import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
// Clone the default export so Windows path injection cannot affect Node or Vitest.
vi.mock('path', async (importOriginal) => {
	const actual = await importOriginal<typeof import('path')>();
	return { ...actual, default: { ...actual } };
});
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
	afterEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});
	it('returns a native Windows root with slash-separated files without changing the host platform', async () => {
		vi.spyOn(path, 'normalize').mockImplementation(path.win32.normalize);
		const cwd = 'C:\\Users\\fixture\\repo\\sub';
		vi.mocked(execFileNoThrow).mockResolvedValue({
			exitCode: 0,
			stderr: '',
			stdout:
				'C:/Users/fixture/repo\0\0\0# branch.head topic\0? dir/file\0\0' + '1\t0\tdir/file\0\0',
		});
		const result = await getGitChanges(cwd);
		expect(result.root).toBe(path.win32.dirname(cwd));
		expect(result.branch).toBe('topic');
		expect(result.files[0].path).toBe('dir/file');
	});
	it.each(['timeout', 'notARepo'] as const)(
		'preserves the native cwd on a Windows %s result',
		async (kind) => {
			vi.spyOn(path, 'normalize').mockImplementation(path.win32.normalize);
			const cwd = 'C:\\Users\\fixture\\repo';
			vi.mocked(execFileNoThrow).mockResolvedValue({
				exitCode: kind === 'timeout' ? 'ETIMEDOUT' : 128,
				stderr: kind === 'timeout' ? 'timeout' : 'fatal: not a git repository',
				stdout: '',
			});
			expect(await getGitChanges(cwd)).toEqual({
				root: cwd,
				branch: null,
				files: [],
				totals: { files: 0, additions: 0, deletions: 0 },
				truncated: false,
				[kind === 'timeout' ? 'timedOut' : 'notARepo']: true,
			});
		}
	);
	it('keeps the SSH root exactly as printed even with Windows local path semantics', async () => {
		const normalize = vi.spyOn(path, 'normalize').mockImplementation(path.win32.normalize);
		const root = '/remote/literal\\name/repo';
		vi.mocked(execFileNoThrow).mockResolvedValue({
			exitCode: 0,
			stderr: '',
			stdout: `${root}\0# branch.head topic\0\0\0`,
		});
		expect((await getGitChanges('C:\\unused', remote, root)).root).toBe(root);
		expect(normalize).not.toHaveBeenCalled();
	});
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
