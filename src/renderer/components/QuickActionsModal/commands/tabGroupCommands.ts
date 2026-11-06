import { selectNewShellEnabled, useSettingsStore } from '../../../stores/settingsStore';
import { getT } from '../../../i18n';
import type { Session } from '../../../types';
import type { QuickAction } from '../types';
import { useModalStore } from '../../../stores/modalStore';
import { updateSessionWith } from '../../../stores/sessionStore';
import { breakApartGroup } from '../../../utils/panelLayout';

interface BuildTabGroupCommandsArgs {
	activeSession: Session | undefined;
	setQuickActionOpen: (open: boolean) => void;
}

/**
 * Commands scoped to the tiled tab group the user is currently under. Only
 * emitted when `activeSession.activeGroupId` resolves to a real group (the
 * group is taking over the main panel), mirroring the actions available from
 * the group chip's hover overlay:
 *   - Rename Tab Group: opens the shared rename-tab modal seeded with the group
 *     id; commit is routed to the group-rename action in handleRenameTab.
 *   - Break Apart Tab Group: gated behind the same confirm dialog the chip uses,
 *     then promotes every pane back to the tab bar as standalone tabs.
 */
export function buildTabGroupCommands({
	activeSession,
	setQuickActionOpen,
}: BuildTabGroupCommandsArgs): QuickAction[] {
	const t = getT();
	const newShell = selectNewShellEnabled(useSettingsStore.getState());
	const commands: QuickAction[] = [];
	const groupId = activeSession?.activeGroupId;
	if (!activeSession || !groupId) return commands;
	const group = activeSession.tabGroups?.find((g) => g.id === groupId);
	if (!group) return commands;

	commands.push({
		id: 'renameTabGroup',
		label: t(newShell ? 'workflows.newShell.renameTabGroup' : 'workflows.shell.renameTabGroup'),
		subtext: t('workflows.shell.renameValue', { p0: group.name }),
		action: () => {
			// Reuse the shared rename-tab modal, seeded with the group id. On commit,
			// handleRenameTab detects the group id and routes to the group-rename action.
			useModalStore.getState().openModal('renameTab', {
				tabId: group.id,
				initialName: group.name,
			});
			setQuickActionOpen(false);
		},
	});

	commands.push({
		id: 'breakApartTabGroup',
		label: t(
			newShell ? 'workflows.newShell.breakApartTabGroup' : 'workflows.shell.breakApartTabGroup'
		),
		subtext: t(
			newShell
				? 'workflows.newShell.returnItsPanesToTheTabBarAs'
				: 'workflows.shell.returnItsPanesToTheTabBarAs'
		),
		action: () => {
			useModalStore.getState().openModal('confirm', {
				title: t('workflows.shell.breakApartGroup'),
				message: `Break apart "${group.name}"? Its panes return to the tab bar as individual tabs. The tabs are not closed, and you can tile them again later.`,
				destructive: false,
				onConfirm: () => updateSessionWith(activeSession.id, (s) => breakApartGroup(s, group.id)),
			});
			setQuickActionOpen(false);
		},
	});

	return commands;
}
