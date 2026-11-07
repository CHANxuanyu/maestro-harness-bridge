import { describe, expect, it } from 'vitest';
import type { ConversationOrigin } from '../../shared/aiHandoff';
import { findConversationParent } from '../../shared/conversationChildren';

const origin: ConversationOrigin = {
	kind: 'review',
	sourceSessionId: 'source',
	sourceTabId: 'original-tab',
	sourceProvider: 'codex',
	sourceNativeSessionId: 'native',
	createdAt: 1,
};
const parent = {
	key: 'source:reopened',
	ownerId: 'source',
	tabId: 'reopened',
	provider: 'codex',
	nativeSessionId: 'native',
};

describe('conversation parent identity', () => {
	it('prefers the exact source tab over a reopened copy', () => {
		const exact = { ...parent, key: 'original', tabId: 'original-tab' };
		expect(findConversationParent(origin, [parent, exact])).toBe(exact);
	});

	it('reattaches to the source native conversation after its tab closes', () => {
		expect(findConversationParent(origin, [parent])).toBe(parent);
	});

	it('attaches to a history row whose owner was resolved by native account matching', () => {
		const history = { ...parent, key: 'history:source', tabId: null };
		expect(findConversationParent(origin, [history])).toBe(history);
	});

	it('does not guess between runners, providers, or ambiguous native identities', () => {
		expect(findConversationParent(origin, [{ ...parent, ownerId: 'other-account' }])).toBeNull();
		expect(findConversationParent(origin, [{ ...parent, provider: 'claude-code' }])).toBeNull();
		expect(findConversationParent(origin, [parent, { ...parent, key: 'duplicate' }])).toBeNull();
		expect(findConversationParent(undefined, [parent])).toBeNull();
	});
});
