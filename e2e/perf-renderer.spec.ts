import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
	test,
	expect,
	_electron as electron,
	type Page,
	type ElectronApplication,
} from '@playwright/test';
import { createNativeTempDir } from './fixtures/native/temp-root.cjs';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import { transcriptMessagesToLogEntries } from '../src/renderer/utils/transcriptMessages';
import { buildTraceConfig } from '../src/main/profiling/categories';
import { createCorpus, longMessages } from '../scripts/perf/fixtures.mjs';
import {
	RendererRun,
	rendererOptions,
	stageBudgets,
	type Metrics,
	type PerfSample,
	type RendererObservation,
	type StageName,
	type StageScope,
} from './fixtures/perf-renderer-runner';
import { collapseAiResponseLogs } from '../src/renderer/components/TerminalOutput/utils/collapseAiResponseLogs';
import { foldNativeToolRuns } from '../src/renderer/components/TerminalOutput/utils/foldNativeToolRuns';
import { groupSubagentToolLogs } from '../src/renderer/components/TerminalOutput/utils/groupSubagentToolLogs';
import { foldTurnActivity } from '../src/renderer/components/TerminalOutput/utils/foldTurnActivity';

// Never launch Electron, inspect accounts or invoke providers in the default suite.
test.skip(process.env.MAESTRO_E2E_PERF !== '1', 'Set MAESTRO_E2E_PERF=1 outside the sandbox');
test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Performance fixtures are synthetic only');

async function painted(page: Page) {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
}

async function observe(page: Page) {
	await page.evaluate(() => {
		const state = {
			frames: [] as RendererObservation['frames'],
			keyEvents: [] as RendererObservation['keyEvents'],
			onKey: undefined as ((event: KeyboardEvent) => void) | undefined,
			tasks: [] as { startTime: number; duration: number }[],
			startedAt: performance.now(),
			last: performance.now(),
			raf: 0,
			observer: undefined as PerformanceObserver | undefined,
		};
		const frame = (now: number) => {
			state.frames.push({ startMs: state.last - state.startedAt, durationMs: now - state.last });
			state.last = now;
			state.raf = requestAnimationFrame(frame);
		};
		state.raf = requestAnimationFrame(frame);
		state.onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Shift') return;
			const key: RendererObservation['keyEvents'][number] = {
				eventStartMs: event.timeStamp - state.startedAt,
				handledMs: performance.now() - state.startedAt,
				visibilityState: document.visibilityState,
				focused: document.hasFocus(),
			};
			state.keyEvents.push(key);
			requestAnimationFrame(() => {
				key.nextFrameMs = performance.now() - state.startedAt;
			});
		};
		document.addEventListener('keydown', state.onKey, true);
		state.observer = new PerformanceObserver((list) =>
			state.tasks.push(
				...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration }))
			)
		);
		state.observer.observe({ type: 'longtask', buffered: false });
		(window as unknown as { __perf: typeof state }).__perf = state;
	});
}

