import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../cli/services/session-command', async (original) => ({
	...(await original<typeof import('../../../cli/services/session-command')>()),
	resolveTabEntry: vi.fn(),
}));
vi.mock('../../../cli/services/maestro-client', () => ({ withMaestroClient: vi.fn() }));
import { changes } from '../../../cli/commands/changes';
import { withMaestroClient } from '../../../cli/services/maestro-client';
import { resolveTabEntry } from '../../../cli/services/session-command';

describe('changes CLI', () => {
	it('uses the shared complete native index from the selected account and remote host', async () => {
		vi.mocked(resolveTabEntry).mockResolvedValue({ agentId: 'agent', tabId: 'selected' } as never);
		const file = { path: 'a.ts', status: 'modified', staged: false, additions: 1, deletions: 0 };
		const sendCommand = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				result: [
					{
						id: 'agent',
						cwd: '/local',
						toolType: 'codex',
						sessionSshRemoteConfig: {
							enabled: true,
							remoteId: 'remote',
							workingDirOverride: '~/repo',
						},
						aiTabs: [{ id: 'selected', agentSessionId: 'long-native', logs: [] }],
					},
				],
			})
			.mockResolvedValueOnce({
				ok: true,
				result: {
					root: '/home/dev/repo',
					executionCwd: '/home/dev/repo',
					files: [file],
					totals: { files: 1, additions: 1, deletions: 0 },
					truncated: false,
					branch: 'main',
				},
			})
			.mockResolvedValueOnce({
				ok: true,
				result: [{ turnId: 'early', title: 'Native early turn', timestamp: 1, paths: ['a.ts'] }],
			});
		vi.mocked(withMaestroClient).mockImplementation(async (callback) =>
			callback({ sendCommand } as never)
		);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await changes({ tab: 'selected', byTurn: true, json: true });
		expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
			hasWriteRecords: true,
			groups: [{ turnId: 'early', files: [file] }],
		});
		expect(sendCommand).toHaveBeenLastCalledWith(
			{
				type: 'bridge.invoke',
				channel: 'agentSessions:turnWrites',
				args: ['codex', '~/repo', 'long-native', { ownerAgentId: 'agent' }, 'remote'],
			},
			'bridge.response',
			25000
		);
	});
	it('reads the retained early turn after persisted logs are trimmed', async () => {
		vi.mocked(resolveTabEntry).mockResolvedValue({ agentId: 'agent', tabId: 'selected' } as never);
		const file = { path: 'a.ts', status: 'modified', staged: false, additions: 1, deletions: 0 };
		const sendCommand = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				result: [
					{
						id: 'agent',
						cwd: '/repo',
						aiTabs: [
							{
								id: 'selected',
								logs: [],
								changeTurnIndex: {
									turns: [
										{ turnId: 'early', title: 'Early change', timestamp: 1, paths: ['a.ts'] },
									],
								},
							},
						],
					},
				],
			})
			.mockResolvedValueOnce({
				ok: true,
				result: {
					root: '/repo',
					files: [file],
					totals: { files: 1, additions: 1, deletions: 0 },
					truncated: false,
					branch: 'main',
				},
			});
		vi.mocked(withMaestroClient).mockImplementation(async (callback) =>
			callback({ sendCommand } as never)
		);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await changes({ tab: 'selected', byTurn: true, json: true });
		expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
			hasWriteRecords: true,
			groups: [{ turnId: 'early', files: [file] }],
		});
	});
	afterEach(() => vi.restoreAllMocks());
	it('groups the selected tab records with the same current remote Git snapshot', async () => {
		vi.mocked(resolveTabEntry).mockResolvedValue({ agentId: 'agent', tabId: 'selected' } as never);
		const file = { path: 'a.ts', status: 'modified', staged: false, additions: 1, deletions: 0 };
		const sendCommand = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				result: [
					{
						id: 'agent',
						cwd: '/local',
						sshRemoteId: 'remote',
						sessionSshRemoteConfig: {
							enabled: true,
							remoteId: 'remote',
							workingDirOverride: '/remote/repo',
						},
						aiTabs: [
							{ id: 'other', logs: [] },
							{
								id: 'selected',
								logs: [
									{ id: 'u', source: 'user', timestamp: 10, text: 'Fix a\nDetails' },
									{
										id: 't',
										source: 'tool',
										timestamp: 11,
										text: 'Write',
										metadata: {
											toolState: { status: 'completed', input: { file_path: '/remote/repo/a.ts' } },
										},
									},
								],
							},
						],
					},
				],
			})
			.mockResolvedValueOnce({
				ok: true,
				result: {
					root: '/remote/repo',
					files: [file],
					totals: { files: 1, additions: 1, deletions: 0 },
					truncated: false,
					branch: 'main',
				},
			});
		vi.mocked(withMaestroClient).mockImplementation(async (callback) =>
			callback({ sendCommand } as never)
		);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await changes({ tab: 'selected', byTurn: true, json: true });
		expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
			hasWriteRecords: true,
			diffScope: 'current',
			groups: [{ turnId: 'u', title: 'Fix a', timestamp: 10, files: [file] }],
		});
		expect(sendCommand).toHaveBeenLastCalledWith(
			{ type: 'bridge.invoke', channel: 'git:changes', args: ['/local', 'remote', '/remote/repo'] },
			'bridge.response',
			25000
		);
	});
	it.each([undefined, 'src/a.ts'])(
		'reads the same IPC for the selected SSH worktree, file=%s',
		async (file) => {
			const result = file
				? { diff: '+line', binary: false, tooLarge: false }
				: { files: [], totals: { files: 0, additions: 0, deletions: 0 } };
			vi.mocked(resolveTabEntry).mockResolvedValue({ agentId: 'agent', tabId: 'tab' } as never);
			const sendCommand = vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					result: [
						{
							id: 'agent',
							cwd: '/work/tree',
							sessionSshRemoteConfig: {
								enabled: true,
								remoteId: 'remote',
								workingDirOverride: '/remote/tree',
							},
						},
					],
				})
				.mockResolvedValueOnce({ ok: true, result });
			vi.mocked(withMaestroClient).mockImplementation(async (callback) =>
				callback({ sendCommand } as never)
			);
			const log = vi.spyOn(console, 'log').mockImplementation(() => {});
			await changes({ tab: 'prefix', agent: 'agent', file, json: true });
			expect(resolveTabEntry).toHaveBeenCalledWith('prefix', 'agent');
			expect(sendCommand).toHaveBeenLastCalledWith(
				expect.objectContaining({
					channel: file ? 'git:changeDiff' : 'git:changes',
					args: file
						? ['/work/tree', file, 'remote', '/remote/tree']
						: ['/work/tree', 'remote', '/remote/tree'],
				}),
				'bridge.response',
				file === undefined ? 25000 : 45000
			);
			expect(JSON.parse(log.mock.calls[0][0])).toEqual(result);
		}
	);
});

