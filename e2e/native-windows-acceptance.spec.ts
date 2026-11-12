import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createTurn } from './fixtures/native/protocol.cjs';
import { formatCount, formatTokensCompact } from '../src/shared/formatters';
import type { Session } from '../src/renderer/types';

// Skip before constructing NativeApp: these checks must never prepare real credentials.
base.skip(process.env.MAESTRO_E2E_REAL === '1', 'Q3 uses temporary synthetic accounts only');
const test = base.extend<{ native: NativeApp }>({
	// Each test gets an explicit CLASSIC seed, independent of the shipped default.
	// The test starts it after preparing its own native records or scripts.
	// eslint-disable-next-line no-empty-pattern
	native: async ({}, use, info) => {
		const native = new NativeApp(info, { providerCli: false });
		const settings = path.join(native.data, 'maestro-settings.json');
		fs.writeFileSync(
			settings,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settings, 'utf8')),
				newShell: false,
				defaultSaveToHistory: false,
				crashReportingEnabled: false,
			})
		);
		try {
			await use(native);
		} finally {
			try {
				if (
					native.app &&
					native.app.process().exitCode === null &&
					native.app.process().signalCode === null
				)
					await native.close(info.status !== info.expectedStatus);
			} finally {
				fs.rmSync(native.root, { recursive: true, force: true });
			}
		}
	},
});
test.setTimeout(180_000);

function savedSessions(native: NativeApp): Session[] {
	return JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8'))
		.sessions;
}

for (const mode of [
	{ id: 'title', label: 'Title Only', placeholder: 'Search titles...' },
	{ id: 'user', label: 'My Messages', placeholder: 'Search your messages...' },
	{ id: 'assistant', label: 'AI Responses', placeholder: 'Search AI responses...' },
] as const) {
	test(`C6 classic: ${mode.id} search matrix, preview and resume follow both selected accounts`, async ({
		native,
	}) => {
		const homes = [native.codex, path.join(native.root, 'second-codex')];
		const fallbackHome = path.join(native.syntheticHome, '.codex');
		const records = homes.map((home, index) => {
			const account = `account-${index}`;
			const turn = createTurn({
				provider: 'codex',
				configDir: home,
				cwd: native.project,
				prompt: `${account} opener`,
			});
			// Codex uses its FIRST assistant response as the list title. Keep the
			// later user/assistant needles out of that title, and out of each other.
			turn.finish(`${account} title-needle`);
			const later = createTurn({
				provider: 'codex',
				configDir: home,
				cwd: native.project,
				id: turn.id,
				prompt: `${account} user-needle`,
			});
			later.finish(`${account} assistant-needle`);
			// Identical UUID under the process-default account is a preview/resume trap.
			const fallback = createTurn({
				provider: 'codex',
				configDir: fallbackHome,
				cwd: native.project,
				id: turn.id,
				prompt: `fallback-${account} opener`,
			});
			fallback.finish(`fallback-${account} title-needle`);
			createTurn({
				provider: 'codex',
				configDir: fallbackHome,
				cwd: native.project,
				id: turn.id,
				prompt: `fallback-${account} user-needle`,
			}).finish(`fallback-${account} assistant-needle`);
			return { ...turn, account, home, before: fs.readFileSync(turn.file), fallback };
		});
		const fallbackBytes = records.map(({ fallback }) => fs.readFileSync(fallback.file));
		native.scriptTurns([{ answer: 'Resumed in the selected account.' }]);
		await native.start(undefined, { CODEX_HOME: fallbackHome });
		const agents: string[] = [];
		for (const home of homes)
			agents.push(await native.createAgent('codex', { env: { CODEX_HOME: home } }));

		for (const [index, record] of records.entries()) {
			const accountBytes = records.map((other) => fs.readFileSync(other.file));
			await native.cli('focus-agent', agents[index]);
			await native.input().press('ControlOrMeta+Shift+L');
			await native.page
				.getByTestId('session-search-filters')
				.getByRole('button', { name: /^(All|title|user|assistant)$/ })
				.click();
			await native.page.getByRole('button', { name: new RegExp(`^${mode.label}`) }).click();
			const search = native.page.getByPlaceholder(mode.placeholder, { exact: true });
			const rows = native.page.getByTitle('Resume session in new tab', { exact: true });
			const query = async (text: string) => {
				await search.fill(text);
				if (mode.id !== 'title')
					await expect(search.locator('..').getByRole('status')).toBeVisible();
				await expect(search.locator('..').getByRole('button')).toHaveCount(1);
			};
			for (const field of ['title', 'user', 'assistant'] as const) {
				await test.step(`${record.account}: ${mode.id} x ${field}`, async () => {
					await query(`${record.account} ${field}-needle`);
					// The search bar replaces its spinner with the clear button only
					// after the backend result, avoiding assertions on the old list.
					const matches = mode.id === field || (mode.id === 'assistant' && field === 'title');
					await expect(rows).toHaveCount(matches ? 1 : 0);
					if (matches) {
						await expect(rows.locator('..')).toContainText(`${record.account} title-needle`);
					} else {
						await expect(
							native.page.getByText('No sessions match your search', { exact: true })
						).toBeVisible();
					}
				});
			}
			for (const foreign of [`fallback-${record.account}`, records[1 - index].account]) {
				await query(`${foreign} ${mode.id}-needle`);
				await expect(rows).toHaveCount(0);
				await expect(
					native.page.getByText('No sessions match your search', { exact: true })
				).toBeVisible();
			}
			await query(`${record.account} ${mode.id}-needle`);
			await expect(rows).toHaveCount(1);
			await search.press('Enter');
			await expect(
				native.page.getByText(`${record.account} assistant-needle`, { exact: true })
			).toBeVisible();
			await expect(
				native.page.getByText(`fallback-${record.account} assistant-needle`, { exact: true })
			).toHaveCount(0);
			await native.page.getByRole('button', { name: 'Resume', exact: true }).click();
			await expect(native.output()).toContainText(`${record.account} assistant-needle`);
			expect(fs.readFileSync(record.file)).toEqual(record.before);
			await native.send('Continue this account after the preview');
			await expect(
				native.output().getByText('Resumed in the selected account.', { exact: true })
			).toBeVisible();
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			await expect
				.poll(
					async () =>
						(await native.cli('tab', 'show', 'active', '--agent', agents[index])).tab.agentSessionId
				)
				.toBe(record.id);
			expect(native.files('codex', record.home)).toEqual([record.file]);
			expect(fs.readFileSync(record.file).subarray(0, record.before.length)).toEqual(record.before);
			expect(fs.readFileSync(record.file, 'utf8')).toContain(
				'Continue this account after the preview'
			);
			for (const [otherIndex, other] of records.entries()) {
				expect(fs.readFileSync(other.fallback.file)).toEqual(fallbackBytes[otherIndex]);
				if (otherIndex !== index)
					expect(fs.readFileSync(other.file)).toEqual(accountBytes[otherIndex]);
			}
		}
	});
}

