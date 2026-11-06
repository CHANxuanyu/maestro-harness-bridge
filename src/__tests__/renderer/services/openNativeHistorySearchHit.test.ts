import { beforeEach, expect, it, vi } from 'vitest';
import { openNativeHistorySearchHit } from '../../../renderer/services/openNativeHistorySearchHit';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useUIStore } from '../../../renderer/stores/uiStore';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import type { NativeHistorySearchHit } from '../../../shared/nativeHistorySearch';
import { openNativeConversation } from '../../../renderer/services/openNativeConversation';
vi.mock('../../../renderer/services/openNativeConversation', () => ({
	openNativeConversation: vi.fn(),
}));
vi.mock('../../../renderer/services/refreshNativeConversation', async (original) => ({
	...(await original<object>()),
	refreshNativeConversation: vi.fn().mockResolvedValue({ status: 'unchanged' }),
}));
const hit: NativeHistorySearchHit = {
	conversation: {
		key: 'hit',
		projectKey: '/project',
		projectPath: '/project',
		provider: 'codex',
		nativeSessionId: 'native',
		title: 'A conversation',
		preview: '',
		createdAt: 1,
		modifiedAt: 2,
		messageCount: 601,
		starred: false,
		ownerId: 'owner',
		accountDir: '/synthetic/account',
		accountEnvVar: 'CODEX_HOME',
	},
	matchPreview: 'the hidden needle',
	message: { uuid: 'old-message', role: 'assistant', text: 'the hidden needle' },
};
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(openNativeConversation).mockResolvedValue({ status: 'opened', ownerId: 'owner' });
	const tab = createMockAITab({
		id: 'tab',
		agentSessionId: 'native',
		logs: [{ id: 'recent', source: 'stdout', text: 'recent answer', timestamp: 2 }],
	});
	useSessionStore.setState({
		activeSessionId: 'owner',
		sessions: [
			createMockSession({
				id: 'owner',
				toolType: 'codex',
				cwd: '/project',
				projectRoot: '/project',
				customEnvVars: { CODEX_HOME: '/synthetic/account' },
				activeTabId: 'tab',
				aiTabs: [tab],
			}),
		],
	});
	useUIStore.setState({ pendingLogJump: null });
	window.maestro.agentSessions.read = vi.fn().mockResolvedValue({
		messages: [
			{
				uuid: 'old-message',
				type: 'assistant',
				role: 'assistant',
				content: 'the hidden needle',
				timestamp: new Date(1).toISOString(),
			},
			{
				uuid: 'recent',
				type: 'assistant',
				role: 'assistant',
				content: 'recent answer',
				timestamp: new Date(2).toISOString(),
			},
		],
		total: 2,
		hasMore: false,
	});
});
it('loads an older hit using the exact account and requests the existing scroll and flash', async () => {
	expect(await openNativeHistorySearchHit(hit, vi.fn())).toBe(true);
	expect(window.maestro.agentSessions.read).toHaveBeenCalledWith('codex', '/project', 'native', {
		ownerAgentId: 'owner',
		configDir: '/synthetic/account',
		readOnly: true,
		limit: 100000,
	});
	expect(useSessionStore.getState().sessions[0].aiTabs[0].logs.map((entry) => entry.id)).toEqual([
		'old-message',
		'recent',
	]);
	expect(useUIStore.getState().pendingLogJump).toEqual({
		sessionId: 'owner',
		tabId: 'tab',
		logId: 'old-message',
	});
});
it('does not move focus after another conversation is selected during the read', async () => {
	vi.mocked(window.maestro.agentSessions.read).mockImplementationOnce(async () => {
		useSessionStore.setState({ activeSessionId: 'other' });
		return { messages: [], total: 0, hasMore: false };
	});
	expect(await openNativeHistorySearchHit(hit, vi.fn())).toBe(false);
	expect(useUIStore.getState().pendingLogJump).toBeNull();
});
it('refuses SSH content targets before opening or reading a local transcript', async () => {
	expect(
		await openNativeHistorySearchHit(
			{ ...hit, conversation: { ...hit.conversation, sshRemoteId: 'remote' } },
			vi.fn()
		)
	).toBe(false);
	expect(openNativeConversation).not.toHaveBeenCalled();
	expect(window.maestro.agentSessions.read).not.toHaveBeenCalled();
});

it('locates a unique live entry whose local ID differs from the native message', async () => {
	useSessionStore.getState().setSessions((sessions) =>
		sessions.map((session) => ({
			...session,
			aiTabs: session.aiTabs.map((tab) => ({
				...tab,
				logs: [
					{ id: 'live', source: 'stdout' as const, text: 'the hidden needle', timestamp: 1 },
					...tab.logs,
				],
			})),
		}))
	);
	expect(await openNativeHistorySearchHit(hit, vi.fn())).toBe(true);
	expect(useUIStore.getState().pendingLogJump?.logId).toBe('live');
});

it('does not guess between repeated live messages', async () => {
	useSessionStore.getState().setSessions((sessions) =>
		sessions.map((session) => ({
			...session,
			aiTabs: session.aiTabs.map((tab) => ({
				...tab,
				logs: ['first', 'second'].map((id) => ({
					id,
					source: 'stdout' as const,
					text: 'the hidden needle',
					timestamp: 1,
				})),
			})),
		}))
	);
	expect(await openNativeHistorySearchHit(hit, vi.fn())).toBe(false);
	expect(useUIStore.getState().pendingLogJump).toBeNull();
});
