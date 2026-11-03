import { describe, it, expect } from 'vitest';
import {
	buildThinkingItems,
	isOnScreenTurnRunning,
	isThinkingItemOnScreen,
	resolveStopPlacement,
} from '../../../renderer/utils/thinkingItems';
import type { ThinkingItem } from '../../../renderer/types';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';

describe('buildThinkingItems', () => {
	it('returns no items when nothing is busy', () => {
		const sessions = [
			createMockSession({ id: 'a', state: 'idle' }),
			createMockSession({ id: 'b', state: 'idle' }),
		];
		expect(buildThinkingItems(sessions)).toEqual([]);
	});

	it('emits one item per busy AI tab', () => {
		const busyTabs = [
			createMockAITab({ id: 't1', state: 'busy' }),
			createMockAITab({ id: 't2', state: 'busy' }),
			createMockAITab({ id: 't3', state: 'idle' }),
		];
		const sessions = [
			createMockSession({ id: 'a', state: 'busy', busySource: 'ai', aiTabs: busyTabs }),
		];
		const items = buildThinkingItems(sessions);
		expect(items).toHaveLength(2);
		expect(items.map((i) => i.tab?.id)).toEqual(['t1', 't2']);
		expect(items.every((i) => i.session.id === 'a')).toBe(true);
	});

	it('falls back to a legacy (tab: null) item when busy with no tab-level tracking', () => {
		const sessions = [createMockSession({ id: 'a', state: 'busy', busySource: 'ai', aiTabs: [] })];
		const items = buildThinkingItems(sessions);
		expect(items).toEqual([{ session: sessions[0], tab: null }]);
	});

	it('does NOT emit a legacy item when the session is busy via terminal, not AI', () => {
		const sessions = [
			createMockSession({ id: 'a', state: 'busy', busySource: 'terminal', aiTabs: [] }),
		];
		expect(buildThinkingItems(sessions)).toEqual([]);
	});

	it('includes orphaned (closed-but-still-thinking) tabs', () => {
		const orphan = createMockAITab({ id: 'orphan', state: 'busy' });
		const sessions = [
			createMockSession({
				id: 'a',
				state: 'idle',
				orphanedThinkingTabs: [orphan],
			}),
		];
		const items = buildThinkingItems(sessions);
		expect(items).toEqual([{ session: sessions[0], tab: orphan }]);
	});

	it('does not list a closed tab parked idle by a held queued item', () => {
		// Regression: closing a tab that owns a HELD message parks it in
		// orphanedThinkingTabs (idle) as a dispatch target. No process runs for
		// it, yet the pill showed it as "Thinking..." until the item was removed.
		const parked = createMockAITab({ id: 'closed', state: 'idle' });
		const sessions = [
			createMockSession({
				id: 'a',
				state: 'idle',
				aiTabs: [createMockAITab({ id: 't1', state: 'idle' })],
				orphanedThinkingTabs: [parked],
				executionQueue: [
					{
						id: 'q1',
						timestamp: 1,
						tabId: 'closed',
						type: 'message',
						text: 'later',
						paused: true,
					},
				],
			}),
		];
		expect(buildThinkingItems(sessions)).toEqual([]);
	});

	it('keeps the legacy fallback when the only orphan is parked idle', () => {
		const parked = createMockAITab({ id: 'closed', state: 'idle' });
		const sessions = [
			createMockSession({
				id: 'a',
				state: 'busy',
				busySource: 'ai',
				aiTabs: [createMockAITab({ id: 't1', state: 'idle' })],
				orphanedThinkingTabs: [parked],
			}),
		];
		expect(buildThinkingItems(sessions)).toEqual([{ session: sessions[0], tab: null }]);
	});

	it('skips the legacy fallback when only orphaned tabs are present (no double count)', () => {
		const orphan = createMockAITab({ id: 'orphan', state: 'busy' });
		const sessions = [
			createMockSession({
				id: 'a',
				state: 'busy',
				busySource: 'ai',
				aiTabs: [],
				orphanedThinkingTabs: [orphan],
			}),
		];
		// One entry for the orphan, NOT an extra legacy {tab: null} entry.
		const items = buildThinkingItems(sessions);
		expect(items).toEqual([{ session: sessions[0], tab: orphan }]);
	});

	describe('window scoping (ownsSession gate)', () => {
		const owned = createMockSession({
			id: 'owned',
			state: 'busy',
			busySource: 'ai',
			aiTabs: [createMockAITab({ id: 'owned-tab', state: 'busy' })],
		});
		const remote = createMockSession({
			id: 'remote',
			state: 'busy',
			busySource: 'ai',
			aiTabs: [createMockAITab({ id: 'remote-tab', state: 'busy' })],
		});
		const sessions = [owned, remote];

		it('includes every session when no ownership predicate is given', () => {
			const items = buildThinkingItems(sessions);
			expect(items.map((i) => i.session.id)).toEqual(['owned', 'remote']);
		});

		it('drops agents this window does not own', () => {
			const ownsSession = (id: string) => id === 'owned';
			const items = buildThinkingItems(sessions, ownsSession);
			expect(items).toHaveLength(1);
			expect(items[0].session.id).toBe('owned');
		});

		it('drops orphaned thinking tabs for agents owned by another window', () => {
			const remoteOrphan = createMockSession({
				id: 'remote',
				state: 'idle',
				orphanedThinkingTabs: [createMockAITab({ id: 'remote-orphan', state: 'busy' })],
			});
			const ownsSession = (id: string) => id === 'owned';
			const items = buildThinkingItems([owned, remoteOrphan], ownsSession);
			expect(items.map((i) => i.session.id)).toEqual(['owned']);
		});

		it('returns nothing when this window owns none of the busy agents', () => {
			const ownsSession = () => false;
			expect(buildThinkingItems(sessions, ownsSession)).toEqual([]);
		});
	});
});

