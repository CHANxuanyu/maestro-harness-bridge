import type { ConversationPermissionSnapshot } from '../../shared/window-types';
import { resolveTabPermissionMode } from '../../shared/agentMetadata';
import { permissionModeFields } from './tabHelpers/focusFields';
import type { AITab, Session } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import { sessionProjectKey, sessionHost } from './nativeConversationMatch';
import { visibleAiTabs } from './unifiedTabOrderUtils';

/** Keep project membership and retained conversation inventory in one place. */
function projectSessions(session: Session): Session[] {
	const state = useSessionStore.getState();
	const sessions = state.sessions.some((item) => item.id === session.id)
		? state.sessions.map((item) => (item.id === session.id ? session : item))
		: [...state.sessions, session];
	const owners = new Map(sessions.map((item) => [item.id, item]));
	const groups = new Map(state.groups.map((group) => [group.id, group]));
	const projectKey = sessionProjectKey(session, owners, groups).key;
	return sessions.filter(
		(owner) =>
			owner.toolType !== 'terminal' &&
			sessionHost(owner) === sessionHost(session) &&
			sessionProjectKey(owner, owners, groups).key === projectKey
	);
}

function knownConversations(session: Session): AITab[] {
	return visibleAiTabs([
		...new Map([
			...(session.closedTabHistory ?? []).map(({ tab }) => [tab.id, tab] as const),
			...(session.unifiedClosedTabHistory ?? []).flatMap((entry) =>
				entry.type === 'ai' ? [[entry.tab.id, entry.tab] as const] : []
			),
			...session.aiTabs.map((tab) => [tab.id, tab] as const),
		]).values(),
	]);
}

function conversationActivity(tab: AITab): number {
	return tab.logs.reduce(
		(time, log) => Math.max(time, log.timestamp),
		Math.max(tab.createdAt, tab.lastSelectedAt ?? 0)
	);
}

/** Local inventory only. User creation paths must resolve the owners first. */
export function recentProjectConversation(
	session: Session
): { session: Session; tab: AITab } | undefined {
	let recent: { session: Session; tab: AITab } | undefined;
	let latest = -Infinity;
	for (const owner of projectSessions(session)) {
		for (const tab of knownConversations(owner)) {
			const activity = conversationActivity(tab);
			if (activity > latest) {
				recent = { session: owner, tab };
				latest = activity;
			}
		}
	}
	return recent;
}

/** Called in the owner without persistence, transcripts, or another window request. */
export function conversationPermissionSnapshot(
	sessionId: string
): ConversationPermissionSnapshot | null {
	const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
	return session
		? {
				sessionId,
				tabs: knownConversations(session).map((tab) => ({
					id: tab.id,
					...permissionModeFields(resolveTabPermissionMode(tab)),
					lastActivity: conversationActivity(tab),
				})),
			}
		: null;
}

/** Main queries all owners concurrently under one 250 ms deadline. */
export async function resolveProjectConversationPermission(
	session: Session
): Promise<ReturnType<typeof permissionModeFields>> {
	const owners = projectSessions(session);
	let snapshots: Array<ConversationPermissionSnapshot | null> | undefined;
	try {
		snapshots = await window.maestro.windows?.getConversationPermissions?.(
			owners.map((owner) => owner.id)
		);
	} catch {
		/* An unavailable owner uses the conservative local fallback below. */
	}
	const complete =
		snapshots?.length === owners.length &&
		snapshots.every((snapshot, index) => snapshot?.sessionId === owners[index].id);
	if (complete) {
		const latest = snapshots!
			.flatMap((snapshot) => snapshot!.tabs)
			.reduce<
				ConversationPermissionSnapshot['tabs'][number] | undefined
			>((recent, tab) => (!recent || tab.lastActivity > recent.lastActivity ? tab : recent), undefined);
		return permissionModeFields(resolveTabPermissionMode(latest));
	}
	// Do not guess recency from a stale peer. Retain every known restriction,
	// including replies that succeeded while another owner was unavailable.
	const current =
		useSessionStore.getState().sessions.find((item) => item.id === session.id) ?? session;
	const known = [
		...projectSessions(current).flatMap(knownConversations),
		...(snapshots ?? []).flatMap((snapshot) => snapshot?.tabs ?? []),
	];
	const modes = known.map(resolveTabPermissionMode);
	return permissionModeFields(
		modes.includes('readonly') ? 'readonly' : modes.includes('standard') ? 'standard' : 'full'
	);
}
