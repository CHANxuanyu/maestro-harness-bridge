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
	afterEach(() => vi.restoreAllMocks());
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
