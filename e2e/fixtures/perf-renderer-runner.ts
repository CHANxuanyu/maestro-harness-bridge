import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { assertSerializedJsonIsSafe } from '../../src/shared/jsonUtils';
import { summarize } from '../../scripts/perf/summary.mjs';

export const stageBudgets = {
	startup: 90_000,
	history: 30_000,
	native: 60_000,
	switch: 45_000,
	backfill: 120_000,
	ids: 15_000,
	scroll: 15_000,
	stream: 20_000,
	trace: 20_000,
	close: 5_000,
};
export type StageName = keyof typeof stageBudgets;
const selectable = [
	'startup',
	'history',
	'native',
	'switch',
	'backfill',
	'ids',
	'scroll',
	'stream',
] as const;
const dependencies: Partial<Record<StageName, StageName[]>> = {
	history: ['startup'],
	native: ['history'],
	switch: ['startup'],
	backfill: ['switch'],
	ids: ['backfill'],
	scroll: ['ids'],
	stream: ['ids'],
};

export function rendererOptions(env: NodeJS.ProcessEnv) {
	const startupTrace = env.MAESTRO_PERF_STARTUP_TRACE === '1';
	const interactionTrace = env.MAESTRO_PERF_TRACE === '1';
	if (startupTrace && interactionTrace)
		throw Error('Startup and interaction traces are mutually exclusive');
	const rounds = Number(env.MAESTRO_PERF_ROUNDS ?? 3);
	if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20)
		throw Error('MAESTRO_PERF_ROUNDS must be an integer from 1 to 20');
	const requested =
		env.MAESTRO_PERF_STAGES === undefined
			? [...(startupTrace ? ['startup' as const] : selectable)]
			: (env.MAESTRO_PERF_STAGES.split(',').map((name) => name.trim()) as StageName[]);
	if (
		!requested.length ||
		requested.some((name) => !selectable.includes(name as (typeof selectable)[number]))
	)
		throw Error(`MAESTRO_PERF_STAGES must contain: ${selectable.join(',')}`);
	if (startupTrace && requested.some((name) => name !== 'startup'))
		throw Error('Startup trace supports only MAESTRO_PERF_STAGES=startup');
	const stages = new Set<StageName>();
	const include = (name: StageName) => {
		for (const dependency of dependencies[name] ?? []) include(dependency);
		stages.add(name);
	};
	requested.forEach(include);
	return {
		rounds,
		startupTrace,
		interactionTrace,
		requested,
		stages,
		// One or two rounds are diagnostic, never a three-round comparison.
		diagnostic: rounds < 3 || startupTrace || interactionTrace,
		sizes: requested.includes('startup') ? (['empty', 'large'] as const) : (['large'] as const),
	};
}

export type Metrics = Record<string, Record<string, number>>;
export interface RendererObservation {
	startedAt: number;
	timeOrigin: number;
	longTasks: { startMs: number; durationMs: number }[];
	frames: { startMs: number; durationMs: number }[];
	keyEvents: {
		eventStartMs: number;
		handledMs: number;
		nextFrameMs?: number;
		visibilityState: DocumentVisibilityState;
		focused: boolean;
	}[];
}
export interface PerfSample {
	variant: string;
	round: number;
	size: string;
	metrics: Metrics;
	observations?: Record<string, RendererObservation>;
	loadBefore: number[];
	loadAfter?: number[];
}
export interface StageRecord {
	variant?: string;
	round?: number;
	size?: string;
	name: string;
	status: 'running' | 'passed' | 'failed' | 'timedOut' | 'blocked';
	startedAt: string;
	endedAt?: string;
	durationMs?: number;
	budgetMs: number;
	waitingFor?: string;
	error?: string;
	metrics?: Metrics;
}

class StageTimeout extends Error {
	constructor(label: string, ms: number) {
		super(`${label} exceeded ${ms} ms`);
		this.name = 'StageTimeout';
	}
}

