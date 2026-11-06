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
import { summarize } from '../scripts/perf/summary.mjs';
import { collapseAiResponseLogs } from '../src/renderer/components/TerminalOutput/utils/collapseAiResponseLogs';
import { foldNativeToolRuns } from '../src/renderer/components/TerminalOutput/utils/foldNativeToolRuns';
import { groupSubagentToolLogs } from '../src/renderer/components/TerminalOutput/utils/groupSubagentToolLogs';
import { foldTurnActivity } from '../src/renderer/components/TerminalOutput/utils/foldTurnActivity';

// Never launch Electron, inspect accounts or invoke providers in the default suite.
test.skip(process.env.MAESTRO_E2E_PERF !== '1', 'Set MAESTRO_E2E_PERF=1 outside the sandbox');
test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Performance fixtures are synthetic only');
test.setTimeout(900_000);

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
			frames: [] as number[],
			keyDelays: [] as number[],
			keyPaints: [] as number[],
			onKey: undefined as ((event: KeyboardEvent) => void) | undefined,
			tasks: [] as number[],
			last: performance.now(),
			raf: 0,
			observer: undefined as PerformanceObserver | undefined,
		};
		const frame = (now: number) => {
			state.frames.push(now - state.last);
			state.last = now;
			state.raf = requestAnimationFrame(frame);
		};
		state.raf = requestAnimationFrame(frame);
		state.onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Shift') return;
			state.keyDelays.push(performance.now() - event.timeStamp);
			requestAnimationFrame(() => state.keyPaints.push(performance.now() - event.timeStamp));
		};
		document.addEventListener('keydown', state.onKey, true);
		state.observer = new PerformanceObserver((list) =>
			state.tasks.push(...list.getEntries().map((entry) => entry.duration))
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
					frames: number[];
					tasks: number[];
					raf: number;
					observer: PerformanceObserver;
					keyDelays: number[];
					keyPaints: number[];
					onKey: (event: KeyboardEvent) => void;
				};
			}
		).__perf;
		cancelAnimationFrame(state.raf);
		state.tasks.push(...state.observer.takeRecords().map((entry) => entry.duration));
		state.observer.disconnect();
		document.removeEventListener('keydown', state.onKey, true);
		state.keyDelays.sort((a, b) => a - b);
		state.keyPaints.sort((a, b) => a - b);
		const frames = state.frames.sort((a, b) => a - b);
		return {
			keyEventCount: state.keyDelays.length,
			keyDelayP95Ms: state.keyDelays[Math.ceil(state.keyDelays.length * 0.95) - 1] ?? 0,
			keyDelayMaxMs: state.keyDelays.at(-1) ?? 0,
			keyNextFrameP95Ms: state.keyPaints[Math.ceil(state.keyPaints.length * 0.95) - 1] ?? 0,
			frameCount: frames.length,
			frameP95Ms: frames[Math.ceil(frames.length * 0.95) - 1] ?? 0,
			maxFrameMs: frames.at(-1) ?? 0,
			estimatedMissed60HzFrames: frames.reduce(
				(sum, ms) => sum + Math.max(0, Math.floor(ms / (1000 / 60)) - 1),
				0
			),
			longTaskCount: state.tasks.length,
			longTaskMs: state.tasks.reduce((a, b) => a + b, 0),
			maxLongTaskMs: Math.max(0, ...state.tasks),
		};
	});
}

