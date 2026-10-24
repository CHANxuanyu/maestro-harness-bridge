import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Group, Session, Theme } from '../../types';
import type {
	ProjectHistoryConversation,
	ProjectHistoryError,
} from '../../../shared/projectHistory';
import { ProjectSessionTree } from './ProjectSessionTree';
import {
	buildProjectHistoryScopes,
	buildProjectSessionTree,
	providersInHistory,
	sessionProjectKey,
	PROJECT_HISTORY_PAGE_SIZE,
	type SidebarConversation,
	type SidebarProject,
} from '../../utils/projectSessionTree';
import { visibleAiTabs } from '../../utils/tabHelpers';
import {
	accountEnvVarFor,
	matchRecordForTab,
	openTabIdentity,
	runnerAccount,
} from '../../utils/nativeConversationMatch';
import { useSessionStore } from '../../stores/sessionStore';
import { useGroupChatStore } from '../../stores/groupChatStore';
import { useModalStore, selectModalOpen } from '../../stores/modalStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAITabHandlers } from '../../hooks/tabs/internal/useAITabHandlers';
import { useProjectHistory } from '../../hooks/session/useProjectHistory';
import {
	noteDirectSelection,
	openNativeConversation,
	type ResumeNativeSession,
} from '../../services/openNativeConversation';
import {
	nativeConversationLooksNewer,
	refreshNativeConversation,
} from '../../services/refreshNativeConversation';
import { hasLegacyTranscriptEntries } from '../../utils/transcriptMessages';
import { isPhoneLayout } from '../../hooks/ui/useViewportBreakpoint';

interface ProjectSessionSidebarProps {
	theme: Theme;
	sessions: Session[];
	groups: Group[];
	groupsPlusEnabled: boolean;
	unreadOnly: boolean;
	onToggleGroup: (id: string) => void;
	onAddAgent: () => void;
	/** Canonical resume; without it history rows are listed but cannot open. */
	onResumeSession?: ResumeNativeSession;
}

function withoutKey(record: Record<string, true>, key: string): Record<string, true> {
	if (!record[key]) return record;
	const next = { ...record };
	delete next[key];
	return next;
}

/**
 * Conversations the user had open in this window, remembered so closing a
 * tab leaves its row in place until the next history scan confirms it.
 */
function rememberOpenConversations(
	sessions: Session[],
	groups: Group[],
	remembered: Map<string, ProjectHistoryConversation>
): void {
	const groupById = new Map(groups.map((group) => [group.id, group]));
	const ownerById = new Map(sessions.map((session) => [session.id, session]));
	for (const session of sessions) {
		if (session.toolType === 'terminal') continue;
		const runner = runnerAccount(session);
		const sshRemoteId = runner.host;
		const envVar = accountEnvVarFor(session.toolType);
		const override = envVar ? session.customEnvVars?.[envVar]?.trim() : undefined;
		const { key: projectKey } = sessionProjectKey(session, ownerById, groupById);
		for (const tab of visibleAiTabs(session.aiTabs)) {
			if (!tab.agentSessionId || (tab.logs?.length ?? 0) === 0) continue;
			const key = `local:${openTabIdentity(runner, tab.agentSessionId)}`;
			const lastLog = tab.logs[tab.logs.length - 1];
			remembered.set(key, {
				key,
				projectKey,
				projectPath: session.projectRoot || session.cwd,
				provider: session.toolType,
				nativeSessionId: tab.agentSessionId,
				title: tab.name ?? '',
				preview: '',
				createdAt: tab.createdAt,
				modifiedAt: Math.max(tab.createdAt, lastLog?.timestamp ?? 0),
				messageCount: tab.logs.length,
				starred: tab.starred,
				ownerId: session.id,
				...(sshRemoteId ? { sshRemoteId } : {}),
				// Only an explicit override is known here; the default pool is left
				// for main to name, never guessed.
				...(envVar && override ? { accountEnvVar: envVar, accountDir: override } : {}),
			});
		}
	}
}

/** Reuse the tab-strip actions so sidebar and tab navigation retain identical semantics. */
/** The tab the active agent shows now (after a new or reopened conversation). */
function activeTabIdNow(): string | undefined {
	const { sessions, activeSessionId } = useSessionStore.getState();
	return sessions.find((session) => session.id === activeSessionId)?.activeTabId;
}

