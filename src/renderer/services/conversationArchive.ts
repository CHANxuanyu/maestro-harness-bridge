import type {
	ConversationArchiveAction,
	ConversationArchiveTarget,
	ConversationLifecycleRequest,
	ConversationLifecycleResult,
} from '../../shared/conversationArchive';
import { useSessionStore } from '../stores/sessionStore';
import { closeTab } from '../utils/tabHelpers';
import { resolveTabPermissionMode } from '../../shared/agentMetadata';
import { useModalStore } from '../stores/modalStore';
import { getT } from '../i18n';
import { refreshConversationArchives } from '../stores/conversationArchiveStore';
import { conversationActivity } from '../utils/newConversationPermissions';

/** Runs synchronously in each owning window, checking again immediately before closure. */
export function conversationLifecycle(
	request: ConversationLifecycleRequest
): ConversationLifecycleResult {
	const state = useSessionStore.getState();
	const owners = request.ownerIds.map((id) => state.sessions.find((session) => session.id === id));
	if (owners.some((owner) => !owner)) return { error: 'conversation-owner-unavailable' };
	const tabs = owners.flatMap((owner) =>
		[...owner!.aiTabs, ...(owner!.orphanedThinkingTabs ?? [])].filter(
			(tab) => tab.agentSessionId === request.nativeSessionId
		)
	);
	if (
		tabs.some((tab) => tab.state === 'busy') ||
		owners.some((owner) =>
			owner!.executionQueue?.some((item) => tabs.some((tab) => tab.id === item.tabId))
		)
	)
		return { error: 'conversation-running' };
	const retained = owners
		.flatMap((owner) => [
			...owner!.aiTabs,
			...(owner!.closedTabHistory ?? []).map((entry) => entry.tab),
			...(owner!.unifiedClosedTabHistory ?? []).flatMap((entry) =>
				entry.type === 'ai' ? [entry.tab] : []
			),
		])
		.filter((tab) => tab.agentSessionId === request.nativeSessionId);
	const modes = retained.map(resolveTabPermissionMode);
	if (request.phase === 'close') {
		state.setSessions((sessions) =>
			sessions.map((session) => {
				if (!request.ownerIds.includes(session.id)) return session;
				let next = session;
				for (const tab of session.aiTabs.filter(
					(item) => item.agentSessionId === request.nativeSessionId
				)) {
					next =
						closeTab(next, tab.id, false, { skipHistory: true, skipReplacement: true })?.session ??
						next;
				}
				return {
					...next,
					conversationArchiveEmpty: next.aiTabs.length === 0,
					closedTabHistory: next.closedTabHistory?.filter(
						({ tab }) => tab.agentSessionId !== request.nativeSessionId
					),
					unifiedClosedTabHistory: next.unifiedClosedTabHistory?.filter(
						(entry) => entry.type !== 'ai' || entry.tab.agentSessionId !== request.nativeSessionId
					),
				};
			})
		);
	}
	return {
		lastActivity: retained.length ? Math.max(...retained.map(conversationActivity)) : undefined,
		permissionMode: modes.includes('readonly')
			? 'readonly'
			: modes.includes('standard')
				? 'standard'
				: modes.includes('full')
					? 'full'
					: undefined,
		title: retained.find((tab) => tab.name)?.name ?? undefined,
	};
}

/** Shared menu and palette entry. CLI invokes the same main operation. */
export function requestConversationAction(
	target: ConversationArchiveTarget,
	action: ConversationArchiveAction
): void {
	const t = getT();
	const run = async () => {
		try {
			await window.maestro.agentSessions.archiveConversation(target, action);
			await refreshConversationArchives();
		} catch (error) {
			const key = String(error).includes('conversation-running') ? 'running' : 'failed';
			useModalStore.getState().openModal('confirm', {
				title: t('workflows.archive.error'),
				message: t(`workflows.archive.${key}`),
				onConfirm: () => {},
			});
		}
	};
	if (action === 'delete')
		useModalStore.getState().openModal('confirm', {
			title: t('workflows.archive.delete'),
			message: t('workflows.archive.deleteConfirm', {
				title: target.title || target.nativeSessionId,
			}),
			destructive: true,
			confirmLabel: t('workflows.archive.delete'),
			onConfirm: () => {
				void run();
			},
		});
	else void run();
}
