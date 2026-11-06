import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeTempDir } from '../../../e2e/fixtures/native/temp-root.cjs';
import {
	RendererRun,
	rendererOptions,
	type PerfSample,
} from '../../../e2e/fixtures/perf-renderer-runner';

describe('renderer benchmark stage journal', () => {
	let root: string;
	let file: string;
	let run: RendererRun;
	let sample: PerfSample;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		root = createNativeTempDir('perf-journal-test-');
		file = path.join(root, 'perf-results.json');
		run = new RendererRun(file, { rounds: 3 });
		sample = { variant: 'before', round: 0, size: 'large', metrics: {}, loadBefore: [] };
		run.samples.push(sample);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('aborts a stalled step, terminates its owner, and ignores late metrics and follow-up actions', async () => {
		let release!: () => void;
		const late = new Promise<void>((resolve) => {
			release = resolve;
		});
		const nextAction = vi.fn();
		const terminate = vi.fn();
		const result = run.stage(
			sample,
			'backfill',
			120_000,
			async (scope) => {
				await scope.step('oldest row', () => late);
				await scope.step('must not run after timeout', nextAction);
				return { backfill: { ms: 1 } };
			},
			{ onTimeout: terminate }
		);
		await vi.advanceTimersByTimeAsync(120_000);
		expect((await result).status).toBe('timedOut');
		expect((await result).error).toContain('oldest row');
		expect(terminate).toHaveBeenCalledOnce();
		release();
		await vi.advanceTimersByTimeAsync(1);
		expect(nextAction).not.toHaveBeenCalled();
		expect(sample.metrics).toEqual({});
		expect(JSON.parse(fs.readFileSync(file, 'utf8')).stages[0].status).toBe('timedOut');
	});

	it('accepts a slow before backfill beyond 17 seconds', async () => {
		const result = run.stage(sample, 'backfill', 120_000, async () => {
			await new Promise((resolve) => setTimeout(resolve, 22_000));
			return { backfill: { ms: 22_000 } };
		});
		await vi.advanceTimersByTimeAsync(22_000);
		expect((await result).status).toBe('passed');
		expect(sample.metrics.backfill.ms).toBe(22_000);
	});

	it('preserves completed stages while the next one is still pending and keeps failures out of summary', async () => {
		await run.stage(sample, 'startup', 100, async () => ({ startup: { ms: 42 } }));
		await run.stage(sample, 'native', 100, async () => {
			throw Error('fixture failure');
		});
		const pending = run.stage(sample, 'switch', 100, () => new Promise(() => {}));
		const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
		expect(checkpoint.complete).toBe(false);
		expect(checkpoint.stages.map((stage: { status: string }) => stage.status)).toEqual([
			'passed',
			'failed',
			'running',
		]);
		expect(checkpoint.summary).toEqual({ 'before:startup': { ms: { n: 1, median: 42, p95: 42 } } });
		const events = fs
			.readFileSync(file.replace('.json', '.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(events.map((event) => event.event)).toEqual(['START', 'END', 'START', 'END', 'START']);
		await vi.advanceTimersByTimeAsync(100);
		await pending;
		const independent = await run.stage(sample, 'independent', 100, async () => ({
			independent: { ms: 9 },
		}));
		expect(independent.status).toBe('passed');
		expect(() => run.finish()).toThrow('2 benchmark stages');
		expect(JSON.parse(fs.readFileSync(file, 'utf8')).complete).toBe(true);
	});

	it('records blocked dependencies without calling their work or pretending they passed', async () => {
		const work = vi.fn();
		const result = await run.stage(sample, 'ids', 100, work, {
			blocked: 'Requires successful backfill',
		});
		expect(result.status).toBe('blocked');
		expect(work).not.toHaveBeenCalled();
		expect(() => run.finish()).toThrow('1 benchmark stages');
	});
});

describe('renderer benchmark selection', () => {
	it('defaults to three rounds and marks short or traced runs as diagnostic', () => {
		expect(rendererOptions({}).rounds).toBe(3);
		expect(rendererOptions({}).diagnostic).toBe(false);
		expect(rendererOptions({ MAESTRO_PERF_ROUNDS: '1' }).diagnostic).toBe(true);
		expect(rendererOptions({ MAESTRO_PERF_STARTUP_TRACE: '1' }).diagnostic).toBe(true);
	});
	it('runs only selected phases and their necessary dependencies', () => {
		const config = rendererOptions({ MAESTRO_PERF_STAGES: 'stream' });
		expect([...config.stages]).toEqual(['startup', 'switch', 'backfill', 'ids', 'stream']);
		expect(config.sizes).toEqual(['large']);
		expect(rendererOptions({ MAESTRO_PERF_STAGES: 'startup' }).sizes).toEqual(['empty', 'large']);
	});
	it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '21', ''])(
		'rejects invalid rounds %s',
		(rounds) => {
			expect(() => rendererOptions({ MAESTRO_PERF_ROUNDS: rounds })).toThrow('MAESTRO_PERF_ROUNDS');
		}
	);
	it.each(['', 'backfil', 'stream,', 'close'])('rejects unknown phase %s', (stages) => {
		expect(() => rendererOptions({ MAESTRO_PERF_STAGES: stages })).toThrow('MAESTRO_PERF_STAGES');
	});
	it('rejects contradictory trace modes and interaction selection in startup trace mode', () => {
		expect(() =>
			rendererOptions({ MAESTRO_PERF_STARTUP_TRACE: '1', MAESTRO_PERF_TRACE: '1' })
		).toThrow('mutually exclusive');
		expect(() =>
			rendererOptions({ MAESTRO_PERF_STARTUP_TRACE: '1', MAESTRO_PERF_STAGES: 'stream' })
		).toThrow('Startup trace supports only');
	});
});