const providers = [
	{ id: 'claude-code', cli: 'claude', label: 'Claude Code', name: 'Native claude' },
	{ id: 'codex', cli: 'codex', label: 'Codex', name: 'Native codex' },
	{ id: 'deepseek', cli: 'claude', label: 'DeepSeek', name: 'Native deepseek' },
] as const;
// The classic tab menu lives on the tab strip, which the agents layout draws.
// The default conversation layout has no tab strip, and its row menu keeps the
// classic actions without hand off (asserted in ProjectSessionTree.test.tsx).
for (const entry of ['agents tab menu', 'command palette'] as const) {
	for (const from of providers) {
		for (const to of providers.filter((provider) => provider.id !== from.id)) {
			test(`F3 classic: ${entry} ${from.id} to ${to.id} explains and edits an unsent draft`, async ({
				native,
			}) => {
				if (entry === 'agents tab menu') {
					const settingsFile = path.join(native.data, 'maestro-settings.json');
					fs.writeFileSync(
						settingsFile,
						JSON.stringify({
							...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
							sidebarNavigationMode: 'agents',
						})
					);
				}
				await native.start();
				const browserWindow = await native.app.browserWindow(native.page);
				await browserWindow.evaluate((window) => window.setContentSize(1800, 1000));
				await native.page.evaluate(() => window.maestro.logger.setLogLevel('debug'));
				const targetId = await native.createAgent(
					to.cli,
					to.id === 'deepseek' ? { preset: 'deepseek' } : {}
				);
				const sourceId = await native.createAgent(
					from.cli,
					from.id === 'deepseek' ? { preset: 'deepseek' } : {}
				);
				const longAnswer = `${'Earlier context. '.repeat(2600)}Keep this final source sentence.`;
				native.scriptTurns([{ answer: 'First source answer.' }, { answer: longAnswer }]);
				await native.send('First source question.');
				await expect(
					native.output().getByText('First source answer.', { exact: true })
				).toBeVisible();
				await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
				await native.send('Last source question.');
				await expect(native.output()).toContainText('Keep this final source sentence.');
				await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
				await native.input().fill('Keep the original unsent draft.');
				await native.input().blur();
				await expect
					.poll(() => savedSessions(native).find((s) => s.id === sourceId)?.aiTabs[0].inputValue)
					.toBe('Keep the original unsent draft.');
				const source = savedSessions(native).find((s) => s.id === sourceId)!;
				const sourceTab = source.aiTabs.find((tab) => tab.id === source.activeTabId)!;
				const target = savedSessions(native).find((s) => s.id === targetId)!;
				const sourceHome =
					from.cli === 'codex' ? native.codex : source.customEnvVars!.CLAUDE_CONFIG_DIR;
				const targetHome =
					to.cli === 'codex' ? native.codex : target.customEnvVars!.CLAUDE_CONFIG_DIR;
				const sourceFile = await native.oneTranscript(from.cli, sourceHome);
				const sourceBytes = fs.readFileSync(sourceFile);
				const invocationFile = path.join(sourceHome, 'fixture-invocations.jsonl');
				const invocations = fs.readFileSync(invocationFile);
				const modelSpawns = () =>
					native.page.evaluate(async () =>
						(await window.maestro.logger.getLogs({ context: 'ProcessManager' })).filter(
							(entry) => entry.message === '[ProcessManager] About to spawn child process'
						)
					);
				const spawnsBefore = await modelSpawns();
				expect(spawnsBefore).toHaveLength(2);
				expect(native.files(to.cli, targetHome)).toEqual([]);
				expect(
					(await native.page.evaluate(() => window.maestro.process.getActiveProcesses())).filter(
						(process) => !process.isTerminal
					)
				).toEqual([]);

				if (entry === 'agents tab menu') {
					await native.page.locator(`[role="tab"][data-tab-id="${sourceTab.id}"]`).hover();
					await native.page
						.getByRole('button', { name: 'Continue with another AI…', exact: true })
						.click();
				} else {
					await native.page.keyboard.press('ControlOrMeta+k');
					await native.page.keyboard.type('Continue with Another AI');
					await native.page.keyboard.press('Enter');
				}
				const dialog = native.page.getByTestId('ai-handoff-modal');
				const targetRadio = dialog.getByRole('radio', { name: new RegExp(`^${to.label}`) });
				await targetRadio.locator('..').click();
				await expect(targetRadio).toBeChecked();
				await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
				await expect(dialog).toHaveCount(0);
				await expect(native.input()).toHaveAttribute(
					'placeholder',
					new RegExp(`^Talking to ${to.name}`)
				);
				const text = await native.input().inputValue();
				const note = native.page.getByTestId('handoff-draft-bar');
				await expect(note).toBeVisible();
				await expect
					.poll(() =>
						savedSessions(native)
							.find((s) => s.id === targetId)!
							.aiTabs.some((tab) => tab.inputValue === text)
					)
					.toBe(true);
				const draft = savedSessions(native)
					.find((s) => s.id === targetId)!
					.aiTabs.find((tab) => tab.inputValue === text)!;
				expect(draft.id).not.toBe(sourceTab.id);
				expect(draft).toMatchObject({
					agentSessionId: null,
					logs: [],
					handoffDraft: {
						sourceAgentId: sourceId,
						sourceName: from.name,
						sourceProvider: from.id,
						budgetTokens: 8000,
						omittedEntries: 3,
					},
				});
				// Independently count the retained tail, rather than trusting the note's own metadata.
				const retained = text.split('Assistant:\n')[1];
				expect(longAnswer.endsWith(retained)).toBe(true);
				const cut = longAnswer.length - retained.length;
				expect(cut).toBeGreaterThan(0);
				expect(draft.handoffDraft!.omittedCharacters).toBe(cut);
				expect(draft.handoffDraft!.estimatedTokens).toBe(Math.ceil(text.length / 4));
				await expect(note).toContainText(`from ${from.name} (${from.label})`);
				await expect(note).toContainText(
					`~${formatTokensCompact(Math.ceil(text.length / 4))} tokens`
				);
				await expect(note).toContainText('3 earlier entries left out');
				await expect(note).toContainText(
					`${formatCount(cut)} characters cut from the oldest entry`
				);
				expect(
					await note
						.locator('span.truncate')
						.evaluate((element) => element.scrollWidth <= element.clientWidth)
				).toBe(true);
				const noteBounds = (await note.boundingBox())!;
				expect(noteBounds.y + noteBounds.height).toBeLessThanOrEqual(
					(await native.input().boundingBox())!.y
				);
				const edited = text.replace(
					'Keep this final source sentence.',
					'Use this edited instruction instead.'
				);
				await native.input().fill(edited);
				// Snapshot disk, live processes, and the source tab after inspecting AND editing.
				expect(await modelSpawns()).toEqual(spawnsBefore);
				expect(fs.readFileSync(invocationFile)).toEqual(invocations);
				expect(fs.existsSync(path.join(targetHome, 'fixture-invocations.jsonl'))).toBe(false);
				expect(native.files(to.cli, targetHome)).toEqual([]);
				expect(
					(await native.page.evaluate(() => window.maestro.process.getActiveProcesses())).filter(
						(process) => !process.isTerminal
					)
				).toEqual([]);
				expect(
					savedSessions(native)
						.find((s) => s.id === sourceId)!
						.aiTabs.find((tab) => tab.id === sourceTab.id)
				).toMatchObject({
					logs: sourceTab.logs,
					inputValue: sourceTab.inputValue,
					agentSessionId: sourceTab.agentSessionId,
				});
				fs.writeFileSync(
					native.script,
					JSON.stringify({ scene: { answer: 'Edited handoff completed.' } })
				);
				await native.input().press('Enter');
				await expect(
					native.output().getByText('Edited handoff completed.', { exact: true })
				).toBeVisible();
				await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
				await expect(note).toHaveCount(0);
				const targetFile = await native.oneTranscript(to.cli, targetHome);
				const targetBytes = fs.readFileSync(targetFile, 'utf8');
				expect(targetBytes).toContain(JSON.stringify(edited).slice(1, -1));
				expect(targetBytes).toContain('Use this edited instruction instead.');
				expect(targetBytes).not.toContain('Keep this final source sentence.');
				expect(fs.readFileSync(sourceFile)).toEqual(sourceBytes);
				await native.cli('focus-agent', sourceId, '--tab', sourceTab.id);
				await expect(native.input()).toHaveValue('Keep the original unsent draft.');
				await expect(native.output()).toContainText('Keep this final source sentence.');
				expect(
					savedSessions(native)
						.find((s) => s.id === sourceId)!
						.aiTabs.find((tab) => tab.id === sourceTab.id)!.logs
				).toEqual(sourceTab.logs);
			});
		}
	}
}

