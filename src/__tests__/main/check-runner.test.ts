import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createCheckRunner } from '../../main/check-runner';
import { MAX_PERSISTED_TOOL_OUTPUT_CHARS } from '../../shared/toolOutput';
import type { ExecResult, ExecStreamingOptions } from '../../main/utils/execFile';

vi.mock('../../main/utils/ssh-spawn-wrapper', () => ({
	wrapSpawnWithSsh: vi.fn(),
	sshUnresolvedRemoteMessage: () => 'SSH remote cannot be resolved',
}));
import { wrapSpawnWithSsh } from '../../main/utils/ssh-spawn-wrapper';
import * as platformDetection from '../../shared/platformDetection';
import type { SshRemoteSettingsStore } from '../../main/utils/ssh-remote-resolver';

describe('check runner', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});
	it.each([
		[0, 'pass'],
		[1, 'fail'],
		[127, 'not-run'],
		['ENOENT', 'not-run'],
	] as const)('keeps exit %s distinct as %s and captures the tail', async (exitCode, outcome) => {
		const exec = vi.fn((_command: string, _args: string[], options: ExecStreamingOptions) => {
			expect(options.maxCaptureChars).toBe(0);
			options.onChunk('x'.repeat(100_000), 'stdout');
			options.onChunk('last error', 'stderr');
			return { cancel: vi.fn(), result: Promise.resolve({ exitCode, stdout: '', stderr: '' }) };
		});
		const result = await createCheckRunner({ exec }).run({ command: 'check', cwd: os.tmpdir() });
		expect(result.outcome).toBe(outcome);
		expect(result.outputTail.endsWith('last error')).toBe(true);
		expect(result.outputTail).toHaveLength(MAX_PERSISTED_TOOL_OUTPUT_CHARS);
		expect(result.truncated).toBe(true);
	});

	it.each([
		["'missing_tool' is not recognized as an internal or external command,", 'not-run'],
		['assertion failed', 'fail'],
	] as const)('reads cmd exit 1 with %j as %s on Windows', async (line, outcome) => {
		const windows = vi.spyOn(platformDetection, 'isWindows').mockReturnValue(true);
		try {
			const exec = vi.fn((_command: string, _args: string[], options: ExecStreamingOptions) => {
				options.onChunk(line, 'stderr');
				return {
					cancel: vi.fn(),
					result: Promise.resolve({ exitCode: 1, stdout: '', stderr: '' }),
				};
			});
			const result = await createCheckRunner({ exec }).run({ command: 'check', cwd: os.tmpdir() });
			expect(exec.mock.calls[0][0]).not.toBe('/bin/sh');
			expect(result.outcome).toBe(outcome);
		} finally {
			windows.mockRestore();
		}
	});

	it.each([
		[2, 2, 'pass'],
		[0, 2, 'fail'],
		[2, undefined, 'fail'],
	] as const)(
		'judges exit %s against an expected %s as %s',
		async (exitCode, expectedExitCode, outcome) => {
			const exec = vi.fn(() => ({
				cancel: vi.fn(),
				result: Promise.resolve({ exitCode, stdout: '', stderr: '' }),
			}));
			const result = await createCheckRunner({ exec }).run({
				command: 'node cli.cjs add 1e3 2',
				cwd: os.tmpdir(),
				expectedExitCode,
			});
			expect(result.outcome).toBe(outcome);
			expect(result.expectedExitCode).toBe(expectedExitCode);
		}
	);

	it('stores the output tail without color codes', async () => {
		const exec = vi.fn((_command: string, _args: string[], options: ExecStreamingOptions) => {
			options.onChunk('\u001b[32m✔ greets \u001b[90m(0.5ms)\u001b[39m\n', 'stdout');
			return { cancel: vi.fn(), result: Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }) };
		});
		const result = await createCheckRunner({ exec }).run({ command: 'check', cwd: os.tmpdir() });
		expect(result.outputTail).toBe('✔ greets (0.5ms)\n');
	});

	it.each(['timeout', 'canceled'] as const)(
		'kills before returning %s and removes timers',
		async (kind) => {
			vi.useFakeTimers();
			let finish!: (result: ExecResult) => void;
			const cancel = vi.fn(() => finish({ exitCode: 'SIGTERM', stdout: '', stderr: '' }));
			const exec = vi.fn(() => ({
				cancel,
				result: new Promise<ExecResult>((done) => {
					finish = done;
				}),
			}));
			const controller = new AbortController();
			const running = createCheckRunner({ exec }).run({
				command: 'check',
				cwd: os.tmpdir(),
				signal: controller.signal,
			});
			if (kind === 'timeout') await vi.advanceTimersByTimeAsync(600_000);
			else controller.abort();
			expect((await running).outcome).toBe(kind);
			expect(cancel).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);
		}
	);

	it('does not start a canceled check, or fall back locally for unresolved SSH', async () => {
		const exec = vi.fn();
		const controller = new AbortController();
		controller.abort();
		expect(
			(
				await createCheckRunner({ exec }).run({
					command: 'check',
					cwd: os.tmpdir(),
					signal: controller.signal,
				})
			).outcome
		).toBe('canceled');
		const result = await createCheckRunner({ exec }).run({
			command: 'check',
			cwd: '/remote',
			host: { kind: 'ssh', remoteId: 'missing' },
		});
		expect(result.outcome).toBe('not-run');
		expect(result.error).toContain('SSH');
		expect(exec).not.toHaveBeenCalled();
	});

	it('cancels while SSH preparation is pending without launching a late check', async () => {
		const exec = vi.fn();
		vi.mocked(wrapSpawnWithSsh).mockImplementation(() => new Promise(() => {}));
		const controller = new AbortController();
		const running = createCheckRunner({ exec, sshStore: {} as SshRemoteSettingsStore }).run({
			command: 'check',
			cwd: '/remote',
			host: { kind: 'ssh', remoteId: 'remote' },
			signal: controller.signal,
		});
		controller.abort();
		expect((await running).outcome).toBe('canceled');
		expect(exec).not.toHaveBeenCalled();
	});

	it('passes remote wrapper argv and stdin to streaming execution without local env overrides', async () => {
		vi.mocked(wrapSpawnWithSsh).mockResolvedValue({
			command: 'ssh',
			args: ['host'],
			cwd: os.tmpdir(),
			sshStdinScript: 'remote script',
			sshRemoteUsed: { id: 'remote' } as never,
		});
		const exec = vi.fn(() => ({
			cancel: vi.fn(),
			result: Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
		}));
		const runner = createCheckRunner({ exec, sshStore: {} as SshRemoteSettingsStore });
		const result = await runner.run({
			command: 'check',
			cwd: '/remote',
			host: { kind: 'ssh', remoteId: 'remote' },
			env: { ONLY_REMOTE: 'yes' },
		});
		expect(result.host).toEqual({ kind: 'ssh', remoteId: 'remote' });
		expect(exec).toHaveBeenCalledWith(
			'ssh',
			['host'],
			expect.objectContaining({ input: 'remote script', env: undefined })
		);
		vi.mocked(wrapSpawnWithSsh).mockResolvedValue({
			command: 'sh',
			args: [],
			cwd: '/remote',
			sshRemoteUsed: null,
		});
		expect(
			(
				await runner.run({
					command: 'check',
					cwd: '/remote',
					host: { kind: 'ssh', remoteId: 'remote' },
				})
			).outcome
		).toBe('not-run');
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it('runs real temporary-directory commands and identifies missing cwd and command', async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'checks-'));
		try {
			const runner = createCheckRunner();
			expect((await runner.run({ command: 'echo evidence', cwd })).outputTail).toContain(
				'evidence'
			);
			expect((await runner.run({ command: 'exit 3', cwd })).outcome).toBe('fail');
			expect(
				(await runner.run({ command: 'maestro_nonexistent_test_command_472', cwd })).outcome
			).toBe('not-run');
			expect(
				(await runner.run({ command: 'echo no', cwd: path.join(cwd, 'missing') })).outcome
			).toBe('not-run');
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});
});
