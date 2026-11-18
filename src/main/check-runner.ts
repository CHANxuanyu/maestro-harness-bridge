import { randomUUID } from 'crypto';
import { checkTestCounts } from '../shared/checkRun';
import { stripAnsiCodes } from '../shared/stringUtils';
import { DURATION_MS } from '../shared/duration';
import type { CheckHost, CheckOutcome, CheckRun } from '../shared/checkRun';
import { compactToolOutput, MAX_PERSISTED_TOOL_OUTPUT_CHARS } from '../shared/toolOutput';
import { isWindows } from '../shared/platformDetection';
import { execFileStreaming } from './utils/execFile';
import { wrapSpawnWithSsh, sshUnresolvedRemoteMessage } from './utils/ssh-spawn-wrapper';
import type { SshRemoteSettingsStore } from './utils/ssh-remote-resolver';
import { shellEscapeRemotePath } from './utils/shell-escape';

export interface CheckRequest {
	command: string;
	cwd: string;
	host?: CheckHost;
	timeoutMs?: number;
	env?: Record<string, string>;
	signal?: AbortSignal;
}

export interface CheckRunnerDependencies {
	sshStore?: SshRemoteSettingsStore;
	now?: () => number;
	exec?: typeof execFileStreaming;
}

export function createCheckRunner(deps: CheckRunnerDependencies = {}) {
	const now = deps.now ?? Date.now;
	return {
		async run(request: CheckRequest): Promise<CheckRun> {
			const timeoutMs = request.timeoutMs ?? 10 * DURATION_MS.minute;
			if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid check timeout');
			if (!request.command.trim()) throw new Error('A check command is required');
			const host = request.host ?? { kind: 'local' };
			const startedAt = now();
			let tail = '';
			let truncated = false;
			let stopped: 'timeout' | 'canceled' | undefined;
			let cancelProcess: (() => void) | undefined;
			let interruptPreparation!: () => void;
			const interrupted = new Promise<undefined>((resolve) => {
				interruptPreparation = () => resolve(undefined);
			});
			const collect = (chunk: string) => {
				truncated ||= tail.length + chunk.length > MAX_PERSISTED_TOOL_OUTPUT_CHARS;
				tail = (tail + chunk).slice(-MAX_PERSISTED_TOOL_OUTPUT_CHARS);
			};
			const result = (
				outcome: CheckOutcome,
				exitCode: number | null,
				error?: string
			): CheckRun => ({
				id: randomUUID(),
				command: request.command,
				cwd: request.cwd,
				host,
				startedAt,
				endedAt: now(),
				outcome,
				exitCode,
				outputTail: compactToolOutput(tail).output as string,
				truncated,
				error,
				...checkTestCounts(stripAnsiCodes(tail)),
			});
			const stop = (reason: 'timeout' | 'canceled') => {
				stopped ??= reason;
				interruptPreparation();
				cancelProcess?.();
			};
			const onAbort = () => stop('canceled');
			request.signal?.addEventListener('abort', onAbort, { once: true });
			const timer = setTimeout(() => stop('timeout'), Math.min(timeoutMs, 2 ** 31 - 1));
			try {
				if (request.signal?.aborted) return result('canceled', null);
				let command = isWindows() ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
				let args = isWindows() ? ['/d', '/s', '/c', request.command] : ['-c', request.command];
				let cwd = request.cwd;
				let input: string | undefined;
				if (host.kind === 'ssh') {
					const remote = { enabled: true, remoteId: host.remoteId };
					if (!deps.sshStore) throw new Error(sshUnresolvedRemoteMessage(remote));
					const wrapped = await Promise.race([
						wrapSpawnWithSsh(
							{
								command: 'sh',
								agentBinaryName: 'sh',
								args: ['-c', `cd ${shellEscapeRemotePath(cwd)} || exit 126\n${request.command}`],
								// Own the cd exit code so a missing remote cwd is not a code failure.
								cwd: '',
								customEnvVars: request.env,
								noPromptSeparator: true,
							},
							remote,
							deps.sshStore
						),
						interrupted,
					]);
					if (!wrapped) return result(stopped!, null);
					if (!wrapped.sshRemoteUsed) throw new Error(sshUnresolvedRemoteMessage(remote));
					command = wrapped.command;
					args = wrapped.args;
					cwd = wrapped.cwd;
					input = wrapped.sshStdinScript;
				}
				if (stopped) return result(stopped, null);
				const handle = (deps.exec ?? execFileStreaming)(command, args, {
					cwd,
					input,
					maxCaptureChars: 0,
					onChunk: collect,
					env: host.kind === 'local' ? { ...process.env, ...request.env } : undefined,
				});
				cancelProcess = handle.cancel;
				if (stopped) cancelProcess();
				const completed = await handle.result;
				const code = completed.exitCode;
				if (stopped) return result(stopped, typeof code === 'number' ? code : null);
				// POSIX shell launch failures and cmd's command-not-found code are
				// infrastructure outcomes, distinct from a check returning nonzero.
				if (typeof code !== 'number' || [126, 127, 9009].includes(code)) {
					return result(
						'not-run',
						typeof code === 'number' ? code : null,
						completed.stderr || String(code)
					);
				}
				return result(code === 0 ? 'pass' : 'fail', code);
			} catch (error) {
				return result(stopped ?? 'not-run', null, String(error));
			} finally {
				clearTimeout(timer);
				request.signal?.removeEventListener('abort', onAbort);
			}
		},
	};
}
