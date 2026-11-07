import path from 'node:path';
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
vi.mock('../../../../main/prompt-manager', () => ({
	getPrompt: () => 'Synthetic internal prompt',
}));
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
import { getAllSessionStorages } from '../../../../main/agents';
import { getProviderAccountDirs } from '../../../../main/agents/provider-account-dirs';

beforeEach(() => {
	state.settings = { newShell: true, archivedConversations: [] };
	state.owners = ['one', 'two'].map((id) => ({
		id,
		toolType: 'codex',
		cwd: '/synthetic-project',
		projectRoot: '/synthetic-project',
	}));
	state.processes = [];
	state.request.mockReset().mockResolvedValue({ permissionMode: 'standard', lastActivity: 7 });
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
		key: JSON.stringify(['codex', 'local', path.join('/synthetic-account', 'sessions'), 'native']),
		permissionMode: 'standard',
		modifiedAt: 7,
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

it('keeps unarchived permission metadata out of CLI archive lists and restores normal discovery', async () => {
	const native = {
		sessionId: 'native',
		projectPath: '/synthetic-project/packages/api',
		timestamp: '2026-11-06T10:00:00Z',
		modifiedAt: '2026-11-06T10:00:00Z',
		messageCount: 2,
		firstUserMessage: 'Synthetic conversation',
	};
	vi.mocked(getAllSessionStorages).mockReturnValue([
		{
			agentId: 'codex',
			listSessions: vi.fn().mockResolvedValue([native]),
		},
	] as never);
	vi.mocked(getProviderAccountDirs).mockResolvedValue(['/synthetic-account']);
	const scopes = [{ projectKey: 'project', projectPath: '/synthetic-project', ownerIds: ['one'] }];
	const list = state.handlers.get('agentSessions:listProjectHistory')!;
	const archives = state.handlers.get('agentSessions:archives')!;
	await archive();
	expect((await list({}, scopes)).conversations).toEqual([]);
	expect((await list({}, scopes, { archived: true })).conversations).toHaveLength(1);
	await state.handlers.get('agentSessions:archiveConversation')!(
		{},
		{ ownerId: 'one', nativeSessionId: 'native' },
		'unarchive'
	);
	expect(await archives({})).toEqual([]);
	expect(await archives({}, { includeUnarchived: true })).toEqual([
		expect.objectContaining({
			nativeSessionId: 'native',
			archived: false,
			permissionMode: 'standard',
		}),
	]);
	expect((await list({}, scopes)).conversations).toHaveLength(1);
	expect((await list({}, scopes, { archived: true })).conversations).toEqual([]);
	await archive();
	state.settings.newShell = false;
	expect((await list({}, scopes)).conversations).toHaveLength(1);
});
