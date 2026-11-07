import { effectiveStandardPermissionCapability } from '../../shared/codexAppServer';
import { projectHistoryScopeFor } from '../../shared/projectHistory';
import {
	refreshConversationArchives,
	useConversationArchiveStore,
} from '../stores/conversationArchiveStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { ConversationPermissionSnapshot } from '../../shared/window-types';
import { resolveTabPermissionMode } from '../../shared/agentMetadata';
import { permissionModeFields } from './tabHelpers/focusFields';
import type { AgentCapabilities } from '../../shared/types';
import { getCachedCapabilities } from '../hooks/agent/useAgentCapabilities';
import type { AITab, Session } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import {
	buildProjectHistoryScopes,
	sessionProjectKey,
	sessionHost,
} from './nativeConversationMatch';
import { visibleAiTabs } from './unifiedTabOrderUtils';

/** New conversations may keep or tighten the source permission, never widen it. */
export function newConversationPermissionFields(
	source?: Pick<AITab, 'permissionMode' | 'readOnlyMode'>,
	capabilities?: Pick<
		AgentCapabilities,
		'supportsReadOnlyMode' | 'supportsStandardPermissionMode' | 'supportsCodexAppServer'
	>,
	remote = true
): ReturnType<typeof permissionModeFields> | null {
	let mode = resolveTabPermissionMode(source);
	if (
		mode === 'standard' &&
		capabilities &&
		!effectiveStandardPermissionCapability(capabilities, useSettingsStore.getState(), remote)
	)
		mode = 'readonly';
	if (mode === 'readonly' && capabilities && !capabilities.supportsReadOnlyMode) return null;
	return permissionModeFields(mode);
}

/** A browser source may tighten, but never widen, its owner's current copy. */
export function remoteConversationPermissionFields(
	source: Pick<AITab, 'permissionMode' | 'readOnlyMode'> | undefined,
	requestedMode: unknown
): ReturnType<typeof permissionModeFields> {
	if (!source || !['full', 'standard', 'readonly'].includes(requestedMode as string))
		return permissionModeFields('readonly');
	const ownerMode = resolveTabPermissionMode(source);
	return permissionModeFields(
		ownerMode === 'readonly' || requestedMode === 'readonly'
			? 'readonly'
			: ownerMode === 'standard' || requestedMode === 'standard'
				? 'standard'
				: 'full'
	);
}

