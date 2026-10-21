import { getT } from '../../../i18n';
import type { Session } from '../../../types';
import type { ActiveTabInfo, QuickAction } from '../types';
import { formatMetaKey } from '../../../utils/shortcutFormatter';
import { resolveSnoozeTarget } from '../../../utils/snoozeHelpers';
import { useModalStore } from '../../../stores/modalStore';
import { resolveModelEffortTabId } from '../../../utils/panelLayout';
import { visibleAiTabs } from '../../../utils/tabHelpers';

interface BuildNewTabCommandsArgs {
	activeSession: Session | undefined;
	onNewTab?: () => void;
	onNewFileTab?: () => void;
	onNewBrowserTab?: () => void;
	onNewTerminalTab?: () => void;
	setQuickActionOpen: (open: boolean) => void;
	newTabShortcut?: QuickAction['shortcut'];
	newFileTabShortcut?: QuickAction['shortcut'];
	newBrowserTabShortcut?: QuickAction['shortcut'];
	/**
	 * `toggleMode` (Cmd+J). Named for what the key does today - it opens a
	 * terminal tab - rather than for its historical id.
	 */
	newTerminalTabShortcut?: QuickAction['shortcut'];
}

interface BuildTabCommandsArgs {
	activeSession: Session | undefined;
	/** Set while a group chat owns the main panel. Suppresses tab-scoped entries a room cannot answer. */
	activeGroupChatId?: string | null;
	isAiMode?: boolean;
	activeTabInfo: ActiveTabInfo;
	enterToSendAI: boolean;
	markdownEditMode?: boolean;
	onOpenTabSwitcher?: () => void;
	onRenameTab?: () => void;
	onToggleReadOnlyMode?: () => void;
	onToggleTabShowThinking?: () => void;
	onToggleTabEnterToSend?: () => void;
	onToggleMarkdownEditMode?: () => void;
	onFocusActiveTab?: () => void;
	onCloseAllTabs?: () => void;
	onCloseOtherTabs?: () => void;
	onCloseTabsLeft?: () => void;
	onCloseTabsRight?: () => void;
	onCloseCurrentTab?: () => void;
	onMoveTabToFirst?: () => void;
	onMoveTabToLast?: () => void;
	onClearActiveTerminal?: () => void;
	setQuickActionOpen: (open: boolean) => void;
	shortcuts: {
		toggleMarkdownMode?: QuickAction['shortcut'];
		showSnoozeList?: QuickAction['shortcut'];
		focusActiveTab?: QuickAction['shortcut'];
		clearTerminal?: QuickAction['shortcut'];
		openModelEffort?: QuickAction['shortcut'];
	};
	tabShortcuts?: Record<string, QuickAction['shortcut']>;
	toggleInputMode: () => void;
}

export function buildNewTabCommands({
	activeSession,
	onNewTab,
	onNewFileTab,
	onNewBrowserTab,
	onNewTerminalTab,
	setQuickActionOpen,
	newTabShortcut,
	newFileTabShortcut,
	newBrowserTabShortcut,
	newTerminalTabShortcut,
}: BuildNewTabCommandsArgs): QuickAction[] {
	const t = getT();
	if (!activeSession) return [];
	const commands: QuickAction[] = [];

	if (onNewTab) {
		commands.push({
			id: 'newAiChat',
			label: t('workflows.shell.newAiChatTab'),
			subtext: t('workflows.shell.openANewAiChatTabInThe'),
			shortcut: newTabShortcut,
			action: () => {
				onNewTab();
				setQuickActionOpen(false);
			},
		});
	}

	if (onNewFileTab) {
		commands.push({
			id: 'newFileTab',
			label: t('workflows.shell.newFileTab'),
			subtext: t('workflows.shell.openANewFileTabInTheActive'),
			shortcut: newFileTabShortcut,
			action: () => {
				onNewFileTab();
				setQuickActionOpen(false);
			},
		});
	}

	if (onNewBrowserTab) {
		commands.push({
			id: 'newBrowserTab',
			label: t('workflows.shell.newBrowserTab'),
			subtext: t('workflows.shell.openANewBrowserTabInTheActive'),
			shortcut: newBrowserTabShortcut,
			action: () => {
				onNewBrowserTab();
				setQuickActionOpen(false);
			},
		});
	}

	if (onNewTerminalTab) {
		commands.push({
			id: 'newTerminalTab',
			label: t('workflows.shell.newTerminalTab'),
			subtext: t('workflows.shell.openANewTerminalTabInTheActive'),
			shortcut: newTerminalTabShortcut,
			action: () => {
				onNewTerminalTab();
				setQuickActionOpen(false);
			},
		});
	}

	return commands;
}

