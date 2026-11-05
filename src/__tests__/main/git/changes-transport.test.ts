import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../main/utils/execFile', () => ({ execFileNoThrow: vi.fn() }));
vi.mock('../../../main/utils/cliDetection', () => ({
	resolveSshPath: vi.fn().mockResolvedValue('ssh'),
}));
vi.mock('../../../main/utils/logger', () => ({
	logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
import { execFileNoThrow } from '../../../main/utils/execFile';
import { getGitChanges, getGitChangeDiff } from '../../../main/git-changes';
import { shellEscapeRemotePath } from '../../../main/utils/shell-escape';
import type { SshRemoteConfig } from '../../../shared/types';

const remote: SshRemoteConfig = {
	id: 'remote',
	name: 'Fixture',
	enabled: true,
	host: 'fixture.invalid',
	port: 2222,
	username: 'fixture',
	sshOptions: { ConnectTimeout: '45' },
};
describe('changes SSH transport', () => {
	afterEach(() => vi.clearAllMocks());
	it('uses the canonical SSH builder once, with remote quoting, overrides and optional locks disabled', async () => {
		vi.mocked(execFileNoThrow).mockResolvedValue({
			exitCode: 0,
			stderr: '',
			stdout: '/remote/root\0# branch.head topic\0? file\0\0' + '2\t0\tfile\0\0',
		});
		const result = await getGitChanges('/local/unused', remote, '~/remote project');
		expect(result).toMatchObject({
			branch: 'topic',
			totals: { files: 1, additions: 2, deletions: 0 },
		});
		expect(execFileNoThrow).toHaveBeenCalledTimes(1);
		const [command, args, cwd, options] = vi.mocked(execFileNoThrow).mock.calls[0];
		expect(command).toBe('ssh');
		expect(cwd).toBeUndefined();
		expect(args.join(' ')).toContain(shellEscapeRemotePath('~/remote project'));
		expect(args.join(' ')).toContain('ConnectTimeout=45');
		expect(args.join(' ')).toContain('GIT_OPTIONAL_LOCKS');
		expect(options).toMatchObject({ timeout: 20000 });
	});
	it('returns timedOut for both reads and propagates other execution failures', async () => {
		vi.mocked(execFileNoThrow).mockResolvedValue({
			exitCode: 'ETIMEDOUT',
			stderr: 'timeout',
			stdout: '',
		});
		expect(await getGitChanges('/cwd')).toMatchObject({ timedOut: true });
		expect(await getGitChangeDiff('/cwd', 'file')).toMatchObject({ timedOut: true });
		vi.mocked(execFileNoThrow).mockResolvedValue({
			exitCode: 255,
			stderr: 'SSH permission denied',
			stdout: '',
		});
		await expect(getGitChanges('/cwd', remote, '/remote')).rejects.toThrow('SSH permission denied');
	});
});