async function observed(page: Page) {
	return page.evaluate(() => {
		const state = (
			window as unknown as {
				__perf: {
					frames: RendererObservation['frames'];
					tasks: { startTime: number; duration: number }[];
					startedAt: number;
					raf: number;
					observer: PerformanceObserver;
					keyEvents: RendererObservation['keyEvents'];
					onKey: (event: KeyboardEvent) => void;
				};
			}
		).__perf;
		cancelAnimationFrame(state.raf);
		state.tasks.push(
			...state.observer.takeRecords().map(({ startTime, duration }) => ({ startTime, duration }))
		);
		state.observer.disconnect();
		document.removeEventListener('keydown', state.onKey, true);
		const keyDelays = state.keyEvents
			.map((key) => key.handledMs - key.eventStartMs)
			.sort((a, b) => a - b);
		const keyPaints = state.keyEvents
			.filter((key) => key.nextFrameMs !== undefined)
			.map((key) => key.nextFrameMs! - key.eventStartMs)
			.sort((a, b) => a - b);
		if (keyPaints.length !== keyDelays.length)
			throw Error('Key probe finished before every key reached its next frame');
		const frames = state.frames.map((frame) => frame.durationMs).sort((a, b) => a - b);
		return {
			keyEventCount: keyDelays.length,
			keyPaintCount: keyPaints.length,
			keyDelayP95Ms: keyDelays[Math.ceil(keyDelays.length * 0.95) - 1] ?? 0,
			keyDelayMaxMs: keyDelays.at(-1) ?? 0,
			keyNextFrameP95Ms: keyPaints[Math.ceil(keyPaints.length * 0.95) - 1] ?? 0,
			frameCount: frames.length,
			frameP95Ms: frames[Math.ceil(frames.length * 0.95) - 1] ?? 0,
			maxFrameMs: frames.at(-1) ?? 0,
			estimatedMissed60HzFrames: frames.reduce(
				(sum, ms) => sum + Math.max(0, Math.floor(ms / (1000 / 60)) - 1),
				0
			),
			longTaskCount: state.tasks.length,
			longTaskMs: state.tasks.reduce((sum, task) => sum + task.duration, 0),
			maxLongTaskMs: Math.max(0, ...state.tasks.map((task) => task.duration)),
			startedAt: state.startedAt,
			timeOrigin: performance.timeOrigin,
			keyEvents: state.keyEvents,
			frames: state.frames,
			longTasks: state.tasks.map((task) => ({
				startMs: task.startTime - state.startedAt,
				durationMs: task.duration,
			})),
		};
	});
}