async function twoWindows(native: NativeApp) {
	await native.start();
	const owners = [];
	for (const name of ['main', 'secondary']) {
		const script = path.join(native.root, `${name}.json`);
		const gate = path.join(native.root, `${name}.gate`);
		const answer = `Complete ${name} answer immediately before quit.`;
		fs.writeFileSync(
			script,
			JSON.stringify({
				scene: {
					answer,
					tools: [
						{
							id: `${name}-hold`,
							command: 'printf held',
							output: 'held',
							updates: ['waiting'],
							gates: [gate],
						},
					],
					toolDelay: 0,
				},
			})
		);
		const id = await native.createAgent('claude', { env: { MAESTRO_NATIVE_SCRIPT: script } });
		owners.push({ id, gate, answer, draft: `Latest ${name} unsent draft`, name });
	}
	const mainId = (await native.page.evaluate(() => window.maestro.windows.list())).find(
		(window) => window.isMain
	)!.id;
	const opened = native.app.waitForEvent('window');
	const created = await native.page.evaluate(
		(id) => window.maestro.windows.create([id]),
		owners[1].id
	);
	expect(created).not.toBeNull();
	const second = await opened;
	await second.waitForLoadState('domcontentloaded');
	await native.page.evaluate(
		({ id, from, to }) => window.maestro.windows.moveSession(id, from, to),
		{ id: owners[1].id, from: mainId, to: created!.id }
	);
	await native.cli('focus-agent', owners[0].id);
	await expect(native.input()).toBeVisible();
	await expect(second.getByPlaceholder(/^Talking to /)).toBeVisible();
	const windows = [native.page, second];
	const result = owners.map((owner, index) => ({
		...owner,
		page: windows[index],
		input: windows[index].getByPlaceholder(/^Talking to /),
		output: windows[index].getByLabel('Terminal output', { exact: true }),
	}));
	const assignments = await native.page.evaluate(() => window.maestro.windows.list());
	// The main window owns every agent no other window has claimed; the registry
	// lists only explicit claims, so "owned by main" means "claimed nowhere else".
	expect(
		assignments.some((window) => window.id !== mainId && window.sessionIds.includes(owners[0].id))
	).toBe(false);
	expect(assignments.find((window) => window.id === mainId)!.sessionIds).not.toContain(
		owners[1].id
	);
	expect(assignments.find((window) => window.id === created!.id)!.sessionIds).toEqual([
		owners[1].id,
	]);
	return result;
}

