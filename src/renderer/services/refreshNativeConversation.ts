/**
 * Bring an already-open native conversation up to date with its transcript.
 *
 * A provider conversation can keep going outside Maestro (the provider's own
 * app, a CLI run), so the tab showing it holds a cached copy that stops at
 * whenever Maestro last read it. Focusing that tab used to show the stale copy
 * forever: `handleResumeSession` returns early for a non-empty tab, by design,
 * since it must never clobber a transcript the user is working in.
 *
 * This is the read-only refresh that fills the gap. It re-reads the SAME native
 * id from the SAME account pool and host through the canonical adapter read and
 * conversion, then appends only what is newer (`mergeNewerEntries`). Nothing is
 * spawned, no model runs, the tab keeps its id, name, draft and position, and no
 * other tab or agent is focused.
 *
 * It refuses whenever Maestro itself may be writing to the tab: a turn running,
 * an item queued for it, or an auto-retry pending. The same checks, plus the
 * tab's identity (runner, account, host, native id), are made again AFTER the
 * read, because the user can send, switch, or close while the disk read is out.
 * A failed read changes nothing: the cached transcript stays on screen and the
 * caller offers a retry.
 */

import type { AITab, LogEntry, Session } from '../types';
import type { ProjectHistoryConversation } from '../../shared/projectHistory';
import { updateSessionWith, useSessionStore } from '../stores/sessionStore';
import { hasPendingRetry } from '../stores/retryStore';
import { logger } from '../utils/logger';
import {
	openTabIdentity,
	runnerAccount,
	runnerCanOpenRecord,
} from '../utils/nativeConversationMatch';
import { resolveSessionProjectPath } from '../components/AgentSessionsBrowser/utils/sessionProjectPath';
import {
	TRANSCRIPT_RESUME_READ_LIMIT,
	bindDelayedOwnSends,
	mergeNewerEntries,
	reconcileTranscriptEntries,
	stripSynopsisTurns,
	transcriptMessagesToLogEntries,
	type TranscriptMessage,
} from '../utils/transcriptMessages';

/**
 * How many times one refresh doubles its window while the newest window does
 * not reach back to anything the tab already shows (more than a window's worth
 * was written elsewhere). Reading past the tab's last known message is what
 * keeps the splice gap-free; a refresh that cannot reach it changes nothing.
 */
const MAX_WIDEN_STEPS = 6;

/**
 * `mismatch`: the supplied native record is not readable by this runner as it
 * is now (another provider, host or account pool). Nothing is read.
 * `changed`: the tab or its runner changed identity while the read was out.
 */
export type NativeRefreshSkipReason =
	| 'missing'
	| 'busy'
	| 'queued'
	| 'retrying'
	| 'mismatch'
	| 'changed';

export type NativeRefreshResult =
	/**
	 * `added`: entries appended at the tail. `upgraded`: native messages already
	 * on screen that were rewritten into the current conversion (an older build
	 * cached them with tool calls as text).
	 */
	| { status: 'updated'; added: number; upgraded?: number }
	| { status: 'unchanged' }
	| { status: 'skipped'; reason: NativeRefreshSkipReason }
	| { status: 'failed'; error: string };

export interface NativeRefreshTarget {
	sessionId: string;
	tabId: string;
	/**
	 * The native history record this tab was matched to, when known. It pins the
	 * transcript's own project path and account pool, which can differ from the
	 * runner's current directory (the runner moved, the conversation did not).
	 * It is checked against the runner as it is NOW, before and after the read:
	 * a record scanned while the runner was on another account must not be read
	 * into it.
	 */
	record?: ProjectHistoryConversation;
}

/**
 * Whether `record` still describes what this tab's runner reads: the same
 * native id, provider and host, and no explicit account contradicting the
 * record's pool. Same rules as opening a record into a runner main named
 * (`runnerCanOpenRecord` without proof): a runner on the default account sets
 * no override, so "unknown" is accepted and only a contradiction refuses.
 * The record's projectPath is deliberately NOT compared - a conversation keeps
 * its own directory when the runner moves.
 */
export function nativeRecordFitsTab(
	session: Session,
	tab: AITab,
	record: ProjectHistoryConversation
): boolean {
	return (
		!!tab.agentSessionId &&
		record.nativeSessionId === tab.agentSessionId &&
		runnerCanOpenRecord(runnerAccount(session), record, false)
	);
}

