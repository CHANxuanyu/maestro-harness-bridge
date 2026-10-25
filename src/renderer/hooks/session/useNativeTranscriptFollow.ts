/**
 * useNativeTranscriptFollow - keep the conversation on screen current while the
 * same native Codex or Claude session is also being continued from another app.
 *
 * The project history scan (useProjectHistory) only runs on focus and on a slow
 * interval, so with both windows visible a turn sent from the other app could
 * sit unseen for minutes. This follows exactly ONE conversation: the visible AI
 * tab of the active agent, when it is a LOCAL Codex or Claude tab bound to a native id
 * and Maestro is not writing to it itself (no turn running, nothing queued for
 * it, no auto-retry pending).
 *
 * Every ~2s it asks main for the transcript's opaque stat revision, which is a
 * stat-only check while nothing changed. Only when the revision differs from
 * the last one consumed does it run the canonical read-only catch-up
 * (`refreshNativeConversation`, which appends through `mergeNewerEntries` and
 * re-checks identity, busy, queue and retry state around its read). The
 * revision is read BEFORE the transcript and is consumed only when that
 * catch-up succeeds or finds nothing new, so a write landing during the read is
 * seen on the next tick, and a failed or skipped catch-up keeps its retry.
 *
 * Nothing here sends, spawns, resumes, focuses, renames or touches a draft or
 * queue; the only write is the refresh's append to that tab's logs. Remote
 * (SSH) agents, other providers, hidden windows and builds whose preload lacks
 * `getTranscriptRevision` are left to the existing history scan.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useGroupChatStore } from '../../stores/groupChatStore';
import {
	nativeRefreshBlocker,
	refreshNativeConversation,
} from '../../services/refreshNativeConversation';
import { resolveSessionProjectPath } from '../../components/AgentSessionsBrowser/utils/sessionProjectPath';
import { openTabIdentity, runnerAccount } from '../../utils/nativeConversationMatch';
import { useEventListener } from '../utils/useEventListener';

/** How often the visible conversation's revision is checked. */
export const NATIVE_FOLLOW_POLL_MS = 2_000;
/**
 * After a failed catch-up, how long the SAME revision waits before it is read
 * again. A new revision retries at once; this only stops an unreadable file
 * from being re-read in full every two seconds.
 */
export const NATIVE_FOLLOW_FAILED_RETRY_MS = 15_000;
/**
 * Conversations remembered per map (consumed revisions, failed revisions), so
 * switching between tabs does not re-read while a long-running window cannot
 * grow either map without limit.
 */
export const NATIVE_FOLLOW_MAX_REMEMBERED = 64;

export interface NativeFollowTarget {
	/** Agent + tab + canonical runner identity (provider, host, account, native id) + path. */
	key: string;
	sessionId: string;
	tabId: string;
	agentId: string;
	projectPath: string;
	nativeId: string;
}

/**
 * The one conversation to follow right now, or null. Read from the stores at
 * call time, so every await can re-ask it and drop a result that no longer
 * describes what is on screen.
 */
export function resolveNativeFollowTarget(): NativeFollowTarget | null {
	if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return null;
	// A group chat replaces the transcript on screen.
	if (useGroupChatStore.getState().activeGroupChatId) return null;
	const { sessions, activeSessionId } = useSessionStore.getState();
	const session = sessions.find((s) => s.id === activeSessionId);
	if (
		!session ||
		!['codex', 'claude-code', 'opencode', 'omp', 'copilot-cli'].includes(session.toolType)
	)
		return null;
	// The AI tab must be what the main window shows (not a file, browser or
	// terminal tab drawn over it).
	if (
		session.inputMode !== 'ai' ||
		session.activeFileTabId ||
		session.activeBrowserTabId ||
		session.activeTerminalTabId
	) {
		return null;
	}
	const tab = session.aiTabs?.find((t) => t.id === session.activeTabId);
	if (!tab || tab.hidden || !tab.agentSessionId) return null;
	if (nativeRefreshBlocker(session, tab)) return null;
	const { projectPathForSessions, sshRemoteId } = resolveSessionProjectPath(session);
	// Remote transcripts have no local revision; the history scan keeps them.
	if (sshRemoteId || !projectPathForSessions) return null;
	const identity = openTabIdentity(runnerAccount(session), tab.agentSessionId);
	return {
		key: [session.id, tab.id, identity, projectPathForSessions].join('\u0000'),
		sessionId: session.id,
		tabId: tab.id,
		agentId: session.toolType,
		projectPath: projectPathForSessions,
		nativeId: tab.agentSessionId,
	};
}

