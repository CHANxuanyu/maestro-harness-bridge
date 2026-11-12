import { getWindowContext } from '../contexts/WindowContext';
import {
	conversationDisclosureKey,
	conversationExpanded,
	type ConversationChildrenRequest,
	type ConversationChildrenResult,
} from '../../shared/conversationChildren';
import { sessionProviderId } from '../../shared/agentPresets';
import { updateSessionWith, useSessionStore } from '../stores/sessionStore';
import { selectNewShellEnabled, useSettingsStore } from '../stores/settingsStore';
import {
	buildProjectHistoryScopes,
	matchRecordForTab,
	runnerAccount,
} from '../utils/nativeConversationMatch';
import { createKeyedWriteQueue } from '../../shared/keyedWriteQueue';

const writes = createKeyedWriteQueue();

/** UI and CLI execute in the parent's owning window. History lookup is metadata only. */
export function conversationChildren(
	request: ConversationChildrenRequest
): Promise<ConversationChildrenResult> {
	return writes.enqueue(request.sessionId, async () => {
		if (!selectNewShellEnabled(useSettingsStore.getState()))
			throw new Error('New shell is disabled');
		const state = useSessionStore.getState();
		const owner = state.sessions.find((session) => session.id === request.sessionId);
		if (!owner || getWindowContext()?.ownsSession(owner.id) === false)
			throw new Error('Conversation owner is unavailable');
		const tab = request.tabId
			? owner.aiTabs.find((item) => item.id === request.tabId)
			: owner.aiTabs.find((item) => item.agentSessionId === request.nativeSessionId);
		if (request.tabId && !tab) throw new Error('Conversation tab is unavailable');
		let nativeSessionId = tab?.agentSessionId ?? request.nativeSessionId ?? null;
		let key = `${owner.id}:${tab?.id}`;
		if (!tab) {
			if (!nativeSessionId) throw new Error('A tab or native conversation ID is required');
			const history = await window.maestro.agentSessions.listProjectHistory(
				buildProjectHistoryScopes([owner], state.groups)
			);
			const record = matchRecordForTab(runnerAccount(owner), nativeSessionId, [
				...history.conversations,
				...((await window.maestro.agentSessions.archives?.()) ?? []),
			]);
			if (!record) throw new Error('Native conversation is unavailable for this account and host');
			key = `history:${record.key}`;
			nativeSessionId = record.nativeSessionId;
		}
		if (getWindowContext()?.ownsSession(owner.id) === false)
			throw new Error('Conversation owner changed');
		if (request.expanded !== undefined) {
			if (typeof request.expanded !== 'boolean') throw new Error('Expanded must be a boolean');
			updateSessionWith(owner.id, (session) => ({
				...session,
				conversationTreeExpanded: {
					...session.conversationTreeExpanded,
					[conversationDisclosureKey(tab?.id ?? null, nativeSessionId)]: request.expanded!,
				},
			}));
			const current = useSessionStore
				.getState()
				.sessions.find((session) => session.id === owner.id)!;
			if ((await window.maestro.sessions.setMany([current], [])) === false)
				throw new Error('Could not save conversation disclosure');
		}
		const current = useSessionStore.getState().sessions.find((session) => session.id === owner.id)!;
		return {
			parent: {
				key,
				ownerId: owner.id,
				tabId: tab?.id ?? null,
				provider: sessionProviderId(owner),
				nativeSessionId,
			},
			expanded:
				conversationExpanded(current.conversationTreeExpanded, tab?.id ?? null, nativeSessionId) ??
				false,
		};
	});
}