// eslint-disable-next-line no-empty-pattern
test('renderer performance: startup stages, full backfill and isolated streaming', async ({}, info) => {
	const rounds = Number(process.env.MAESTRO_PERF_ROUNDS || 5);
	const startupTrace = process.env.MAESTRO_PERF_STARTUP_TRACE === '1';
	const interactionTrace = process.env.MAESTRO_PERF_TRACE === '1';
	expect(startupTrace && interactionTrace).toBe(false);
	expect(Number.isInteger(rounds) && rounds >= 3).toBe(true);
	const variants = process.env.MAESTRO_PERF_BEFORE_ENTRY
		? [
				{ name: 'before', entry: path.resolve(process.env.MAESTRO_PERF_BEFORE_ENTRY) },
				{ name: 'after', entry: path.resolve('dist/main/index.js') },
			]
		: [{ name: 'baseline', entry: path.resolve('dist/main/index.js') }];
	const root = createNativeTempDir('maestro-perf-e2e-');
	const corpus = await createCorpus(path.join(root, 'corpus'));
	// Put the large native conversation inside the sidebar's initial history window.
	fs.utimesSync(corpus.files[0].file, 1795000000, 1795000000);
	const samples: Array<{
		variant: string;
		round: number;
		metrics: Record<string, Record<string, number>>;
		loadBefore: number[];
		loadAfter: number[];
	}> = [];
	try {
		for (let round = 0; round < rounds; round++)
			for (const variant of round % 2 ? [...variants].reverse() : variants)
				for (const size of ['empty', 'large']) {
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
					for (const account of Object.values(accounts)) fs.mkdirSync(account, { recursive: true });
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
					const metrics: Record<string, Record<string, number>> = {};
					const loadBefore = os.loadavg();
					const started = performance.now();
					try {
						const startupTracePath = info.outputPath(
							`${variant.name}-${round}-${size}-startup-trace.json`
						);
						app = await electron.launch({
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
						const createdAt = await app.evaluate(() => process.getCreationTime());
						expect(createdAt).not.toBeNull();
						const page = await app.firstWindow();
						const input = page.getByPlaceholder(/^(Talking to |Message )/);
						if (size === 'empty') await expect(page.getByTestId('project-start')).toBeVisible();
						else
							await expect(page.locator('[data-log-id]').last()).toContainText(
								'Synthetic message 4999'
							);
						await expect(page.locator('#initial-splash')).toHaveCount(0);
						await painted(page);
						metrics[`${size}.startup.usable`] = {
							ms: Date.now() - createdAt!,
							launchToReadyMs: performance.now() - started,
						};
						const mainStages = await app.evaluate(() =>
							Object.fromEntries(
								performance
									.getEntriesByType('mark')
									.filter((entry) => entry.name.startsWith('maestro:main.'))
									.map((entry) => [entry.name, performance.timeOrigin + entry.startTime])
							)
						);
						const rendererStages = await page.evaluate(() => {
							const marks = Object.fromEntries(
								performance
									.getEntriesByType('mark')
									.filter((entry) => entry.name.startsWith('maestro:renderer.'))
									.map((entry) => [entry.name, performance.timeOrigin + entry.startTime])
							);
							for (const entry of performance.getEntriesByType('paint'))
								marks[entry.name] = performance.timeOrigin + entry.startTime;
							return marks;
						});
						metrics[`${size}.startup.timeline`] = Object.fromEntries(
							Object.entries({ ...mainStages, ...rendererStages }).map(([name, time]) => [
								name,
								time - createdAt!,
							])
						);
						if (size === 'empty') {
							await app.evaluate(({ dialog }, project) => {
								dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
							}, corpus.projects[0]);
							await page.getByRole('button', { name: 'Open project folder', exact: true }).click();
						}
						// Readiness only: do not type or submit any prompt.
						await expect(input).toBeEditable();
						await painted(page);
						metrics[`${size}.startup.inputEditable`] = {
							ms: Date.now() - createdAt!,
							launchToReadyMs: performance.now() - started,
						};
						if (size === 'large' && !startupTrace) {
							const cdp = await app.context().newCDPSession(page);
							await cdp.send('Performance.enable');
							const phase = async (name: string, work: () => Promise<void>) => {
								if (interactionTrace)
									await app!.evaluate(
										({ contentTracing }, config) => contentTracing.startRecording(config),
										buildTraceConfig()
									);
								await observe(page);
								const before = await cdp.send('Performance.getMetrics');
								const begin = performance.now();
								let probing = true;
								let wakeProbe: (() => void) | undefined;
								// Shift produces a trusted key event without changing or submitting a draft.
								const probe = (async () => {
									while (probing) {
										await page.keyboard.press('Shift');
										if (probing)
											await new Promise<void>((resolve) => {
												const timer = setTimeout(resolve, 100);
												wakeProbe = () => {
													clearTimeout(timer);
													resolve();
												};
											});
									}
								})();
								try {
									await work();
									await painted(page);
								} finally {
									probing = false;
									wakeProbe?.();
									await probe;
								}
								const workEnd = performance.now();
								const ms = workEnd - begin;
								const after = await cdp.send('Performance.getMetrics');
								const mainMemory = await app!.evaluate(() => process.memoryUsage());
								const value = (rows: typeof after, key: string) =>
									rows.metrics.find((metric) => metric.name === key)?.value ?? 0;
								metrics[name] = {
									ms,
									...(await observed(page)),
									rendererTaskMs:
										(value(after, 'TaskDuration') - value(before, 'TaskDuration')) * 1000,
									scriptMs:
										(value(after, 'ScriptDuration') - value(before, 'ScriptDuration')) * 1000,
									heapBytes: value(after, 'JSHeapUsedSize'),
									mainHeapBytes: mainMemory.heapUsed,
									mainRssBytes: mainMemory.rss,
									nodes: value(after, 'Nodes'),
								};
								if (interactionTrace) {
									const buffer = await app!.evaluate(({ contentTracing }) =>
										contentTracing.getTraceBufferUsage()
									);
									await app!.evaluate(
										({ contentTracing }, file) => contentTracing.stopRecording(file),
										info.outputPath(`${variant.name}-${round}-${name}-trace.json`)
									);
									expect(buffer.percentage).toBeLessThan(0.98);
								}
							};
							const nativeRow = page.locator(
								`[data-conversation-kind="history"][data-conversation-key*="${corpus.files[0].id}"] [data-tree-nav]`
							);
							const historyStart = performance.now();
							await expect(nativeRow).toBeVisible();
							metrics['large.history.rowsReady'] = { ms: performance.now() - historyStart };
							await phase('large.open.native50MiB.firstPaint', async () => {
								await nativeRow.click();
								await expect(
									page
										.locator('.terminal-output')
										.getByText('Synthetic message 4997', { exact: true })
								).toBeVisible();
								await expect(input).toBeEditable();
							});
							await phase('large.switch.5000', async () => {
								await page.locator('[data-conversation-key$=":b"] [data-tree-nav]').click();
								await expect(page.locator('[data-log-id]').last()).toContainText(
									'b: Synthetic message 4999'
								);
							});
							await phase('large.backfill.remaining', async () => {
								await expect(page.locator('[data-log-id="b-message-0"]')).toBeAttached({
									timeout: 120_000,
								});
							});
							const ids = await page
								.locator('[data-log-id]')
								.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-log-id')));
							// Stored tool calls and intermediate messages fold into their host row.
							// Compare the entire canonical projection, not just the newest or oldest row.
							const expectedRows = foldTurnActivity(
								groupSubagentToolLogs(
									foldNativeToolRuns(collapseAiResponseLogs(tabs[1].logs), true, true).logs
								).logs,
								{ keepLastTurnOpen: false }
							).logs;
							expect(ids).toEqual(expectedRows.map((log) => log.id));
							await phase('large.scroll', async () => {
								await page.evaluate(async () => {
									const container = document.querySelector('.terminal-output .overflow-y-auto');
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
								});
							});
							await page.evaluate(() => {
								const container = document.querySelector('.terminal-output .overflow-y-auto');
								if (!container) throw Error('Transcript scroll container missing');
								container.scrollTop = container.scrollHeight;
							});
							await painted(page);
							await phase('large.stream.100Hz', async () => {
								await app!.evaluate(async ({ BrowserWindow }) => {
									const web = BrowserWindow.getAllWindows().find(
										(w) => !w.isDestroyed()
									)!.webContents;
									for (let i = 0; i < 300; i++) {
										web.send('process:data', 'perf-session-ai-b', ` stream-${i}`);
										await new Promise((resolve) => setTimeout(resolve, 10));
									}
								});
								await expect(page.locator('.terminal-output')).toContainText('stream-299');
							});
							await cdp.detach();
						}
						if (startupTrace)
							await expect
								.poll(
									() => fs.existsSync(startupTracePath) && fs.statSync(startupTracePath).size > 0,
									{ timeout: 15_000 }
								)
								.toBe(true);
						samples.push({
							variant: variant.name,
							round,
							metrics,
							loadBefore,
							loadAfter: os.loadavg(),
						});
					} finally {
						await app?.close();
					}
				}
		fs.writeFileSync(
			info.outputPath('perf-results.json'),
			JSON.stringify(
				{
					schema: 2,
					startupTrace,
					interactionTrace,
					rounds,
					variants: variants.map((v) => ({
						...v,
						mainSha256: createHash('sha256').update(fs.readFileSync(v.entry)).digest('hex'),
						// Entry JS can be identical while its storage dependencies or renderer differ.
						buildFiles: ['main', 'renderer'].flatMap((part) => {
							const root = path.resolve(path.dirname(v.entry), '..', part);
							return fs
								.readdirSync(root, { recursive: true })
								.map(String)
								.sort()
								.filter((file) => fs.statSync(path.join(root, file)).isFile())
								.map((file) => ({
									path: `${part}/${file}`,
									sha256: createHash('sha256')
										.update(fs.readFileSync(path.join(root, file)))
										.digest('hex'),
								}));
						}),
					})),
					cpu: os.cpus()[0].model,
					cpuCount: os.cpus().length,
					samples,
					summary: summarize(samples),
					notes: [
						'Startup usable waits for splash removal and two frames, measured from process.getCreationTime. Timeline entries are milliseconds from the same process epoch.',
						'Startup trace mode runs separately. Document to modulesReady includes script transfer, parse and evaluation; only a trace can separate their CPU costs.',
						'Key latency probes press only Shift, never text or Enter. Event delay and next animation frame are response proxies, not draft insertion or GPU present latency.',
						'Streaming starts after the complete 5000-message display projection exists. Backfill remaining starts immediately after the first switch paint. Do not compare it to the old overlapping measurement.',
						'Empty input readiness includes opening a project after the start screen.',
						'Streaming injects synthetic process:data events into the real preload and batcher, without spawning a provider.',
						'Native firstPaint measures sidebar selection through visible transcript and editable input; startup/switch use the persisted 5000-message view. Full backfill validates every canonical displayed row ID in order, including folded activity hosts.',
						'Frames are rAF gaps at a 60 Hz reference, not GPU present counters.',
					],
				},
				null,
				'\t'
			)
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
