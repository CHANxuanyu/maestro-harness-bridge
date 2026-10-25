import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));
vi.mock('electron-store', () => ({
	default: class {
		get() {
			return {};
		}
		set() {}
	},
}));
vi.mock('../../../src/main/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../src/main/utils/sentry', () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
}));

import { ClaudeOutputParser } from '../../../src/main/parsers/claude-output-parser';
import { CodexOutputParser } from '../../../src/main/parsers/codex-output-parser';
import { ClaudeSessionStorage } from '../../../src/main/storage/claude-session-storage';
import { CodexSessionStorage } from '../../../src/main/storage/codex-session-storage';

const require = createRequire(import.meta.url);
const { transcriptPath } = require('./protocol.cjs');
const { appendTurn } = require('./append-turn.cjs');
const { startAppServer } = require('./app-server.cjs');
const { runSharedExec } = require('../../../scripts/codex-shared/shared-exec.cjs');
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

for (const provider of ['claude', 'codex']) {
	describe(provider, () => {
		it('SIGINT records a native cancellation before exit', async () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-native-stop-'));
			roots.push(root);
			const script = path.join(root, 'script.json');
			fs.writeFileSync(
				script,
				JSON.stringify({
					turns: [
						{
							waitForStop: true,
							tools: [{ id: 'interrupted-tool', command: 'sleep 60', output: '' }],
						},
					],
				})
			);
			const args =
				provider === 'claude' ? ['--print', '--output-format', 'stream-json'] : ['exec', '--json'];
			const child = spawn(
				process.execPath,
				[path.resolve(`e2e/fixtures/native/${provider}`), ...args, '--', 'Interrupt this tool'],
				{
					cwd: root,
					env: {
						...process.env,
						CLAUDE_CONFIG_DIR: root,
						CODEX_HOME: root,
						MAESTRO_NATIVE_SCRIPT: script,
					},
				}
			);
			let output = '';
			const exited = once(child, 'exit');
			try {
				await new Promise<void>((resolve, reject) => {
					child.once('error', reject);
					child.stdout.on('data', (chunk) => {
						output += chunk;
						if (output.includes('interrupted-tool')) resolve();
					});
				});
				child.kill('SIGINT');
				expect((await exited)[0]).toBe(130);
				const events = output
					.trim()
					.split('\n')
					.map((line) => JSON.parse(line));
				const id = provider === 'claude' ? events[0].session_id : events[0].thread_id;
				const storage =
					provider === 'claude' ? new ClaudeSessionStorage() : new CodexSessionStorage();
				const history = await storage.readSessionMessages(root, id, {
					configDir: root,
					readOnly: true,
				});
				expect(
					history.messages
						.flatMap((message) => message.toolUse || [])
						.map((tool) => tool.state.status)
				).toContain('canceled');
			} finally {
				if (child.exitCode === null) child.kill('SIGKILL');
			}
		});

		it('the executable stream and native storage retain the same answer, tool IDs and results', async () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-native-fixture-'));
			roots.push(root);
			const script = path.join(root, 'script.json');
			const tools = [
				{ id: 'call-first', command: 'printf first', output: 'first' },
				{ id: 'call-second', command: 'printf second', output: 'second', status: 'failed' },
			];
			fs.writeFileSync(script, JSON.stringify({ turns: [{ answer: 'Fixture answer.', tools }] }));
			const args =
				provider === 'claude' ? ['--print', '--output-format', 'stream-json'] : ['exec', '--json'];
			const { stdout } = await exec(
				process.execPath,
				[path.resolve(`e2e/fixtures/native/${provider}`), ...args, '--', 'Fixture prompt'],
				{
					cwd: root,
					env: {
						...process.env,
						CLAUDE_CONFIG_DIR: root,
						CODEX_HOME: root,
						MAESTRO_NATIVE_SCRIPT: script,
					},
				}
			);
			const parser = provider === 'claude' ? new ClaudeOutputParser() : new CodexOutputParser();
			const events = stdout
				.trim()
				.split('\n')
				.map((line) => parser.parseJsonLine(line))
				.filter(Boolean);
			const id = events.find((event) => event?.sessionId)?.sessionId!;
			expect(id).toBeTruthy();
			const storage =
				provider === 'claude' ? new ClaudeSessionStorage() : new CodexSessionStorage();
			const file = transcriptPath(provider, root, root, id);
			const before = fs.readFileSync(file);
			const history = await storage.readSessionMessages(root, id, {
				configDir: root,
				readOnly: true,
			});
			expect(fs.readFileSync(file)).toEqual(before);
			expect(history.messages.find((message) => message.content === 'Fixture answer.')?.model).toBe(
				provider === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5.3-codex'
			);
			expect(events.some((event) => event?.text === 'Fixture answer.')).toBe(true);
			for (const tool of tools) {
				const live = events.find(
					(event) =>
						event?.toolCallId === tool.id &&
						(event.toolState as { status: string })?.status !== 'running'
				)!;
				const stored =
					provider === 'claude'
						? history.messages
								.flatMap((message) => message.toolUse || [])
								.find((item) => item.id === tool.id)
						: history.messages.find((message) => message.uuid === tool.id)?.toolUse?.[0];
				expect(live).toBeTruthy();
				expect(stored?.state?.status).toBe((live.toolState as { status: string }).status);
				expect(stored?.state?.output).toContain(tool.output);
				expect((live.toolState as { output: string }).output).toContain(tool.output);
			}
		});
	});
}

