import { getT } from '../../../i18n';
import type { RightPanelTab } from '../../../types';
import type { QuickAction } from '../types';

interface BuildRightPanelCommandsArgs {
	autoRunDisabled: boolean;
	autoRunSelectedDocument?: string | null;
	autoRunCompletedTaskCount?: number;
	setRightPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
	setActiveRightTab: (tab: RightPanelTab) => void;
	setQuickActionOpen: (open: boolean) => void;
	onToggleAutoRunExpanded?: () => void;
	onAutoRunResetTasks?: () => void;
	shortcuts: {
		goToFiles?: QuickAction['shortcut'];
		goToHistory?: QuickAction['shortcut'];
		goToAutoRun?: QuickAction['shortcut'];
		toggleAutoRunExpanded?: QuickAction['shortcut'];
	};
}

export function buildRightPanelCommands({
	autoRunDisabled,
	autoRunSelectedDocument,
	autoRunCompletedTaskCount,
	setRightPanelOpen,
	setActiveRightTab,
	setQuickActionOpen,
	onToggleAutoRunExpanded,
	onAutoRunResetTasks,
	shortcuts,
}: BuildRightPanelCommandsArgs): QuickAction[] {
	const t = getT();
	const commands: QuickAction[] = [
		{
			id: 'goToFiles',
			label: t('workflows.shell.goToFilesTab'),
			shortcut: shortcuts.goToFiles,
			action: () => {
				setRightPanelOpen(true);
				setActiveRightTab('files');
				setQuickActionOpen(false);
			},
		},
		{
			id: 'goToHistory',
			label: t('workflows.shell.goToHistoryTab'),
			shortcut: shortcuts.goToHistory,
			action: () => {
				setRightPanelOpen(true);
				setActiveRightTab('history');
				setQuickActionOpen(false);
			},
		},
	];

	if (!autoRunDisabled) {
		commands.push({
			id: 'goToAutoRun',
			label: t('workflows.shell.goToAutoRunTab'),
			shortcut: shortcuts.goToAutoRun,
			action: () => {
				setRightPanelOpen(true);
				setActiveRightTab('autorun');
				setQuickActionOpen(false);
			},
		});

		if (onToggleAutoRunExpanded) {
			commands.push({
				id: 'autoRunExpandedPreview',
				label: t('workflows.shell.autoRunExpandedPreview'),
				subtext: t('workflows.shell.openTheAutoRunDocumentInACentered'),
				shortcut: shortcuts.toggleAutoRunExpanded,
				action: () => {
					onToggleAutoRunExpanded();
					setQuickActionOpen(false);
				},
			});
		}

		if (
			autoRunSelectedDocument &&
			autoRunCompletedTaskCount &&
			autoRunCompletedTaskCount > 0 &&
			onAutoRunResetTasks
		) {
			commands.push({
				id: 'resetAutoRunTasks',
				label: t('workflows.shell.resetFinishedTasksInValue', { p0: autoRunSelectedDocument }),
				subtext: t('workflows.shell.uncheckValueCompletedTaskvalue', {
					p0: autoRunCompletedTaskCount,
					p1: autoRunCompletedTaskCount !== 1 ? t('workflows.shell.pluralSuffix') : '',
				}),
				action: () => {
					onAutoRunResetTasks();
					setQuickActionOpen(false);
				},
			});
		}
	}

	return commands;
}
