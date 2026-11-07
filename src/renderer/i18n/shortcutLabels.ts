/**
 * Localized names for keyboard-shortcut actions.
 *
 * A shortcut's English `label` lives with its definition and is also what gets
 * persisted alongside custom bindings, so it cannot be swapped for a translated
 * string. Display sites call `localizeShortcutLabel` instead, which looks the
 * action up by its stable `id` and falls back to the stored English label.
 */

import { selectNewShellEnabled, useSettingsStore } from '../stores/settingsStore';
import { getTranslator, type MessageKey } from './translate';
import { useCallback } from 'react';
import type { AppLocale } from '../../shared/i18n';
import { shortcutLabelsZhCN } from './locales/zh-CN/shortcutLabels';
import { useAppLocale } from './useI18n';

export const SHORTCUT_LABEL_OVERLAYS: Readonly<
	Partial<Record<AppLocale, Readonly<Record<string, string>>>>
> = {
	'zh-CN': shortcutLabelsZhCN,
};

const NEW_SHELL_SHORTCUT_KEYS: Readonly<Record<string, MessageKey>> = {
	splitConversation: 'workflows.split.openRight',
	toggleMode: 'workflows.newShell.newTerminalTab',
	goToFiles: 'workflows.newShell.goToFilesTab',
	goToHistory: 'workflows.newShell.goToHistoryTab',
	goToAutoRun: 'workflows.newShell.goToAutoRunTab',
	openModelEffort: 'workflows.newShell.changeTabsModelAndEffort',
	nextUnreadTab: 'workflows.newShell.nextUnreadDraftTab',
	previousUnreadTab: 'workflows.newShell.previousUnreadDraftTab',
	toggleUnreadFilters: 'workflows.newShell.filterBothTheAgentListAndTheTab',
	focusActiveTab: 'workflows.newShell.focusActiveTab',
	searchAllTabs: 'workflows.newShell.searchMessagesAllAgentTabs',
	showSnoozeList: 'workflows.newShell.seeAllSnoozedTabs',
	tabSwitcher: 'workflows.newShell.tabSwitcher',
	newTab: 'workflows.newShell.newAiChatTab',
	newBrowserTab: 'workflows.newShell.newBrowserTab',
	newFileTab: 'workflows.newShell.newFileTab',
	closeTab: 'workflows.newShell.closeTab',
	closeAllTabs: 'workflows.newShell.closeAllTabs',
	closeOtherTabs: 'workflows.newShell.closeOtherTabs',
	snoozeTab: 'workflows.newShell.snoozeTab',
	closeTabsLeft: 'workflows.newShell.closeTabsToLeft',
	closeTabsRight: 'workflows.newShell.closeTabsToRight',
	renameTab: 'workflows.newShell.renameTab',
	prevTab: 'workflows.newShell.shortcut.prevTab',
	nextTab: 'workflows.newShell.shortcut.nextTab',
	toggleTabStar: 'workflows.newShell.shortcut.toggleTabStar',
	filterFiles: 'workflows.newShell.shortcut.filterFiles',
	filterHistory: 'workflows.newShell.shortcut.filterHistory',
	historyJumpToSession: 'workflows.newShell.shortcut.historyJumpToSession',
	reopenClosedTab: 'workflows.newShell.shortcut.reopenClosedTab',
	moveTabToStart: 'workflows.newShell.shortcut.moveTabToStart',
	moveTabToEnd: 'workflows.newShell.shortcut.moveTabToEnd',
	filterUnreadTabs: 'workflows.newShell.shortcut.filterUnreadTabs',
	toggleTabUnread: 'workflows.newShell.shortcut.toggleTabUnread',
	goToLastTab: 'workflows.newShell.shortcut.goToLastTab',
	goToTab1: 'workflows.newShell.shortcut.goToTab1',
	goToTab2: 'workflows.newShell.shortcut.goToTab2',
	goToTab3: 'workflows.newShell.shortcut.goToTab3',
	goToTab4: 'workflows.newShell.shortcut.goToTab4',
	goToTab5: 'workflows.newShell.shortcut.goToTab5',
	goToTab6: 'workflows.newShell.shortcut.goToTab6',
	goToTab7: 'workflows.newShell.shortcut.goToTab7',
	goToTab8: 'workflows.newShell.shortcut.goToTab8',
	goToTab9: 'workflows.newShell.shortcut.goToTab9',
};

export function localizeShortcutLabel(
	locale: AppLocale,
	shortcut: { id: string; label: string },
	newShell = false
): string {
	const key = newShell ? NEW_SHELL_SHORTCUT_KEYS[shortcut.id] : undefined;
	if (key) return getTranslator(locale)(key);
	return SHORTCUT_LABEL_OVERLAYS[locale]?.[shortcut.id] ?? shortcut.label;
}

export function useShortcutLabel(): (shortcut: { id: string; label: string }) => string {
	const locale = useAppLocale();
	const newShell = useSettingsStore(selectNewShellEnabled);
	return useCallback(
		(shortcut) => localizeShortcutLabel(locale, shortcut, newShell),
		[locale, newShell]
	);
}
