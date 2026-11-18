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
import {
	getGitChanges,
	getGitChangeDiff,
	applyGitChange,
	beginGitTurn,
	finishGitTurn,
	recordGitTurnTool,
} from '../../../main/git-changes';
import { logger } from '../../../main/utils/logger';
import { READ_ONLY_GIT_TIMEOUT_MS } from '../../../main/utils/remote-git';
import { shellEscapeRemotePath, shellEscape } from '../../../main/utils/shell-escape';
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
		vi.mocked(execFileNoThrow).mockReset();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});
	it('captures and measures a turn entirely through remote Git, never a local remote-path cwd', async () => {
		const root = '/remote project';
		vi.mocked(execFileNoThrow)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: `${root}\0# branch.head topic\0\0\0`,
				stderr: '',
			})
			.mockResolvedValueOnce({ exitCode: 0, stdout: 'head\n', stderr: '' })
			.mockResolvedValueOnce({ exitCode: 0, stdout: 'head\n', stderr: '' })
			.mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'missing new file' })
			.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout:
					'patch\0' + '1\t0\tnew.txt\0\0--- a/new.txt\n+++ b/new.txt\n@@ -0,0 +1 @@\n+created\n',
				stderr: '',
			});
		await beginGitTurn('ssh-turn', '/local/unused', remote, root);
		recordGitTurnTool('ssh-turn', {
			toolName: 'Write',
			toolCallId: 'write',
			timestamp: 1,
			state: { status: 'completed', input: { file_path: `${root}/new.txt` } },
		});
		expect(await finishGitTurn('ssh-turn')).toEqual({
			files: 1,
			additions: 1,
			deletions: 0,
			paths: ['new.txt'],
		});
		expect(execFileNoThrow).toHaveBeenCalledTimes(6);
		for (const [command, args, cwd, options] of vi.mocked(execFileNoThrow).mock.calls) {
			expect(command).toBe('ssh');
			expect(cwd).toBeUndefined();
			expect(args.join(' ')).toContain(shellEscapeRemotePath(root));
			expect(options).toMatchObject({ timeout: READ_ONLY_GIT_TIMEOUT_MS });
		}
	});

	it.each([false, true])(
		'buffers early creation, but rejects an already existing target=%s',
		async (existing) => {
			let release!: (value: { exitCode: number; stdout: string; stderr: string }) => void;
			vi.mocked(execFileNoThrow)
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							release = resolve;
						})
				)
				.mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'unborn' })
				.mockResolvedValueOnce({ exitCode: existing ? 1 : 0, stdout: '', stderr: '' })
				.mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'unborn' })
				.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
				.mockResolvedValueOnce({
					exitCode: 0,
					stdout:
						'patch\0' + '1\t0\tnew.txt\0\0--- a/new.txt\n+++ b/new.txt\n@@ -0,0 +1 @@\n+created\n',
					stderr: '',
				});
			const sessionId = `early-${existing}`;
			const capture = beginGitTurn(sessionId, '/unused', remote, '/early');
			await vi.waitFor(() => expect(release).toBeDefined());
			recordGitTurnTool(sessionId, {
				toolName: 'Write',
				toolCallId: 'write',
				timestamp: 1,
				state: { status: 'running', input: { file_path: '/early/new.txt' } },
			});
			release({ exitCode: 0, stdout: '/early\0# branch.head main\0\0\0', stderr: '' });
			await capture;
			recordGitTurnTool(sessionId, {
				toolName: 'Write',
				toolCallId: 'write',
				timestamp: 2,
				state: { status: 'completed' },
			});
			expect(await finishGitTurn(sessionId)).toEqual(
				existing ? undefined : { files: 1, additions: 1, deletions: 0, paths: ['new.txt'] }
			);
			const [command, args, cwd, options] = vi.mocked(execFileNoThrow).mock.calls[2];
			expect(command).toBe('ssh');
			expect(cwd).toBeUndefined();
			expect(args.join(' ')).toContain('maestro-turn-absent');
			expect(args.join(' ')).toContain('/early/new.txt');
			expect(options).toMatchObject({ timeout: READ_ONLY_GIT_TIMEOUT_MS });
		}
	);

	it.each(['hanging', 'throwing'] as const)(
		'bounds a %s baseline and omits its result',
		async (mode) => {
			vi.useFakeTimers();
			vi.mocked(execFileNoThrow).mockImplementationOnce(() => {
				if (mode === 'throwing') throw new Error('SSH capture failed');
				return new Promise(() => {});
			});
			const capture = beginGitTurn(`baseline-${mode}`, '/unused', remote, `/remote/${mode}`);
			await vi.waitFor(() => expect(execFileNoThrow).toHaveBeenCalled());
			await vi.advanceTimersByTimeAsync(READ_ONLY_GIT_TIMEOUT_MS);
			await capture;
			expect(finishGitTurn(`baseline-${mode}`)).toBeUndefined();
			expect(logger.warn).toHaveBeenCalled();
		}
	);

	it.each(['hanging', 'throwing'] as const)(
		'bounds a %s delivery measurement and omits its result',
		async (mode) => {
			vi.useFakeTimers();
			const root = `/measure-${mode}`;
			vi.mocked(execFileNoThrow)
				.mockResolvedValueOnce({
					exitCode: 0,
					stdout: `${root}\0# branch.head main\0\0\0`,
					stderr: '',
				})
				.mockResolvedValueOnce({ exitCode: 0, stdout: 'head\n', stderr: '' });
			await beginGitTurn(`measure-${mode}`, '/unused', remote, root);
			recordGitTurnTool(`measure-${mode}`, {
				toolName: 'Write',
				toolCallId: 'write',
				timestamp: 1,
				state: { status: 'completed', input: { file_path: `${root}/new.txt` } },
			});
			vi.mocked(execFileNoThrow).mockImplementationOnce(() => {
				if (mode === 'throwing') throw new Error('SSH measurement failed');
				return new Promise(() => {});
			});
			const delivery = finishGitTurn(`measure-${mode}`);
			await vi.waitFor(() => expect(execFileNoThrow).toHaveBeenCalledTimes(3));
			await vi.advanceTimersByTimeAsync(READ_ONLY_GIT_TIMEOUT_MS);
			expect(await delivery).toBeUndefined();
			expect(logger.warn).toHaveBeenCalled();
		}
	);

	it.each([
		['Edit', 'running'],
		['Bash', 'running'],
		['Write', 'completed'],
	])('discards a pending baseline on %s %s evidence', async (toolName, status) => {
		let release!: (value: { exitCode: number; stdout: string; stderr: string }) => void;
		vi.mocked(execFileNoThrow).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		const capture = beginGitTurn('late', '/unused', remote, '/late');
		await vi.waitFor(() => expect(release).toBeDefined());
		recordGitTurnTool('late', {
			toolName,
			toolCallId: 'call',
			timestamp: 1,
			state: { status, input: { file_path: '/late/file' } },
		});
		release({ exitCode: 0, stdout: '/late\0# branch.head main\0\0\0', stderr: '' });
		await capture;
		expect(finishGitTurn('late')).toBeUndefined();
		expect(execFileNoThrow).toHaveBeenCalledTimes(1);
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
	it('writes only over SSH with literal paths at the remote worktree root', async () => {
		const normalize = vi.spyOn(path, 'normalize');
		vi.mocked(execFileNoThrow)
			.mockResolvedValueOnce({ exitCode: 0, stdout: '/remote/tree\n', stderr: '' })
			.mockResolvedValueOnce({ exitCode: 0, stdout: '? -中文 file\0', stderr: '' })
			.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
		expect(
			await applyGitChange(
				'/unused',
				{ action: 'stage', paths: ['-中文 file'] },
				remote,
				'~/remote tree'
			)
		).toMatchObject({ success: true });
		expect(normalize).not.toHaveBeenCalled();
		const calls = vi.mocked(execFileNoThrow).mock.calls;
		expect(calls).toHaveLength(3);
		expect(calls.every(([command, , cwd]) => command === 'ssh' && cwd === undefined)).toBe(true);
		expect(calls[0][1].join(' ')).toContain(shellEscapeRemotePath('~/remote tree'));
		const command = calls[2][1].join(' ');
		expect(command).toContain("'/remote/tree'");
		expect(command).toContain(
			shellEscape("git '--literal-pathspecs' 'add' '--' '-中文 file'").slice(1, -1)
		);
		expect(command).toContain('ConnectTimeout=45');
		expect(calls[2][3]).toMatchObject({ timeout: 120000 });
	});
	it('preserves a copy source when reverting the copied destination', async () => {
		vi.mocked(execFileNoThrow)
			.mockResolvedValueOnce({ exitCode: 0, stdout: '/remote/tree\n', stderr: '' })
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '2 C. N... 100644 100644 100644 abc abc C100 copy\0source\0',
				stderr: '',
			})
			.mockResolvedValueOnce({ exitCode: 0, stdout: 'abc', stderr: '' })
			.mockResolvedValueOnce({ exitCode: 0, stdout: '100644 abc 0\tcopy\0', stderr: '' })
			.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
		expect(
			await applyGitChange(
				'/unused',
				{ action: 'revert', paths: ['copy'], confirmed: true },
				remote,
				'/remote/tree'
			)
		).toMatchObject({ success: true });
		const args = vi.mocked(execFileNoThrow).mock.calls.at(-1)![1].join(' ');
		expect(args).toContain(
			shellEscape(
				"git '--literal-pathspecs' 'restore' '--source=HEAD' '--staged' '--worktree' '--' 'copy'"
			).slice(1, -1)
		);
		expect(args).not.toContain(shellEscape("'source'").slice(1, -1));
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