/**
 * Set `key` as the most recently used entry and drop the least recently used
 * beyond the bound (a Map iterates in insertion order).
 */
export function rememberBounded<V>(
	map: Map<string, V>,
	key: string,
	value: V,
	max = NATIVE_FOLLOW_MAX_REMEMBERED
): void {
	map.delete(key);
	map.set(key, value);
	while (map.size > max) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

export function useNativeTranscriptFollow(): void {
	// The revision each conversation was last brought up to date with.
	const consumed = useRef(new Map<string, string>());
	// The revision whose catch-up last failed, and when.
	const failed = useRef(new Map<string, { revision: string; at: number }>());
	const running = useRef(false);
	const disposed = useRef(false);
	const lastKey = useRef<string | null>(null);

	const check = useCallback(async () => {
		// One check at a time: a slow read must not stack up behind the timer.
		if (running.current || disposed.current) return;
		const getRevision = window.maestro?.agentSessions?.getTranscriptRevision;
		if (typeof getRevision !== 'function') return;
		const target = resolveNativeFollowTarget();
		if (!target) return;
		running.current = true;
		try {
			let revision: string | null;
			try {
				revision = await getRevision(target.agentId, target.projectPath, target.nativeId, {
					ownerAgentId: target.sessionId,
				});
			} catch {
				// Unavailable is not a change; the history scan still covers it.
				return;
			}
			if (disposed.current || !revision) return;
			// The selection, identity or busy state may have moved while main
			// answered; that revision describes something no longer on screen.
			if (resolveNativeFollowTarget()?.key !== target.key) return;
			if (consumed.current.get(target.key) === revision) return;
			const lastFailure = failed.current.get(target.key);
			if (
				lastFailure &&
				lastFailure.revision === revision &&
				Date.now() - lastFailure.at < NATIVE_FOLLOW_FAILED_RETRY_MS
			) {
				return;
			}

			const result = await refreshNativeConversation({
				sessionId: target.sessionId,
				tabId: target.tabId,
			});
			if (disposed.current) return;
			// Consume the revision only for the conversation it was read for, and
			// only when the catch-up really ran to the end.
			if (resolveNativeFollowTarget()?.key !== target.key) return;
			if (result.status === 'updated' || result.status === 'unchanged') {
				rememberBounded(consumed.current, target.key, revision);
				failed.current.delete(target.key);
			} else if (result.status === 'failed') {
				rememberBounded(failed.current, target.key, { revision, at: Date.now() });
			}
			// `skipped` (busy, queued, retrying, changed): nothing consumed, so the
			// next tick tries again once the blocker clears.
		} finally {
			running.current = false;
		}
	}, []);

	useEffect(() => {
		disposed.current = false;
		const tick = () => {
			void check();
		};
		tick();
		const timer = setInterval(tick, NATIVE_FOLLOW_POLL_MS);
		// A tab switch, a turn ending, a queue draining: check at once rather than
		// on the next tick. Compared as one string, so streaming output (which
		// changes nothing in the key) costs a cheap lookup and no work.
		const unsubscribe = useSessionStore.subscribe(() => {
			const key = resolveNativeFollowTarget()?.key ?? null;
			if (key === lastKey.current) return;
			lastKey.current = key;
			if (key) tick();
		});
		return () => {
			disposed.current = true;
			clearInterval(timer);
			unsubscribe();
		};
	}, [check]);

	// Coming back to the window: check promptly.
	useEventListener('focus', () => void check(), {
		target: typeof window !== 'undefined' ? window : null,
	});
	useEventListener(
		'visibilitychange',
		() => {
			if (document.visibilityState !== 'hidden') void check();
		},
		{ target: typeof document !== 'undefined' ? document : null }
	);
}
