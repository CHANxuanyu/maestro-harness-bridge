import { fork, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

// The fake is a POSIX shebang script, which node-pty cannot exec on Windows.
// Windows termination and parent detection are covered by the unit tests.
describe.runIf(process.platform !== 'win32')(
	'status probe process lifetime',
	{ timeout: 40_000 },
	() => {
		let root: string;
		let parent: ChildProcess | undefined;
		let probePid: number | undefined;
		let claudePid: number | undefined;
		let fixture: string;

		beforeAll(async () => {
			root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'status-process-')));
			await build({
				entryPoints: [path.resolve('src/maestro-p/index.ts')],
				bundle: true,
				platform: 'node',
				target: 'node20',
				format: 'cjs',
				outfile: path.join(root, 'maestro-p.cjs'),
				external: ['node-pty'],
				define: { __MAESTRO_P_VERSION__: JSON.stringify('test') },
			});
			fs.copyFileSync(
				path.resolve('src/__tests__/fixtures/maestro-p-usage/usage-well-spaced.txt'),
				path.join(root, 'usage.txt')
			);
			fs.writeFileSync(
				path.join(root, 'parent.cjs'),
				`const { execFile } = require('node:child_process');
const fs = require('node:fs');
const child = execFile(process.execPath, [process.env.PROBE_BIN, '--status'], {
	cwd: process.cwd(), env: process.env, encoding: 'utf8',
	maxBuffer: 1024 * 1024, timeout: 30000,
}, (error, stdout, stderr) => {
	fs.writeFileSync('result.json', JSON.stringify({ code: error?.code ?? 0, stdout, stderr }));
});
process.send(child.pid);
process.on('message', (message) => {
	if (message === 'exit') process.exit(0);
	if (message === 'end-stdin') child.stdin.end();
	if (message === 'close-readers') {
		child.stdout.destroy();
		child.stderr.destroy();
	}
});
`
			);
			fs.writeFileSync(
				path.join(root, 'claude'),
				`#!${process.execPath}
const fs = require('node:fs');
// Match a TUI's raw input: terminal echo would otherwise repaint every
// synthetic Enter and keep extending the status panel's quiet debounce.
process.stdin.setRawMode(true);
fs.writeFileSync('signals', '');
fs.writeFileSync('commands', '');
for (const [signal, code] of [['SIGTERM', 143], ['SIGHUP', 129]]) {
	process.on(signal, () => {
		fs.appendFileSync('signals', signal + '\\n');
		if (process.env.IGNORE_SIGNALS !== '1') process.exit(code);
	});
}
// SIGKILL cannot run this hook, so a recorded zero also proves a clean exit.
process.on('exit', (code) => fs.writeFileSync('claude-exit-code', String(code)));
let input = '';
process.stdin.on('data', (chunk) => {
	input += chunk.toString();
	const commands = input.split(/[\\r\\n]/);
	input = commands.pop();
	for (const command of commands) {
		if (!command) continue;
		fs.appendFileSync('commands', command + '\\n');
		if (process.env.HEALTHY === '1') {
			if (command === '/usage') process.stdout.write(fs.readFileSync(process.env.USAGE_FIXTURE));
			if (command === '/quit') process.exit(0);
		}
	}
});
fs.writeFileSync('claude.pid', String(process.pid));
if (process.env.PAINT_PROMPT === '1') process.stdout.write('❯ \\n');
if (process.env.API_BILLING === '1') process.stdout.write('Test model · API Usage Billing\\n');
if (process.env.PAINT_TRUST === '1') {
	process.stdout.write('Trust this folder?\\n  1. Yes, I trust this folder\\n❯ 2. No, exit\\n');
}
process.stdin.resume();
setInterval(() => {}, 1000);
`,
				{ mode: 0o755 }
			);
		}, 40_000);

		function alive(pid: number | undefined): boolean {
			if (pid === undefined) return false;
			try {
				process.kill(pid, 0);
				return true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
				throw error;
			}
		}

		// Gone waits stay well below the 28s lifetime: only parent detection or a
		// stop path may make them pass, never the lifetime deadline.
		async function waitUntil(check: () => boolean, timeoutMs = 10_000): Promise<void> {
			const deadline = Date.now() + timeoutMs;
			while (!check() && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			expect(check()).toBe(true);
		}

		async function waitForResult(): Promise<{
			code: number | string;
			stdout: string;
			stderr: string;
		}> {
			await waitUntil(
				() =>
					!alive(probePid) && !alive(claudePid) && fs.existsSync(path.join(fixture, 'result.json'))
			);
			expect(alive(parent?.pid)).toBe(true);
			return JSON.parse(fs.readFileSync(path.join(fixture, 'result.json'), 'utf8'));
		}

		async function start(extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
			fixture = fs.mkdtempSync(path.join(root, 'case-'));
			const home = path.join(fixture, 'home');
			const config = path.join(fixture, 'config');
			fs.mkdirSync(home);
			fs.mkdirSync(config);
			parent = fork(path.join(root, 'parent.cjs'), [], {
				cwd: fixture,
				stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
				env: {
					HOME: home,
					CLAUDE_CONFIG_DIR: config,
					BROWSER: '/usr/bin/true',
					PATH: process.env.PATH,
					NODE_PATH: path.resolve('node_modules'),
					PROBE_BIN: path.join(root, 'maestro-p.cjs'),
					MAESTRO_CLAUDE_BIN: path.join(root, 'claude'),
					USAGE_FIXTURE: path.join(root, 'usage.txt'),
					...extraEnv,
				},
			});
			let parentStderr = '';
			parent.stderr!.on('data', (data) => (parentStderr += data));
			parent.on('message', (pid: number) => (probePid = pid));
			// Boot is outside the behavior under test, and loaded CI can take seconds.
			await waitUntil(() => {
				const pidFile = path.join(fixture, 'claude.pid');
				if (fs.existsSync(pidFile)) claudePid = Number(fs.readFileSync(pidFile, 'utf8'));
				return probePid !== undefined && claudePid !== undefined;
			}, 20_000).catch((error) => {
				const result = path.join(fixture, 'result.json');
				throw new Error(
					`${error.message}\n${parentStderr}\n${fs.existsSync(result) ? fs.readFileSync(result, 'utf8') : ''}`
				);
			});
			expect(alive(probePid)).toBe(true);
			expect(alive(claudePid)).toBe(true);
		}

		afterEach(async () => {
			for (const pid of [claudePid, probePid, parent?.pid]) {
				if (alive(pid)) process.kill(pid!, 'SIGKILL');
			}
			await waitUntil(() => !alive(claudePid) && !alive(probePid) && !alive(parent?.pid));
			parent = undefined;
			probePid = undefined;
			claudePid = undefined;
		}, 40_000);
		afterAll(() => fs.rmSync(root, { recursive: true, force: true }), 40_000);

		it('stops a parked probe and claude when the parent exits normally', async () => {
			await start();
			parent!.send('exit');
			await waitUntil(() => !alive(probePid) && !alive(claudePid));
		});

		it('stops a parked probe and claude when the parent is SIGKILLed', async () => {
			await start();
			parent!.kill('SIGKILL');
			await waitUntil(() => !alive(probePid) && !alive(claudePid));
		});

		it('escalates when the orphaned parked claude ignores SIGTERM and SIGHUP', async () => {
			await start({ IGNORE_SIGNALS: '1' });
			parent!.send('exit');
			await waitUntil(() => !alive(probePid) && !alive(claudePid));
			expect(fs.readFileSync(path.join(fixture, 'signals'), 'utf8')).toContain('SIGTERM');
		});

		it('stops an orphaned prompt-ready claude that ignores SIGTERM and SIGHUP', async () => {
			await start({ IGNORE_SIGNALS: '1', PAINT_PROMPT: '1' });
			parent!.send('exit');
			await waitUntil(() => !alive(probePid) && !alive(claudePid));
		});

		it('SIGKILLs claude through the exit backstop when dead readers cause EPIPE', async () => {
			await start({ IGNORE_SIGNALS: '1', PAINT_PROMPT: '1', API_BILLING: '1' });
			parent!.send('close-readers');
			expect((await waitForResult()).code).toBe(0);
		});

		it('exits 143 on SIGTERM with its parent alive and a stubborn claude', async () => {
			await start({ IGNORE_SIGNALS: '1' });
			process.kill(probePid!, 'SIGTERM');
			expect((await waitForResult()).code).toBe(143);
			expect(fs.readFileSync(path.join(fixture, 'commands'), 'utf8')).toContain('/quit\n');
			expect(fs.readFileSync(path.join(fixture, 'signals'), 'utf8')).toContain('SIGTERM');
		});

		it('exits 129 on SIGHUP and stops claude', async () => {
			await start({ IGNORE_SIGNALS: '1' });
			process.kill(probePid!, 'SIGHUP');
			expect((await waitForResult()).code).toBe(129);
		});

		it('hard-stops on a second SIGTERM before the 2s quit grace', async () => {
			await start({ IGNORE_SIGNALS: '1' });
			process.kill(probePid!, 'SIGTERM');
			// Observe the first handler before sending again so POSIX cannot coalesce
			// the signals.
			await waitUntil(() =>
				fs.readFileSync(path.join(fixture, 'commands'), 'utf8').includes('/quit\n')
			);
			process.kill(probePid!, 'SIGTERM');
			expect((await waitForResult()).code).toBe(143);
			// quit() only sends SIGTERM when its 2s grace runs out, so finding none
			// proves the hard stop won without a wall-clock limit a busy runner can trip.
			expect(fs.readFileSync(path.join(fixture, 'signals'), 'utf8')).not.toContain('SIGTERM');
		});

		it('reports workspace-untrusted and stops a stubborn claude without trust opt-in', async () => {
			await start({ IGNORE_SIGNALS: '1', PAINT_TRUST: '1' });
			const result = await waitForResult();
			expect(result.code).toBe(1);
			expect(result.stderr).toContain(`claude has not been trusted to work in ${fixture}`);
			expect(result.stderr).toContain('MAESTRO_P_ACCEPT_WORKSPACE_TRUST=1');
			expect(result.stderr).toContain('Failing with workspace_untrusted.');
			expect(fs.readFileSync(path.join(fixture, 'signals'), 'utf8')).toContain('SIGTERM');
		});

		it('reports API billing parse failure and escalates with its parent and readers alive', async () => {
			await start({ IGNORE_SIGNALS: '1', PAINT_PROMPT: '1', API_BILLING: '1' });
			const result = await waitForResult();
			expect(result.code).toBe(1);
			expect(result.stderr).toContain('claude started on API Usage Billing');
			expect(result.stderr).toContain('There is no plan usage to report.');
			expect(fs.readFileSync(path.join(fixture, 'commands'), 'utf8')).toContain('/quit\n');
			expect(fs.readFileSync(path.join(fixture, 'signals'), 'utf8')).toContain('SIGTERM');
		});

		it('emits exactly one status and quits a healthy claude without signals', async () => {
			await start({ PAINT_PROMPT: '1', HEALTHY: '1' });
			const result = await waitForResult();
			expect(result.code).toBe(0);
			const lines = result.stdout.trimEnd().split('\n');
			expect(lines).toHaveLength(1);
			expect(JSON.parse(lines[0]).type).toBe('status');
			expect(result.stderr).toBe('');
			expect(fs.readFileSync(path.join(fixture, 'commands'), 'utf8')).toBe('/usage\n/quit\n');
			expect(fs.readFileSync(path.join(fixture, 'signals'), 'utf8')).toBe('');
			expect(fs.readFileSync(path.join(fixture, 'claude-exit-code'), 'utf8')).toBe('0');
		});

		it('keeps a parked probe alive while its parent lives, even with stdin at EOF', async () => {
			await start();
			parent!.send('end-stdin');
			await new Promise((resolve) => setTimeout(resolve, 4000));
			expect(alive(probePid)).toBe(true);
			expect(alive(claudePid)).toBe(true);
		});
	}
);
