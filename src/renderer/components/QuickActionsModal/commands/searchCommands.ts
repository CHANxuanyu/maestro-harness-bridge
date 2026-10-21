import { getT } from '../../../i18n';
import type { RightPanelTab, Shortcut } from '../../../types';
import type { QuickAction } from '../types';
import { FIXED_SHORTCUTS } from '../../../constants/shortcuts';

interface BuildSearchCommandsArgs {
	setQuickActionOpen: (open: boolean) => void;
	setLeftSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
	setRightPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
	setActiveRightTab: (tab: RightPanelTab) => void;
	setActiveFocus: (focus: 'sidebar' | 'main' | 'right') => void;
	setSessionFilterOpen: (open: boolean) => void;
	setOutputSearchOpen: (open: boolean) => void;
	setFileTreeFilterOpen: (open: boolean) => void;
	setHistorySearchFilterOpen: (open: boolean) => void;
	/** Open cross-tab message search. Omitted when there are no AI tabs to search. */
	openCrossTabSearch?: () => void;
	searchAllTabsShortcut?: Shortcut;
}

export function buildSearchCommands({
	setQuickActionOpen,
	setLeftSidebarOpen,
	setRightPanelOpen,
	setActiveRightTab,
	setActiveFocus,
	setSessionFilterOpen,
	setOutputSearchOpen,
	setFileTreeFilterOpen,
	setHistorySearchFilterOpen,
	openCrossTabSearch,
	searchAllTabsShortcut,
}: BuildSearchCommandsArgs): QuickAction[] {
	const t = getT();
	return [
		{
			id: 'searchAgents',
			label: t('workflows.shell.searchAgents'),
			subtext: t('workflows.shell.filterAgentsInTheSidebar'),
			// The four in-context find bars are all Cmd+F, scoped by whatever has
			// focus. Naming the chord here is how a user learns that; without it the
			// palette reads as the only way in.
			shortcut: FIXED_SHORTCUTS.filterSessions,
			action: () => {
				setQuickActionOpen(false);
				setLeftSidebarOpen(true);
				setActiveFocus('sidebar');
				setTimeout(() => setSessionFilterOpen(true), 50);
			},
		},
		{
			id: 'searchMessages',
			label: t('workflows.shell.searchMessagesThisTab'),
			subtext: t('workflows.shell.searchMessagesInTheCurrentConversation'),
			shortcut: FIXED_SHORTCUTS.searchOutput,
			action: () => {
				setQuickActionOpen(false);
				setActiveFocus('main');
				setTimeout(() => setOutputSearchOpen(true), 50);
			},
		},
		...(openCrossTabSearch
			? [
					{
						id: 'searchAllTabs',
						label: t('workflows.shell.searchMessagesAllAgentTabs'),
						subtext: t('workflows.shell.searchEveryOpenTabInThisAgentAnd'),
						shortcut: searchAllTabsShortcut,
						action: () => {
							setQuickActionOpen(false);
							setActiveFocus('main');
							openCrossTabSearch();
						},
					} satisfies QuickAction,
				]
			: []),
		{
			id: 'searchFiles',
			label: t('workflows.shell.searchFiles'),
			subtext: t('workflows.shell.filterFilesInTheFileExplorer'),
			shortcut: FIXED_SHORTCUTS.filterFiles,
			action: () => {
				setQuickActionOpen(false);
				setRightPanelOpen(true);
				setActiveRightTab('files');
				setActiveFocus('right');
				setTimeout(() => setFileTreeFilterOpen(true), 50);
			},
		},
		{
			id: 'searchHistory',
			label: t('workflows.shell.searchHistory'),
			subtext: t('workflows.shell.searchInTheHistoryPanel'),
			shortcut: FIXED_SHORTCUTS.filterHistory,
			action: () => {
				setQuickActionOpen(false);
				setRightPanelOpen(true);
				setActiveRightTab('history');
				setActiveFocus('right');
				setTimeout(() => setHistorySearchFilterOpen(true), 50);
			},
		},
	];
}
