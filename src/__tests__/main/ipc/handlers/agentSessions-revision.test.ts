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
import {
	readStoredSessions,
	resolveAgentAccountDir,
} from '../../../../main/agents/provider-account-dirs';
import { restoreStarredTranscript } from '../../../../main/storage/starred-transcript-mirror';

const handlers = new Map<string, (...args: any[]) => Promise<any>>();
const probe = vi.fn().mockResolvedValue('opaque-revision');
const read = vi.fn().mockResolvedValue({ messages: [], total: 0, hasMore: false });
beforeEach(() => {
	vi.clearAllMocks();
	read.mockResolvedValue({ messages: [], total: 0, hasMore: false });
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
	it('indexes complete native history independently of the 500-message display window and shares revision cache', async () => {
		const handler = handlers.get('agentSessions:turnWrites');
		expect(handler).toBeTypeOf('function');
		const messages = [
			{ type: 'user', uuid: 'early', content: 'Early change', timestamp: '2026-11-06T09:00:00Z' },
			{
				type: 'assistant',
				uuid: 'write',
				content: '',
				timestamp: '2026-11-06T09:00:01Z',
				toolUse: [{ tool: 'Write', state: { status: 'completed', input: { file_path: 'a.ts' } } }],
			},
			...Array.from({ length: 600 }, (_, i) => ({
				type: 'assistant',
				uuid: `later-${i}`,
				content: 'Progress',
				timestamp: '2026-11-06T09:00:02Z',
			})),
		];
		read.mockImplementation(async (_project, _native, options) => ({
			messages: messages.slice(-options.limit),
			total: messages.length,
			hasMore: options.limit < messages.length,
		}));
		const args = [{}, 'codex', '/project', 'long-native', { ownerAgentId: 'owner' }];
		const first = await handler!(...args);
		expect(first).toEqual([
			{
				turnId: 'early',
				title: 'Early change',
				timestamp: Date.parse('2026-11-06T09:00:00Z'),
				paths: ['a.ts'],
			},
		]);
		expect(read).toHaveBeenCalledWith(
			'/project',
			'long-native',
			expect.objectContaining({
				readOnly: true,
				configDir: '/owner-account',
				limit: Number.MAX_SAFE_INTEGER,
			}),
			undefined
		);
		expect(await handler!(...args)).toEqual(first);
		expect(read).toHaveBeenCalledTimes(1);
		expect(restoreStarredTranscript).not.toHaveBeenCalled();
	});
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
	it('validates a parked provider source and reads its original account', async () => {
		const source = {
			provider: 'claude-code',
			projectPath: '/old-project',
			nativeSessionId: 'old-native',
			ownerAgentId: 'owner',
			accountDir: '/old-account',
		};
		vi.mocked(readStoredSessions).mockReturnValueOnce([
			{
				id: 'owner',
				toolType: 'codex',
				aiTabs: [
					{
						id: 'tab',
						agentSessionId: 'new-native',
						providerSessions: { 'claude-code': { agentSessionId: 'old-native' } },
						logs: [{ metadata: { toolCallId: 'old-call', toolOutputSource: source } }],
					},
				],
			},
		]);
		await handlers.get('agentSessions:toolOutput')!({}, source, 'old-call');
		expect(read).toHaveBeenCalledWith('/old-project', 'old-native', 'old-call', {
			configDir: '/old-account',
			readOnly: true,
		});
		expect(restoreStarredTranscript).not.toHaveBeenCalled();
	});
	it('resolves CLI card IDs using the same saved source as the UI', async () => {
		const source = {
			provider: 'claude-code',
			projectPath: '/old-project',
			nativeSessionId: 'old-native',
			ownerAgentId: 'owner',
			accountDir: '/old-account',
		};
		vi.mocked(readStoredSessions).mockReturnValueOnce([
			{
				id: 'owner',
				toolType: 'codex',
				aiTabs: [{ logs: [{ metadata: { toolCallId: 'old-call', toolOutputSource: source } }] }],
			},
		]);
		await handlers.get('agentSessions:toolOutput')!(
			{},
			{
				provider: 'codex',
				projectPath: '/project',
				nativeSessionId: 'new-native',
				ownerAgentId: 'owner',
			},
			'old-call'
		);
		expect(read).toHaveBeenCalledWith('/old-project', 'old-native', 'old-call', {
			configDir: '/old-account',
			readOnly: true,
		});
	});
	it('rejects an invented parked provider account', async () => {
		expect(
			await handlers.get('agentSessions:toolOutput')!(
				{},
				{
					provider: 'claude-code',
					projectPath: '/project',
					nativeSessionId: 'invented',
					ownerAgentId: 'owner',
					accountDir: '/invented',
				},
				'call'
			)
		).toEqual({ status: 'not-found' });
		expect(read).not.toHaveBeenCalled();
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