it('the shared app-server drives the real connector and writes readable native results', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-shared-fixture-'));
	roots.push(root);
	const scene = {
		answer: 'Shared fixture answer.',
		tools: [{ id: 'shared-tool', command: 'printf shared-result', output: 'shared-result' }],
	};
	const seed = appendTurn(
		{ provider: 'codex', configDir: root, cwd: root, prompt: 'Initial shared turn' },
		{ answer: 'Initial answer.' }
	);
	const socket = path.join(root, 'rpc.sock');
	const server = await startAppServer({
		socket,
		configDir: root,
		cwd: root,
		id: seed.id,
		scenes: [scene],
	});
	try {
		const events: unknown[] = [];
		expect(
			await runSharedExec(socket, ['exec', '--json', 'resume', seed.id, '--', 'Shared turn'], {
				output: (event: unknown) => events.push(event),
			})
		).toMatchObject({ threadId: seed.id, status: 'completed' });
		const parsed = events.map((event) => new CodexOutputParser().parseJsonObject(event));
		expect(parsed.some((event) => event?.text === scene.answer)).toBe(true);
		const history = await new CodexSessionStorage().readSessionMessages(root, seed.id, {
			configDir: root,
			readOnly: true,
		});
		expect(history.messages.find((message) => message.content === scene.answer)?.effort).toBe(
			'high'
		);
		expect(
			history.messages.find((message) => message.uuid === 'shared-tool')?.toolUse?.[0].state
		).toMatchObject({ status: 'completed', output: expect.stringContaining('shared-result') });
		expect(server.state.turns).toHaveLength(1);
	} finally {
		await server.close();
	}
});

for (const blocker of ['active', 'queued'] as const) {
	it(`the shared executable reports ${blocker} rejection in the production adapter format`, async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-shared-rejection-'));
		roots.push(root);
		const seed = appendTurn(
			{ provider: 'codex', configDir: root, cwd: root, prompt: 'Shared history' },
			{ answer: 'Shared initial answer.' }
		);
		const socket = path.join(root, 'rpc.sock');
		const server = await startAppServer({
			socket,
			configDir: root,
			cwd: root,
			id: seed.id,
			scenes: [],
		});
		if (blocker === 'active') server.state.status = 'active';
		else server.state.queue = [{ id: 'queued' }];
		try {
			const result = await exec(
				process.execPath,
				[
					path.resolve('e2e/fixtures/native/codex-shared'),
					'exec',
					'--json',
					'resume',
					seed.id,
					'--',
					'Refuse this turn',
				],
				{ cwd: root, env: { ...process.env, MAESTRO_NATIVE_SOCKET: socket } }
			).catch((error: { code: number; stdout: string; stderr: string }) => error);
			expect(result).toMatchObject({ code: 1, stderr: '' });
			// scripts/codex-shared/exec-adapter-v2.cjs emits this native exec error envelope.
			const event = JSON.parse(result.stdout.trim());
			expect(event).toEqual({ type: 'error', message: expect.stringMatching(/^Shared Codex: /) });
			expect(new CodexOutputParser().detectErrorFromParsed(event)?.message).toContain(
				blocker === 'active' ? 'still generating in another client' : 'already has queued messages'
			);
			expect(server.state.turns).toHaveLength(0);
		} finally {
			await server.close();
		}
	});
}

it('a nonpersistent Claude resume leaves every native byte and file unchanged', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-native-synopsis-'));
	roots.push(root);
	const turn = appendTurn(
		{ provider: 'claude', configDir: root, cwd: root, prompt: 'Initial turn' },
		{ answer: 'Initial answer.' }
	);
	const before = fs.readFileSync(turn.file);
	const script = path.join(root, 'script.json');
	fs.writeFileSync(script, JSON.stringify({ synopsis: { answer: 'Synopsis answer.' } }));
	const files = fs.readdirSync(root, { recursive: true }).sort();
	await exec(
		process.execPath,
		[
			path.resolve('e2e/fixtures/native/claude'),
			'--print',
			'--resume',
			turn.id,
			'--no-session-persistence',
			'--',
			'Synopsis',
		],
		{ cwd: root, env: { ...process.env, CLAUDE_CONFIG_DIR: root, MAESTRO_NATIVE_SCRIPT: script } }
	);
	expect(fs.readFileSync(turn.file)).toEqual(before);
	expect(fs.readdirSync(root, { recursive: true }).sort()).toEqual(files);
});