/** Why Maestro must not touch this tab's transcript right now, or null. */
export function nativeRefreshBlocker(
	session: Session | undefined,
	tab: AITab | undefined
): NativeRefreshSkipReason | null {
	if (!session || !tab || !tab.agentSessionId) return 'missing';
	if (tab.state === 'busy') return 'busy';
	if ((session.executionQueue ?? []).some((item) => item.tabId === tab.id)) return 'queued';
	if (hasPendingRetry(session.id, tab.id)) return 'retrying';
	return null;
}

function locate(sessionId: string, tabId: string): { session?: Session; tab?: AITab } {
	const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
	return { session, tab: session?.aiTabs?.find((t) => t.id === tabId) };
}

/** Runner + account + host + native id: what must not change during the read. */
function identityOf(session: Session, tab: AITab): string {
	return openTabIdentity(runnerAccount(session), tab.agentSessionId ?? '');
}

/**
 * Upgrade the entries the tab already shows (same native message, same id and
 * moment; see `reconcileTranscriptEntries`), then append what is newer. The
 * upgrade runs first so the merge anchors on the canonical entries; it never
 * moves or drops a local entry, so the merge sees the tab's own tail intact.
 * `null` exactly when the merge cannot line the two up.
 */
function upgradeAndMerge(
	loaded: LogEntry[],
	visible: LogEntry[],
	partialWindow: boolean
): { logs: LogEntry[]; added: number; upgraded: number } | null {
	// A tail read has no evidence about the older prefix. In particular, legacy
	// envelope removal must not rewrite entries outside this window. Keep that
	// prefix verbatim, including object identity; full reads retain the existing
	// upgrade behavior. Without a shared id only the ordered merge can help.
	const loadedIds = new Set(loaded.map((entry) => entry.id));
	const windowStart = partialWindow ? visible.findIndex((entry) => loadedIds.has(entry.id)) : 0;
	const upgrade =
		windowStart < 0
			? { logs: visible, upgraded: 0 }
			: reconcileTranscriptEntries(loaded, visible.slice(windowStart));
	const upgradedLogs =
		upgrade.upgraded > 0 ? [...visible.slice(0, windowStart), ...upgrade.logs] : visible;
	// A prompt Maestro sent whose native copy was written late (pre-turn context
	// compaction) is tied to it here, and a duplicate an earlier refresh showed
	// for it is repaired, before the merge decides what is new.
	const own = bindDelayedOwnSends(loaded, upgradedLogs);
	const merged = mergeNewerEntries(loaded, own.logs);
	if (!merged) return null;
	return { logs: merged.logs, added: merged.added, upgraded: upgrade.upgraded + own.bound };
}

const inFlight = new Map<string, Promise<NativeRefreshResult>>();

/** Test seam: forget refreshes still in flight between tests. */
export function resetNativeConversationRefreshes(): void {
	inFlight.clear();
}

