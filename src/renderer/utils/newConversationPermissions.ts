import type { AITab, Session } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import { sessionProjectKey, sessionHost } from './nativeConversationMatch';
import { visibleAiTabs } from './unifiedTabOrderUtils';

/** Find the project's latest known conversation without reading native account files. */
export function recentProjectConversation(
	session: Session
): { session: Session; tab: AITab } | undefined {
	const state = useSessionStore.getState();
	const sessions = [...state.sessions.filter((item) => item.id !== session.id), session];
	const owners = new Map(sessions.map((item) => [item.id, item]));
	const groups = new Map(state.groups.map((group) => [group.id, group]));
	const projectKey = sessionProjectKey(session, owners, groups).key;
	let recent: { session: Session; tab: AITab } | undefined;
	let latest = -Infinity;
	for (const owner of sessions) {
		if (
			owner.toolType === 'terminal' ||
			sessionHost(owner) !== sessionHost(session) ||
			sessionProjectKey(owner, owners, groups).key !== projectKey
		)
			continue;
		const knownTabs = new Map([
			...(owner.closedTabHistory ?? []).map(({ tab }) => [tab.id, tab] as const),
			...(owner.unifiedClosedTabHistory ?? []).flatMap((entry) =>
				entry.type === 'ai' ? [[entry.tab.id, entry.tab] as const] : []
			),
			...owner.aiTabs.map((tab) => [tab.id, tab] as const),
		]);
		for (const tab of visibleAiTabs([...knownTabs.values()])) {
			const activity = tab.logs.reduce(
				(time, log) => Math.max(time, log.timestamp),
				Math.max(tab.createdAt, tab.lastSelectedAt ?? 0)
			);
			if (activity > latest) {
				recent = { session: owner, tab };
				latest = activity;
			}
		}
	}
	return recent;
}
