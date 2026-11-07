export { buildProjectHistoryScopes } from './nativeConversationMatch';
import type { ArchivedConversation } from '../../shared/conversationArchive';
import type { Group, Session } from '../types';
import type { ProjectHistoryConversation } from '../../shared/projectHistory';
import { getBasename } from '../../shared/formatters';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { DEEPSEEK_PRESET, sessionProviderId } from '../../shared/agentPresets';
import { isSessionIdLabel, visibleAiTabs } from './tabHelpers';
import { conversationDisplayTitle } from './conversationTitle';
import {
	matchRecordForTab,
	openTabIdentity,
	runnerAccount,
	sessionProjectKey,
} from './nativeConversationMatch';

/** Rows a project shows before "Show more", and how many each press adds. */
export const PROJECT_HISTORY_PAGE_SIZE = 15;

export interface SidebarConversation {
	key: string;
	/**
	 * `open`: an AI tab in this window (it may also be in native history).
	 * `history`: a native transcript with no open tab; opening it resumes it.
	 */
	kind: 'open' | 'history';
	/** Owning runner for an open tab; a compatible runner hint for history, if any. */
	ownerId: string | null;
	/** Open rows only. */
	tabId: string | null;
	provider: string;
	/** Native provider conversation id, when one exists. */
	nativeSessionId: string | null;
	title: string;
	/**
	 * The provider's own name for the conversation, when it differs from
	 * `title` (a tab the user or an older import named something else). Kept as
	 * a search alias and shown on hover so the row stays recognizable from the
	 * provider's app; it never replaces a name the user chose.
	 */
	nativeTitle?: string;
	agentName: string;
	projectPath: string;
	busy: boolean;
	unread: boolean;
	error: boolean;
	starred: boolean;
	canDeleteWorktree?: boolean;
	createdAt: number;
	/** Newest activity we know about; what rows sort and display by. */
	modifiedAt: number;
	/** The backend record this row resumes from (history rows, and open rows it matched). */
	history?: ProjectHistoryConversation;
}

export interface SidebarAgentChoice {
	id: string;
	name: string;
	provider: string;
	projectPath: string;
}

export interface SidebarProject {
	archivedConversations?: ArchivedConversation[];
	key: string;
	groupId?: string;
	name: string;
	emoji?: string;
	depth: number;
	collapsed: boolean;
	/** Visible rows (recent page, plus every open tab). */
	conversations: SidebarConversation[];
	/** Conversations matching the current filters, before the page limit. */
	totalCount: number;
	/** Matching conversations hidden behind "Show more". */
	hiddenCount: number;
	/** One entry per provider: the configuration a NEW conversation starts in. */
	agents: SidebarAgentChoice[];
}

export { sessionProjectKey } from './nativeConversationMatch';

interface ProjectSessionTreeOptions {
	archives?: ArchivedConversation[];
	sessions: Session[];
	/** Already in the user's sidebar group order. */
	groups: Group[];
	groupsPlusEnabled?: boolean;
	collapsedProjects?: string[];
	search?: string;
	unreadOnly?: boolean;
	/** Native conversations from `agentSessions.listProjectHistory`. */
	history?: ProjectHistoryConversation[];
	/** Only rows of this provider, when set. */
	providerFilter?: string | null;
	/** Per-project row limit; defaults to {@link PROJECT_HISTORY_PAGE_SIZE}. */
	rowLimits?: Record<string, number>;
}

function sessionPath(session: Session): string {
	return session.projectRoot || session.cwd;
}

/**
 * A native record is filed under its harness (`claude-code`), but a DeepSeek
 * preset's transcripts live in that preset's own account directory and are
 * DeepSeek's conversations to the user. The owner says so when there is one;
 * the account directory says so when the runner has since been removed.
 */
function historyProviderId(
	record: ProjectHistoryConversation,
	owner: Session | undefined,
	sessions: Session[]
): string {
	if (owner) return sessionProviderId(owner);
	const deepseekAccount =
		!!record.accountDir &&
		sessions.some(
			(session) =>
				sessionProviderId(session) === DEEPSEEK_PRESET.id &&
				session.customEnvVars?.CLAUDE_CONFIG_DIR === record.accountDir
		);
	return deepseekAccount ? DEEPSEEK_PRESET.id : record.provider;
}

/** A readable title: never a bare id when a name or the first message exists. */
export function historyTitle(conversation: ProjectHistoryConversation): string {
	const title = conversation.title?.trim();
	if (
		title &&
		title !== conversation.nativeSessionId &&
		!isSessionIdLabel(title, conversation.nativeSessionId)
	)
		return title;
	return conversation.preview?.trim().split('\n')[0] ?? '';
}