async function refreshNow(target: NativeRefreshTarget): Promise<NativeRefreshResult> {
	const { sessionId, tabId, record } = target;
	const before = locate(sessionId, tabId);
	const blocked = nativeRefreshBlocker(before.session, before.tab);
	if (blocked) return { status: 'skipped', reason: blocked };
	const session = before.session!;
	const tab = before.tab!;
	const nativeId = tab.agentSessionId!;
	// A record scanned earlier may name a pool this runner no longer reads (its
	// account was switched). Refuse before any I/O rather than read pool A into
	// a runner now on pool B.
	if (record && !nativeRecordFitsTab(session, tab, record)) {
		return { status: 'skipped', reason: 'mismatch' };
	}
	const identity = identityOf(session, tab);

	const { projectPathForSessions, sshRemoteId } = resolveSessionProjectPath(session);
	const projectRoot = record?.projectPath || projectPathForSessions;
	if (!projectRoot) return { status: 'failed', error: 'No project path for this conversation' };

	let loaded: LogEntry[] = [];
	let partialWindow = false;
	let merged: ReturnType<typeof upgradeAndMerge> = null;
	try {
		const baseLimit = Math.max(TRANSCRIPT_RESUME_READ_LIMIT, tab.logs?.length ?? 0);
		const limits = Array.from({ length: MAX_WIDEN_STEPS + 1 }, (_, step) => baseLimit * 2 ** step);
		// Usually a shared native id is in the last 500 messages. If not, retain
		// the old window and all six doublings: an untimed live tab may need its
		// entire user sequence before there is enough evidence for an anchor.
		if (baseLimit > TRANSCRIPT_RESUME_READ_LIMIT) limits.unshift(TRANSCRIPT_RESUME_READ_LIMIT);
		for (const limit of limits) {
			const result = await window.maestro.agentSessions.read(
				session.toolType || 'claude-code',
				projectRoot,
				nativeId,
				{
					offset: 0,
					limit,
					ownerAgentId: sessionId,
					...(record?.accountDir ? { configDir: record.accountDir } : {}),
					// A catch-up is a background read: it must never restore or
					// rewrite a transcript file (starred restoration stays on the
					// user-driven open paths).
					readOnly: true,
				},
				sshRemoteId
			);
			loaded = transcriptMessagesToLogEntries(
				stripSynopsisTurns((result?.messages ?? []) as TranscriptMessage[])
			);
			partialWindow = result?.hasMore === true;
			// An unreadable transcript comes back empty from several adapters
			// rather than throwing. It is never a reason to empty a full tab.
			if (loaded.length === 0) {
				// A valid tail may contain only filtered native envelopes. Read
				// farther back before treating an empty conversion as unreadable.
				if (partialWindow) continue;
				return { status: 'failed', error: 'The conversation could not be read' };
			}
			// Merge against the tab as it is NOW: a backfill may have prepended,
			// and the merge only ever appends to whatever is there.
			const current = locate(sessionId, tabId).tab;
			merged = upgradeAndMerge(loaded, current?.logs ?? tab.logs ?? [], partialWindow);
			if (merged || !result?.hasMore) break;
		}
	} catch (error) {
		logger.warn('[refreshNativeConversation] Read failed', undefined, error);
		return {
			status: 'failed',
			error: error instanceof Error ? error.message : 'Failed to read the conversation',
		};
	}
	if (!merged) {
		return { status: 'failed', error: 'Newer messages could not be lined up with this tab' };
	}
	if (merged.added === 0 && merged.upgraded === 0) return { status: 'unchanged' };
	// There is no await between the last merge and this synchronous store write.
	// Reuse that result; running all three merge functions again only repeats
	// work on the same logs. Identity and write blockers are still checked below.
	const next = merged;

	// Re-check everything after the await, inside the store update, so the write
	// lands on exactly the state that was checked (a session removed meanwhile
	// never reaches the updater and stays `changed`). Only this tab's `logs`
	// change: no focus, name, draft, queue or other tab is touched.
	let outcome: NativeRefreshResult = { status: 'skipped', reason: 'changed' };
	updateSessionWith(sessionId, (s) => {
		const fresh = s.aiTabs?.find((t) => t.id === tabId);
		const blocker = nativeRefreshBlocker(s, fresh);
		if (blocker) {
			outcome = { status: 'skipped', reason: blocker };
			return s;
		}
		if (
			!fresh ||
			fresh.agentSessionId !== nativeId ||
			identityOf(s, fresh) !== identity ||
			(record && !nativeRecordFitsTab(s, fresh, record))
		) {
			outcome = { status: 'skipped', reason: 'changed' };
			return s;
		}
		outcome = {
			status: 'updated',
			added: next.added,
			...(next.upgraded > 0 ? { upgraded: next.upgraded } : {}),
		};
		return {
			...s,
			aiTabs: s.aiTabs.map((t) => (t.id === tabId ? { ...t, logs: next.logs } : t)),
		};
	});
	return outcome;
}

/**
 * Append whatever the native transcript gained since this tab last read it.
 * Never throws, never focuses anything, and a second call for the same tab
 * while one is reading joins the first.
 */
export function refreshNativeConversation(
	target: NativeRefreshTarget
): Promise<NativeRefreshResult> {
	const key = `${target.sessionId}:${target.tabId}`;
	const running = inFlight.get(key);
	if (running) return running;
	const promise = refreshNow(target)
		.catch(
			(error): NativeRefreshResult => ({
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			})
		)
		.finally(() => inFlight.delete(key));
	inFlight.set(key, promise);
	return promise;
}

/**
 * Whether native metadata says the transcript moved past what the tab shows.
 * `attemptedAt` is the newest `modifiedAt` already refreshed for, so a record
 * whose newest messages convert to nothing (tool-only output) cannot trigger a
 * read on every scan.
 */
export function nativeConversationLooksNewer(
	tab: Pick<AITab, 'logs' | 'createdAt'>,
	modifiedAt: number,
	attemptedAt = 0
): boolean {
	if (!Number.isFinite(modifiedAt) || modifiedAt <= attemptedAt) return false;
	const logs = tab.logs ?? [];
	let newest = tab.createdAt ?? 0;
	for (const entry of logs) if (entry.timestamp > newest) newest = entry.timestamp;
	// Disk and renderer clocks disagree by a little; a second of slack keeps a
	// turn Maestro just ran from looking like an external change.
	return modifiedAt > newest + 1_000;
}