function captureMainLog(native: NativeApp) {
	const chunks: string[] = [];
	for (const stream of [native.app.process().stdout, native.app.process().stderr])
		stream?.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
	return () => chunks.join('');
}

async function restoredWindows(native: NativeApp, owners: Awaited<ReturnType<typeof twoWindows>>) {
	// Preserve the window-state file: acceptance includes the real two-window restore.
	await native.start();
	await expect.poll(() => native.app.windows().length).toBe(2);
	const entries: { page: Page; id: string | undefined; sessionIds: string[] }[] = [];
	for (const page of native.app.windows()) {
		await page.waitForLoadState('domcontentloaded');
		const state = await page.evaluate(() => window.maestro.windows.getState());
		entries.push({ page, id: state?.id, sessionIds: state?.sessionIds ?? [] });
	}
	const registered = await native.page.evaluate(() => window.maestro.windows.list());
	const mainId = registered.find((window) => window.isMain)?.id;
	const pages: Page[] = [];
	for (const owner of owners) {
		// The main window owns every agent that no other window claims.
		const claimed = entries.find((entry) => entry.sessionIds.includes(owner.id));
		const claimedElsewhere = registered.some(
			(window) => window.id !== mainId && window.sessionIds.includes(owner.id)
		);
		const found =
			claimed?.page ??
			(claimedElsewhere ? undefined : entries.find((entry) => entry.id === mainId)?.page);
		expect(found, `Restored window owning ${owner.name}`).toBeDefined();
		pages.push(found!);
	}
	expect(pages[0]).not.toBe(pages[1]);
	return pages;
}

