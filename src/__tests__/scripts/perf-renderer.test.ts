import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeTempDir } from '../../../e2e/fixtures/native/temp-root.cjs';

const harness = vi.hoisted(() => ({
	run: undefined as undefined | ((fixtures: object, info: object) => Promise<void>),
	launch: vi.fn(),
	corpus: vi.fn(),
	messages: vi.fn(),
}));
vi.mock('@playwright/test', async () => {
	const { expect } = await import('vitest');
	return {
		expect: (value: unknown) => {
			if (value && typeof value === 'object' && '__locator' in value)
				return {
					toBeVisible: async () => {},
					toContainText: async () => {},
					toHaveCount: async () => {},
					toBeEditable: async () => {},
					toBeAttached: async () => {},
				};
			return expect(value);
		},
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
	longMessages: harness.messages,
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
		vi.spyOn(fs.promises, 'rm').mockImplementation(async (file, options) => {
			fs.rmSync(file, options);
		});
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
		harness.messages.mockReset().mockReturnValue([]);
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

	function respondingApp(
		options: {
			freezeFrames?: boolean;
			freezeKeys?: boolean;
			ids?: string[];
			longTasks?: boolean;
		} = {}
	) {
		const kill = vi.fn();
		const send = vi.fn();
		const locator = {
			__locator: true,
			last: () => locator,
			getByText: () => locator,
			click: async () => {},
			evaluateAll: async () => options.ids ?? [],
		};
		const container = { scrollTop: 0, scrollHeight: 1000 };
		const observers = new Map<string, (event: object) => void>();
		const renderer = {
			window: {},
			document: {
				addEventListener: (name: string, handler: (event: object) => void) =>
					observers.set(name, handler),
				removeEventListener: (name: string) => observers.delete(name),
				querySelector: () => container,
			},
			performance: { now: () => Date.now(), getEntriesByType: () => [], timeOrigin: 0 },
			requestAnimationFrame: (callback: (now: number) => void) =>
				options.freezeFrames ? 0 : setTimeout(() => callback(Date.now()), 16),
			cancelAnimationFrame: clearTimeout,
			PerformanceObserver: class {
				observe() {}
				disconnect() {}
				takeRecords() {
					return options.longTasks ? [{ startTime: Date.now() - 80, duration: 60 }] : [];
				}
			},
		};
		const page = {
			setDefaultTimeout: vi.fn(),
			getByPlaceholder: () => locator,
			getByTestId: () => locator,
			getByRole: () => locator,
			locator: () => locator,
			evaluate: async (fn: () => unknown) => runInNewContext(`(${fn.toString()})()`, renderer),
			keyboard: {
				press: async () => {
					if (options.freezeKeys) await new Promise(() => {});
					observers.get('keydown')?.({ key: 'Shift', timeStamp: Date.now() });
				},
			},
		};
		return {
			kill,
			send,
			app: {
				process: () => ({ kill }),
				close: async () => {},
				firstWindow: async () => page,
				context: () => ({
					newCDPSession: async () => ({
						send: async () => ({ metrics: [] }),
						detach: async () => {},
					}),
				}),
				evaluate: async (fn: () => unknown, argument: unknown) =>
					runInNewContext(`(${fn.toString()})(electron, argument)`, {
						process: {
							getCreationTime: () => Date.now(),
							memoryUsage: () => ({ heapUsed: 1, rss: 1 }),
						},
						performance: renderer.performance,
						setTimeout,
						electron: {
							dialog: {},
							BrowserWindow: {
								getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }],
							},
						},
						argument,
					}),
			},
		};
	}

	it('runs selected streaming dependencies successfully without native selection or empty startup', async () => {
		vi.stubEnv('MAESTRO_PERF_BEFORE_ENTRY', '');
		vi.stubEnv('MAESTRO_PERF_ROUNDS', '1');
		vi.stubEnv('MAESTRO_PERF_STAGES', 'stream');
		const fake = respondingApp({ longTasks: true });
		harness.launch.mockResolvedValue(fake.app);
		const run = start();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(run.failure()).toBeUndefined();
		expect(run.done()).toBe(true);
		expect(fake.send).toHaveBeenCalledTimes(300);
		expect(harness.launch).toHaveBeenCalledOnce();
		const result = JSON.parse(fs.readFileSync(path.join(output, 'perf-results.json'), 'utf8'));
		const stream = result.samples[0].observations?.['large.stream.100Hz'];
		expect(stream?.longTasks).toEqual([{ startMs: expect.any(Number), durationMs: 60 }]);
		expect(stream.longTasks[0].startMs).toBeGreaterThan(0);
		expect(result.stages.map((stage: { name: string }) => stage.name)).toEqual([
			'prepare',
			'startup',
			'switch',
			'backfill',
			'ids',
			'stream',
			'close',
			'cleanup',
		]);
		expect(result.stages.every((stage: { status: string }) => stage.status === 'passed')).toBe(
			true
		);
	});

	it('rejects an extra display ID and blocks isolated streaming', async () => {
		vi.stubEnv('MAESTRO_PERF_BEFORE_ENTRY', '');
		vi.stubEnv('MAESTRO_PERF_ROUNDS', '1');
		vi.stubEnv('MAESTRO_PERF_STAGES', 'stream');
		const fake = respondingApp({ ids: ['unexpected'] });
		harness.launch.mockResolvedValue(fake.app);
		const run = start();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(run.failure()).toBeInstanceOf(Error);
		expect(fake.send).not.toHaveBeenCalled();
		const result = JSON.parse(fs.readFileSync(path.join(output, 'perf-results.json'), 'utf8'));
		expect(result.stages.find((stage: { name: string }) => stage.name === 'ids').status).toBe(
			'failed'
		);
		expect(result.stages.find((stage: { name: string }) => stage.name === 'stream').status).toBe(
			'blocked'
		);
		expect(result.samples[0].metrics['large.backfill.remaining']).toBeDefined();
	});

	it.each([
		{ ids: ['b-message-0', 'b-message-1'], status: 'passed' },
		{ ids: ['b-message-1', 'b-message-0'], status: 'failed' },
		{ ids: ['b-message-0', 'b-message-0'], status: 'failed' },
		{ ids: ['b-message-0'], status: 'failed' },
	])('validates every displayed ID in exact order: $ids', async ({ ids, status }) => {
		vi.stubEnv('MAESTRO_PERF_BEFORE_ENTRY', '');
		vi.stubEnv('MAESTRO_PERF_ROUNDS', '1');
		vi.stubEnv('MAESTRO_PERF_STAGES', 'ids');
		harness.messages.mockReturnValue(
			[0, 1].map((index) => ({
				type: 'user',
				content: `Synthetic ${index}`,
				uuid: `message-${index}`,
				timestamp: '2026-11-06T10:00:00Z',
			}))
		);
		harness.launch.mockResolvedValue(respondingApp({ ids }).app);
		const run = start();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(run.done()).toBe(true);
		const result = JSON.parse(fs.readFileSync(path.join(output, 'perf-results.json'), 'utf8'));
		expect(result.stages.find((stage: { name: string }) => stage.name === 'ids').status).toBe(
			status
		);
	});

	it.each([
		{ freezeFrames: true, freezeKeys: false, waitingFor: 'startup two painted frames' },
		{ freezeFrames: false, freezeKeys: true, waitingFor: 'key probe drain' },
	])('bounds the renderer wait at $waitingFor', async ({ waitingFor, ...options }) => {
		vi.stubEnv('MAESTRO_PERF_BEFORE_ENTRY', '');
		vi.stubEnv('MAESTRO_PERF_ROUNDS', '1');
		vi.stubEnv('MAESTRO_PERF_STAGES', 'switch');
		const fake = respondingApp(options);
		harness.launch.mockResolvedValue(fake.app);
		const run = start();
		await vi.advanceTimersByTimeAsync(100_000);
		expect(run.done()).toBe(true);
		expect(run.failure()).toBeInstanceOf(Error);
		expect(fake.kill).toHaveBeenCalledWith('SIGKILL');
		const result = JSON.parse(fs.readFileSync(path.join(output, 'perf-results.json'), 'utf8'));
		expect(
			result.stages.find((stage: { status: string }) => stage.status === 'timedOut').waitingFor
		).toBe(waitingFor);
	});

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

	it('bounds a stalled main-process evaluate and a stalled close, then launches the next sample', async () => {
		const kill = vi.fn();
		const close = vi.fn(() => new Promise<void>(() => {}));
		harness.launch.mockResolvedValue({
			evaluate: () => new Promise(() => {}),
			close,
			process: () => ({ kill }),
		});
		start();
		await vi.advanceTimersByTimeAsync(96_000);
		expect(harness.launch).toHaveBeenCalledTimes(2);
		expect(close).toHaveBeenCalledOnce();
		expect(kill).toHaveBeenCalledTimes(2);
		const result = JSON.parse(fs.readFileSync(path.join(output, 'perf-results.json'), 'utf8'));
		expect(
			result.stages
				.filter((stage: { status: string }) => stage.status === 'timedOut')
				.map((stage: { waitingFor: string }) => stage.waitingFor)
		).toEqual(['process creation time', 'electron.close']);
	});

	it('kills a child whose launch resolves after its sample timed out', async () => {
		let release!: (app: object) => void;
		const kill = vi.fn();
		harness.launch.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		start();
		await vi.advanceTimersByTimeAsync(91_000);
		release({ process: () => ({ kill }) });
		await vi.advanceTimersByTimeAsync(1);
		expect(kill).toHaveBeenCalledWith('SIGKILL');
		const result = JSON.parse(fs.readFileSync(path.join(output, 'perf-results.json'), 'utf8'));
		expect(result.samples[0].metrics).toEqual({});
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
