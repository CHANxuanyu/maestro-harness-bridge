import { getT } from '../../../i18n';
import { agentStateLabel } from '../../../utils/workflowLabels';
import type React from 'react';
import { getAgentDisplayName, getAgentLoginCommand } from '../../../../shared/agentMetadata';
import { startManualReauth } from '../../../stores/authOutageStore';
import { getModalActions } from '../../../stores/modalStore';
import type { Session } from '../../../types';
import { sessionJumpShortcut } from '../../../utils/sessionJumpSlots';
import type { QuickAction } from '../types';
import { alphabetizeKey } from '../utils/quickActionSorting';
import { makeAgentJumpAction, type GetSessionWindow } from './agentJumpAction';

interface BuildSessionCommandsArgs {
	sessions: Session[];
	setActiveSessionId: (id: string) => void;
	revealJumpTarget: (session: Session) => void;
	/** Multi-window: resolves an agent's owning window so cross-window picks focus
	 * that window instead of stealing the agent. Omitted = single-window behavior. */
	getSessionWindow?: GetSessionWindow;
	/** Agent ID -> Opt+Cmd+# digit, for agents in the Left Bar's first ten slots. */
	jumpSlots?: Map<string, string>;
}

interface BuildSessionManagementCommandsArgs {
	activeSession: Session | undefined;
	activeSessionId: string;
	sessions: Session[];
	setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
	setQuickActionOpen: (open: boolean) => void;
	setRenameInstanceModalOpen: (open: boolean) => void;
	setRenameInstanceValue: (value: string) => void;
	onEditAgent?: (session: Session) => void;
	agentSettingsShortcut?: QuickAction['shortcut'];
	toggleBookmarkShortcut?: QuickAction['shortcut'];
	deleteSession: (id: string) => void;
	killShortcut?: QuickAction['shortcut'];
	openClearBookmarksConfirm: (bookmarkedCount: number) => void;
}

export function buildSessionJumpCommands({
	sessions,
	setActiveSessionId,
	revealJumpTarget,
	getSessionWindow,
	jumpSlots,
}: BuildSessionCommandsArgs): QuickAction[] {
	const t = getT();
	return sessions.map((session) => {
		let label: string;
		if (session.parentSessionId) {
			const parentSession = sessions.find((p) => p.id === session.parentSessionId);
			const parentName = parentSession?.name || 'Unknown';
			label = t('workflows.shell.extraJumpToValueSubagentValue', {
				p0: parentName,
				p1: session.name,
			});
		} else {
			label = t('workflows.shell.extraJumpToValue', { p0: session.name });
		}
		const jumpDigit = jumpSlots?.get(session.id);

		return {
			id: `jump-${session.id}`,
			label,
			shortcut: jumpDigit ? sessionJumpShortcut(jumpDigit) : undefined,
			action: makeAgentJumpAction({
				session,
				setActiveSessionId,
				revealJumpTarget,
				getSessionWindow,
			}),
			subtext: agentStateLabel(t, session.state).toUpperCase(),
			bookmarked: !!session.bookmarked,
			agentSortKey: alphabetizeKey(session.name),
		};
	});
}

export function buildSessionManagementCommands({
	activeSession,
	activeSessionId,
	sessions,
	setSessions,
	setQuickActionOpen,
	setRenameInstanceModalOpen,
	setRenameInstanceValue,
	onEditAgent,
	agentSettingsShortcut,
	toggleBookmarkShortcut,
	deleteSession,
	killShortcut,
	openClearBookmarksConfirm,
}: BuildSessionManagementCommandsArgs): QuickAction[] {
	const t = getT();
	const commands: QuickAction[] = [];

	if (activeSession) {
		commands.push({
			id: 'rename',
			label: t('workflows.shell.renameAgentValue', { p0: activeSession.name }),
			action: () => {
				setRenameInstanceValue(activeSession.name);
				setRenameInstanceModalOpen(true);
				setQuickActionOpen(false);
			},
		});
	}

	if (activeSession && onEditAgent) {
		commands.push({
			id: 'editAgent',
			label: t('workflows.shell.editAgentValue', { p0: activeSession.name }),
			shortcut: agentSettingsShortcut,
			action: () => {
				onEditAgent(activeSession);
				setQuickActionOpen(false);
			},
		});
	}

	if (activeSession) {
		commands.push({
			id: 'toggleBookmark',
			label: activeSession.bookmarked
				? t('workflows.shell.unbookmarkValue', { p0: activeSession.name })
				: t('workflows.shell.bookmarkValue', { p0: activeSession.name }),
			shortcut: toggleBookmarkShortcut,
			action: () => {
				setSessions((prev) =>
					prev.map((session) =>
						session.id === activeSessionId
							? { ...session, bookmarked: !session.bookmarked }
							: session
					)
				);
				setQuickActionOpen(false);
			},
		});
	}

	if (sessions.some((session) => session.bookmarked)) {
		commands.push({
			id: 'clearAllBookmarks',
			label: t('workflows.shell.clearAllBookmarks'),
			action: () => {
				const bookmarkedCount = sessions.filter((session) => session.bookmarked).length;
				setQuickActionOpen(false);
				openClearBookmarksConfirm(bookmarkedCount);
			},
		});
	}

	// Same login flow the expired-credentials prompt runs, reachable before
	// anything breaks: a token the user knows is about to lapse, an account
	// switch, or a provider that started rejecting turns without saying so.
	// Hidden for an agent with no login of its own (the Terminal agent).
	if (activeSession && getAgentLoginCommand(activeSession.toolType, activeSession.customPath)) {
		const agentName = getAgentDisplayName(activeSession.toolType);
		commands.push({
			id: 'reauthenticateProvider',
			label: t('workflows.shell.reAuthenticateProviderValue', { p0: agentName }),
			subtext: t('workflows.shell.signInToValueAgainForValue', {
				p0: agentName,
				p1: activeSession.name,
			}),
			action: () => {
				const { providerKey } = startManualReauth(activeSession.id);
				setQuickActionOpen(false);
				if (providerKey) getModalActions().openReauthModal({ providerKey });
			},
		});
	}

	if (activeSession) {
		commands.push({
			id: 'kill',
			label: t('workflows.shell.removeAgentValue', { p0: activeSession.name }),
			shortcut: killShortcut,
			action: () => deleteSession(activeSessionId),
		});
	}

	return commands;
}
