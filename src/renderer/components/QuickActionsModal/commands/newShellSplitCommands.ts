import { getT } from '../../../i18n';
import { splitConversation, unsplitConversation } from '../../../services/newShellSplit';
import { notifyCenterFlash } from '../../../stores/centerFlashStore';
import { selectNewShellEnabled, useSettingsStore } from '../../../stores/settingsStore';
import type { Session } from '../../../types';
import { conversationDisplayTitle } from '../../../utils/conversationTitle';
import { visibleAiTabs } from '../../../utils/tabHelpers';
import type { QuickAction } from '../types';
import type { GetSessionWindow } from './agentJumpAction';

export function buildNewShellSplitCommands({
	sessions,
	activeSession,
	setQuickActionOpen,
	setSearch,
	getSessionWindow,
}: {
	sessions: Session[];
	activeSession: Session | undefined;
	setQuickActionOpen: (open: boolean) => void;
	setSearch: (search: string) => void;
	getSessionWindow?: GetSessionWindow;
}): QuickAction[] {
	if (!selectNewShellEnabled(useSettingsStore.getState()) || !activeSession?.activeTabId) return [];
	const t = getT();
	return [
		{
			id: 'splitConversation',
			label: t('workflows.split.chooseConversation'),
			shortcut: useSettingsStore.getState().shortcuts.splitConversation,
			action: () => setSearch(t('workflows.split.openRight')),
		},
		{
			id: 'unsplitConversation',
			label: t('workflows.split.unsplit'),
			action: () => {
				setQuickActionOpen(false);
				void unsplitConversation().catch((error) =>
					notifyCenterFlash({
						color: 'yellow',
						message: error instanceof Error ? error.message : String(error),
					})
				);
			},
		},
		...sessions
			.filter((session) => !getSessionWindow?.(session.id))
			.flatMap((session) =>
				visibleAiTabs(session.aiTabs)
					.filter((tab) => session.id !== activeSession.id || tab.id !== activeSession.activeTabId)
					.map(
						(tab): QuickAction => ({
							id: `splitConversation:${session.id}:${tab.id}`,
							label: t('workflows.split.openRightTitle', {
								title:
									conversationDisplayTitle(tab) ?? t('workflows.conversations.newConversation'),
							}),
							subtext: session.name,
							action: () => {
								setQuickActionOpen(false);
								void splitConversation(session.id, tab.id).catch((error) =>
									notifyCenterFlash({
										color: 'yellow',
										message: error instanceof Error ? error.message : String(error),
									})
								);
							},
						})
					)
			),
	];
}
