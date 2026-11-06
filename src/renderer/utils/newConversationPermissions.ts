import type { ConversationPermissionSnapshot } from '../../shared/window-types';
import { resolveTabPermissionMode } from '../../shared/agentMetadata';
import { permissionModeFields } from './tabHelpers/focusFields';
import type { AgentCapabilities } from '../../shared/types';
import { useSettingsStore } from '../stores/settingsStore';
import { getCachedCapabilities } from '../hooks/agent/useAgentCapabilities';
import type { AITab, Session } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import { sessionProjectKey, sessionHost } from './nativeConversationMatch';
import { visibleAiTabs } from './unifiedTabOrderUtils';

/** New conversations may keep or tighten the source permission, never widen it. */
export function newConversationPermissionFields(
	source?: Pick<AITab, 'permissionMode' | 'readOnlyMode'>,
	capabilities?: Pick<AgentCapabilities, 'supportsReadOnlyMode' | 'supportsStandardPermissionMode'>
): ReturnType<typeof permissionModeFields> | null {
	let mode = resolveTabPermissionMode(source);
	if (mode === 'standard' && capabilities && !capabilities.supportsStandardPermissionMode)
		mode = 'readonly';
	if (mode === 'readonly' && capabilities && !capabilities.supportsReadOnlyMode) return null;
	return permissionModeFields(mode);
}

/** Reopening validates against the current tool, including retained and orphan tabs. */
export function restoreConversationPermissions(session: Session, tab: AITab): AITab | null {
	if (!useSettingsStore.getState().newShell) return tab;
	const permissions = newConversationPermissionFields(
		tab,
		getCachedCapabilities(session.toolType) ?? {
			supportsReadOnlyMode: false,
			supportsStandardPermissionMode: false,
		}
	);
	return permissions ? { ...tab, ...permissions } : null;
}

function permissionProjectIdentity(session: Session) {
	const state = useSessionStore.getState();
	return {
		projectKey: sessionProjectKey(
			session,
			new Map(state.sessions.map((owner) => [owner.id, owner])),
			new Map(state.groups.map((group) => [group.id, group]))
		).key,
		host: sessionHost(session) ?? null,
	};
}

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
				...permissionProjectIdentity(session),
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
	const identity = permissionProjectIdentity(session);
	let snapshots: Array<ConversationPermissionSnapshot | null> | undefined;
	try {
		snapshots = await window.maestro.windows?.getConversationPermissions?.(
			owners.map((owner) => owner.id)
		);
	} catch {
		/* An unavailable owner cannot authorize permissions from a cached copy. */
	}
	const complete =
		snapshots?.length === owners.length &&
		snapshots.every(
			(snapshot, index) =>
				snapshot?.sessionId === owners[index].id &&
				typeof snapshot.projectKey === 'string' &&
				(snapshot.host === null || typeof snapshot.host === 'string')
		);
	if (!complete) return permissionModeFields('readonly');
	const matchesProject = (snapshot: ConversationPermissionSnapshot) =>
		snapshot.projectKey === identity.projectKey && snapshot.host === identity.host;
	const target = snapshots!.find((snapshot) => snapshot!.sessionId === session.id)!;
	if (!target || !matchesProject(target)) return permissionModeFields('readonly');
	const latest = snapshots!
		.filter((snapshot) => matchesProject(snapshot!))
		.flatMap((snapshot) => snapshot!.tabs)
		.reduce<ConversationPermissionSnapshot['tabs'][number] | undefined>(
			(recent, tab) => (!recent || tab.lastActivity > recent.lastActivity ? tab : recent),
			undefined
		);
	return permissionModeFields(resolveTabPermissionMode(latest));
}