/**
 * The provider's own title for a record, independent of any Maestro display
 * name main applied on top (`title`). Older backends only send `title`.
 */
export function nativeTitleOf(record: ProjectHistoryConversation): string {
	const native = record.nativeTitle?.trim();
	if (
		native &&
		native !== record.nativeSessionId &&
		!isSessionIdLabel(native, record.nativeSessionId)
	)
		return native;
	return '';
}

/** `nativeTitle` for a row, only when it adds something beyond what the row shows. */
function aliasFor(
	title: string,
	record: ProjectHistoryConversation | undefined
): { nativeTitle?: string } {
	if (!record) return {};
	const native = nativeTitleOf(record) || historyTitle(record);
	return native && native !== title ? { nativeTitle: native } : {};
}

/**
 * Project navigation: open tabs and native history merged per project, one
 * row per native conversation. Nothing here copies or imports a transcript.
 */
export function buildProjectSessionTree({
	archives = [],
	sessions,
	groups,
	groupsPlusEnabled = false,
	collapsedProjects = [],
	search = '',
	unreadOnly = false,
	history = [],
	providerFilter = null,
	rowLimits = {},
}: ProjectSessionTreeOptions): SidebarProject[] {
	const groupById = new Map(groups.map((group) => [group.id, group]));
	const ownerById = new Map(sessions.map((session) => [session.id, session]));
	const projects = new Map<string, SidebarProject>();
	const rowsByProject = new Map<string, SidebarConversation[]>();
	const collapsed = new Set(collapsedProjects);
	const query = search.trim().toLocaleLowerCase();
	for (const group of groups) {
		const parent =
			groupsPlusEnabled && group.parentGroupId ? groupById.get(group.parentGroupId) : undefined;
		projects.set(`group:${group.id}`, {
			key: `group:${group.id}`,
			groupId: group.id,
			name: group.name,
			emoji: group.emoji,
			depth: parent && !parent.parentGroupId ? 1 : 0,
			collapsed: group.collapsed,
			conversations: [],
			totalCount: 0,
			hiddenCount: 0,
			agents: [],
		});
		rowsByProject.set(`group:${group.id}`, []);
	}

	// Main's key (provider + host + account pool + native id) is the identity;
	// the same native id in two account pools stays two conversations.
	const historyByKey = new Map<string, ProjectHistoryConversation>();
	for (const record of history) {
		if (
			archives.some(
				(item) =>
					item.key === record.key ||
					(record.key.startsWith('local:') &&
						item.ownerIds.includes(record.ownerId ?? '') &&
						item.nativeSessionId === record.nativeSessionId)
			)
		)
			continue;
		const existing = historyByKey.get(record.key);
		if (!existing || record.modifiedAt > existing.modifiedAt) historyByKey.set(record.key, record);
	}
	const records = [...historyByKey.values()];
	// Record keys claimed by an open tab, and identities of open tabs no record names.
	const claimed = new Set<string>();

	for (const session of sessions) {
		if (session.toolType === 'terminal') continue;
		const path = sessionPath(session);
		const { key } = sessionProjectKey(session, ownerById, groupById);
		let project = projects.get(key);
		if (!project) {
			project = {
				key,
				name: getBasename(path) || path || session.name,
				depth: 0,
				collapsed: collapsed.has(key),
				conversations: [],
				totalCount: 0,
				hiddenCount: 0,
				agents: [],
			};
			projects.set(key, project);
			rowsByProject.set(key, []);
		}
		// "New conversation" offers a provider, never a configuration.
		const provider = sessionProviderId(session);
		if (!project.agents.some((agent) => agent.provider === provider)) {
			project.agents.push({
				id: session.id,
				name: session.name,
				provider,
				projectPath: path,
			});
		}
		const runner = runnerAccount(session);
		for (const tab of visibleAiTabs(session.aiTabs)) {
			if (
				archives.some(
					(item) =>
						item.ownerIds.includes(session.id) && item.nativeSessionId === tab.agentSessionId
				)
			)
				continue;
			const record = tab.agentSessionId
				? (matchRecordForTab(runner, tab.agentSessionId, records) ?? undefined)
				: undefined;
			const identity = record
				? record.key
				: tab.agentSessionId
					? openTabIdentity(runner, tab.agentSessionId)
					: null;
			// A second tab on the same native conversation (another runner) adds no row.
			if (identity && claimed.has(identity)) continue;
			if (identity) claimed.add(identity);
			const recordTitle = record ? historyTitle(record) : '';
			// Never the provider id label. Before the tab is named or its native
			// record is scanned, the row uses the first thing the user said, like
			// the header does, and "New conversation" (the tree's empty-title
			// label) before that. The logs are READ here but not subscribed to
			// (see sidebarSessionEquality): a send flips the tab to busy, which
			// rebuilds the row at the moment the first message lands, and later
			// streamed chunks never touch the first message.
			const name = tab.name && !isSessionIdLabel(tab.name, tab.agentSessionId) ? tab.name : '';
			const title = name || recordTitle || conversationDisplayTitle(tab) || '';
			rowsByProject.get(key)!.push({
				key: `${session.id}:${tab.id}`,
				kind: 'open',
				ownerId: session.id,
				tabId: tab.id,
				provider,
				nativeSessionId: tab.agentSessionId ?? null,
				title,
				...aliasFor(title, record),
				agentName: session.name,
				projectPath: path,
				busy: tab.state === 'busy',
				unread: !!tab.hasUnread,
				error: !!tab.agentError,
				starred: tab.starred,
				canDeleteWorktree: !!(session.parentSessionId && session.worktreeBranch),
				createdAt: tab.createdAt,
				modifiedAt: Math.max(tab.createdAt, record?.modifiedAt ?? 0),
				...(record ? { history: record } : {}),
			});
		}
	}

	for (const record of records) {
		if (claimed.has(record.key)) continue;
		const rows = rowsByProject.get(record.projectKey);
		// A scope the window no longer has (agent removed mid-load) has nowhere to go.
		if (!rows) continue;
		const owner = record.ownerId ? ownerById.get(record.ownerId) : undefined;
		const title = historyTitle(record);
		rows.push({
			key: `history:${record.key}`,
			kind: 'history',
			ownerId: owner ? owner.id : null,
			tabId: null,
			provider: historyProviderId(record, owner, sessions),
			nativeSessionId: record.nativeSessionId,
			title,
			...aliasFor(title, record),
			agentName: owner?.name ?? '',
			projectPath: record.projectPath,
			busy: false,
			unread: false,
			error: false,
			starred: record.starred,
			createdAt: record.createdAt,
			modifiedAt: record.modifiedAt,
			history: record,
		});
	}

	for (const project of projects.values()) {
		if (archives.length)
			project.archivedConversations = archives.filter(
				(record) => record.projectKey === project.key
			);
		const rows = (rowsByProject.get(project.key) ?? []).filter((row) => {
			if (providerFilter && row.provider !== providerFilter) return false;
			if (unreadOnly && !row.unread && !row.busy && !row.error) return false;
			if (!query) return true;
			return [
				row.title,
				row.nativeTitle ?? '',
				row.history?.title ?? '',
				row.history?.preview ?? '',
				row.agentName,
				row.projectPath,
				getAgentDisplayName(row.provider),
				project.name,
				row.nativeSessionId ?? '',
			].some((value) => value.toLocaleLowerCase().includes(query));
		});
		rows.sort((a, b) => Number(b.starred) - Number(a.starred) || b.modifiedAt - a.modifiedAt);
		const limit = rowLimits[project.key] ?? PROJECT_HISTORY_PAGE_SIZE;
		// Open tabs are never paged away: they are what the user is working in.
		const visible = rows.filter((row, index) => index < limit || row.kind === 'open');
		project.conversations = visible;
		project.totalCount = rows.length;
		project.hiddenCount = rows.length - visible.length;
	}

	const filtering = !!query || unreadOnly || !!providerFilter;
	return [...projects.values()]
		.filter((project) => {
			const group = project.groupId ? groupById.get(project.groupId) : undefined;
			const parent =
				groupsPlusEnabled && group?.parentGroupId ? groupById.get(group.parentGroupId) : undefined;
			if (!filtering && project.depth > 0 && parent?.collapsed) return false;
			if (filtering) {
				if (project.totalCount > 0 || project.archivedConversations?.length) return true;
				return (
					groupsPlusEnabled &&
					groups.some(
						(child) =>
							child.parentGroupId === project.groupId &&
							(projects.get(`group:${child.id}`)?.totalCount ?? 0) > 0
					)
				);
			}
			return true;
		})
		.map((project) => (unreadOnly ? { ...project, collapsed: false } : project));
}

/** Providers that have at least one row anywhere, for the provider filter. */
export function providersInHistory(
	sessions: Session[],
	history: ProjectHistoryConversation[]
): string[] {
	const providers = new Set<string>();
	for (const session of sessions) {
		if (session.toolType !== 'terminal' && visibleAiTabs(session.aiTabs).length > 0)
			providers.add(sessionProviderId(session));
	}
	const ownerById = new Map(sessions.map((session) => [session.id, session]));
	for (const record of history)
		providers.add(
			historyProviderId(
				record,
				record.ownerId ? ownerById.get(record.ownerId) : undefined,
				sessions
			)
		);
	return [...providers].sort((a, b) =>
		getAgentDisplayName(a).localeCompare(getAgentDisplayName(b))
	);
}
