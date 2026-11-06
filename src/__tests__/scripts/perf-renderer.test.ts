import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeTempDir } from '../../../e2e/fixtures/native/temp-root.cjs';

const harness = vi.hoisted(() => ({
	run: undefined as undefined | ((fixtures: object, info: object) => Promise<void>),
	launch: vi.fn(),
	corpus: vi.fn(),
}));
vi.mock('@playwright/test', async () => {
	const { expect } = await import('vitest');
	return {
		expect,
		_electron: { launch: harness.launch },
		test: Object.assign(
			(_name: string, run: typeof harness.run) => {
				harness.run = run;
			},
			{ skip: vi.fn(), setTimeout: vi.fn() }
		),
	};
});
vi.mock('../../../scripts/perf/fixtures.mjs', () => ({
	createCorpus: harness.corpus,
	longMessages: () => [],
}));

// Run the actual spec with a stalled Electron transport. No Electron process is launched.
describe('renderer benchmark failure isolation', () => {
	let root: string;
	let output: string;
	let lines: string[];
	let fixtureRoots: string[];
	beforeEach(async () => {
		vi.useFakeTimers();
		fixtureRoots = [];
		root = createNativeTempDir('perf-runner-test-');
		output = path.join(root, 'output');
		fs.mkdirSync(output);
		const entry = path.join(root, 'dist/main/index.js');
		fs.mkdirSync(path.dirname(entry), { recursive: true });
		fs.mkdirSync(path.join(root, 'dist/renderer'));
		fs.writeFileSync(entry, '// synthetic build');
		vi.stubEnv('MAESTRO_PERF_BEFORE_ENTRY', entry);
		vi.stubEnv('MAESTRO_PERF_ENTRY', entry);
		vi.stubEnv('MAESTRO_PERF_ROUNDS', '3');
		vi.stubEnv('MAESTRO_PERF_STAGES', 'startup');
		vi.stubEnv('MAESTRO_PERF_STARTUP_TRACE', '0');
		vi.stubEnv('MAESTRO_PERF_TRACE', '0');
		harness.launch.mockReset().mockImplementation(() => new Promise(() => {}));
		harness.corpus.mockReset().mockImplementation(async (dir: string) => {
			fixtureRoots.push(path.dirname(dir));
			fs.mkdirSync(dir, { recursive: true });
			const file = path.join(dir, 'synthetic.jsonl');
			fs.writeFileSync(file, '{}\n');
			return {
				files: [{ file, id: 'synthetic' }],
				projects: [dir],
				accounts: { codex: path.join(dir, 'codex'), 'claude-code': path.join(dir, 'claude') },
			};
		});
		lines = [];
		vi.spyOn(console, 'log').mockImplementation((...args) => lines.push(args.join(' ')));
		await import('../../../e2e/perf-renderer.spec');
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		fs.rmSync(root, { recursive: true, force: true });
		for (const fixtureRoot of fixtureRoots)
			fs.rmSync(fixtureRoot, { recursive: true, force: true });
	});
	function start() {
		let done = false;
		let failure: unknown;
		const promise = harness.run!({}, { outputPath: (file: string) => path.join(output, file) })
			.catch((error) => {
				failure = error;
			})
			.finally(() => {
				done = true;
			});
		return { promise, done: () => done, failure: () => failure };
	}

	it('permits a one-round startup trace and reaches the launcher', async () => {
		vi.stubEnv('MAESTRO_PERF_ROUNDS', '1');
		vi.stubEnv('MAESTRO_PERF_STARTUP_TRACE', '1');
		start();
		await vi.advanceTimersByTimeAsync(1);
		expect(harness.launch).toHaveBeenCalledOnce();
	});

	it('records a timed out stage and continues to the next sample', async () => {
		start();
		await vi.advanceTimersByTimeAsync(100_000);
		expect(harness.launch.mock.calls.length).toBeGreaterThan(1);
		const result = JSON.parse(fs.readFileSync(path.join(output, 'perf-results.json'), 'utf8'));
		expect(result.stages.some((stage: { status: string }) => stage.status === 'timedOut')).toBe(
			true
		);
		expect(lines.some((line) => line.includes('START') && line.includes('startup'))).toBe(true);
		expect(lines.some((line) => line.includes('END') && line.includes('timedOut'))).toBe(true);
	});

	it('checkpoints the run before the first renderer reply', async () => {
		start();
		await vi.advanceTimersByTimeAsync(1);
		expect(fs.existsSync(path.join(output, 'perf-results.json'))).toBe(true);
		const result = JSON.parse(fs.readFileSync(path.join(output, 'perf-results.json'), 'utf8'));
		expect(result.complete).toBe(false);
		expect(result.stages.at(-1).status).toBe('running');
	});

	it('finishes a completely stalled comparison with failures instead of waiting 45 minutes', async () => {
		const run = start();
		await vi.advanceTimersByTimeAsync(32 * 60_000);
		expect(run.done()).toBe(true);
		expect(run.failure()).toBeInstanceOf(Error);
		const result = JSON.parse(fs.readFileSync(path.join(output, 'perf-results.json'), 'utf8'));
		expect(result.complete).toBe(true);
		expect(
			result.stages.filter((stage: { status: string }) => stage.status === 'timedOut')
		).toHaveLength(12);
		await run.promise;
	});
});