describe('isThinkingItemOnScreen', () => {
	const session = createMockSession({ id: 'agent', state: 'busy', busySource: 'ai' });
	const tab = createMockAITab({ id: 'tab', state: 'busy' });

	it('is the active tab of the active agent', () => {
		expect(isThinkingItemOnScreen({ session, tab }, 'agent', 'tab')).toBe(true);
	});

	it('is not another tab, another agent, or a turn with no tab', () => {
		expect(isThinkingItemOnScreen({ session, tab }, 'agent', 'other-tab')).toBe(false);
		expect(isThinkingItemOnScreen({ session, tab }, 'other-agent', 'tab')).toBe(false);
		expect(isThinkingItemOnScreen({ session, tab: null }, 'agent', 'tab')).toBe(false);
		expect(isThinkingItemOnScreen({ session, tab }, 'agent', undefined)).toBe(false);
	});
});

/**
 * Stop is one agent-level action, so exactly one Stop is drawn. Each placement
 * names the one surface that draws it.
 */
describe('resolveStopPlacement', () => {
	const here = createMockSession({ id: 'here', state: 'busy', busySource: 'ai' });
	const elsewhere = createMockSession({ id: 'elsewhere', state: 'busy', busySource: 'ai' });
	const onScreen: ThinkingItem = { session: here, tab: createMockAITab({ id: 'tab-here' }) };
	const sameAgentOtherTab: ThinkingItem = {
		session: here,
		tab: createMockAITab({ id: 'tab-other' }),
	};
	const otherAgent: ThinkingItem = {
		session: elsewhere,
		tab: createMockAITab({ id: 'tab-elsewhere' }),
	};
	const place = (items: ThinkingItem[], autoRunRunning = false) =>
		resolveStopPlacement(items, 'here', 'tab-here', autoRunRunning);

	it('puts Stop on the send key while the conversation on screen runs', () => {
		expect(place([onScreen])).toBe('composer');
		expect(place([onScreen, sameAgentOtherTab, otherAgent])).toBe('composer');
		// A turn fired in the tab on screen during an Auto Run is still stopped there.
		expect(place([onScreen], true)).toBe('composer');
	});

	it('leaves it on the pill for another conversation of this agent', () => {
		expect(place([sameAgentOtherTab])).toBe('pill');
		expect(place([otherAgent, sameAgentOtherTab])).toBe('pill');
	});

	it('draws no Stop for a turn this agent cannot stop', () => {
		// Stop reaches this agent only, so another agent's turn gets none; consults
		// this agent fanned out are the only thing left for it to stop.
		expect(place([otherAgent])).toBe('consults');
		expect(place([])).toBe('consults');
	});

	it('yields to the Auto Run pill, whose own Stop ends the run', () => {
		expect(place([sameAgentOtherTab], true)).toBe('none');
		expect(place([], true)).toBe('none');
	});
});

describe('isOnScreenTurnRunning', () => {
	const agent = (activeTabId: string, busyTabId: string, inputModeBusy = true) =>
		createMockSession({
			id: 'agent',
			state: inputModeBusy ? 'busy' : 'idle',
			busySource: 'ai',
			activeTabId,
			aiTabs: [
				createMockAITab({ id: 'a', state: busyTabId === 'a' ? 'busy' : 'idle' }),
				createMockAITab({ id: 'b', state: busyTabId === 'b' ? 'busy' : 'idle' }),
			],
		});

	it('is true while the tab on screen is running', () => {
		expect(isOnScreenTurnRunning(agent('a', 'a'))).toBe(true);
	});

	it('is false for another running tab of the agent, or an idle agent', () => {
		expect(isOnScreenTurnRunning(agent('a', 'b'))).toBe(false);
		expect(isOnScreenTurnRunning(agent('a', 'a', false))).toBe(false);
		expect(isOnScreenTurnRunning(undefined)).toBe(false);
	});
});
