import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../../../../main/agents', () => ({
	getSessionStorage: vi.fn(),
	hasSessionStorage: vi.fn(),
	getAllSessionStorages: vi.fn(),
}));
vi.mock('../../../../main/stores', () => ({ getSshRemoteById: vi.fn() }));
vi.mock('../../../../main/agents/provider-account-dirs', () => ({
	resolveAgentAccountDir: vi.fn().mockReturnValue('/owner-account'),
	getProviderAccountDirs: vi.fn(),
	readStoredSessions: vi.fn(() => [{ id: 'owner', toolType: 'codex' }]),
}));
vi.mock('../../../../main/storage/starred-transcript-mirror', () => ({
	snapshotStarredTranscript: vi.fn(),
	releaseTranscriptMirror: vi.fn(),
	releaseSnoozedTranscriptMirror: vi.fn(),
	restoreStarredTranscript: vi.fn(),
	listMirroredStarredSessions: vi.fn(),
}));
vi.mock('../../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
import { registerAgentSessionsHandlers } from '../../../../main/ipc/handlers/agentSessions';
import { getSessionStorage, type AgentSessionStorage } from '../../../../main/agents';
import { getSshRemoteById } from '../../../../main/stores';
import { resolveAgentAccountDir } from '../../../../main/agents/provider-account-dirs';
import { restoreStarredTranscript } from '../../../../main/storage/starred-transcript-mirror';

const handlers = new Map<string, (...args: any[]) => Promise<any>>();
const probe = vi.fn().mockResolvedValue('opaque-revision');
const read = vi.fn().mockResolvedValue({ messages: [], total: 0, hasMore: false });
beforeEach(() => {
	vi.clearAllMocks();
	handlers.clear();
	vi.mocked(getSessionStorage).mockReturnValue({
		getTranscriptRevision: probe,
		readSessionMessages: read,
		readToolOutput: read,
	} as unknown as AgentSessionStorage);
	vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
		handlers.set(channel, handler);
	});
	registerAgentSessionsHandlers();
});
const invoke = (...args: any[]) =>
	handlers.get('agentSessions:getTranscriptRevision')!({}, ...args);
describe('read-only transcript refresh IPC', () => {
	it('reads one tool from the selected owner account without restoring mirrors', async () => {
		const handler = handlers.get('agentSessions:toolOutput');
		expect(handler).toBeTypeOf('function');
		await handler!(
			{},
			{
				provider: 'codex',
				projectPath: '/project',
				nativeSessionId: 'native-id',
				ownerAgentId: 'owner',
			},
			'call-1'
		);
		expect(resolveAgentAccountDir).toHaveBeenCalledWith('owner');
		expect(read).toHaveBeenCalledWith('/project', 'native-id', 'call-1', {
			configDir: '/owner-account',
			readOnly: true,
		});
		expect(restoreStarredTranscript).not.toHaveBeenCalled();
	});
	it('refuses unsupported remote tool output without reading local files', async () => {
		const handler = handlers.get('agentSessions:toolOutput');
		expect(handler).toBeTypeOf('function');
		expect(
			await handler!(
				{},
				{
					provider: 'codex',
					projectPath: '~/remote',
					nativeSessionId: 'id',
					ownerAgentId: 'owner',
					sshRemoteId: 'ssh',
				},
				'call-1'
			)
		).toEqual({ status: 'unsupported' });
		expect(read).not.toHaveBeenCalled();
		expect(resolveAgentAccountDir).not.toHaveBeenCalled();
	});
	it('uses the exact native ID and owner account without restoring content', async () => {
		expect(await invoke('codex', '/project', 'native-id', { ownerAgentId: 'owner' })).toBe(
			'opaque-revision'
		);
		expect(resolveAgentAccountDir).toHaveBeenCalledWith('owner');
		expect(probe).toHaveBeenCalledWith('/project', 'native-id', { configDir: '/owner-account' });
		expect(restoreStarredTranscript).not.toHaveBeenCalled();
	});
	it('preserves an explicit conversation account over the owner default', async () => {
		await invoke('codex', '/project', 'native-id', {
			ownerAgentId: 'owner',
			configDir: '/exact-account',
		});
		expect(probe).toHaveBeenCalledWith('/project', 'native-id', { configDir: '/exact-account' });
		expect(resolveAgentAccountDir).not.toHaveBeenCalled();
	});
	it('never probes locally when a remote was requested', async () => {
		await expect(
			invoke('codex', '/project', 'native-id', undefined, 'unavailable-remote')
		).rejects.toThrow('SSH remote is unavailable');
		expect(getSessionStorage).not.toHaveBeenCalled();
		expect(probe).not.toHaveBeenCalled();
	});
	it('feature-detects unsupported storage without an invented revision', async () => {
		vi.mocked(getSessionStorage).mockReturnValue({} as AgentSessionStorage);
		expect(await invoke('other', '/project', 'native-id')).toBeNull();
	});
	it('suppresses mirrored-file restoration for a strictly read-only refresh', async () => {
		await handlers.get('agentSessions:read')!({}, 'codex', '/project', 'native-id', {
			readOnly: true,
			offset: 0,
		});
		expect(restoreStarredTranscript).not.toHaveBeenCalled();
		expect(read).toHaveBeenCalledWith(
			'/project',
			'native-id',
			{ readOnly: true, offset: 0 },
			undefined
		);
	});
	it('keeps Codex initial reads read-only even when an older caller omits readOnly', async () => {
		await handlers.get('agentSessions:read')!({}, 'codex', '/project', 'native-id', { offset: 0 });
		expect(restoreStarredTranscript).not.toHaveBeenCalled();
		expect(read).toHaveBeenCalledWith('/project', 'native-id', { offset: 0 }, undefined);
	});
	it('passes the selected SSH host into Codex revision reads', async () => {
		const remote = {
			id: 'remote',
			enabled: true,
		} as import('../../../../shared/types').SshRemoteConfig;
		vi.mocked(getSshRemoteById).mockReturnValueOnce(remote);
		expect(
			await invoke(
				'codex',
				'/remote/project',
				'native-id',
				{ configDir: '/remote/account' },
				'remote'
			)
		).toBe('opaque-revision');
		expect(probe).toHaveBeenCalledWith(
			'/remote/project',
			'native-id',
			{ configDir: '/remote/account' },
			remote
		);
	});
});
