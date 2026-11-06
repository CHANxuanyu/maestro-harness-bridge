import type { NativeHistorySearchHit } from '../../shared/nativeHistorySearch';
import { openNativeConversation, type ResumeNativeSession } from './openNativeConversation';
import { nativeRecordFitsTab, refreshNativeConversation } from './refreshNativeConversation';
import { useSessionStore, updateAiTab } from '../stores/sessionStore';
import { useUIStore } from '../stores/uiStore';
import {
	sameLiveMessage,
	selectOlderEntries,
	stripSynopsisTurns,
	transcriptMessagesToLogEntries,
	type TranscriptMessage,
} from '../utils/transcriptMessages';

/** Open and backfill through the normal native reader, then use the existing scroll and flash. */
export async function openNativeHistorySearchHit(
	hit: NativeHistorySearchHit,
	resume: ResumeNativeSession
): Promise<boolean> {
	const record = hit.conversation;
	if (record.sshRemoteId) return false;
	const opened = await openNativeConversation(record, record.title, resume);
	if (opened.status !== 'opened') return false;
	const ownerId = opened.ownerId;
	const owner = useSessionStore.getState().sessions.find((session) => session.id === ownerId);
	const tabId = owner?.activeTabId;
	if (!tabId) return false;
	await refreshNativeConversation({ sessionId: ownerId, tabId, record });
	const current = () => {
		const state = useSessionStore.getState();
		const session = state.sessions.find((item) => item.id === ownerId);
		const tab = session?.aiTabs.find((item) => item.id === tabId);
		return state.activeSessionId === ownerId &&
			session?.activeTabId === tabId &&
			tab &&
			nativeRecordFitsTab(session, tab, record)
			? tab
			: undefined;
	};
	if (!current()) return false;
	try {
		const result = await window.maestro.agentSessions.read(
			record.provider,
			record.projectPath,
			record.nativeSessionId,
			{
				ownerAgentId: ownerId,
				configDir: record.accountDir,
				readOnly: true,
				limit: 100000,
			}
		);
		const loaded = transcriptMessagesToLogEntries(
			stripSynopsisTurns(result.messages as TranscriptMessage[]),
			result.toolOutputSource
		);
		const matched =
			loaded.find(
				(entry) => hit.message.uuid && entry.nativeTranscript?.messageId === hit.message.uuid
			) ??
			loaded.find(
				(entry) =>
					(entry.source === 'user') === (hit.message.role === 'user') &&
					(!hit.message.timestamp || entry.timestamp === Date.parse(hit.message.timestamp)) &&
					entry.text.replace(/\s+/g, ' ').includes(hit.message.text.replace(/\s+/g, ' '))
			);
		if (!matched || !current()) return false;
		let logId: string | undefined;
		updateAiTab(ownerId, tabId, (tab) => {
			if (!current()) return tab;
			const older = selectOlderEntries(loaded, tab.logs);
			const logs = [...older, ...tab.logs];
			const target = logs.find(
				(entry) =>
					entry.id === matched.id ||
					entry.nativeTranscript?.messageId === matched.nativeTranscript?.messageId
			);
			const live = target
				? []
				: logs.filter((entry) => !entry.nativeTranscript && sameLiveMessage(entry, matched));
			logId = target?.id ?? (live.length === 1 ? live[0].id : undefined);
			return older.length ? { ...tab, logs } : tab;
		});
		if (!logId || !current()) return false;
		useUIStore.getState().setPendingLogJump({
			sessionId: ownerId,
			tabId,
			logId,
			revealTurnActivity: true,
		});
		return true;
	} catch {
		return false;
	}
}