export function buildTabCommands({
	activeSession,
	activeGroupChatId,
	isAiMode,
	activeTabInfo,
	enterToSendAI,
	markdownEditMode,
	onOpenTabSwitcher,
	onRenameTab,
	onToggleReadOnlyMode,
	onToggleTabShowThinking,
	onToggleTabEnterToSend,
	onToggleMarkdownEditMode,
	onFocusActiveTab,
	onCloseAllTabs,
	onCloseOtherTabs,
	onCloseTabsLeft,
	onCloseTabsRight,
	onCloseCurrentTab,
	onMoveTabToFirst,
	onMoveTabToLast,
	onClearActiveTerminal,
	setQuickActionOpen,
	shortcuts,
	tabShortcuts,
	toggleInputMode,
}: BuildTabCommandsArgs): QuickAction[] {
	const t = getT();
	const commands: QuickAction[] = [];
	const { isTerminalMode, hasActiveTab, activeUnifiedIndex, unifiedTabCount, activeTabType } =
		activeTabInfo;

	if (activeSession) {
		commands.push({
			id: 'switchMode',
			label: t('workflows.shell.switchAiShellMode'),
			// No shortcut hint. This entry really does toggle inputMode in place,
			// but `toggleMode`'s key (Cmd+J) stopped doing that in afad8e7be and now
			// opens a terminal tab. Advertising that chord here told the user a key
			// would do this, and it does something else - which is exactly the
			// "switch AI/terminal isn't valid anymore" report. The palette is now the
			// only way to reach the in-place toggle; it has no binding of its own.
			action: toggleInputMode,
		});
	}

	if (onOpenTabSwitcher && activeSession?.aiTabs) {
		commands.push({
			id: 'tabSwitcher',
			label: t('workflows.shell.tabSwitcher'),
			subtext: t('workflows.shell.searchOpenTabsAcrossThisAgent'),
			shortcut: tabShortcuts?.tabSwitcher,
			action: () => {
				onOpenTabSwitcher();
				setQuickActionOpen(false);
			},
		});
	}

	if (hasActiveTab && onRenameTab) {
		commands.push({
			id: 'renameTab',
			label: t('workflows.shell.renameTab'),
			shortcut: tabShortcuts?.renameTab,
			action: () => {
				onRenameTab();
				setQuickActionOpen(false);
			},
		});
	}

	if (isAiMode && onToggleReadOnlyMode) {
		commands.push({
			id: 'toggleReadOnly',
			label: t('workflows.shell.toggleReadOnlyMode'),
			shortcut: tabShortcuts?.toggleReadOnlyMode,
			action: () => {
				onToggleReadOnlyMode();
				setQuickActionOpen(false);
			},
		});
	}

	if (isAiMode && onToggleTabShowThinking) {
		commands.push({
			id: 'toggleShowThinking',
			label: t('workflows.shell.toggleShowThinking'),
			shortcut: tabShortcuts?.toggleShowThinking,
			action: () => {
				onToggleTabShowThinking();
				setQuickActionOpen(false);
			},
		});
	}

	if (isAiMode && onToggleTabEnterToSend) {
		const activeTab = activeSession?.aiTabs.find((tab) => tab.id === activeSession.activeTabId);
		const effective = activeTab?.enterToSend ?? enterToSendAI;
		commands.push({
			id: 'toggleEnterToSend',
			label: t('workflows.shell.toggleEnterToSend'),
			subtext: effective
				? t('workflows.shell.currentlyEnterSendsClickToSwitchThisTab', { p0: formatMetaKey() })
				: t('workflows.shell.currentlyValueEnterSendsClickToSwitchThis', { p0: formatMetaKey() }),
			action: () => {
				onToggleTabEnterToSend();
				setQuickActionOpen(false);
			},
		});
	}

	if (isAiMode && onToggleMarkdownEditMode) {
		commands.push({
			id: 'toggleMarkdown',
			label: t('workflows.shell.toggleEditPreview'),
			shortcut: shortcuts.toggleMarkdownMode,
			subtext: markdownEditMode
				? t('workflows.shell.currentlyInEditMode')
				: t('workflows.shell.currentlyInPreviewMode'),
			action: () => {
				onToggleMarkdownEditMode();
				setQuickActionOpen(false);
			},
		});
	}

	if (hasActiveTab && onFocusActiveTab) {
		commands.push({
			id: 'focusActiveTab',
			label: t('workflows.shell.focusActiveTab'),
			shortcut: shortcuts.focusActiveTab,
			subtext: t('workflows.shell.bringTheCurrentTabHeaderIntoFocus'),
			action: () => {
				onFocusActiveTab();
				setQuickActionOpen(false);
			},
		});
	}

	// Count only what the strip draws: hidden consult tabs survive a close-all, so
	// including them would name a number the user can neither see nor close.
	const closableTabCount = visibleAiTabs(activeSession?.aiTabs).length;
	if (isAiMode && closableTabCount > 0 && onCloseAllTabs) {
		commands.push({
			id: 'closeAllTabs',
			label: t('workflows.shell.closeAllTabs'),
			shortcut: tabShortcuts?.closeAllTabs,
			subtext:
				closableTabCount === 1
					? t('workflows.shell.close1Tab')
					: t('workflows.shell.closeAllValueTabs', { p0: closableTabCount }),
			action: () => {
				onCloseAllTabs();
				setQuickActionOpen(false);
			},
		});
	}

	if (hasActiveTab && unifiedTabCount > 1 && onCloseOtherTabs) {
		commands.push({
			id: 'closeOtherTabs',
			label: t('workflows.shell.closeOtherTabs'),
			shortcut: tabShortcuts?.closeOtherTabs,
			subtext: t('workflows.shell.keepOnlyCurrentTabCloseValueOthers', { p0: unifiedTabCount - 1 }),
			action: () => {
				onCloseOtherTabs();
				setQuickActionOpen(false);
			},
		});
	}

	if (hasActiveTab && activeUnifiedIndex > 0 && onCloseTabsLeft) {
		commands.push({
			id: 'closeTabsLeft',
			label: t('workflows.shell.closeTabsToLeft'),
			shortcut: tabShortcuts?.closeTabsLeft,
			action: () => {
				onCloseTabsLeft();
				setQuickActionOpen(false);
			},
		});
	}

	if (
		hasActiveTab &&
		activeUnifiedIndex >= 0 &&
		activeUnifiedIndex < unifiedTabCount - 1 &&
		onCloseTabsRight
	) {
		commands.push({
			id: 'closeTabsRight',
			label: t('workflows.shell.closeTabsToRight'),
			shortcut: tabShortcuts?.closeTabsRight,
			action: () => {
				onCloseTabsRight();
				setQuickActionOpen(false);
			},
		});
	}

	if (hasActiveTab && unifiedTabCount > 1 && onCloseCurrentTab) {
		commands.push({
			id: 'closeCurrentTab',
			label: t('workflows.shell.closeTab'),
			shortcut: tabShortcuts?.closeTab,
			action: () => {
				onCloseCurrentTab();
				setQuickActionOpen(false);
			},
		});
	}

	// Retune the active AI tab's model and reasoning effort. AI-only, and absent
	// while a group chat owns the view: the palette is reachable from a room, and
	// `activeSession` still points at the agent selected before the room opened,
	// so the entry would have retuned a background tab the user is not looking
	// at. `resolveModelEffortTabId` owns both rules, and the shortcut resolves
	// its target through the same function.
	const modelEffortTabId = resolveModelEffortTabId(activeSession, activeGroupChatId);
	if (modelEffortTabId) {
		commands.push({
			id: 'changeModelEffort',
			label: t('workflows.shell.changeTabsModelAndEffort'),
			subtext: t('workflows.shell.pickAModelAndEffortLevelWithThe'),
			shortcut: shortcuts.openModelEffort,
			action: () => {
				setQuickActionOpen(false);
				useModalStore.getState().openModal('modelEffort', { tabId: modelEffortTabId });
			},
		});
	}

	// Snooze the active AI tab. The palette acts on the active tab, and the
	// non-AI kinds have their own snooze entry on their chip menu, so this stays
	// AI-only. The dialog's own shape still comes from `resolveSnoozeTarget`
	// rather than a literal here, so what it offers is derived from the tab in
	// exactly one place.
	if (activeSession && activeTabType === 'ai') {
		const activeTab = activeSession.aiTabs?.find((t) => t.id === activeSession.activeTabId);
		const snoozeTarget = activeTab ? resolveSnoozeTarget(activeSession, activeTab.id) : null;
		if (snoozeTarget) {
			commands.push({
				id: 'snoozeTab',
				label: t('workflows.shell.snoozeTab'),
				subtext: t('workflows.shell.hideThisTabUntilLaterThenGetA'),
				shortcut: tabShortcuts?.snoozeTab,
				action: () => {
					setQuickActionOpen(false);
					useModalStore.getState().openModal('snoozeTab', snoozeTarget);
				},
			});
		}
	}

	commands.push({
		id: 'showSnoozedTabs',
		label: t('workflows.shell.seeAllSnoozedTabs'),
		subtext: t('workflows.shell.unsnoozeRescheduleOrDismissSnoozedTabs'),
		shortcut: shortcuts.showSnoozeList,
		action: () => {
			setQuickActionOpen(false);
			useModalStore.getState().openModal('snoozedTabs');
		},
	});

	if (hasActiveTab && activeUnifiedIndex > 0 && onMoveTabToFirst) {
		commands.push({
			id: 'moveTabToFirst',
			label: t('workflows.shell.moveToFirstPosition'),
			shortcut: tabShortcuts?.moveTabToStart,
			action: () => {
				onMoveTabToFirst();
				setQuickActionOpen(false);
			},
		});
	}

	if (
		hasActiveTab &&
		activeUnifiedIndex >= 0 &&
		activeUnifiedIndex < unifiedTabCount - 1 &&
		onMoveTabToLast
	) {
		commands.push({
			id: 'moveTabToLast',
			label: t('workflows.shell.moveToLastPosition'),
			shortcut: tabShortcuts?.moveTabToEnd,
			action: () => {
				onMoveTabToLast();
				setQuickActionOpen(false);
			},
		});
	}

	if (activeSession && isTerminalMode && onClearActiveTerminal) {
		commands.push({
			id: 'clearTerminal',
			label: t('workflows.shell.clearTerminalHistory'),
			shortcut: shortcuts.clearTerminal,
			action: () => {
				onClearActiveTerminal();
				setQuickActionOpen(false);
			},
		});
	}

	return commands;
}