// eslint-disable-next-line no-empty-pattern
test('renderer performance: startup stages, full backfill and isolated streaming', async ({}, info) => {
	const config = rendererOptions(process.env);
	const { rounds, startupTrace, interactionTrace } = config;
	const currentEntry = path.resolve(process.env.MAESTRO_PERF_ENTRY || 'dist/main/index.js');
	const variants = process.env.MAESTRO_PERF_BEFORE_ENTRY
		? [
				{ name: 'before', entry: path.resolve(process.env.MAESTRO_PERF_BEFORE_ENTRY) },
				{ name: 'after', entry: currentEntry },
			]
		: [{ name: 'baseline', entry: currentEntry }];
	// The sample cap includes all its stages. Cleanup has a separate allowance.
	const sampleLimits = { empty: 90_000, large: 180_000 };
	const timeoutMs =
		60_000 +
		rounds *
			variants.length *
			config.sizes.reduce((total, size) => total + sampleLimits[size] + stageBudgets.close, 0) +
		15_000 +
		60_000;
	test.setTimeout(timeoutMs);
	const root = createNativeTempDir('maestro-perf-e2e-');
	const builds: Array<Record<string, unknown>> = [];
	const run = new RendererRun(info.outputPath('perf-results.json'), {
		startupTrace,
		interactionTrace,
		rounds,
		diagnostic: config.diagnostic,
		requestedStages: config.requested,
		effectiveStages: [...config.stages],
		stageBudgets,
		sampleLimits,
		timeoutMs,
		variants: builds,
		cpu: os.cpus()[0]?.model,
		cpuCount: os.cpus().length,
		notes: [
			'Startup waits for splash removal and two frames. Timeline uses the process creation epoch.',
			'Traces and runs shorter than three rounds are diagnostic. Failed stages are excluded from metric summaries; inspect stages and each distribution n.',
			'Shift probes never insert text or submit a draft. rAF gaps and next-frame delays are proxies, not GPU present counters.',
			'Full canonical row IDs must match in order before scroll or isolated streaming. Backfill waits up to 120 seconds, subject to the remaining sample budget.',
			'A timed out transport poisons only its own sample; dependent stages are blocked and the next independent sample continues without retry.',
		],
	});
	let corpus!: Awaited<ReturnType<typeof createCorpus>>;
	try {
		const prepared = await run.stage(undefined, 'prepare', 60_000, async (scope) => {
			corpus = await scope.step('synthetic corpus', () => createCorpus(path.join(root, 'corpus')));
			fs.utimesSync(corpus.files[0].file, 1795000000, 1795000000);
			for (const variant of variants)
				builds.push({
					...variant,
					mainSha256: createHash('sha256').update(fs.readFileSync(variant.entry)).digest('hex'),
					buildFiles: ['main', 'renderer'].flatMap((part) => {
						const dir = path.resolve(path.dirname(variant.entry), '..', part);
						return fs
							.readdirSync(dir, { recursive: true })
							.map(String)
							.sort()
							.filter((file) => fs.statSync(path.join(dir, file)).isFile())
							.map((file) => ({
								path: `${part}/${file}`,
								sha256: createHash('sha256')
									.update(fs.readFileSync(path.join(dir, file)))
									.digest('hex'),
							}));
					}),
				});
		});
		if (prepared.status === 'passed') {
			for (let round = 0; round < rounds; round++)
				for (const variant of round % 2 ? [...variants].reverse() : variants)
					for (const size of config.sizes) {
						const data = path.join(root, `${variant.name}-${round}-${size}`);
						const isolatedHome = path.join(data, 'home');
						fs.mkdirSync(isolatedHome, { recursive: true });
						fs.writeFileSync(
							path.join(data, 'maestro-settings.json'),
							JSON.stringify({
								newShell: true,
								uiLanguage: 'en',
								typographyPromptSeen: true,
								themePromptSeen: true,
								updatesPromptSeen: true,
								agentPowersPromptSeen: true,
								tourCompleted: true,
								crashReportingEnabled: false,
								automaticTabNamingEnabled: false,
								defaultSaveToHistory: false,
								activeSessionId: 'perf-session',
							})
						);
						const accounts =
							size === 'large'
								? corpus.accounts
								: { codex: path.join(data, 'codex'), 'claude-code': path.join(data, 'claude') };
						for (const account of Object.values(accounts))
							fs.mkdirSync(account, { recursive: true });
						fs.writeFileSync(
							path.join(data, 'maestro-agent-configs.json'),
							JSON.stringify({
								configs: {
									'claude-code': {
										customPath: path.resolve('e2e/fixtures/native/claude'),
										customEnvVars: { CLAUDE_CONFIG_DIR: accounts['claude-code'] },
									},
									codex: {
										customPath: path.resolve('e2e/fixtures/native/codex'),
										customEnvVars: { CODEX_HOME: accounts.codex },
									},
								},
							})
						);
						const logs = transcriptMessagesToLogEntries(longMessages());
						const tabs = ['a', 'b'].map((id) =>
							createMockAITab({
								id,
								name: `Synthetic ${id}`,
								logs: logs.map((log) => ({
									...log,
									id: `${id}-${log.id}`,
									text: `${id}: ${log.text}`,
								})),
							})
						);
						if (size === 'large')
							fs.writeFileSync(
								path.join(data, 'maestro-sessions.json'),
								JSON.stringify({
									sessions: [
										createMockSession({
											id: 'perf-session',
											name: 'Synthetic project',
											cwd: corpus.projects[0],
											fullPath: corpus.projects[0],
											projectRoot: corpus.projects[0],
											customPath: path.resolve('e2e/fixtures/native/claude'),
											aiTabs: tabs,
											activeTabId: 'a',
										}),
									],
								})
							);
						let app: ElectronApplication | undefined;
						let page: Page;
						let poisoned = false;
						const sample: PerfSample = {
							variant: variant.name,
							round,
							size,
							metrics: {} as Metrics,
							loadBefore: os.loadavg(),
							loadAfter: [] as number[],
						};
						run.samples.push(sample);
						const started = performance.now();
						const completed = new Map<StageName, string>();
						const kill = () => {
							poisoned = true;
							// Only the child returned by this launch is eligible for termination.
							app?.process().kill('SIGKILL');
						};
						const stage = async (
							name: StageName,
							needs: StageName[],
							work: (scope: StageScope) => Promise<Metrics | void>
						) => {
							if (!config.stages.has(name) && name !== 'trace') return;
							const remaining = sampleLimits[size] - (performance.now() - started);
							const dependency = needs.find((need) => completed.get(need) !== 'passed');
							const result = await run.stage(
								sample,
								name,
								Math.max(1, Math.min(stageBudgets[name], remaining)),
								work,
								{
									blocked: poisoned
										? 'Electron transport timed out; sample terminated'
										: dependency
											? `Requires successful ${dependency}`
											: remaining <= 0
												? 'Sample time budget exhausted'
												: undefined,
									onTimeout: kill,
								}
							);
							completed.set(name, result.status);
						};
						const startupTracePath = info.outputPath(
							`${variant.name}-${round}-${size}-startup-trace.json`
						);
						try {
							await stage('startup', [], async (scope) => {
								// If launch resolves after its deadline, kill the late child before using it.
								app = await scope.step('electron.launch', async () => {
									const launched = await electron.launch({
										args: [
											variant.entry,
											...(process.platform === 'linux' ? ['--no-sandbox'] : []),
											...(startupTrace
												? [
														'--trace-startup',
														'--trace-startup-duration=5',
														'--trace-startup-format=json',
														`--trace-startup-file=${startupTracePath}`,
														`--trace-startup-categories=${buildTraceConfig().included_categories!.join(',')}`,
													]
												: []),
										],
										timeout: 30_000,
										env: {
											...process.env,
											MAESTRO_DEMO_DIR: data,
											MAESTRO_USER_DATA: data,
											NODE_ENV: 'test',
											HOME: isolatedHome,
											USERPROFILE: isolatedHome,
											CLAUDE_CONFIG_DIR: accounts['claude-code'],
											CLAUDE_SECURESTORAGE_CONFIG_DIR: accounts['claude-code'],
											CODEX_HOME: accounts.codex,
											XDG_CONFIG_HOME: path.join(data, 'config'),
											XDG_DATA_HOME: path.join(data, 'xdg'),
											XDG_CACHE_HOME: path.join(data, 'cache'),
											XDG_STATE_HOME: path.join(data, 'state'),
											COPILOT_HOME: path.join(data, 'copilot'),
											GROK_HOME: path.join(data, 'grok'),
											GROK_AUTH_PATH: path.join(data, 'grok', 'auth.json'),
											PI_CODING_AGENT_DIR: path.join(data, 'omp'),
											PI_CONFIG_DIR: path.join(data, 'pi'),
											OMP_PROFILE: '',
											PI_PROFILE: '',
											OPENCODE_CONFIG_DIR: path.join(data, 'opencode'),
											OPENCODE_CONFIG: '',
											OPENCODE_CONFIG_CONTENT: '{}',
											ELECTRON_DISABLE_GPU: '0',
										},
									});
									if (scope.signal.aborted) launched.process().kill('SIGKILL');
									return launched;
								});
								const createdAt = await scope.step('process creation time', () =>
									app!.evaluate(() => process.getCreationTime())
								);
								expect(createdAt).not.toBeNull();
								page = await scope.step('first window', () =>
									app!.firstWindow({ timeout: 30_000 })
								);
								page.setDefaultTimeout(30_000);
								if (size === 'empty')
									await scope.step('start screen', () =>
										expect(page.getByTestId('project-start')).toBeVisible({ timeout: 60_000 })
									);
								else
									await scope.step('persisted transcript', () =>
										expect(page.locator('[data-log-id]').last()).toContainText(
											'Synthetic message 4999',
											{ timeout: 60_000 }
										)
									);
								await scope.step('splash removal', () =>
									expect(page.locator('#initial-splash')).toHaveCount(0, { timeout: 60_000 })
								);
								await scope.step('startup two painted frames', () => painted(page));
								const metrics: Metrics = {
									[`${size}.startup.usable`]: {
										ms: Date.now() - createdAt!,
										launchToReadyMs: performance.now() - started,
									},
								};
								const mainStages = await scope.step('main timeline', () =>
									app!.evaluate(() =>
										Object.fromEntries(
											performance
												.getEntriesByType('mark')
												.filter((entry) => entry.name.startsWith('maestro:main.'))
												.map((entry) => [entry.name, performance.timeOrigin + entry.startTime])
										)
									)
								);
								const rendererStages = await scope.step('renderer timeline', () =>
									page.evaluate(() => {
										const marks = Object.fromEntries(
											performance
												.getEntriesByType('mark')
												.filter((entry) => entry.name.startsWith('maestro:renderer.'))
												.map((entry) => [entry.name, performance.timeOrigin + entry.startTime])
										);
										for (const entry of performance.getEntriesByType('paint'))
											marks[entry.name] = performance.timeOrigin + entry.startTime;
										return marks;
									})
								);
								metrics[`${size}.startup.timeline`] = Object.fromEntries(
									Object.entries({ ...mainStages, ...rendererStages }).map(([name, time]) => [
										name,
										time - createdAt!,
									])
								);
								if (size === 'empty') {
									await scope.step('project dialog fixture', () =>
										app!.evaluate(({ dialog }, project) => {
											dialog.showOpenDialog = async () => ({
												canceled: false,
												filePaths: [project],
											});
										}, corpus.projects[0])
									);
									await scope.step('open project', () =>
										page.getByRole('button', { name: 'Open project folder', exact: true }).click()
									);
								}
								await scope.step('editable input', () =>
									expect(page.getByPlaceholder(/^(Talking to |Message )/)).toBeEditable({
										timeout: 30_000,
									})
								);
								await scope.step('input two painted frames', () => painted(page));
								metrics[`${size}.startup.inputEditable`] = {
									ms: Date.now() - createdAt!,
									launchToReadyMs: performance.now() - started,
								};
								return metrics;
							});

							const measured = async (
								scope: StageScope,
								name: string,
								work: () => Promise<void>
							): Promise<Metrics> => {
								const cdp = await scope.step('CDP connection', () =>
									app!.context().newCDPSession(page)
								);
								let probing = false;
								let wakeProbe: (() => void) | undefined;
								let probe: Promise<void> | undefined;
								let tracing = false;
								let observing = false;
								const stopProbe = () => {
									probing = false;
									wakeProbe?.();
								};
								scope.signal.addEventListener('abort', stopProbe, { once: true });
								try {
									await scope.step('CDP enable', () => cdp.send('Performance.enable'));
									if (interactionTrace) {
										await scope.step('trace start', () =>
											app!.evaluate(
												({ contentTracing }, config) => contentTracing.startRecording(config),
												buildTraceConfig()
											)
										);
										tracing = true;
									}
									await scope.step('observe renderer', () => observe(page));
									observing = true;
									const before = await scope.step('CDP metrics before', () =>
										cdp.send('Performance.getMetrics')
									);
									const begin = performance.now();
									probing = true;
									// Shift produces a trusted event without inserting or submitting text.
									probe = (async () => {
										while (probing && !scope.signal.aborted) {
											await page.keyboard.press('Shift');
											if (probing && !scope.signal.aborted)
												await new Promise<void>((resolve) => {
													const timer = setTimeout(resolve, 100);
													wakeProbe = () => {
														clearTimeout(timer);
														resolve();
													};
												});
										}
									})();
									// Observe rejection immediately, then propagate it at drain time.
									void probe.catch(() => {});
									await scope.step(name, work);
									stopProbe();
									await scope.step('key probe drain', () => probe!);
									// A late key can arrive after work completes. Its next-frame callback
									// must settle before observations are summarized.
									await scope.step('two painted frames', () => painted(page));
									const ms = performance.now() - begin;
									const after = await scope.step('CDP metrics after', () =>
										cdp.send('Performance.getMetrics')
									);
									const mainMemory = await scope.step('main memory', () =>
										app!.evaluate(() => process.memoryUsage())
									);
									const value = (rows: typeof after, key: string) =>
										rows.metrics.find((metric) => metric.name === key)?.value ?? 0;
									const { longTasks, startedAt, timeOrigin, keyEvents, frames, ...observations } =
										await scope.step('renderer observations', async () => {
											const result = await observed(page);
											observing = false;
											return result;
										});
									(sample.observations ??= {})[name] = {
										longTasks,
										startedAt,
										timeOrigin,
										keyEvents,
										frames,
									};
									return {
										[name]: {
											ms,
											...observations,
											layoutMs:
												(value(after, 'LayoutDuration') - value(before, 'LayoutDuration')) * 1000,
											styleMs:
												(value(after, 'RecalcStyleDuration') -
													value(before, 'RecalcStyleDuration')) *
												1000,
											rendererTaskMs:
												(value(after, 'TaskDuration') - value(before, 'TaskDuration')) * 1000,
											scriptMs:
												(value(after, 'ScriptDuration') - value(before, 'ScriptDuration')) * 1000,
											heapBytes: value(after, 'JSHeapUsedSize'),
											mainHeapBytes: mainMemory.heapUsed,
											mainRssBytes: mainMemory.rss,
											nodes: value(after, 'Nodes'),
										},
									};
								} finally {
									stopProbe();
									scope.signal.removeEventListener('abort', stopProbe);
									if (!scope.signal.aborted) {
										await scope.step('key probe cleanup', async () => {
											await probe;
										});
										if (observing) await scope.step('observer cleanup', () => observed(page));
										if (tracing) {
											const buffer = await scope.step('trace buffer', () =>
												app!.evaluate(({ contentTracing }) => contentTracing.getTraceBufferUsage())
											);
											await scope.step('trace stop', () =>
												app!.evaluate(
													({ contentTracing }, file) => contentTracing.stopRecording(file),
													info.outputPath(`${variant.name}-${round}-${name}-trace.json`)
												)
											);
											expect(buffer.percentage).toBeLessThan(0.98);
										}
										await scope.step('CDP detach', () => cdp.detach());
									}
								}
							};
							if (size === 'large' && !startupTrace) {
								await stage('history', ['startup'], async (scope) => {
									const begin = performance.now();
									await scope.step('native history row', () =>
										expect(
											page.locator(
												`[data-conversation-kind="history"][data-conversation-key*="${corpus.files[0].id}"] [data-tree-nav]`
											)
										).toBeVisible({ timeout: 30_000 })
									);
									return { 'large.history.rowsReady': { ms: performance.now() - begin } };
								});
								await stage('native', ['history'], (scope) =>
									measured(scope, 'large.open.native50MiB.firstPaint', async () => {
										await scope.step('select native history', () =>
											page
												.locator(
													`[data-conversation-kind="history"][data-conversation-key*="${corpus.files[0].id}"] [data-tree-nav]`
												)
												.click()
										);
										await scope.step('native first paint', () =>
											expect(
												page
													.locator('.terminal-output')
													.getByText('Synthetic message 4997', { exact: true })
											).toBeVisible({ timeout: 60_000 })
										);
										await scope.step('native input', () =>
											expect(page.getByPlaceholder(/^(Talking to |Message )/)).toBeEditable({
												timeout: 30_000,
											})
										);
									})
								);
								await stage('switch', ['startup'], (scope) =>
									measured(scope, 'large.switch.5000', async () => {
										await scope.step('select tab b', () =>
											page.locator('[data-conversation-key$=":b"] [data-tree-nav]').click()
										);
										await scope.step('tab b first paint', () =>
											expect(page.locator('[data-log-id]').last()).toContainText(
												'b: Synthetic message 4999',
												{ timeout: 45_000 }
											)
										);
									})
								);
								await stage('backfill', ['switch'], (scope) =>
									measured(scope, 'large.backfill.remaining', async () => {
										await scope.step('oldest row attached', () =>
											expect(page.locator('[data-log-id="b-message-0"]')).toBeAttached({
												timeout: 120_000,
											})
										);
									})
								);
								await stage('ids', ['backfill'], async (scope) => {
									const ids = await scope.step('read all display IDs', () =>
										page
											.locator('[data-log-id]')
											.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-log-id')))
									);
									const expected = foldTurnActivity(
										groupSubagentToolLogs(
											foldNativeToolRuns(collapseAiResponseLogs(tabs[1].logs), true, true).logs
										).logs,
										{ keepLastTurnOpen: false }
									).logs.map((log) => log.id);
									// Exact equality, including duplicates and order, with bounded failure output.
									const mismatch = ids.findIndex((id, index) => id !== expected[index]);
									expect({
										count: ids.length,
										mismatch,
										actual: ids[mismatch],
										expected: expected[mismatch],
									}).toEqual({
										count: expected.length,
										mismatch: -1,
										actual: undefined,
										expected: undefined,
									});
									return { 'large.backfill.ids': { rows: ids.length } };
								});
								await stage('scroll', ['ids'], (scope) =>
									measured(scope, 'large.scroll', async () => {
										await scope.step('scroll animation', () =>
											page.evaluate(async () => {
												const container = document.querySelector(
													'.terminal-output .overflow-y-auto'
												);
												if (!container) throw Error('Transcript scroll container missing');
												const start = performance.now();
												await new Promise<void>((resolve) => {
													const scroll = () => {
														container.scrollTop -= 80;
														if (performance.now() - start < 2000) requestAnimationFrame(scroll);
														else resolve();
													};
													requestAnimationFrame(scroll);
												});
											})
										);
									})
								);
								await stage('stream', ['ids'], async (scope) => {
									await scope.step('scroll to bottom', () =>
										page.evaluate(() => {
											const container = document.querySelector('.terminal-output .overflow-y-auto');
											if (!container) throw Error('Transcript scroll container missing');
											container.scrollTop = container.scrollHeight;
										})
									);
									await scope.step('scroll painted', () => painted(page));
									return measured(scope, 'large.stream.100Hz', async () => {
										await scope.step('inject synthetic stream', () =>
											app!.evaluate(async ({ BrowserWindow }) => {
												const web = BrowserWindow.getAllWindows().find(
													(window) => !window.isDestroyed()
												)!.webContents;
												for (let i = 0; i < 300; i++) {
													web.send('process:data', 'perf-session-ai-b', ` stream-${i}`);
													await new Promise((resolve) => setTimeout(resolve, 10));
												}
											})
										);
										await scope.step('stream tail', () =>
											expect(page.locator('.terminal-output')).toContainText('stream-299', {
												timeout: 15_000,
											})
										);
									});
								});
							}
							if (startupTrace)
								await stage('trace', ['startup'], async (scope) => {
									await scope.step('startup trace file', () =>
										expect
											.poll(
												() =>
													fs.existsSync(startupTracePath) && fs.statSync(startupTracePath).size > 0,
												{ timeout: 15_000 }
											)
											.toBe(true)
									);
								});
						} finally {
							sample.loadAfter = os.loadavg();
							await run.stage(
								sample,
								'close',
								stageBudgets.close,
								async (scope) => {
									await scope.step('electron.close', async () => {
										try {
											await app?.close();
										} catch (error) {
											kill();
											throw error;
										}
									});
								},
								{ onTimeout: kill }
							);
						}
					}
		}
	} finally {
		await run.stage(undefined, 'cleanup', 15_000, async (scope) => {
			await scope.step('remove synthetic data', () =>
				fs.promises.rm(root, { recursive: true, force: true })
			);
		});
	}
	run.finish();
});