/** Reopening validates against the current tool, including retained and orphan tabs. */
export function restoreConversationPermissions(
	session: Session,
	tab: AITab,
	permissionCeiling?: Pick<AITab, 'permissionMode' | 'readOnlyMode'>
): AITab | null {
	if (!useSettingsStore.getState().newShell) return tab;
	const source = permissionCeiling
		? remoteConversationPermissionFields(tab, resolveTabPermissionMode(permissionCeiling))
		: tab;
	const capabilities = getCachedCapabilities(session.toolType) ?? {
		supportsReadOnlyMode: false,
		supportsStandardPermissionMode: false,
	};
	const permissions = newConversationPermissionFields(
		source,
		capabilities,
		!!session.sessionSshRemoteConfig?.enabled
	);
	// Keep a saved prototype choice when its transport is unavailable. Spawn must
	// report the existing explicit refusal instead of silently changing the mode.
	if (
		tab.turnProvider === 'codex' &&
		capabilities.supportsReadOnlyMode &&
		capabilities.supportsCodexAppServer &&
		resolveTabPermissionMode(source) === 'standard' &&
		!effectiveStandardPermissionCapability(
			capabilities,
			useSettingsStore.getState(),
			!!session.sessionSshRemoteConfig?.enabled
		)
	)
		return { ...tab, ...permissionModeFields('standard') };

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

function knownConversations(session: Session, includeHidden = false): AITab[] {
	const retained = [
		...new Map([
			...(session.closedTabHistory ?? []).map(({ tab }) => [tab.id, tab] as const),
			...(session.unifiedClosedTabHistory ?? []).flatMap((entry) =>
				entry.type === 'ai' ? [[entry.tab.id, entry.tab] as const] : []
			),
			...(session.snoozedTabs ?? []).flatMap((entry) =>
				entry.type === 'ai'
					? [[entry.tab.id, entry.tab] as const]
					: entry.type === 'group'
						? entry.members.flatMap((member) =>
								member.type === 'ai' ? [[member.tab.id, member.tab] as const] : []
							)
						: []
			),
			...(session.orphanedThinkingTabs ?? []).map((tab) => [tab.id, tab] as const),
			...session.aiTabs.map((tab) => [tab.id, tab] as const),
		]).values(),
	];
	const tabs = includeHidden ? retained : visibleAiTabs(retained);
	if (!useSettingsStore.getState().newShell) return tabs;
	const state = useSessionStore.getState();
	const scopes = buildProjectHistoryScopes(
		[...state.sessions.filter((owner) => owner.id !== session.id), session],
		state.groups
	);
	const projectKey = scopes.find((scope) => scope.ownerIds.includes(session.id))?.projectKey;
	const archives = useConversationArchiveStore
		.getState()
		.records.filter(
			(record) =>
				record.sshRemoteId === sessionHost(session) &&
				!!projectKey &&
				projectHistoryScopeFor(scopes, record)?.projectKey === projectKey
		);
	return [
		...tabs.map((tab) =>
			archives.some(
				(record) =>
					record.archived !== false &&
					record.ownerIds.includes(session.id) &&
					record.nativeSessionId === tab.agentSessionId
			)
				? { ...tab, archived: true }
				: tab
		),
		...archives
			.filter(
				(record) =>
					!(
						record.ownerIds.includes(session.id) &&
						tabs.some((tab) => tab.agentSessionId === record.nativeSessionId)
					)
			)
			.map(
				(record): AITab => ({
					id: record.key,
					agentSessionId: record.nativeSessionId,
					archived: record.archived !== false,
					...permissionModeFields(record.permissionMode),
					name: record.title,
					starred: false,
					logs: [],
					inputValue: '',
					stagedImages: [],
					createdAt: record.modifiedAt ?? record.archivedAt,
					state: 'idle',
				})
			),
	];
}

/** Last defense for callers without a resolved source. Only an empty owner uses project recency. */
export function fallbackConversationPermissionSource(session: Session): AITab | undefined {
	const known = knownConversations(session, true);
	return (
		known.find((tab) => resolveTabPermissionMode(tab) === 'readonly') ??
		known.find((tab) => resolveTabPermissionMode(tab) === 'standard') ??
		known[0] ??
		recentProjectConversation(session)?.tab
	);
}

export function conversationActivity(tab: AITab): number {
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
	let strictest: { session: Session; tab: AITab } | undefined;
	for (const owner of projectSessions(session)) {
		for (const tab of knownConversations(owner)) {
			if (tab.archived) {
				const rank = { full: 0, standard: 1, readonly: 2 };
				if (
					!strictest ||
					rank[resolveTabPermissionMode(tab)] > rank[resolveTabPermissionMode(strictest.tab)]
				)
					strictest = { session: owner, tab };
				continue;
			}
			const activity = conversationActivity(tab);
			if (activity > latest) {
				recent = { session: owner, tab };
				latest = activity;
			}
		}
	}
	return recent ?? strictest;
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
					...(tab.archived ? { archived: true } : {}),
				})),
			}
		: null;
}

/** Main queries all owners concurrently under one 250 ms deadline. */
export async function resolveProjectConversationPermission(
	session: Session
): Promise<ReturnType<typeof permissionModeFields>> {
	if (useSettingsStore.getState().newShell) await refreshConversationArchives();
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
	const matching = snapshots!.filter((snapshot) => matchesProject(snapshot!));
	const retainedKeys = new Set(
		useSettingsStore.getState().newShell
			? useConversationArchiveStore.getState().records.map((record) => record.key)
			: []
	);
	const inventory = [
		...matching.flatMap((snapshot) => snapshot!.tabs),
		...owners
			.filter((owner) => matching.some((snapshot) => snapshot!.sessionId === owner.id))
			.flatMap((owner) => knownConversations(owner))
			.filter((tab) => tab.archived || retainedKeys.has(tab.id))
			.map((tab) => ({
				id: tab.id,
				archived: tab.archived,
				...permissionModeFields(resolveTabPermissionMode(tab)),
				lastActivity: conversationActivity(tab),
			})),
	];
	const active = inventory.filter((tab) => !tab.archived);
	if (active.length === 0 && inventory.length > 0) {
		const modes = inventory.map(resolveTabPermissionMode);
		return permissionModeFields(
			modes.includes('readonly') ? 'readonly' : modes.includes('standard') ? 'standard' : 'full'
		);
	}
	const latest = active.reduce<ConversationPermissionSnapshot['tabs'][number] | undefined>(
		(recent, tab) => (!recent || tab.lastActivity > recent.lastActivity ? tab : recent),
		undefined
	);
	return permissionModeFields(resolveTabPermissionMode(latest));
}
