import { beforeEach, describe, expect, it } from 'vitest';
import {
	canHandOffTab,
	errorOffersHandoff,
	requestAiHandoff,
} from '../../../renderer/services/aiHandoffEntry';
import { useModalStore } from '../../../renderer/stores/modalStore';
import { createMockAITab, createMockSession } from '../../helpers';

const talked = () =>
	createMockAITab({
		id: 'tab-1',
		logs: [
			{ id: 'u', timestamp: 1, source: 'user', text: 'Why does login fail?' },
			{ id: 'a', timestamp: 2, source: 'stdout', text: 'The token expired.' },
		],
	});

beforeEach(() => {
	useModalStore.getState().closeModal('aiHandoff');
});

describe('AI handoff entry points', () => {
	it('offers a handoff for a local tab that holds a conversation', () => {
		const tab = talked();
		expect(canHandOffTab(createMockSession({ aiTabs: [tab] }), tab)).toBe(true);
	});

	it('withholds it from an empty tab, an SSH agent and a missing tab', () => {
		const empty = createMockAITab({ id: 'tab-1', logs: [] });
		expect(canHandOffTab(createMockSession({ aiTabs: [empty] }), empty)).toBe(false);
		// Tool rows and blank text are not a conversation to hand over.
		const toolsOnly = createMockAITab({
			id: 'tab-1',
			logs: [
				{ id: 't', timestamp: 1, source: 'tool', text: 'Read' },
				{ id: 'b', timestamp: 2, source: 'stdout', text: '   ' },
			],
		});
		expect(canHandOffTab(createMockSession({ aiTabs: [toolsOnly] }), toolsOnly)).toBe(false);
		const tab = talked();
		expect(
			canHandOffTab(
				createMockSession({ aiTabs: [tab], sessionSshRemoteConfig: { enabled: true } } as never),
				tab
			)
		).toBe(false);
		expect(canHandOffTab(createMockSession({ aiTabs: [tab] }), undefined)).toBe(false);
	});

	it('counts a tab whose transcript is still deferred as a conversation', () => {
		const tab = createMockAITab({ id: 'tab-1', logs: [] });
		const session = createMockSession({
			aiTabs: [tab],
			deferredContent: { tabIds: ['tab-1'] },
		} as never);
		expect(canHandOffTab(session, tab)).toBe(true);
	});

	it('sits next to plan limits, rate limits and lost logins only', () => {
		expect(errorOffersHandoff('rate_limited')).toBe(true);
		expect(errorOffersHandoff('auth_expired')).toBe(true);
		for (const type of [
			'network_error',
			'token_exhaustion',
			'agent_crashed',
			'session_not_found',
			'unknown',
			undefined,
		] as const)
			expect(errorOffersHandoff(type)).toBe(false);
	});

	it('opens the handoff dialog for the named tab', () => {
		requestAiHandoff('agent-1', 'tab-1');
		expect(useModalStore.getState().modals.get('aiHandoff')).toMatchObject({
			open: true,
			data: { sessionId: 'agent-1', tabId: 'tab-1' },
		});
	});
});