export const ProjectSessionSidebar = memo(function ProjectSessionSidebar({
	theme,
	sessions,
	groups,
	groupsPlusEnabled,
	unreadOnly,
	onToggleGroup,
	onAddAgent,
	onResumeSession,
}: ProjectSessionSidebarProps) {
	const [search, setSearch] = useState('');
	const [providerFilter, setProviderFilter] = useState<string | null>(null);
	const [rowLimits, setRowLimits] = useState<Record<string, number>>({});
	const [pendingKeys, setPendingKeys] = useState<Record<string, true>>({});
	const [failedKeys, setFailedKeys] = useState<Record<string, true>>({});
	const pendingRef = useRef(new Set<string>());
	const collapsedProjects = useSettingsStore((s) => s.collapsedConversationProjects);
	const groupChatActive = useGroupChatStore((s) => s.activeGroupChatId !== null);
	const browsing = useModalStore(selectModalOpen('agentSessions'));
	const activeKey = useSessionStore((s) => {
		const active = s.sessions.find((session) => session.id === s.activeSessionId);
		return active &&
			active.inputMode === 'ai' &&
			!active.activeFileTabId &&
			!active.activeBrowserTabId &&
			!active.activeTerminalTabId
			? `${active.id}:${active.activeTabId}`
			: null;
	});
	const { handleTabSelect, handleNewAgentSession, handleTabClose, handleRequestTabRename } =
		useAITabHandlers();

	const scopes = useMemo(() => buildProjectHistoryScopes(sessions, groups), [sessions, groups]);
	const scopeKey = useMemo(() => JSON.stringify(scopes), [scopes]);
	const history = useProjectHistory(scopes, scopeKey, sessions);

	const rememberedRef = useRef(new Map<string, ProjectHistoryConversation>());
	const mergedHistory = useMemo(() => {
		rememberOpenConversations(sessions, groups, rememberedRef.current);
		const extra: ProjectHistoryConversation[] = [];
		for (const [key, record] of rememberedRef.current) {
			const runner = {
				id: record.ownerId ?? '',
				provider: record.provider,
				host: record.sshRemoteId,
				env:
					record.accountEnvVar && record.accountDir
						? { [record.accountEnvVar]: record.accountDir }
						: undefined,
			};
			// The scan names it now, with its real account pool: drop the local copy.
			if (matchRecordForTab(runner, record.nativeSessionId, history.conversations))
				rememberedRef.current.delete(key);
			else extra.push(record);
		}
		return extra.length > 0 ? [...history.conversations, ...extra] : history.conversations;
	}, [sessions, groups, history.conversations]);

	const providers = useMemo(
		() => providersInHistory(sessions, mergedHistory),
		[sessions, mergedHistory]
	);
	// A filter for a provider that no longer has rows would hide everything.
	const effectiveProviderFilter =
		providerFilter && providers.includes(providerFilter) ? providerFilter : null;

	const projects = useMemo(
		() =>
			buildProjectSessionTree({
				sessions,
				groups,
				groupsPlusEnabled,
				collapsedProjects,
				search,
				unreadOnly,
				history: mergedHistory,
				providerFilter: effectiveProviderFilter,
				rowLimits,
			}),
		[
			sessions,
			groups,
			groupsPlusEnabled,
			collapsedProjects,
			search,
			unreadOnly,
			mergedHistory,
			effectiveProviderFilter,
			rowLimits,
		]
	);

	const historyErrors = useMemo(() => {
		const byProject: Record<string, ProjectHistoryError[]> = {};
		for (const error of history.errors) (byProject[error.projectKey] ??= []).push(error);
		return byProject;
	}, [history.errors]);

	const selectOwner = useCallback((ownerId: string) => {
		if (!useSessionStore.getState().sessions.some((session) => session.id === ownerId))
			return false;
		useGroupChatStore.getState().setActiveGroupChatId(null);
		useSessionStore.getState().setActiveSessionId(ownerId);
		useModalStore.getState().closeModal('agentSessions');
		return true;
	}, []);

	/**
	 * Hand the user to the conversation they picked. Setting activeFocus here is
	 * not enough: the Left Bar's own container sets it back to 'sidebar' as the
	 * click bubbles up, and the DOM focus would stay on the row. A focus request
	 * is consumed by the main panel after the tab renders, which puts the caret
	 * in its composer. Not on a phone, where focusing the composer would raise
	 * the keyboard over the conversation the user opened to read.
	 */
	const leaveSidebar = useCallback((tabId: string | undefined) => {
		const ui = useUIStore.getState();
		ui.setActiveFocus('main');
		if (tabId && !isPhoneLayout()) ui.requestTabFocus({ type: 'ai', id: tabId });
		ui.closeLeftSidebarForNavigation();
	}, []);

	const openHistory = useCallback(
		(conversation: SidebarConversation) => {
			const record = conversation.history;
			if (!record || !onResumeSession) return;
			const key = conversation.key;
			// A second click while the first is loading is the same request.
			if (pendingRef.current.has(key)) return;
			pendingRef.current.add(key);
			setPendingKeys((prev) => ({ ...prev, [key]: true }));
			setFailedKeys((prev) => withoutKey(prev, key));
			// The row closes the drawer on a phone: the tap is the request.
			useUIStore.getState().closeLeftSidebarForNavigation();
			void openNativeConversation(record, conversation.title, onResumeSession).then((result) => {
				pendingRef.current.delete(key);
				setPendingKeys((prev) => withoutKey(prev, key));
				if (result.status === 'failed') setFailedKeys((prev) => ({ ...prev, [key]: true }));
				if (result.status === 'opened') leaveSidebar(activeTabIdNow());
			});
		},
		[onResumeSession, leaveSidebar]
	);

	// Newest native `modifiedAt` each record was already refreshed for, so a
	// scan that reports the same metadata again does not re-read the transcript.
	const refreshedAtRef = useRef(new Map<string, number>());
	// Tabs already re-read to upgrade an older cached conversion this window.
	const upgradeAttemptedRef = useRef(new Set<string>());
	/**
	 * Read-only catch-up of an open tab whose conversation may have continued
	 * outside Maestro. Never moves focus; a failure keeps the cached transcript
	 * and marks the row so the user can retry.
	 */
	const refreshOpenTab = useCallback(
		(rowKey: string, ownerId: string, tabId: string, record?: ProjectHistoryConversation) => {
			if (record) refreshedAtRef.current.set(record.key, record.modifiedAt);
			// A new attempt (including a click retrying a failed automatic one)
			// clears the old failure; rapid clicks join one read and all land on
			// its single result, so the row ends in one consistent state.
			setFailedKeys((prev) => withoutKey(prev, rowKey));
			void refreshNativeConversation({ sessionId: ownerId, tabId, record }).then((result) => {
				if (result.status === 'failed') {
					setFailedKeys((prev) => ({ ...prev, [rowKey]: true }));
					return;
				}
				setFailedKeys((prev) => withoutKey(prev, rowKey));
				// Not attempted after all (a turn was running, the tab changed):
				// forget the mark so the next scan may ask again. Deleting rather than
				// restoring a previous value keeps joined calls order-independent.
				if (result.status === 'skipped' && result.reason !== 'mismatch') {
					if (record) refreshedAtRef.current.delete(record.key);
					upgradeAttemptedRef.current.delete(rowKey);
				}
			});
		},
		[]
	);

	const selectConversation = useCallback(
		(conversation: SidebarConversation) => {
			if (conversation.kind === 'history' || !conversation.ownerId || !conversation.tabId) {
				openHistory(conversation);
				return;
			}
			if (!selectOwner(conversation.ownerId)) return;
			noteDirectSelection(conversation.ownerId, conversation.tabId);
			handleTabSelect(conversation.tabId);
			leaveSidebar(conversation.tabId);
			// The tab may hold a copy from before the conversation continued in
			// another app. Selecting it is the moment the user wants it current.
			if (conversation.nativeSessionId) {
				refreshOpenTab(
					conversation.key,
					conversation.ownerId,
					conversation.tabId,
					conversation.history
				);
			}
		},
		[openHistory, selectOwner, handleTabSelect, leaveSidebar, refreshOpenTab]
	);

	// Returning to the window rescans history (useProjectHistory). When that scan
	// says the conversation on screen moved on elsewhere, catch the tab up. Only
	// the ACTIVE tab: background tabs catch up when the user selects them.
	useEffect(() => {
		if (!activeKey) return;
		const state = useSessionStore.getState();
		const session = state.sessions.find((s) => s.id === state.activeSessionId);
		const tab = session?.aiTabs?.find((t) => t.id === session.activeTabId);
		if (!session || !tab?.agentSessionId || (tab.logs?.length ?? 0) === 0) return;
		const record = matchRecordForTab(
			runnerAccount(session),
			tab.agentSessionId,
			history.conversations
		);
		if (!record) return;
		const attempted = refreshedAtRef.current.get(record.key) ?? 0;
		const rowKey = `${session.id}:${tab.id}`;
		// A tab cached by an older build (tool calls stored as text) is re-read
		// once per window even when the native file has nothing new, so it is
		// upgraded in place without the user having to click it.
		const legacy = !upgradeAttemptedRef.current.has(rowKey) && hasLegacyTranscriptEntries(tab.logs);
		if (!legacy && !nativeConversationLooksNewer(tab, record.modifiedAt, attempted)) return;
		if (legacy) upgradeAttemptedRef.current.add(rowKey);
		refreshOpenTab(rowKey, session.id, tab.id, record);
	}, [activeKey, history.conversations, refreshOpenTab]);
	const newConversation = useCallback(
		(ownerId: string) => {
			if (!selectOwner(ownerId)) return;
			noteDirectSelection(ownerId, null);
			handleNewAgentSession();
			leaveSidebar(activeTabIdNow());
		},
		[selectOwner, handleNewAgentSession, leaveSidebar]
	);
	const renameConversation = useCallback(
		(conversation: SidebarConversation) => {
			if (!conversation.ownerId || !conversation.tabId) return;
			if (!selectOwner(conversation.ownerId)) return;
			handleTabSelect(conversation.tabId);
			handleRequestTabRename(conversation.tabId);
		},
		[selectOwner, handleTabSelect, handleRequestTabRename]
	);
	// Closes the TAB only. The native transcript stays on disk and its row
	// stays in the tree (remembered above until the next scan lists it).
	const closeConversation = useCallback(
		(conversation: SidebarConversation) => {
			if (!conversation.ownerId || !conversation.tabId) return;
			if (!selectOwner(conversation.ownerId)) return;
			handleTabClose(conversation.tabId);
		},
		[selectOwner, handleTabClose]
	);
	const toggleProject = useCallback(
		(project: SidebarProject) => {
			if (project.groupId) {
				onToggleGroup(project.groupId);
				return;
			}
			const settings = useSettingsStore.getState();
			const collapsed = settings.collapsedConversationProjects;
			settings.setCollapsedConversationProjects(
				collapsed.includes(project.key)
					? collapsed.filter((key) => key !== project.key)
					: [...collapsed, project.key]
			);
		},
		[onToggleGroup]
	);
	const showMore = useCallback((project: SidebarProject) => {
		setRowLimits((prev) => ({
			...prev,
			[project.key]: (prev[project.key] ?? PROJECT_HISTORY_PAGE_SIZE) + PROJECT_HISTORY_PAGE_SIZE,
		}));
	}, []);
	const manageAgents = useCallback(() => {
		useSettingsStore.getState().setSidebarNavigationMode('agents');
	}, []);

	return (
		<ProjectSessionTree
			theme={theme}
			projects={projects}
			activeKey={groupChatActive || browsing ? null : activeKey}
			search={search}
			onSearchChange={setSearch}
			providers={providers}
			providerFilter={effectiveProviderFilter}
			onProviderFilterChange={setProviderFilter}
			historyStatus={history.status}
			historyRefreshing={history.refreshing}
			historyFailure={history.failure}
			historyErrors={historyErrors}
			onRetryHistory={history.refresh}
			pendingKeys={pendingKeys}
			failedKeys={failedKeys}
			onToggleProject={toggleProject}
			onSelectConversation={selectConversation}
			onNewConversation={newConversation}
			onRenameConversation={renameConversation}
			onCloseConversation={closeConversation}
			onShowMore={showMore}
			onManageAgents={manageAgents}
			onAddAgent={onAddAgent}
		/>
	);
});
