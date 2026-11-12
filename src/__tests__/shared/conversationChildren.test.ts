import { describe, expect, it } from 'vitest';
import type { ConversationOrigin } from '../../shared/aiHandoff';
import { conversationBranch, findConversationParent } from '../../shared/conversationChildren';

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
	it('nests handoffs with reviews and subtasks under their source', () => {
		const candidates = [
			{ key: 'a:t', ownerId: 'a', tabId: 't', provider: 'claude-code', nativeSessionId: 'n' },
		];
		const origin = { sourceSessionId: 'a', sourceTabId: 't', sourceProvider: 'claude-code' };
		expect(findConversationParent({ ...origin, kind: 'handoff' }, candidates)?.key).toBe('a:t');
		expect(findConversationParent({ ...origin, kind: 'review' }, candidates)?.key).toBe('a:t');
		expect(findConversationParent({ ...origin, kind: 'subtask' }, candidates)?.key).toBe('a:t');
	});

	it('leaves a hand-off out of the branch an archive hides or blocks on', () => {
		const origin = {
			sourceSessionId: 'a',
			sourceTabId: 't',
			sourceProvider: 'claude-code',
			createdAt: 1,
		};
		const sessions = [
			{
				id: 'a',
				toolType: 'claude-code',
				aiTabs: [
					{ id: 't', agentSessionId: 'n' },
					{ id: 'moved', origin: { ...origin, kind: 'handoff' as const } },
					{ id: 'review', origin: { ...origin, kind: 'review' as const } },
				],
			},
		];
		expect(conversationBranch(sessions, ['a'], 'n').map(({ tab }) => tab.id)).toEqual([
			't',
			'review',
		]);
	});

	it('prefers the exact source tab over a reopened copy', () => {
		const exact = { ...parent, key: 'original', tabId: 'original-tab' };
		expect(findConversationParent(origin, [parent, exact])).toBe(exact);
	});

	it.each(['handoff', 'review', 'subtask'] as const)(
		'reattaches %s after its source tab closes',
		(kind) => {
			expect(findConversationParent({ ...origin, kind }, [parent])).toBe(parent);
		}
	);

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
