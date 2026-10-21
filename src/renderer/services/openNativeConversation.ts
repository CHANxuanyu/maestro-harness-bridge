/**
 * Opening a native conversation from the Left Bar's project tree.
 *
 * One click on a history row must leave the user in that conversation, ready
 * to continue in its ORIGINAL harness: same provider, path, host and account.
 * There is no picker. The order of preference is:
 *
 *  1. a tab already open on that native id, in ANY compatible runner (focus it);
 *  2. the compatible runner main reported (`ownerId`), or one found in the store;
 *  3. a new runner created for exactly that provider/path/host/account, its
 *     initial tab bound to the native id so no blank tab is left behind.
 *
 * The transcript itself is loaded by the canonical `handleResumeSession`
 * (native read + conversion, dedup against a racing click), never re-parsed
 * here, and nothing is spawned just to display history. A failed open removes
 * a runner it created, so a bad snapshot never leaves clutter, and never
 * starts a new provider session in its place (no silent fork).
 *
 * Opens are serialized and the newest request wins focus: clicking A then B
 * ends in B even when A's disk read finishes last.
 */

import type { Session, ToolType } from '../types';
import type { ProjectHistoryConversation } from '../../shared/projectHistory';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGroupChatStore } from '../stores/groupChatStore';
import { useModalStore } from '../stores/modalStore';
import { createMergedSession, focusAiTabInSession, visibleAiTabs } from '../utils/tabHelpers';
import { runnerAccount, runnerCanOpenRecord } from '../utils/nativeConversationMatch';
import { refreshNativeConversation } from './refreshNativeConversation';

/** The canonical resume (`useAgentSessionManagement().handleResumeSession`). */
export type ResumeNativeSession = (
	agentSessionId: string,
	providedMessages?: undefined,
	sessionName?: string,
	starred?: boolean,
	usageStats?: undefined,
	projectPath?: string,
	opts?: { targetSessionId?: string; suppressUnavailableFlash?: boolean; configDir?: string }
) => Promise<boolean>;

export type OpenNativeConversationResult =
	| { status: 'opened'; ownerId: string }
	| { status: 'superseded' }
	| { status: 'failed' };

let chain: Promise<unknown> = Promise.resolve();
let latestTicket = 0;
let lastDirectSelection: { ownerId: string; tabId: string } | null = null;

/**
 * Called when the user navigates somewhere directly (an open row, a new
 * conversation), so a history open still loading cannot take focus back.
 */
export function noteDirectSelection(ownerId: string, tabId: string | null): void {
	latestTicket++;
	lastDirectSelection = tabId ? { ownerId, tabId } : null;
}

/** Test seam: forget queued work between tests. */
export function resetNativeConversationOpens(): void {
	chain = Promise.resolve();
	latestTicket = 0;
	lastDirectSelection = null;
}

/**
 * A runner already showing this native conversation in a visible tab. Only
 * a runner PROVEN to read the record's account pool counts: the same native
 * id open on another account is a different conversation.
 */
export function findOpenNativeTab(
	sessions: Session[],
	record: ProjectHistoryConversation
): { ownerId: string; tabId: string } | null {
	for (const session of sessions) {
		if (!runnerCanOpenRecord(runnerAccount(session), record, true)) continue;
		const tab = visibleAiTabs(session.aiTabs).find(
			(candidate) => candidate.agentSessionId === record.nativeSessionId
		);
		if (tab) return { ownerId: session.id, tabId: tab.id };
	}
	return null;
}

/**
 * The runner to resume into, without creating one. Main's `ownerId` is
 * trusted (it resolved the account, including the default one, which sets no
 * env var) unless the runner explicitly names another account. Any other
 * runner must prove it reads the same pool.
 */
export function findCompatibleOwner(
	sessions: Session[],
	record: ProjectHistoryConversation
): Session | null {
	const hinted = record.ownerId ? sessions.find((s) => s.id === record.ownerId) : undefined;
	if (hinted && runnerCanOpenRecord(runnerAccount(hinted), record, false)) return hinted;
	return (
		sessions.find(
			(session) =>
				session.toolType !== 'terminal' &&
				(session.projectRoot || session.cwd) === record.projectPath &&
				runnerCanOpenRecord(runnerAccount(session), record, true)
		) ?? null
	);
}

/**
 * The provider-level env vars (Settings -> Agents). An agent's own
 * `customEnvVars` REPLACE these rather than layering, so a new runner that pins
 * its account must carry them along or it silently drops the user's provider
 * setup (gateway, keys, flags).
 */
async function providerEnvVars(provider: string): Promise<Record<string, string> | undefined> {
	try {
		const config = await window.maestro?.agents?.getConfig?.(provider);
		const env = config?.customEnvVars;
		return env && typeof env === 'object' ? (env as Record<string, string>) : undefined;
	} catch {
		return undefined;
	}
}

