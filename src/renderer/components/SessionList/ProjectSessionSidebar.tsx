import { useT } from '../../i18n';
import { openUiSurface } from '../../utils/openUiSurface';
import { newProjectConversation } from '../../services/newShellConversation';
import { requestConversationAction } from '../../services/conversationArchive';
import { useConversationArchiveStore } from '../../stores/conversationArchiveStore';
import type { ConversationArchiveTarget } from '../../../shared/conversationArchive';
import { projectHistoryScopeFor } from '../../../shared/projectHistory';

import { useNativeHistorySearch } from '../../hooks/session/useNativeHistorySearch';
import { openNativeHistorySearchHit } from '../../services/openNativeHistorySearchHit';
import type { NativeHistorySearchHit } from '../../../shared/nativeHistorySearch';
import { useTabStore } from '../../stores/tabStore';
import { type ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Group, Session, Theme } from '../../types';
import type {
	ProjectHistoryConversation,
	ProjectHistoryError,
} from '../../../shared/projectHistory';
import { ProjectSessionTree } from './ProjectSessionTree';
import { ProjectSettingsModal } from '../ProjectSettingsModal';
import { projectSettingsKey } from '../../../shared/projectSettings';
import { projectSettingsScopeForSession } from '../../utils/projectConversationDefaults';
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
import { selectNewShellEnabled, useSettingsStore } from '../../stores/settingsStore';
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
	headerMenu?: ReactNode;
	theme: Theme;
	sessions: Session[];
	groups: Group[];
	groupsPlusEnabled: boolean;
	unreadOnly: boolean;
	onToggleGroup: (id: string) => void;
	onAddAgent: () => void;
	onDeleteWorktree?: (session: Session) => void;
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
	headerMenu,
	theme,
	sessions,
	groups,
	groupsPlusEnabled,
	unreadOnly,
	onToggleGroup,
	onAddAgent,
	onResumeSession,
	onDeleteWorktree,
}: ProjectSessionSidebarProps) {
	const t = useT();
	const newShell = useSettingsStore(selectNewShellEnabled);
	const archiveRecords = useConversationArchiveStore((state) => state.records);
	const [classicSearch, setClassicSearch] = useState('');
	const shellSearch = useUIStore((state) => state.newShellSidebarSearch);
	const search = newShell ? shellSearch : classicSearch;
	const setSearch = newShell ? useUIStore.getState().setNewShellSidebarSearch : setClassicSearch;
	const settingsProjectKey = useUIStore((state) => state.newShellSettingsProjectKey);
	const settingsScopeKey = useUIStore((state) => state.newShellSettingsScopeKey);
	const contentSearch = useNativeHistorySearch(search, newShell);
	const [contentOpening, setContentOpening] = useState(false);
	const [contentOpenFailed, setContentOpenFailed] = useState(false);
	const contentOpenTicket = useRef(0);
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
			(newShell || !active.activeFileTabId) &&
			!active.activeBrowserTabId &&
			!active.activeTerminalTabId
			? `${active.id}:${active.activeTabId}`
			: null;
	});
	// The agent the "New conversation" button at the top starts one with.
	const activeOwnerId = useSessionStore((s) =>
		s.sessions.some((session) => session.id === s.activeSessionId) ? s.activeSessionId : null
	);
	const { handleTabSelect, handleNewAgentSession, handleTabClose, handleRequestTabRename } =
		useAITabHandlers();

	const scopes = useMemo(() => buildProjectHistoryScopes(sessions, groups), [sessions, groups]);
	const scopeKey = useMemo(() => JSON.stringify(scopes), [scopes]);
	const history = useProjectHistory(scopes, scopeKey, sessions);
	useEffect(() => {
		if (newShell) history.refresh();
	}, [archiveRecords, newShell, history.refresh]);
	const archives = useMemo(
		() =>
			newShell
				? archiveRecords
						.filter((record) => record.archived !== false)
						.map((record) => ({
							...record,
							projectKey: projectHistoryScopeFor(scopes, record)?.projectKey ?? '',
						}))
				: [],
		[archiveRecords, scopes, newShell]
	);

	const rememberedRef = useRef(new Map<string, ProjectHistoryConversation>());
	const archiveRevision = useRef(archiveRecords);
	const mergedHistory = useMemo(() => {
		if (archiveRevision.current !== archiveRecords) {
			rememberedRef.current.clear();
			archiveRevision.current = archiveRecords;
		}
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
	}, [sessions, groups, history.conversations, archiveRecords]);

	const contentResults = useMemo(
		() => ({
			...contentSearch.result,
			hits: contentSearch.result.hits
				.filter((hit) => !archives.some((record) => record.key === hit.conversation.key))
				.map((hit) => {
					const known = mergedHistory.find(
						(record) =>
							!record.sshRemoteId &&
							record.provider === hit.conversation.provider &&
							record.nativeSessionId === hit.conversation.nativeSessionId &&
							record.accountDir === hit.conversation.accountDir
					);
					return known ? { ...hit, conversation: known } : hit;
				}),
		}),
		[contentSearch.result, mergedHistory, archives]
	);

	const providers = useMemo(
		() => providersInHistory(sessions, mergedHistory),
		[sessions, mergedHistory]
	);
	// A filter for a provider that no longer has rows would hide everything.
	const effectiveProviderFilter =
		!newShell && providerFilter && providers.includes(providerFilter) ? providerFilter : null;

	const setChildrenExpanded = useCallback(
		(conversation: SidebarConversation, expanded: boolean) => {
			if (!newShell || !conversation.ownerId) return;
			void window.maestro.windows
				.conversationChildren({
					sessionId: conversation.ownerId,
					...(conversation.tabId
						? { tabId: conversation.tabId }
						: { nativeSessionId: conversation.nativeSessionId! }),
					expanded,
				})
				.catch(() => {
					useModalStore.getState().openModal('confirm', {
						title: t('workflows.archive.error'),
						message: t('workflows.conversations.disclosureFailed'),
						onConfirm: () => {},
					});
				});
		},
		[newShell, t]
	);

	const projects = useMemo(
		() =>
			buildProjectSessionTree({
				newShell,
				archives,
				sessions,
				groups,
				groupsPlusEnabled,
				collapsedProjects,
				search,
				remoteTitleOnly: newShell,
				unreadOnly,
				history: mergedHistory,
				providerFilter: effectiveProviderFilter,
				rowLimits,
			}),
		[
			newShell,
			archives,
			sessions,
			groups,
			groupsPlusEnabled,
			collapsedProjects,
			search,
			newShell,
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
		async (ownerId: string) => {
			if (!selectOwner(ownerId)) return;
			const owner = useSessionStore.getState().sessions.find((session) => session.id === ownerId);
			if (owner && newShell && (await newProjectConversation(owner))) return;
			noteDirectSelection(ownerId, null);
			handleNewAgentSession();
			leaveSidebar(activeTabIdNow());
		},
		[selectOwner, handleNewAgentSession, leaveSidebar, newShell]
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
	const newConversationHere = useCallback(() => {
		if (activeOwnerId) newConversation(activeOwnerId);
	}, [activeOwnerId, newConversation]);
	const manageAgents = useCallback(() => {
		useSettingsStore.getState().setSidebarNavigationMode('agents');
	}, []);
	const settingsProject = projects.find((project) => project.key === settingsProjectKey);
	const settingsSessions = useMemo(() => {
		if (!settingsProjectKey) return [];
		const owners = new Map(sessions.map((owner) => [owner.id, owner]));
		const projectGroups = new Map(groups.map((group) => [group.id, group]));
		return sessions.filter(
			(session) =>
				session.toolType !== 'terminal' &&
				sessionProjectKey(session, owners, projectGroups).key === settingsProjectKey
		);
	}, [settingsProjectKey, sessions, groups]);
	const settingsScopes = [
		...new Map(
			settingsSessions.map((session) => {
				const scope = projectSettingsScopeForSession(session);
				return [projectSettingsKey(scope), scope] as const;
			})
		).values(),
	].sort(
		(a, b) =>
			Number(projectSettingsKey(b) === settingsScopeKey) -
			Number(projectSettingsKey(a) === settingsScopeKey)
	);

	const archiveTarget = (conversation: SidebarConversation): ConversationArchiveTarget =>
		conversation.history &&
		conversation.kind !== 'open' &&
		!conversation.history.key.startsWith('local:')
			? {
					provider: conversation.history.provider,
					nativeSessionId: conversation.history.nativeSessionId,
					projectPath: conversation.history.projectPath,
					projectKey: conversation.history.projectKey,
					lastActivity: conversation.history.modifiedAt,
					worktree: conversation.history.worktree,
					accountDir: conversation.history.accountDir,
					sshRemoteId: conversation.history.sshRemoteId,
					title: conversation.title,
				}
			: {
					ownerId: conversation.ownerId ?? undefined,
					nativeSessionId: conversation.nativeSessionId ?? '',
					title: conversation.title,
				};

	const selectContent = useCallback(
		async (hit: NativeHistorySearchHit) => {
			if (!onResumeSession) return;
			const ticket = ++contentOpenTicket.current;
			setContentOpening(true);
			setContentOpenFailed(false);
			const known = mergedHistory.find(
				(record) =>
					record.provider === hit.conversation.provider &&
					record.nativeSessionId === hit.conversation.nativeSessionId &&
					!record.sshRemoteId &&
					record.accountDir === hit.conversation.accountDir
			);
			const success = await openNativeHistorySearchHit(
				known ? { ...hit, conversation: known } : hit,
				onResumeSession
			);
			if (ticket !== contentOpenTicket.current) return;
			setContentOpening(false);
			setContentOpenFailed(!success);
			if (success) {
				useUIStore.getState().setActiveFocus('main');
				useUIStore.getState().closeLeftSidebarForNavigation();
			}
		},
		[onResumeSession, mergedHistory]
	);

	return (
		<>
			<ProjectSessionTree
				headerMenu={headerMenu}
				theme={theme}
				projects={projects}
				activeKey={groupChatActive || browsing ? null : activeKey}
				search={search}
				contentSearch={contentResults}
				contentSearching={contentSearch.searching}
				contentOpening={contentOpening}
				contentOpenFailed={contentOpenFailed}
				onSelectContent={selectContent}
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
				onSetChildrenExpanded={setChildrenExpanded}
				onSelectConversation={selectConversation}
				onNewConversation={newConversation}
				onNewConversationHere={activeOwnerId ? newConversationHere : undefined}
				onRenameConversation={renameConversation}
				onCloseConversation={closeConversation}
				onArchiveConversation={
					newShell
						? (conversation) => requestConversationAction(archiveTarget(conversation), 'archive')
						: undefined
				}
				onDeleteConversation={
					newShell
						? (conversation) => requestConversationAction(archiveTarget(conversation), 'delete')
						: undefined
				}
				onTogglePin={(conversation) => {
					if (conversation.ownerId && conversation.tabId)
						useTabStore.getState().starTab(conversation.tabId, conversation.ownerId);
				}}
				onDeleteWorktree={
					onDeleteWorktree
						? (conversation) => {
								const owner = useSessionStore
									.getState()
									.sessions.find((s) => s.id === conversation.ownerId);
								if (owner?.parentSessionId && owner.worktreeBranch) onDeleteWorktree(owner);
							}
						: undefined
				}
				onShowMore={showMore}
				onManageAgents={manageAgents}
				onProjectSettings={(project) =>
					openUiSurface('project-settings', undefined, { projectKey: project.key })
				}
				onAddAgent={onAddAgent}
			/>
			{newShell && settingsProjectKey && settingsScopes.length > 0 && (
				<ProjectSettingsModal
					key={`${settingsProjectKey}:${settingsScopeKey}`}
					theme={theme}
					name={settingsProject?.name ?? settingsSessions[0]?.name ?? ''}
					scopes={settingsScopes}
					sessions={settingsSessions}
					onClose={() => openUiSurface('project-settings', undefined, { close: true })}
				/>
			)}
		</>
	);
});
