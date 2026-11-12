import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
	sessions: [] as any[],
	handlers: new Map<string, (...args: any[]) => any>(),
	callbacks: new Map<string, (...args: any[]) => any>(),
}));
vi.mock('electron', () => ({ ipcMain: { _invokeHandlers: state.handlers } }));
vi.mock('../../../shared/cli-activity', () => ({ getSessionIdsBusyWithCli: () => new Set() }));
vi.mock('../../../cli/services/storage', () => ({
	readSessions: () => state.sessions,
	getSessionById: (id: string) => state.sessions.find((s) => s.id === id),
	readActiveAgentId: () => 'owner',
	resolveAgentId: (id: string) => id,
}));
vi.mock('../../../cli/services/maestro-client', () => ({
	withMaestroClient: async (run: (client: any) => Promise<unknown>) =>
		run({
			sendCommand: async (message: any) => {
				if (message.type === 'list_desktop_sessions')
					return { sessions: state.callbacks.get('setListDesktopSessionsCallback')!() };
				const { handleBridgeInvoke } =
					await import('../../../main/web-server/handlers/bridgeHandlers');
				let reply: unknown;
				await handleBridgeInvoke({ id: 'synthetic-client' } as never, message, (_client, value) => {
					reply = value;
				});
				return reply;
			},
		}),
}));
import { nativeHistory } from '../../../cli/commands/native-history';
import { registerSessionCallbacks } from '../../../main/web-server/callbacks/sessionCallbacks';
const read = vi.fn();
const discover = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error('CLI failed');
	});
	state.sessions = [
		{
			id: 'owner',
			name: 'Synthetic',
			toolType: 'codex',
			cwd: '/project',
			projectRoot: '/project',
			activeTabId: 'tab',
			aiTabs: [{ id: 'tab', agentSessionId: 'native-id', state: 'idle' }],
		},
	];
	state.handlers.clear();
	read.mockResolvedValue({ status: 'found', text: 'TAIL', totalBytes: 4, omittedBytes: 0 });
	state.handlers.set('agentSessions:toolOutput', read);
	state.handlers.set('agentSessions:listProjectHistory', discover);
	discover.mockResolvedValue({
		conversations: [
			{
				key: 'record',
				projectPath: '/project',
				provider: 'codex',
				nativeSessionId: 'native-id',
				ownerId: 'owner',
				accountDir: '/account',
			},
		],
		errors: [],
	});
	registerSessionCallbacks(
		new Proxy(
			{},
			{
				get: (_target, key: string) => (callback: (...args: any[]) => any) =>
					state.callbacks.set(key, callback),
			}
		) as never,
		{
			sessionsStore: { get: () => state.sessions },
			groupsStore: { get: () => [] },
			getProcessManager: () => ({ get: () => undefined, getAll: () => [] }),
		} as never
	);
});
it.each(['tab', 'active', 'native-id'])(
	'uses the real tab resolver and bridge dispatcher for %s',
	async (selector) => {
		await nativeHistory('tool-output', selector, 'call-1', { json: true });
		expect(read).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ nativeSessionId: 'native-id', ownerAgentId: 'owner' }),
			'call-1'
		);
		expect(discover).not.toHaveBeenCalled();
	}
);
it('reads an exact native history ID while the opened tab is still waiting for persistence', async () => {
	state.sessions[0].aiTabs[0].agentSessionId = null;
	await nativeHistory('tool-output', 'native-id', 'call-1', { json: true });
	expect(discover).toHaveBeenCalledOnce();
	expect(read).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			provider: 'codex',
			nativeSessionId: 'native-id',
			ownerAgentId: 'owner',
			accountDir: '/account',
		}),
		'call-1'
	);
});
it('refuses ambiguous native IDs across accounts', async () => {
	state.sessions[0].aiTabs = [];
	discover.mockResolvedValue({
		conversations: [
			{ key: 'one', nativeSessionId: 'native-id', ownerId: 'owner', accountDir: '/one' },
			{ key: 'two', nativeSessionId: 'native-id', ownerId: 'owner', accountDir: '/two' },
		],
		errors: [],
	});
	await expect(nativeHistory('tool-output', 'native-id', 'call-1', { json: true })).rejects.toThrow(
		'CLI failed'
	);
	expect(read).not.toHaveBeenCalled();
});

it('resolves a parked native conversation from the saved tool source', async () => {
	const source = {
		provider: 'claude-code',
		projectPath: '/old-project',
		ownerAgentId: 'owner',
		nativeSessionId: 'old-native',
		accountDir: '/old-account',
	};
	state.sessions[0].aiTabs[0].logs = [
		{ metadata: { toolCallId: 'old-call', toolOutputSource: source } },
	];
	await nativeHistory('tool-output', 'old-native', 'old-call', { json: true });
	expect(read).toHaveBeenCalledWith(expect.anything(), source, 'old-call');
	expect(discover).not.toHaveBeenCalled();
});

it('reports persisted disclosure in the desktop inventory used by tab children', () => {
	state.sessions[0].conversationTreeExpanded = { '["native","native-id"]': true };
	expect(state.callbacks.get('setListDesktopSessionsCallback')!()).toEqual([
		expect.objectContaining({ tabId: 'tab', expanded: true }),
	]);
	state.sessions[0].conversationTreeExpanded['["native","native-id"]'] = false;
	expect(state.callbacks.get('setListDesktopSessionsCallback')!()[0].expanded).toBe(false);
});