/** A runner for exactly this transcript's provider, path, host and account. */
export function createOwnerForConversation(
	record: ProjectHistoryConversation,
	providerEnv?: Record<string, string>
): Session {
	const settings = useSettingsStore.getState();
	const groupId = record.projectKey.startsWith('group:')
		? record.projectKey.slice('group:'.length)
		: undefined;
	const { session, tabId } = createMergedSession({
		name: getAgentDisplayName(record.provider),
		projectRoot: record.projectPath,
		toolType: record.provider as ToolType,
		mergedLogs: [],
		groupId,
		saveToHistory: settings.defaultSaveToHistory,
		showThinking: settings.defaultShowThinking,
	});
	return {
		...session,
		// Bind the initial tab to the native id: the resume fills THIS tab
		// instead of adding a second one beside an empty first.
		aiTabs: session.aiTabs.map((tab) =>
			tab.id === tabId ? { ...tab, agentSessionId: record.nativeSessionId } : tab
		),
		shellLogs: [],
		...(record.accountEnvVar && record.accountDir
			? { customEnvVars: { ...providerEnv, [record.accountEnvVar]: record.accountDir } }
			: {}),
		...(record.sshRemoteId
			? { sessionSshRemoteConfig: { enabled: true, remoteId: record.sshRemoteId } }
			: {}),
	};
}

function selectOwner(ownerId: string): void {
	useGroupChatStore.getState().setActiveGroupChatId(null);
	useSessionStore.getState().setActiveSessionId(ownerId);
	useModalStore.getState().closeModal('agentSessions');
}

async function openNow(
	record: ProjectHistoryConversation,
	title: string,
	resume: ResumeNativeSession,
	ticket: number
): Promise<OpenNativeConversationResult> {
	// Superseded while queued: the user has already moved on.
	if (ticket !== latestTicket) return { status: 'superseded' };
	const store = useSessionStore.getState();
	const open = findOpenNativeTab(store.sessions, record);
	let owner: Session | null = open
		? (store.sessions.find((s) => s.id === open.ownerId) ?? null)
		: findCompatibleOwner(store.sessions, record);
	let createdId: string | null = null;
	let providerEnv: Record<string, string> | undefined;
	if (!owner) {
		providerEnv = record.accountEnvVar ? await providerEnvVars(record.provider) : undefined;
		// The store may have gained a compatible runner while the config was read.
		owner = findCompatibleOwner(useSessionStore.getState().sessions, record);
	}
	if (!owner) {
		owner = createOwnerForConversation(record, providerEnv);
		createdId = owner.id;
		useSessionStore.getState().addSession(owner);
	}
	const ownerId = owner.id;

	let ok = false;
	try {
		ok = await resume(
			record.nativeSessionId,
			undefined,
			title || undefined,
			record.starred || undefined,
			undefined,
			record.projectPath,
			{
				targetSessionId: ownerId,
				suppressUnavailableFlash: true,
				// The exact pool the row came from; a just-created owner is not persisted
				// yet, so main cannot resolve its account from the owner id alone.
				...(record.accountDir ? { configDir: record.accountDir } : {}),
			}
		);
	} catch {
		ok = false;
	}

	if (!ok) {
		if (createdId) {
			const created = useSessionStore.getState().sessions.find((s) => s.id === createdId);
			const untouched =
				created &&
				created.aiTabs.every((tab) => (tab.logs?.length ?? 0) === 0 && tab.state !== 'busy');
			if (untouched) useSessionStore.getState().removeSession(createdId);
		}
		return { status: 'failed' };
	}

	// The resume only FOCUSES a tab that already has a transcript; bring that
	// copy up to date with the native file. Read-only, never moves focus, and a
	// failure leaves the cached transcript in place.
	if (open) {
		void refreshNativeConversation({ sessionId: open.ownerId, tabId: open.tabId, record });
	}

	if (ticket !== latestTicket) {
		// The resume focused its tab inside the owner. If the user meanwhile
		// picked another tab of that same runner, put them back there.
		const direct = lastDirectSelection;
		if (direct && direct.ownerId === ownerId) {
			useSessionStore
				.getState()
				.setSessions((prev) =>
					prev.map((s) => (s.id === ownerId ? focusAiTabInSession(s, direct.tabId) : s))
				);
		}
		return { status: 'superseded' };
	}
	selectOwner(ownerId);
	return { status: 'opened', ownerId };
}

/** Open (or focus) a native conversation. Never throws. */
export function openNativeConversation(
	record: ProjectHistoryConversation,
	title: string,
	resume: ResumeNativeSession
): Promise<OpenNativeConversationResult> {
	const ticket = ++latestTicket;
	lastDirectSelection = null;
	const result = chain.then(() => openNow(record, title, resume, ticket));
	chain = result.catch(() => undefined);
	return result.catch(() => ({ status: 'failed' }) as const);
}