describe('changes write CLI', () => {
	afterEach(() => vi.restoreAllMocks());
	it.each(['stage', 'unstage', 'revert', 'commit'] as const)(
		'routes %s to the shared operation with SSH context',
		async (action) => {
			vi.mocked(resolveTabEntry).mockResolvedValue({ agentId: 'agent', tabId: 'tab' } as never);
			const sendCommand = vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					result: [
						{
							id: 'agent',
							cwd: '/worktree',
							sessionSshRemoteConfig: {
								enabled: true,
								remoteId: 'remote',
								workingDirOverride: '~/remote tree',
							},
						},
					],
				})
				.mockResolvedValueOnce({ ok: true, result: { success: true, output: 'done' } });
			vi.mocked(withMaestroClient).mockImplementation(async (callback) =>
				callback({ sendCommand } as never)
			);
			vi.spyOn(console, 'log').mockImplementation(() => {});
			await changes({
				tab: 'tab',
				json: true,
				action,
				paths: action === 'commit' ? [] : ['-中文 file'],
				message: 'message',
				yes: true,
			});
			expect(sendCommand).toHaveBeenLastCalledWith(
				expect.objectContaining({
					channel: 'git:applyChange',
					args: [
						'/worktree',
						action === 'commit'
							? { action, message: 'message' }
							: {
									action,
									paths: ['-中文 file'],
									...(action === 'revert' ? { confirmed: true } : {}),
								},
						'remote',
						'~/remote tree',
					],
				}),
				'bridge.response',
				180000
			);
		}
	);
	it('rejects revert without --yes before connecting', async () => {
		vi.mocked(withMaestroClient).mockClear();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exited');
		});
		await expect(changes({ action: 'revert', paths: ['file'], json: true })).rejects.toThrow(
			'exited'
		);
		expect(exit).toHaveBeenCalledWith(1);
		expect(withMaestroClient).not.toHaveBeenCalled();
	});
});