export interface StageScope {
	signal: AbortSignal;
	step<T>(label: string, work: () => Promise<T>): Promise<T>;
}

/** Benchmark-only journal. Sync checkpoints finish before the next measured phase starts. */
export class RendererRun {
	readonly samples: PerfSample[] = [];
	readonly stages: StageRecord[] = [];
	complete = false;
	constructor(
		private file: string,
		private metadata: Record<string, unknown>
	) {
		this.checkpoint();
	}
	checkpoint() {
		const serialized = JSON.stringify(
			{
				...this.metadata,
				schema: 4,
				complete: this.complete,
				samples: this.samples,
				stages: this.stages,
				summary: summarize(this.samples),
			},
			null,
			'\t'
		);
		assertSerializedJsonIsSafe(serialized, this.file);
		fs.writeFileSync(`${this.file}.tmp`, serialized);
		fs.renameSync(`${this.file}.tmp`, this.file);
	}
	private publish(record: StageRecord, event: 'START' | 'END') {
		// Each line is independent JSON; an interrupted final line cannot erase prior stages.
		fs.appendFileSync(
			this.file.replace(/\.json$/, '.jsonl'),
			JSON.stringify({ event, ...record }) + '\n'
		);
		this.checkpoint();
		console.log(
			`[perf] ${event} ${record.variant ?? 'run'} round=${record.round ?? '-'} size=${record.size ?? '-'} stage=${record.name} status=${record.status} budgetMs=${record.budgetMs}${record.durationMs === undefined ? '' : ` durationMs=${Math.round(record.durationMs)}`}${record.error ? ` error=${record.error}` : ''}`
		);
	}
	async stage(
		sample: PerfSample | undefined,
		name: string,
		budgetMs: number,
		work: (scope: StageScope) => Promise<Metrics | void>,
		options: { blocked?: string; onTimeout?: () => void } = {}
	): Promise<StageRecord> {
		const record: StageRecord = {
			...(sample ? { variant: sample.variant, round: sample.round, size: sample.size } : {}),
			name,
			budgetMs,
			status: 'running',
			startedAt: new Date().toISOString(),
		};
		this.stages.push(record);
		this.publish(record, 'START');
		const controller = new AbortController();
		const started = performance.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			if (options.blocked) {
				record.status = 'blocked';
				record.error = options.blocked;
			} else {
				const result = await Promise.race([
					new Promise<never>((_, reject) => {
						timer = setTimeout(() => {
							const error = new StageTimeout(`${name}: ${record.waitingFor ?? 'work'}`, budgetMs);
							controller.abort(error);
							reject(error);
						}, budgetMs);
					}),
					Promise.resolve().then(() =>
						work({
							signal: controller.signal,
							step: async (label, action) => {
								controller.signal.throwIfAborted();
								record.waitingFor = label;
								const value = await action();
								controller.signal.throwIfAborted();
								return value;
							},
						})
					),
				]);
				record.metrics = result ?? undefined;
				if (sample && result) Object.assign(sample.metrics, result);
				record.status = 'passed';
			}
		} catch (error) {
			record.status =
				error instanceof StageTimeout || (error instanceof Error && error.name === 'TimeoutError')
					? 'timedOut'
					: 'failed';
			record.error = error instanceof Error ? error.message : String(error);
			if (record.status === 'timedOut') {
				try {
					options.onTimeout?.();
				} catch (cleanupError) {
					record.error += `; termination failed: ${String(cleanupError)}`;
				}
			}
		} finally {
			clearTimeout(timer);
			controller.abort();
			record.durationMs = performance.now() - started;
			record.endedAt = new Date().toISOString();
			this.publish(record, 'END');
		}
		return record;
	}
	finish() {
		this.complete = true;
		this.checkpoint();
		const failures = this.stages.filter((stage) => stage.status !== 'passed');
		if (failures.length)
			throw Error(`${failures.length} benchmark stages failed or were blocked; see ${this.file}`);
	}
}
