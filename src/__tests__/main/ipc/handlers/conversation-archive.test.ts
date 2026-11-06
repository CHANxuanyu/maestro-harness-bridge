import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
	handlers: new Map<string, (...args: any[]) => any>(),
	settings: { newShell: true, archivedConversations: [] as any[] },
	owners: [] as any[],
	windows: [{ webContents: { send: vi.fn() } }, { webContents: { send: vi.fn() } }],
	request: vi.fn(),
	processes: [] as any[],
}));
vi.mock('electron', () => ({
	ipcMain: { handle: (key: string, fn: any) => state.handlers.set(key, fn) },
	BrowserWindow: { getAllWindows: () => state.windows },
}));
vi.mock('../../../../main/stores/getters', () => ({
	getSettingsStore: () => ({
		get: (key: keyof typeof state.settings, fallback: any) => state.settings[key] ?? fallback,
		set: (key: string, value: any) => Object.assign(state.settings, { [key]: value }),
	}),
	getSessionsStore: () => ({ get: () => state.owners }),
}));
vi.mock('../../../../main/agents/provider-account-dirs', () => ({
	resolveAgentAccountDir: () => '/synthetic-account',
	getProviderAccountDirs: vi.fn(),
	readStoredSessions: () => state.owners,
}));
vi.mock('../../../../main/agents', () => ({
	getSessionStorage: vi.fn(),
	hasSessionStorage: vi.fn(),
	getAllSessionStorages: vi.fn(),
}));
vi.mock('../../../../main/stores', () => ({ getSshRemoteById: vi.fn() }));
vi.mock('../../../../main/web-server/callbacks/remoteRequest', () => ({
	requestFromRenderer: (...args: any[]) => state.request(...args),
}));
vi.mock('../../../../main/utils/safe-send', () => ({
	isWebContentsAvailable: (win: unknown) => !!win,
	createSafeSend: () => vi.fn(),
}));
vi.mock('fs/promises', async (original) => ({
	...(await original<object>()),
	default: { ...(await original<object>()), realpath: async (value: string) => value },
}));
import { registerAgentSessionsHandlers } from '../../../../main/ipc/handlers/agentSessions';

beforeEach(() => {
	state.settings = { newShell: true, archivedConversations: [] };
	state.owners = ['one', 'two'].map((id) => ({
		id,
		toolType: 'codex',
		cwd: '/synthetic-project',
		projectRoot: '/synthetic-project',
	}));
	state.processes = [];
	state.request.mockReset().mockResolvedValue({ permissionMode: 'standard' });
	registerAgentSessionsHandlers({
		getMainWindow: () => state.windows[0] as never,
		getWindowForSession: (id) => state.windows[id === 'one' ? 0 : 1] as never,
		getProcessManager: () => ({ getAll: () => state.processes }) as never,
	});
});
const archive = () =>
	state.handlers.get('agentSessions:archiveConversation')!(
		{},
		{ ownerId: 'one', nativeSessionId: 'native' },
		'archive'
	);
it('asks both owner windows before committing and stores the exact account identity', async () => {
	await archive();
	expect(
		state.request.mock.calls.map(([win, , options]) => [
			state.windows.indexOf(win),
			options.args[0].phase,
		])
	).toEqual([
		[0, 'check'],
		[1, 'check'],
		[0, 'close'],
		[1, 'close'],
	]);
	expect(state.settings.archivedConversations[0]).toMatchObject({
		key: JSON.stringify(['codex', 'local', '/synthetic-account/sessions', 'native']),
		permissionMode: 'standard',
	});
});
it('does not archive if another window reports the conversation running', async () => {
	state.request.mockImplementation(async (win) =>
		win === state.windows[1] ? { error: 'conversation-running' } : { permissionMode: 'full' }
	);
	await expect(archive()).rejects.toThrow('conversation-running');
	expect(state.settings.archivedConversations).toEqual([]);
});
it('refuses a live main-process turn even if the renderer would report idle', async () => {
	state.processes = [{ sessionId: 'two-ai-tab', agentSessionId: 'native', isTerminal: false }];
	await expect(archive()).rejects.toThrow('conversation-running');
	expect(state.request).not.toHaveBeenCalled();
});
it('keeps archive mutations behind newShell', async () => {
	state.settings.newShell = false;
	await expect(archive()).rejects.toThrow('conversation-new-shell-required');
	expect(state.settings.archivedConversations).toEqual([]);
});
