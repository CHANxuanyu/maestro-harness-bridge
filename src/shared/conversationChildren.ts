import type { ConversationOrigin } from './aiHandoff';
import { sessionProviderId } from './agentPresets';

/** History owners must first be resolved through the canonical native account matcher. */
export interface ConversationParentCandidate {
	key: string;
	ownerId: string | null;
	tabId: string | null;
	provider: string;
	nativeSessionId: string | null;
}

/** One parent for the sidebar and CLI, without guessing across runner accounts or hosts. */
export function findConversationParent<T extends ConversationParentCandidate>(
	origin:
		| (Pick<ConversationOrigin, 'sourceSessionId' | 'sourceTabId'> & Partial<ConversationOrigin>)
		| undefined,
	candidates: readonly T[]
): T | null {
	if (!origin) return null;
	const owned = candidates.filter((candidate) => candidate.ownerId === origin.sourceSessionId);
	const exact = owned.find((candidate) => candidate.tabId === origin.sourceTabId);
	if (exact) return exact;
	if (!origin.sourceNativeSessionId) return null;
	const native = owned.filter(
		(candidate) =>
			candidate.provider === origin.sourceProvider &&
			candidate.nativeSessionId === origin.sourceNativeSessionId
	);
	return native.length === 1 ? native[0] : null;
}

/** Archive checks include closed parents and descendants owned by other windows. */
export function conversationBranch<
	T extends {
		id: string;
		agentSessionId?: string | null;
		origin?: ConversationOrigin;
		consultOrigin?: Pick<ConversationOrigin, 'sourceSessionId' | 'sourceTabId'>;
	},
>(
	sessions: readonly {
		id: string;
		toolType: string;
		customEnvVars?: Record<string, string>;
		aiTabs?: readonly T[];
		orphanedThinkingTabs?: readonly T[];
	}[],
	ownerIds: readonly string[],
	nativeSessionId: string
): Array<{ ownerId: string; tab: T }> {
	type Entry = { ownerId: string; provider: string; tab: T };
	const edges = new Map<string, Entry[]>();
	const pending: Entry[] = [];
	const rootKeys: string[] = [];
	for (const owner of sessions) {
		const provider = sessionProviderId(owner);
		const rootOwner = ownerIds.includes(owner.id);
		if (rootOwner) rootKeys.push(JSON.stringify(['native', owner.id, provider, nativeSessionId]));
		for (const tab of [...(owner.aiTabs ?? []), ...(owner.orphanedThinkingTabs ?? [])]) {
			const entry = { ownerId: owner.id, provider, tab };
			if (rootOwner && tab.agentSessionId === nativeSessionId) pending.push(entry);
			const origin = tab.origin ?? tab.consultOrigin;
			if (!origin || tab.origin?.kind === 'handoff') continue;
			const keys = [JSON.stringify(['tab', origin.sourceSessionId, origin.sourceTabId])];
			if (tab.origin?.sourceNativeSessionId)
				keys.push(
					JSON.stringify([
						'native',
						origin.sourceSessionId,
						tab.origin.sourceProvider,
						tab.origin.sourceNativeSessionId,
					])
				);
			for (const key of keys) {
				const bucket = edges.get(key);
				if (bucket) bucket.push(entry);
				else edges.set(key, [entry]);
			}
		}
	}
	for (const key of rootKeys) pending.push(...(edges.get(key) ?? []));
	const seen = new Set<string>();
	const branch: Array<{ ownerId: string; tab: T }> = [];
	for (let index = 0; index < pending.length; index++) {
		const entry = pending[index];
		const key = JSON.stringify(['tab', entry.ownerId, entry.tab.id]);
		if (seen.has(key)) continue;
		seen.add(key);
		branch.push({ ownerId: entry.ownerId, tab: entry.tab });
		pending.push(...(edges.get(key) ?? []));
		if (entry.tab.agentSessionId)
			pending.push(
				...(edges.get(
					JSON.stringify(['native', entry.ownerId, entry.provider, entry.tab.agentSessionId])
				) ?? [])
			);
	}
	return branch;
}

/** Stored on the owning session, so history rows retain the choice after tab closure. */
export function conversationDisclosureKey(
	tabId: string | null,
	nativeSessionId: string | null
): string {
	return JSON.stringify(nativeSessionId ? ['native', nativeSessionId] : ['tab', tabId]);
}

export function conversationExpanded(
	choices: Record<string, boolean> | undefined,
	tabId: string | null,
	nativeSessionId: string | null
): boolean | undefined {
	return (
		choices?.[conversationDisclosureKey(tabId, nativeSessionId)] ??
		(tabId ? choices?.[conversationDisclosureKey(tabId, null)] : undefined)
	);
}

export interface ConversationChildrenRequest {
	sessionId: string;
	tabId?: string;
	nativeSessionId?: string;
	expanded?: boolean;
}
export interface ConversationChildrenResult {
	parent: ConversationParentCandidate;
	expanded: boolean;
}
export interface ConversationSourceIdentity {
	sessionId: string;
	tabId: string;
	nativeSessionId: string;
	provider: string;
}
