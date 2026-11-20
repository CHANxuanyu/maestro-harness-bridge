import { afterEach, expect, it, vi } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { setupForwardingListeners } from '../../../main/process-listeners/forwarding-listeners';
import path from 'node:path';
import * as remoteGit from '../../../main/utils/remote-git';
import { beginGitTurn, finishGitTurn } from '../../../main/git-changes';
import { StdoutHandler } from '../../../main/process-manager/handlers/StdoutHandler';
import { DataBufferManager } from '../../../main/process-manager/handlers/DataBufferManager';
import { ClaudeOutputParser } from '../../../main/parsers/claude-output-parser';
import { CodexOutputParser } from '../../../main/parsers/codex-output-parser';
import type { ManagedProcess } from '../../../main/process-manager/types';

vi.mock('../../../main/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../main/utils/sentry', () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
}));

const { createNativeTempDir } = require('../../../../e2e/fixtures/native/temp-root.cjs');
const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
	for (const child of children.splice(0)) child.kill();
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	vi.clearAllMocks();
});

it.each(['claude', 'codex'] as const)(
	'captures the %s native fixture write turn without waiting before spawn',
	async (provider) => {
		const cwd = createNativeTempDir('maestro-delivery-');
		roots.push(cwd);
		execFileSync('git', ['init', '-b', 'main'], { cwd });
		const configDir = path.join(cwd, '.git', 'fixture');
		mkdirSync(configDir);
		const script = path.join(configDir, 'scene.json');
		const gate = path.join(configDir, 'release-tools');
		const files = { 'activity-a.txt': 'one\ntwo\n', 'activity-b.txt': 'three\n' };
		const tools =
			provider === 'claude'
				? Object.entries(files).map(([file_path, content], index) => ({
						id: `write-${index}`,
						name: 'Write',
						input: { file_path, content },
						command: '',
						output: 'Written',
					}))
				: [
						{
							id: 'write-patch',
							name: 'file_change',
							command: '',
							output: 'Written',
							input: {
								patch:
									'*** Begin Patch\n*** Add File: activity-a.txt\n+one\n+two\n*** Add File: activity-b.txt\n+three\n*** End Patch',
								changes: Object.keys(files).map((file) => ({ path: file, kind: 'add' })),
							},
						},
					];
		writeFileSync(
			script,
			JSON.stringify({
				turns: [
					{
						answer: 'DELIVERY_DONE',
						tools: tools.map((tool) => ({ ...tool, updates: ['pending'], gates: [gate] })),
						writes: files,
					},
				],
			})
		);
		const sessionId = `fixture-${provider}-ai-tab`;
		const emitter = new EventEmitter();
		const proc = {
			sessionId,
			toolType: provider === 'claude' ? 'claude-code' : 'codex',
			cwd,
			isStreamJsonMode: true,
			isBatchMode: true,
			newShellActivity: true,
			isTerminal: false,
			jsonBuffer: '',
			stdoutBuffer: '',
			streamedText: '',
			resultEmitted: false,
			errorEmitted: false,
			outputParser: provider === 'claude' ? new ClaudeOutputParser() : new CodexOutputParser(),
		} as ManagedProcess;
		const processes = new Map([[sessionId, proc]]);
		const bufferManager = new DataBufferManager(processes, emitter);
		const stdout = new StdoutHandler({ processes, emitter, bufferManager });
		setupForwardingListeners(
			emitter as never,
			{ safeSend: vi.fn(), getWebServer: () => null, patterns: {} } as unknown as Parameters<
				typeof setupForwardingListeners
			>[1]
		);
		// Deterministically let init and tool starts beat the first Git read,
		// as they do in the failing native scenario. No mutation has happened.
		let releaseBaseline!: () => void;
		const ready = new Promise<void>((resolve) => {
			releaseBaseline = resolve;
		});
		const readGit = remoteGit.execGitReadOnly;
		vi.spyOn(remoteGit, 'execGitReadOnly').mockImplementationOnce(async (...args) => {
			await ready;
			return readGit(...args);
		});
		const toolStarted = once(emitter, 'tool-execution');
		const capture = beginGitTurn(sessionId, cwd);
		const child = spawn(
			process.execPath,
			[
				path.resolve(`e2e/fixtures/native/${provider}`),
				provider === 'claude' ? '--print' : 'exec',
				'--',
				'Write two synthetic files',
			],
			{
				cwd,
				env: {
					...process.env,
					CLAUDE_CONFIG_DIR: configDir,
					CODEX_HOME: configDir,
					MAESTRO_NATIVE_SCRIPT: script,
				},
				stdio: ['ignore', 'pipe', 'pipe'],
			}
		);
		children.push(child);
		let answer = '';
		child.stdout.on('data', (chunk) => {
			answer += chunk.toString();
			emitter.emit('raw-stdout', sessionId, chunk.toString());
			stdout.handleData(sessionId, chunk.toString());
		});
		let stderr = '';
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});
		// Hold tool completion while the baseline settles, without gating spawn or stdout.
		await toolStarted;
		releaseBaseline();
		await capture;
		writeFileSync(gate, 'ready');
		const [code] = await once(child, 'close');
		bufferManager.flushDataBuffer(sessionId);
		expect(code, stderr).toBe(0);
		expect(answer).toContain('DELIVERY_DONE');
		expect(await finishGitTurn(sessionId)).toEqual({
			files: 2,
			additions: 3,
			deletions: 0,
			paths: Object.keys(files),
		});
	}
);
