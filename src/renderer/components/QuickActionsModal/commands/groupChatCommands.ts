import { getT } from '../../../i18n';
import type { GroupChat } from '../../../../shared/group-chat-types';
import { useGroupChatStore } from '../../../stores/groupChatStore';
import type { Session } from '../../../types';
import {
	describeGroupChatRunState,
	getGroupChatRunState,
	type GroupChatBusySnapshot,
} from '../../../utils/groupChatStatus';
import type { QuickAction } from '../types';
import { alphabetizeKey } from '../utils/quickActionSorting';

interface BuildGroupChatJumpCommandsArgs {
	groupChats?: GroupChat[];
	onOpenGroupChat?: (id: string) => void;
	setQuickActionOpen: (open: boolean) => void;
}

interface BuildGroupChatSwitcherCommandsArgs {
	groupChats?: GroupChat[];
	busySnapshot: GroupChatBusySnapshot;
	onOpenGroupChat?: (id: string) => void;
}

interface BuildGroupChatCommandsArgs {
	sessions: Session[];
	groupChats?: GroupChat[];
	activeGroupChatId?: string | null;
	onNewGroupChat?: () => void;
	onCloseGroupChat?: () => void;
	onDeleteGroupChat?: (id: string) => void;
	setQuickActionOpen: (open: boolean) => void;
	newGroupChatShortcut?: QuickAction['shortcut'];
	killShortcut?: QuickAction['shortcut'];
	moderatorOnlyShortcut?: QuickAction['shortcut'];
}

export function buildGroupChatJumpCommands({
	groupChats,
	onOpenGroupChat,
	setQuickActionOpen,
}: BuildGroupChatJumpCommandsArgs): QuickAction[] {
	const t = getT();
	if (!groupChats || !onOpenGroupChat) return [];
	return groupChats.map((groupChat) => ({
		id: `groupchat-${groupChat.id}`,
		label: t('workflows.shell.groupChatValue', { p0: groupChat.name }),
		action: () => {
			onOpenGroupChat(groupChat.id);
			setQuickActionOpen(false);
		},
		subtext: t('workflows.shell.valueParticipantvalue', {
			p0: groupChat.participants.length,
			p1: groupChat.participants.length !== 1 ? t('workflows.shell.pluralSuffix') : '',
		}),
	}));
}

/**
 * Group chat entries for the agent jumper (Cmd+K agents mode).
 *
 * Only RUNNING rooms are listed. The jumper's job is "where is work happening
 * right now", and a busy room is work the same way a busy agent is; an idle
 * room would just pad an already long list, and it is still reachable from the
 * main palette via buildGroupChatJumpCommands.
 */
export function buildGroupChatSwitcherCommands({
	groupChats,
	busySnapshot,
	onOpenGroupChat,
}: BuildGroupChatSwitcherCommandsArgs): QuickAction[] {
	const t = getT();
	if (!groupChats || !onOpenGroupChat) return [];

	const commands: QuickAction[] = [];
	for (const groupChat of groupChats) {
		const run = getGroupChatRunState(groupChat.id, busySnapshot);
		if (!run.isBusy) continue;
		const label = t('workflows.shell.groupChatValue', { p0: groupChat.name });
		commands.push({
			id: `jump-groupchat-${groupChat.id}`,
			label,
			action: () => onOpenGroupChat(groupChat.id),
			isRunningAgent: true,
			runningInfo: {
				// Group chat runs have no per-room start timestamp, so the subtext
				// carries a status label instead of an elapsed clock.
				state: 'busy',
				statusLabel: describeGroupChatRunState(run),
				queueCount: 0,
			},
			agentSortKey: alphabetizeKey(label),
		});
	}
	return commands;
}

export function buildGroupChatCommands({
	sessions,
	groupChats,
	activeGroupChatId,
	onNewGroupChat,
	onCloseGroupChat,
	onDeleteGroupChat,
	setQuickActionOpen,
	newGroupChatShortcut,
	killShortcut,
	moderatorOnlyShortcut,
}: BuildGroupChatCommandsArgs): QuickAction[] {
	const t = getT();
	const commands: QuickAction[] = [];

	if (onNewGroupChat && sessions.filter((session) => session.toolType !== 'terminal').length >= 2) {
		commands.push({
			id: 'newGroupChat',
			label: t('workflows.shell.newGroupChat'),
			shortcut: newGroupChatShortcut,
			action: () => {
				onNewGroupChat();
				setQuickActionOpen(false);
			},
		});
	}

	if (activeGroupChatId && onCloseGroupChat) {
		commands.push({
			id: 'closeGroupChat',
			label: t('workflows.shell.closeGroupChat'),
			action: () => {
				onCloseGroupChat();
				setQuickActionOpen(false);
			},
		});
	}

	if (activeGroupChatId) {
		// Read at build time, not at action time: the palette rebuilds its command
		// list on every open, so the label always names the state you would move to.
		const moderatorOnly = useGroupChatStore.getState().groupChatModeratorOnly;
		commands.push({
			id: 'toggleGroupChatModeratorOnly',
			label: moderatorOnly
				? t('workflows.shell.groupChatShowTeamChat')
				: t('workflows.shell.groupChatShowModeratorOnly'),
			subtext: moderatorOnly
				? t('workflows.shell.bringBackAgentDelegationsAndRepliesInThe')
				: t('workflows.shell.hideTheAgentBackAndForthAndKeep'),
			shortcut: moderatorOnlyShortcut,
			action: () => {
				useGroupChatStore.getState().toggleGroupChatModeratorOnly();
				setQuickActionOpen(false);
			},
		});
	}

	if (activeGroupChatId && onDeleteGroupChat && groupChats) {
		commands.push({
			id: 'deleteGroupChat',
			label: t('workflows.shell.removeGroupChatValue', {
				p0:
					groupChats.find((c) => c.id === activeGroupChatId)?.name ||
					t('workflows.shell.extraGroupChat'),
			}),
			shortcut: killShortcut,
			action: () => {
				onDeleteGroupChat(activeGroupChatId);
				setQuickActionOpen(false);
			},
		});
	}

	return commands;
}
