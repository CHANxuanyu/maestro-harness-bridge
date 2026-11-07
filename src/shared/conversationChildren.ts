import type { ConversationOrigin } from './aiHandoff';

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
