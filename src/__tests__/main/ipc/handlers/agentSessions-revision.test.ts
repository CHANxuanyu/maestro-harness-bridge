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
	} as unknown as AgentSessionStorage);
	vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
		handlers.set(channel, handler);
	});
	registerAgentSessionsHandlers();
});
const invoke = (...args: any[]) =>
	handlers.get('agentSessions:getTranscriptRevision')!({}, ...args);
describe('read-only transcript refresh IPC', () => {
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
		expect(
			await invoke('codex', '/project', 'native-id', undefined, 'unavailable-remote')
		).toBeNull();
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
	it('retains the existing user-driven initial-read restoration behavior', async () => {
		await handlers.get('agentSessions:read')!({}, 'codex', '/project', 'native-id', { offset: 0 });
		expect(restoreStarredTranscript).toHaveBeenCalledWith({
			agentId: 'codex',
			projectPath: '/project',
			sessionId: 'native-id',
		});
	});
});
