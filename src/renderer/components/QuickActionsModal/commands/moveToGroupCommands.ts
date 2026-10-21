import { getT } from '../../../i18n';
import type { Group } from '../../../types';
import type { QuickAction, QuickActionMode } from '../types';

interface BuildMoveToGroupCommandsArgs {
	initialMode: QuickActionMode;
	groups: Group[];
	handleMoveToGroup: (groupId: string) => void;
	handleCreateGroup: () => void;
	setMode: (mode: QuickActionMode) => void;
	resetSelectionToFirst: () => void;
}

export function buildMoveToGroupCommands({
	initialMode,
	groups,
	handleMoveToGroup,
	handleCreateGroup,
	setMode,
	resetSelectionToFirst,
}: BuildMoveToGroupCommandsArgs): QuickAction[] {
	const t = getT();
	return [
		...(initialMode === 'main'
			? [
					{
						id: 'back',
						label: t('workflows.shell.backToMainMenu'),
						action: () => {
							setMode('main');
							resetSelectionToFirst();
						},
					},
				]
			: []),
		{
			id: 'no-group',
			label: t('workflows.shell.noGroupUngrouped'),
			action: () => handleMoveToGroup(''),
		},
		...groups.map((group) => ({
			id: `group-${group.id}`,
			label: `${group.emoji} ${group.name}`,
			action: () => handleMoveToGroup(group.id),
		})),
		{ id: 'create-new', label: t('workflows.shell.createNewGroup2'), action: handleCreateGroup },
	];
}