test('U7 classic: both windows keep final answers and drafts changed less than two seconds before quit', async ({
	native,
}, info) => {
	const owners = await twoWindows(native);
	const log = captureMainLog(native);
	for (const owner of owners) {
		await owner.output.evaluate((element, answer) => {
			const observer = new MutationObserver(() => {
				if (element.textContent?.includes(answer)) {
					(element as HTMLElement).dataset.acceptanceAnswerAt = String(Date.now());
					observer.disconnect();
				}
			});
			observer.observe(element, { childList: true, subtree: true, characterData: true });
		}, owner.answer);
		await owner.input.evaluate((element) =>
			element.addEventListener('input', () => {
				(element as HTMLElement).dataset.acceptanceDraftAt = String(Date.now());
			})
		);
		await owner.input.fill(`Question in ${owner.name}`);
		await owner.input.press('Enter');
		await expect(owner.output.locator('[data-tool-status="running"]').first()).toBeVisible();
	}
	// Both turns are really live, and their pending copies are already durable.
	await expect
		.poll(
			async () =>
				(
					await native.page.evaluate(() =>
						window.maestro.process.getActiveProcesses({ includeChildProcesses: false })
					)
				).filter((process) => !process.isTerminal).length
		)
		.toBe(2);
	await expect
		.poll(() =>
			owners.every((owner) =>
				savedSessions(native)
					.find((session) => session.id === owner.id)
					?.aiTabs.some((tab) =>
						tab.logs.some((entry) => entry.text.includes(`Question in ${owner.name}`))
					)
			)
		)
		.toBe(true);
	for (const owner of owners)
		expect(JSON.stringify(savedSessions(native).find((s) => s.id === owner.id))).not.toContain(
			owner.answer
		);
	// Trace export is intentionally outside the measured critical interval.
	await native.app.context().tracing.stop();
	for (const owner of owners) fs.writeFileSync(owner.gate, 'release');
	await Promise.all(
		owners.map(async (owner) => {
			await expect(owner.output.getByText(owner.answer, { exact: true })).toBeVisible();
			await expect(owner.page.getByTestId('stop-turn-button')).toHaveCount(0);
			await owner.input.fill(owner.draft);
		})
	);
	const times = await Promise.all(
		owners.map(async (owner) => ({
			window: owner.name,
			answerAt: await owner.output.evaluate((element) =>
				Number((element as HTMLElement).dataset.acceptanceAnswerAt)
			),
			draftAt: await owner.input.evaluate((element) =>
				Number((element as HTMLElement).dataset.acceptanceDraftAt)
			),
		}))
	);
	const closed = native.app.waitForEvent('close', { timeout: 15_000 });
	const quitAt = await native.app.evaluate(({ app }) => {
		const time = Date.now();
		setImmediate(() => app.quit());
		return time;
	});
	await closed;
	await info.attach('two-window-quit-timing.json', {
		body: JSON.stringify({ quitAt, times }),
		contentType: 'application/json',
	});
	for (const time of times) {
		for (const changedAt of [time.answerAt, time.draftAt]) {
			expect(changedAt).toBeGreaterThan(0);
			expect(quitAt - changedAt).toBeGreaterThanOrEqual(0);
			expect(quitAt - changedAt).toBeLessThan(2000);
		}
	}
	expect(log()).toContain('Quit confirmed by renderer');
	expect(log()).toContain('Application shutting down');
	expect(log()).not.toMatch(/Quit save (timed out|did not complete)/);
	for (const owner of owners) {
		const tab = savedSessions(native).find((s) => s.id === owner.id)!.aiTabs[0];
		expect(tab.inputValue).toBe(owner.draft);
		expect(
			tab.logs.filter((entry) => entry.source !== 'user').map((entry) => entry.text.trim())
		).toContain(owner.answer);
	}
	const pages = await restoredWindows(native, owners);
	for (const [index, page] of pages.entries()) {
		await expect(
			page
				.getByLabel('Terminal output', { exact: true })
				.getByText(owners[index].answer, { exact: true })
		).toBeVisible();
		await expect(page.getByPlaceholder(/^Talking to /)).toHaveValue(owners[index].draft);
	}
});

