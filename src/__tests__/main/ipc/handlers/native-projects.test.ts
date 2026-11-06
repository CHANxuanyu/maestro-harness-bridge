import { runNativeHistorySearch } from '../../../../main/storage/native-history-search';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { registerAgentSessionsHandlers } from '../../../../main/ipc/handlers/agentSessions';
import {
	getProviderAccountDirs,
	getAgentAccountDirLayers,
	resolveAgentAccountDir,
} from '../../../../main/agents/provider-account-dirs';
import { getSessionsStore, getSettingsStore } from '../../../../main/stores/getters';
import { requestFromRenderer } from '../../../../main/web-server/callbacks/remoteRequest';

vi.mock('../../../../main/storage/native-history-search', () => ({
	runNativeHistorySearch: vi.fn().mockResolvedValue({ hits: [], truncated: false }),
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../../../../main/agents/provider-account-dirs', () => ({
	getProviderAccountDirs: vi.fn(),
	getAgentAccountDirLayers: vi.fn(),
	resolveAgentAccountDir: vi.fn(),
}));
vi.mock('../../../../main/stores/getters', () => ({
	getSessionsStore: vi.fn(),
	getSettingsStore: vi.fn(),
}));
vi.mock('../../../../main/web-server/callbacks/remoteRequest', () => ({
	requestFromRenderer: vi.fn(),
}));
let root: string;
let handlers: Map<string, Function>;
beforeEach(async () => {
	vi.clearAllMocks();
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'project-account-ipc-')));
	handlers = new Map();
	vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
		handlers.set(channel, handler);
	});
	vi.mocked(getSessionsStore).mockReturnValue({ get: () => [] } as never);
	vi.mocked(getSettingsStore).mockReturnValue({ get: () => false } as never);
	vi.mocked(getProviderAccountDirs).mockResolvedValue([]);
	vi.mocked(getAgentAccountDirLayers).mockReturnValue({
		homeDir: root,
		env: {},
		globalShellEnvVars: {},
		agentLevelEnvVars: {},
	});
	registerAgentSessionsHandlers();
});
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

it('includes discovered, inherited and per-owner accounts, excluding SSH account paths', async () => {
	const project = path.join(root, 'project');
	await fs.mkdir(project);
	const pools = ['discovered', 'inherited', 'owner', 'remote'];
	for (const pool of pools) {
		const directory = path.join(root, pool, 'projects', 'lossy-key');
		await fs.mkdir(directory, { recursive: true });
		await fs.writeFile(
			path.join(directory, 'history.jsonl'),
			JSON.stringify({ cwd: project }) + '\n'
		);
	}
	vi.mocked(getProviderAccountDirs).mockImplementation(async (provider) =>
		provider === 'claude-code' ? [path.join(root, 'discovered')] : []
	);
	vi.mocked(getAgentAccountDirLayers).mockReturnValue({
		homeDir: root,
		env: {},
		globalShellEnvVars: { CLAUDE_CONFIG_DIR: path.join(root, 'inherited') },
	});
	vi.mocked(getSessionsStore).mockReturnValue({
		get: () => [
			{ id: 'local', toolType: 'claude-code' },
			{ id: 'ssh', toolType: 'claude-code', sessionSshRemoteConfig: { enabled: true } },
		],
	} as never);
	vi.mocked(resolveAgentAccountDir).mockImplementation((id) =>
		path.join(root, id === 'ssh' ? 'remote' : 'owner')
	);
	expect(await handlers.get('agentSessions:projects')!({})).toEqual([
		{ path: project, tools: ['claude-code'], lastActivity: expect.any(Number), sessionCount: 3 },
	]);
	expect(resolveAgentAccountDir).not.toHaveBeenCalledWith('ssh');
});

it('refuses project opening in the classic shell before reading any directory', async () => {
	await expect(
		handlers.get('agentSessions:openProject')!({}, path.join(root, 'missing'))
	).rejects.toThrow('new shell');
	expect(getSessionsStore).not.toHaveBeenCalled();
});

it('reveals the existing project owner window after its renderer acknowledges', async () => {
	vi.mocked(getSettingsStore).mockReturnValue({ get: () => true } as never);
	vi.mocked(getSessionsStore).mockReturnValue({
		get: () => [{ id: 'owner', name: 'project', cwd: root, toolType: 'codex' }],
	} as never);
	vi.mocked(requestFromRenderer).mockResolvedValue({ success: true, sessionId: 'owner' });
	const win = {
		isDestroyed: () => false,
		webContents: { isDestroyed: () => false },
		isMinimized: () => true,
		restore: vi.fn(),
		show: vi.fn(),
		focus: vi.fn(),
	};
	registerAgentSessionsHandlers({ getWindowForSession: () => win as never });
	expect(await handlers.get('agentSessions:openProject')!({}, root)).toEqual({
		success: true,
		sessionId: 'owner',
	});
	expect(requestFromRenderer).toHaveBeenCalledWith(
		win,
		'agentSessions:openProjectTarget',
		expect.objectContaining({ args: [{ path: root, sessionId: 'owner' }] })
	);
	expect(win.restore).toHaveBeenCalledOnce();
	expect(win.show).toHaveBeenCalledOnce();
	expect(win.focus).toHaveBeenCalledOnce();
});

it('settles a cancelled search even while account discovery is waiting', async () => {
	let finish: (dirs: string[]) => void = () => {};
	vi.mocked(getProviderAccountDirs).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	let settled = false;
	const pending = handlers.get('agentSessions:searchNativeHistory')!(
		{ sender: { id: 17 } },
		{ query: 'needle', requestId: 'pending' }
	).then((result: unknown) => {
		settled = true;
		return result;
	});
	handlers.get('agentSessions:cancelNativeHistorySearch')!({ sender: { id: 17 } }, 'pending');
	await new Promise((resolve) => setTimeout(resolve, 0));
	try {
		expect(settled).toBe(true);
	} finally {
		finish([]);
		await pending;
	}
});

it('search passes resolved local accounts to the worker and never resolves SSH accounts locally', async () => {
	vi.mocked(getSessionsStore).mockReturnValue({
		get: () => [
			{ id: 'local', toolType: 'codex' },
			{
				id: 'remote',
				toolType: 'codex',
				sessionSshRemoteConfig: { enabled: true, remoteId: 'host' },
			},
		],
	} as never);
	vi.mocked(resolveAgentAccountDir).mockReturnValue(path.join(root, 'selected-account'));
	await handlers.get('agentSessions:searchNativeHistory')!(
		{},
		{ query: 'needle', projectPath: root }
	);
	expect(resolveAgentAccountDir).toHaveBeenCalledWith('local');
	expect(resolveAgentAccountDir).not.toHaveBeenCalledWith('remote');
	expect(runNativeHistorySearch).toHaveBeenCalledWith(
		expect.objectContaining({
			query: 'needle',
			projectPath: root,
			accounts: expect.arrayContaining([
				{ provider: 'codex', accountDir: path.join(root, 'selected-account') },
			]),
		}),
		expect.any(AbortSignal)
	);
});

it('returns a bounded partial result when account discovery exceeds the deadline', async () => {
	vi.useFakeTimers();
	let finish: (dirs: string[]) => void = () => {};
	vi.mocked(getProviderAccountDirs).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	try {
		const pending = handlers.get('agentSessions:searchNativeHistory')!({}, { query: 'needle' });
		await vi.advanceTimersByTimeAsync(5000);
		expect(await pending).toEqual({ hits: [], truncated: true, limited: true });
		expect(runNativeHistorySearch).not.toHaveBeenCalled();
	} finally {
		finish([]);
		vi.useRealTimers();
	}
});
