import { getT } from '../../../i18n';
import type { Session } from '../../../types';
import type { QuickAction } from '../types';
import { areUnreadFiltersActive, toggleAllUnreadFilters } from '../../../services/unreadFilters';

interface BuildNavigationCommandsArgs {
	activeSession: Session | undefined;
	activeSessionId: string;
	setQuickActionOpen: (open: boolean) => void;
	setLeftSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
	setRightPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
	addNewSession: () => void;
	deleteSession: (id: string) => void;
	openWizard?: () => void;
	getOpenInLabel: (platform: string) => string;
	platform: string;
	openPath?: (path: string) => void;
	// Shared with the Alt+Cmd+Down keyboard shortcut so both invocation paths
	// use the same sidebar-visible ordering and current-session clear semantics.
	onGoToNextUnread?: () => void;
	// Same callback the second press of Opt+Cmd+Up runs, so the palette entry
	// and the chord walk the same ordering.
	onGoToPreviousUnread?: () => void;
	// Shared with the Cmd+Shift+, / Cmd+Shift+. keyboard shortcuts so both paths
	// walk the same session/tab navigation history.
	onNavBack?: () => void;
	onNavForward?: () => void;
	shortcuts: {
		newInstance?: QuickAction['shortcut'];
		openWizard?: QuickAction['shortcut'];
		toggleSidebar?: QuickAction['shortcut'];
		toggleRightPanel?: QuickAction['shortcut'];
		nextUnreadTab?: QuickAction['shortcut'];
		previousUnreadTab?: QuickAction['shortcut'];
		focusActiveTab?: QuickAction['shortcut'];
		toggleUnreadFilters?: QuickAction['shortcut'];
		killInstance?: QuickAction['shortcut'];
		navBack?: QuickAction['shortcut'];
		navForward?: QuickAction['shortcut'];
	};
}

export function buildNavigationCommands({
	activeSession,
	activeSessionId,
	setQuickActionOpen,
	setLeftSidebarOpen,
	setRightPanelOpen,
	addNewSession,
	deleteSession,
	openWizard,
	getOpenInLabel,
	platform,
	openPath,
	onGoToNextUnread,
	onGoToPreviousUnread,
	onNavBack,
	onNavForward,
	shortcuts,
}: BuildNavigationCommandsArgs): QuickAction[] {
	const t = getT();
	const commands: QuickAction[] = [
		{
			id: 'new',
			label: t('workflows.shell.createNewAgent'),
			shortcut: shortcuts.newInstance,
			action: addNewSession,
		},
	];

	if (openWizard) {
		commands.push({
			id: 'wizard',
			label: t('workflows.shell.newAgentWizard'),
			shortcut: shortcuts.openWizard,
			action: () => {
				openWizard();
				setQuickActionOpen(false);
			},
		});
	}

	commands.push(
		{
			id: 'toggleSidebar',
			label: t('workflows.shell.toggleSidebar'),
			shortcut: shortcuts.toggleSidebar,
			action: () => setLeftSidebarOpen((prev) => !prev),
		},
		{
			id: 'toggleRight',
			label: t('workflows.shell.toggleRightPanel'),
			shortcut: shortcuts.toggleRightPanel,
			action: () => setRightPanelOpen((prev) => !prev),
		},
		{
			id: 'nextUnreadTab',
			label: t('workflows.shell.nextUnreadDraftTab'),
			shortcut: shortcuts.nextUnreadTab,
			action: () => {
				// Delegate to the shared App.tsx callback so this matches the
				// Alt+Cmd+Down keyboard shortcut exactly (uses sortedSessions -
				// the sidebar's visible order - and the same clear semantics).
				onGoToNextUnread?.();
				setQuickActionOpen(false);
			},
		},
		{
			id: 'previousUnreadTab',
			label: t('workflows.shell.previousUnreadDraftTab'),
			// previousUnreadTab ships unbound, so name the chord that actually
			// reaches it today: Focus Active Tab pressed a second time.
			subtext: t('workflows.shell.walkBackwardsAlsoTheSecondPressOfFocus'),
			shortcut: shortcuts.previousUnreadTab?.keys?.length
				? shortcuts.previousUnreadTab
				: shortcuts.focusActiveTab,
			action: () => {
				onGoToPreviousUnread?.();
				setQuickActionOpen(false);
			},
		},
		{
			id: 'toggleUnreadFilters',
			// The label names the state this entry PUTS you in, not the state you
			// are in, so hitting it twice reads as a switch flipping back and
			// forth rather than a status line that argues with itself.
			label: areUnreadFiltersActive()
				? t('workflows.shell.unreadOnlyOff')
				: t('workflows.shell.unreadOnlyOn'),
			subtext: t('workflows.shell.filterBothTheAgentListAndTheTab'),
			shortcut: shortcuts.toggleUnreadFilters,
			action: () => {
				toggleAllUnreadFilters();
				setQuickActionOpen(false);
			},
		}
	);

	if (onNavBack) {
		commands.push({
			id: 'navBack',
			label: t('workflows.shell.navigateBack'),
			shortcut: shortcuts.navBack,
			action: () => {
				onNavBack();
				setQuickActionOpen(false);
			},
		});
	}

	if (onNavForward) {
		commands.push({
			id: 'navForward',
			label: t('workflows.shell.navigateForward'),
			shortcut: shortcuts.navForward,
			action: () => {
				onNavForward();
				setQuickActionOpen(false);
			},
		});
	}

	if (activeSession && !activeSession.sshRemote) {
		commands.push({
			id: 'openWorkingDirectory',
			label: t('workflows.shell.valueWorkingDirectory', { p0: getOpenInLabel(platform) }),
			subtext: activeSession.projectRoot,
			action: () => {
				openPath?.(activeSession.fullPath || activeSession.projectRoot);
				setQuickActionOpen(false);
			},
		});
	}

	if (activeSession) {
		commands.push({
			id: 'kill',
			label: t('workflows.shell.removeAgentValue', { p0: activeSession.name }),
			shortcut: shortcuts.killInstance,
			action: () => deleteSession(activeSessionId),
		});
	}

	return commands;
}