for (const update of [false, true]) {
	test(`U8 classic: ${update ? 'update' : 'normal'} quit bounds an unresponsive secondary and records unsaved state`, async ({
		native,
	}, info) => {
		// Only macOS hard-exits after the update-install grace window (ShipIt
		// waits for the PID to die). Windows and Linux hand the quit to their
		// installer without a forced exit by design, so an unresponsive window
		// holds that quit until it recovers; the trial package is macOS only.
		test.skip(
			update && process.platform !== 'darwin',
			'The update-install exit budget is a macOS contract'
		);
		const owners = await twoWindows(native);
		const [main, second] = owners;
		for (const owner of owners) {
			fs.writeFileSync(owner.gate, 'release');
			await owner.input.fill(`Baseline ${owner.name} question`);
			await owner.input.press('Enter');
			await expect(owner.output.getByText(owner.answer, { exact: true })).toBeVisible();
			await expect(owner.page.getByTestId('stop-turn-button')).toHaveCount(0);
			await owner.input.fill(`Saved ${owner.name} baseline draft`);
			await owner.input.blur();
			await expect
				.poll(() => savedSessions(native).find((s) => s.id === owner.id)?.aiTabs[0].inputValue)
				.toBe(`Saved ${owner.name} baseline draft`);
		}
		const baseline = savedSessions(native).find((s) => s.id === second.id)!.aiTabs[0];
		const log = captureMainLog(native);
		const secondaryContents = await native.app.browserWindow(second.page);
		const secondaryId = await secondaryContents.evaluate((window) => window.webContents.id);
		const primaryContents = await native.app.browserWindow(main.page);
		const primaryId = await primaryContents.evaluate((window) => window.webContents.id);
		// Observe the REAL preload acknowledgements. Do not install a replacement save listener.
		await native.app.evaluate(({ ipcMain }) => {
			ipcMain.on('app:quitSaveComplete', (event, requestId, saved) => {
				console.log(
					`Q3 quit acknowledgement ${JSON.stringify({ id: event.sender.id, requestId, saved })}`
				);
			});
		});
		if (update) {
			// Resolve the installed package's dependency using app.getAppPath(),
			// never a dist import or __setAutoUpdaterForTesting. Replace only the
			// external installer side effect; updates:install still runs its real
			// onBeforeQuitAndInstall hook and the real before-quit coordinator.
			await native.app.evaluate(({ app }) => {
				// The main bundle is an ES module and evaluate has no import callback,
				// so reach Node's built-ins through process.getBuiltinModule.
				const { createRequire } = process.getBuiltinModule('node:module');
				const { join } = process.getBuiltinModule('node:path');
				const appRequire = createRequire(join(app.getAppPath(), 'package.json'));
				const { autoUpdater } = appRequire('electron-updater');
				autoUpdater.autoInstallOnAppQuit = false;
				autoUpdater.quitAndInstall = (silent: boolean, forceRunAfter: boolean) => {
					console.log(`Q3 updater handoff ${JSON.stringify({ silent, forceRunAfter })}`);
					setImmediate(() => app.quit());
				};
			});
		}
		await native.app.context().tracing.stop();
		await second.input.fill('Secondary draft deliberately not saved');
		const blocking = second.page.waitForEvent('console', {
			predicate: (message) => message.text() === 'Q3 renderer blocked',
		});
		const blocked = second.page
			.evaluate(() => {
				console.log('Q3 renderer blocked');
				const until = Date.now() + 15_000;
				while (Date.now() < until) {
					/* Deliberately stop this renderer's event loop. */
				}
			})
			.catch((error: Error) => error.message);
		await blocking;
		await main.input.fill(main.draft);
		const closed = native.app.waitForEvent('close', { timeout: 15_000 });
		const started = performance.now();
		if (update) await main.page.evaluate(() => window.maestro.updates.install());
		else
			await native.app.evaluate(({ app }) => {
				setImmediate(() => app.quit());
			});
		await closed;
		const elapsed = performance.now() - started;
		const blockedResult = await blocked;
		await info.attach('quit-evidence.json', {
			body: JSON.stringify({ update, elapsed, primaryId, secondaryId, log: log() }),
			contentType: 'application/json',
		});
		// The documented contract (docs/verification/hb6-prerequisites.md and
		// v1.0.1-hb.6.md): saving gets five seconds in total across all windows,
		// then the quit continues with the normal teardown grace (750 ms, or
		// 2000 ms for an update install) and its own process exit time.
		const teardownGraceMs = update ? 2000 : 750;
		expect(elapsed).toBeGreaterThanOrEqual(4900);
		expect(elapsed).toBeLessThanOrEqual(5000 + teardownGraceMs + 1500);
		expect(blockedResult).toMatch(/closed|destroyed/i);
		expect(log()).toContain('Application shutting down');
		expect(log()).toContain('Quit save timed out with 1 renderer(s) pending');
		const acknowledgements = log()
			.split('\n')
			.filter((line) => line.startsWith('Q3 quit acknowledgement '))
			.map((line) => JSON.parse(line.slice('Q3 quit acknowledgement '.length)));
		expect(acknowledgements).toEqual([
			{ id: primaryId, requestId: expect.any(String), saved: true },
		]);
		expect(log()).not.toMatch(/all (?:windows|renderers|sessions).*saved|saved all/i);
		if (update) {
			expect(log()).toContain('Installing update - quitting and restarting app');
			expect(log()).toContain('Q3 updater handoff {"silent":false,"forceRunAfter":true}');
			expect(log()).not.toContain('Requesting quit confirmation from renderer');
			expect(log()).toContain('Hard-exiting after update-install grace window');
		} else expect(log()).toContain('Quit confirmed by renderer');
		const savedMain = savedSessions(native).find((s) => s.id === main.id)!.aiTabs[0];
		expect(savedMain.inputValue).toBe(main.draft);
		expect(savedMain.logs.map((entry) => entry.text.trim())).toContain(main.answer);
		const savedSecondary = savedSessions(native).find((s) => s.id === second.id)!.aiTabs[0];
		expect(savedSecondary.inputValue).toBe(baseline.inputValue);
		expect(savedSecondary.logs).toEqual(baseline.logs);
		expect(savedSecondary.agentSessionId).toBe(baseline.agentSessionId);
		const pages = await restoredWindows(native, owners);
		for (const [index, page] of pages.entries()) {
			await expect(page.getByPlaceholder(/^Talking to /)).toHaveValue(
				index === 0 ? main.draft : baseline.inputValue
			);
			await expect(
				page
					.getByLabel('Terminal output', { exact: true })
					.getByText(owners[index].answer, { exact: true })
			).toBeVisible();
		}
	});
}
