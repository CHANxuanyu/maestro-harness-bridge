import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { NativeApp, type NativeScene } from './fixtures/native-app';
import { nativeIdentity } from './fixtures/native-real';
import { models } from './fixtures/native/protocol.cjs';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import type { Session } from '../src/renderer/types';
import type { NotificationHistoryRecord } from '../src/shared/notificationHistory';

// Start only AFTER each scenario has pinned its shell and seeded isolated stores.
const test = base.extend<{ native: NativeApp }>({
	// eslint-disable-next-line no-empty-pattern
	native: async ({}, use, info) => {
		const native = new NativeApp(info, { providerCli: false });
		try {
			await use(native);
		} finally {
			try {
				// A scenario may already have closed the app (C4 quits twice), and a
				// closed ElectronApplication throws from process().
				let open = false;
				try {
					open = !!native.app && native.app.process().exitCode === null;
				} catch {
					open = false;
				}
				if (open) await native.close(info.status !== info.expectedStatus);
			} finally {
				fs.rmSync(native.root, { recursive: true, force: true });
			}
		}
	},
});
test.setTimeout(180_000);
test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Q1 acceptance uses synthetic providers only');

// All observations below use shipped DOM, public IPC or durable store files.
// There are no renderer module imports, store injection or development hooks.
function seed(
	native: NativeApp,
	settings: { newShell: false; defaultSaveToHistory?: boolean },
	scenes: { claude: NativeScene[]; codex: NativeScene[] }
) {
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			defaultSaveToHistory: false,
			crashReportingEnabled: false,
			toastDuration: 0,
			audioFeedbackEnabled: false,
			osNotificationsEnabled: false,
			synopsisDebounceSeconds: 0,
			...settings,
		})
	);
	const sessions = (['claude', 'codex'] as const).map((provider) => {
		const script = path.join(native.root, `${provider}.json`);
		fs.writeFileSync(
			script,
			JSON.stringify({
				turns: scenes[provider],
				synopsis: { answer: `${provider} acceptance synopsis.` },
			})
		);
		const tabs = ['main', 'spare'].map((slot) =>
			createMockAITab({
				id: `${provider}-${slot}`,
				name: `${provider} ${slot} conversation`,
				showThinking: 'on',
				permissionMode: 'full',
				saveToHistory: settings.defaultSaveToHistory ?? false,
				logs: [
					{
						id: `${provider}-${slot}-seed`,
						timestamp: 1,
						source: 'ai',
						text: `${provider} ${slot} saved answer.`,
					},
				],
			})
		);
		return createMockSession({
			id: `classic-${provider}`,
			name: `Acceptance ${provider}`,
			toolType: provider === 'claude' ? 'claude-code' : 'codex',
			cwd: fs.realpathSync(native.project),
			fullPath: fs.realpathSync(native.project),
			projectRoot: fs.realpathSync(native.project),
			customPath: path.resolve(`e2e/fixtures/native/${provider}`),
			customModel: models[provider],
			enableMaestroP: false,
			customEnvVars: {
				CLAUDE_CONFIG_DIR: native.claude,
				CODEX_HOME: native.codex,
				MAESTRO_NATIVE_SCRIPT: script,
			},
			aiTabs: tabs,
			activeTabId: tabs[0].id,
			unifiedTabOrder: tabs.map((tab) => ({ type: 'ai' as const, id: tab.id })),
		});
	});
	const sessionsFile = path.join(native.data, 'maestro-sessions.json');
	fs.writeFileSync(sessionsFile, JSON.stringify({ sessions }));
	const saved = (): Session[] => JSON.parse(fs.readFileSync(sessionsFile, 'utf8')).sessions;
	return {
		saved,
		tab: (id: string) =>
			saved()
				.flatMap((session) => session.aiTabs)
				.find((tab) => tab.id === id),
		// Stored tabs are deliberately normalized to idle. Process liveness must
		// come from main, not from the disk copy or a button disappearing.
		running: async () =>
			(await native.page.evaluate(() => window.maestro.process.getActiveProcesses()))
				.map((process) => process.sessionId.replace(/-fp-.*$/, ''))
				.filter((id) => /^classic-(claude|codex)-ai-/.test(id))
				.sort(),
	};
}

for (const provider of ['claude', 'codex'] as const) {
	const other = provider === 'claude' ? 'codex' : 'claude';
	const agentId = `classic-${provider}`;
	const tabId = `${provider}-main`;
	const processId = `${agentId}-ai-${tabId}`;
	const otherProcessId = `classic-${other}-ai-${other}-main`;

	test(`${provider} classic U2: empty, draft and queued input have exactly one reachable Stop`, async ({
		native,
	}) => {
		const gate = path.join(native.root, 'release-first-turn');
		const queued = `${provider} recognisable queued draft`;
		const turns: NativeScene[] = [
			{
				answer: 'First queued test answer.',
				tools: [
					{
						id: 'hold',
						command: 'synthetic hold',
						output: 'done',
						updates: ['held'],
						gates: [gate],
					},
				],
			},
			{ answer: 'Queued draft was delivered.' },
		];
		const background: NativeScene[] = [{ answer: '', waitForStop: true }];
		const state = seed(
			native,
			{ newShell: false },
			{
				claude: provider === 'claude' ? turns : background,
				codex: provider === 'codex' ? turns : background,
			}
		);
		await native.start();
		const win = await native.app.browserWindow(native.page);
		await win.evaluate((window) => window.setContentSize(1600, 1000));
		const stop = native.page.getByRole('button', { name: /^Stop/ });
		const send = native.page.getByTitle('Send message', { exact: true });
		const queue = native.page.getByTitle('Queue message', { exact: true });
		const pill = native.page.locator('.status-pill-container');

		await native.cli('focus-agent', `classic-${other}`, '--tab', `${other}-main`);
		await native.send('Keep the other agent running');
		await expect.poll(state.running).toEqual([otherProcessId]);
		await native.cli('focus-agent', agentId, '--tab', tabId);
		await test.step('only another agent is busy: Send remains, and there is no unreachable Stop', async () => {
			for (const draft of ['', 'Idle draft while another agent works']) {
				await native.input().fill(draft);
				await expect(send).toBeVisible();
				await expect(stop).toHaveCount(0);
				await expect(pill).toContainText(`${other} main conversation`);
			}
		});
		await native.send('Hold this conversation while I compose');
		await expect.poll(state.running).toEqual([processId, otherProcessId].sort());
		await expect(native.input()).toHaveValue('');
		await expect(stop).toHaveCount(1);
		await expect(stop).toBeVisible();
		await expect(send.or(queue)).toHaveCount(0);
		await expect(pill.getByRole('button', { name: /^Stop/ })).toHaveCount(0);
		await native.input().fill(queued);
		await expect(queue).toBeVisible();
		await expect(stop).toHaveCount(1);
		const stopBox = (await stop.boundingBox())!;
		const queueBox = (await queue.boundingBox())!;
		expect(stopBox).not.toBeNull();
		expect(queueBox).not.toBeNull();
		expect(Math.abs(stopBox.y - queueBox.y)).toBeLessThan(2);
		expect(queueBox.x - (stopBox.x + stopBox.width)).toBeGreaterThanOrEqual(0);
		expect(queueBox.x - (stopBox.x + stopBox.width)).toBeLessThanOrEqual(8);
		await queue.click();
		await expect(native.input()).toHaveValue('');
		await expect(native.output()).toContainText(queued);
		await expect
			.poll(() => state.saved().find((s) => s.id === agentId)?.executionQueue)
			.toEqual([expect.objectContaining({ text: queued, tabId })]);
		await expect(stop).toHaveCount(1);
		await expect(send.or(queue)).toHaveCount(0);
		const transcript = await native.oneTranscript(provider);
		expect(fs.readFileSync(transcript, 'utf8')).not.toContain(queued);

		await test.step('viewing an idle sibling moves the one Stop to the named background pill', async () => {
			await native.cli('focus-agent', agentId, '--tab', `${provider}-spare`);
			for (const draft of ['', 'Sibling draft']) {
				await native.input().fill(draft);
				await expect(send).toBeVisible();
				await expect(stop).toHaveCount(1);
				await expect(pill.getByRole('button', { name: /^Stop/ })).toBeVisible();
				await expect(pill).toContainText(`${provider} main conversation`);
			}
			await native.cli('focus-agent', agentId, '--tab', tabId);
			await expect(stop).toHaveCount(1);
			await expect(pill.getByRole('button', { name: /^Stop/ })).toHaveCount(0);
		});
		fs.writeFileSync(gate, 'continue');
		await expect(native.output()).toContainText('Queued draft was delivered.');
		await expect.poll(state.running).toEqual([otherProcessId]);
		await expect
			.poll(() => state.saved().find((s) => s.id === agentId)?.executionQueue)
			.toEqual([]);
		expect(fs.readFileSync(transcript, 'utf8')).toContain(queued);
		await expect(stop).toHaveCount(0);
		await native.cli('focus-agent', `classic-${other}`, '--tab', `${other}-main`);
		await expect(stop).toHaveCount(1);
		await stop.click();
		await expect.poll(state.running).toEqual([]);
	});

	test(`${provider} classic U3: Escape keeps the draft and caret, after menus and command mode`, async ({
		native,
	}) => {
		const state = seed(
			native,
			{ newShell: false },
			{
				claude: [
					{ answer: '', waitForStop: true },
					{ answer: '', waitForStop: true },
				],
				codex: [
					{ answer: '', waitForStop: true },
					{ answer: '', waitForStop: true },
				],
			}
		);
		await native.start();
		await native.cli('focus-agent', `classic-${other}`, '--tab', `${other}-main`);
		await native.send('Other agent must survive Escape');
		await expect.poll(state.running).toEqual([otherProcessId]);
		await native.cli('focus-agent', agentId, '--tab', tabId);

		for (const surface of ['composer', 'transcript']) {
			await test.step(`Escape from ${surface} stops the viewed turn and retains the exact selection`, async () => {
				await native.send(`Run the ${surface} Escape check`);
				await expect.poll(state.running).toEqual([processId, otherProcessId].sort());
				if (surface === 'composer') {
					await native.input().fill('Half a sentence before opening a menu');
					const row = native.page.locator(
						`[data-conversation-key$=":${tabId}"] button[data-tree-nav]`
					);
					await row.click({ button: 'right' });
					await expect(native.page.getByRole('menu')).toBeVisible();
					await native.page.keyboard.press('Escape');
					await expect(native.page.getByRole('menu')).toHaveCount(0);
					await expect(row).toBeFocused();
					await expect(native.input()).toHaveValue('Half a sentence before opening a menu');
					await expect
						.poll(() => state.tab(tabId)?.inputValue)
						.toBe('Half a sentence before opening a menu');
					await expect.poll(state.running).toEqual([processId, otherProcessId].sort());

					// A typed bang on an empty composer enters the real command ladder.
					// Command mode changes the placeholder, so hold the textarea itself.
					const composer = native.page.getByTestId('composer-card').locator('textarea').first();
					await native.input().fill('');
					await composer.press('!');
					await expect(native.page.getByTestId('command-mode-bar')).toBeVisible();
					await composer.press('!');
					await expect(native.page.getByTestId('ai-command-mode-bar')).toBeVisible();
					await composer.press('Escape');
					await expect(native.page.getByTestId('ai-command-mode-bar')).toHaveCount(0);
					await expect(native.page.getByTestId('command-mode-bar')).toBeVisible();
					await expect(composer).toBeFocused();
					await expect.poll(() => state.tab(tabId)?.commandMode).toBe('shell');
					await expect.poll(state.running).toEqual([processId, otherProcessId].sort());
					await composer.press('Escape');
					await expect(native.page.getByTestId('command-mode-bar')).toHaveCount(0);
					await expect(composer).toBeFocused();
					await expect.poll(() => state.tab(tabId)?.commandMode).toBe('off');
					await expect.poll(state.running).toEqual([processId, otherProcessId].sort());
				}
				const draft = `Half a sentence in the ${surface} check`;
				await native.input().fill(draft);
				await native
					.input()
					.evaluate((input: HTMLTextAreaElement) => input.setSelectionRange(7, 7));
				if (surface === 'transcript') {
					await native.output().focus();
					await expect(native.output()).toBeFocused();
					await native.output().press('Escape');
				} else await native.input().press('Escape');
				await expect.poll(state.running).toEqual([otherProcessId]);
				await expect(native.input()).toBeFocused();
				await expect(native.input()).toHaveValue(draft);
				expect(
					await native
						.input()
						.evaluate((input: HTMLTextAreaElement) => [input.selectionStart, input.selectionEnd])
				).toEqual([7, 7]);
				await native.page.keyboard.insertText('[caret]');
				await expect(native.input()).toHaveValue(`${draft.slice(0, 7)}[caret]${draft.slice(7)}`);
				const transcript = await native.oneTranscript(provider);
				expect(fs.readFileSync(transcript, 'utf8')).not.toContain(draft);
			});
		}
		await native.cli('focus-agent', `classic-${other}`, '--tab', `${other}-main`);
		await native.page.getByTestId('stop-turn-button').click();
		await expect.poll(state.running).toEqual([]);
	});

	for (const sameAgent of [false, true]) {
		test(`${provider} classic U4 (${sameAgent ? 'same agent' : 'other agent'}): running line, named background pill and no viewed synopsis popup`, async ({
			native,
		}) => {
			const backgroundProvider = sameAgent ? provider : other;
			const backgroundAgentId = sameAgent ? agentId : `classic-${other}`;
			const backgroundTabId = sameAgent ? `${provider}-spare` : `${other}-main`;
			const backgroundProcessId = `${backgroundAgentId}-ai-${backgroundTabId}`;
			const backgroundTitle = 'Background work to identify in the pill';
			const viewedTitle = 'Viewed work that needs no notification';
			const gates = {
				viewed: path.join(native.root, 'finish-viewed'),
				background: path.join(native.root, 'finish-background'),
			};
			const scene = (name: 'viewed' | 'background'): NativeScene => ({
				answer: `${name} final answer while the writer is still alive.`,
				tools: [{ id: `${name}-work`, command: 'synthetic work', output: 'work completed' }],
				exitGate: gates[name],
			});
			const turns = sameAgent ? [scene('background'), scene('viewed')] : [scene('viewed')];
			const background = sameAgent ? [] : [scene('background')];
			const state = seed(
				native,
				{ newShell: false, defaultSaveToHistory: true },
				{
					claude: provider === 'claude' ? turns : background,
					codex: provider === 'codex' ? turns : background,
				}
			);
			// Exercise first-prompt titles, including two tabs of the same tool. The
			// classic read-only mode permits those two turns to run simultaneously.
			const sessions = state.saved();
			for (const session of sessions)
				for (const tab of session.aiTabs) {
					tab.name = null;
					tab.readOnlyMode = true;
					tab.permissionMode = 'readonly';
				}
			fs.writeFileSync(
				path.join(native.data, 'maestro-sessions.json'),
				JSON.stringify({ sessions })
			);
			const notifications = (): NotificationHistoryRecord[] =>
				JSON.parse(
					fs.readFileSync(path.join(native.data, 'maestro-notification-history.json'), 'utf8')
				).records;
			await native.start();
			const win = await native.app.browserWindow(native.page);
			await win.evaluate((window) => {
				window.setContentSize(1600, 1000);
				window.show();
				window.focus();
			});
			await native.cli('focus-agent', backgroundAgentId, '--tab', backgroundTabId);
			await native.send(backgroundTitle);
			await expect(native.output()).toContainText('background final answer');
			await expect(native.output().getByTestId('turn-running-status')).toContainText('5 tokens');
			await native.cli('focus-agent', agentId, '--tab', tabId);
			await native.send(viewedTitle);
			await expect(native.output()).toContainText('viewed final answer');
			await expect.poll(state.running).toEqual([processId, backgroundProcessId].sort());
			await expect.poll(() => native.page.evaluate(() => document.hasFocus())).toBe(true);

			const status = native.output().getByTestId('turn-running-status');
			await expect(status).toHaveCount(1);
			await expect(status).toBeInViewport();
			await expect(status).toHaveText(/^Thinking\.\.\. · (?:\d+[dhms] ?)+ · 5 tokens$/);
			const elapsed = status.locator('.tabular-nums').first();
			const before = await elapsed.innerText();
			await expect(elapsed).not.toHaveText(before);
			const lastLog = native.output().locator('[data-log-index]').last();
			expect((await status.boundingBox())!.y).toBeGreaterThanOrEqual(
				(await lastLog.boundingBox())!.y + (await lastLog.boundingBox())!.height - 1
			);
			// Count painted text lines, not wrappers: every clause must share one line.
			expect(
				await status.locator('.min-w-0').evaluate((node) => {
					const range = document.createRange();
					range.selectNodeContents(node);
					return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
				})
			).toBe(1);
			const pill = native.page.locator('.status-pill-container');
			await expect(pill).toHaveCount(1);
			await expect(pill.getByRole('button', { name: backgroundTitle, exact: true })).toBeVisible();
			await expect(pill).not.toContainText(viewedTitle);
			expect(
				(await pill.boundingBox())!.y + (await pill.boundingBox())!.height
			).toBeLessThanOrEqual((await native.input().boundingBox())!.y);
			for (const id of [tabId, backgroundTabId]) {
				await expect.poll(() => state.tab(id)?.agentSessionId).toBeTruthy();
				const nativeId = state.tab(id)!.agentSessionId!;
				// Cross-check the provider record instead of trusting a display label.
				expect(
					native
						.files(id === tabId ? provider : backgroundProvider)
						.some(
							(file) =>
								nativeIdentity(id === tabId ? provider : backgroundProvider, file).id === nativeId
						)
				).toBe(true);
				await expect(pill).not.toContainText(id);
				await expect(pill).not.toContainText(nativeId);
				await expect(pill).not.toContainText(nativeId.slice(0, 8));
			}

			fs.writeFileSync(gates.viewed, 'continue');
			await expect.poll(state.running).toEqual([backgroundProcessId]);
			await expect(status).toHaveCount(0);
			// Waiting for History proves the synopsis ran; disabling it would make a
			// negative popup assertion pass without exercising the acceptance rule.
			await expect
				.poll(
					async () =>
						(
							await native.page.evaluate(
								({ project, agentId }) => window.maestro.history.getAll(project, agentId),
								{ project: native.project, agentId }
							)
						).length
				)
				.toBe(1);
			await expect
				.poll(() => notifications().filter((n) => n.tabId === tabId && n.type === 'success').length)
				.toBe(1);
			expect(
				notifications()
					.filter((n) => n.tabId === tabId)
					.every((n) => n.historyOnly === true)
			).toBe(true);
			expect(notifications().filter((n) => n.tabId === tabId && n.title === 'Synopsis')).toEqual(
				[]
			);
			await expect(native.page.getByTestId('toast-stack')).toHaveCount(0);

			// Positive control: the other conversation finishes while still off screen.
			fs.writeFileSync(gates.background, 'continue');
			await expect.poll(state.running).toEqual([]);
			await expect
				.poll(
					() =>
						notifications().filter((n) => n.tabId === backgroundTabId && n.title === 'Synopsis')
							.length
				)
				.toBe(1);
			await expect(native.page.getByTestId('toast-stack')).toContainText('Synopsis');
			await expect(native.page.getByTestId('toast-stack')).toContainText(
				notifications().find((n) => n.tabId === backgroundTabId && n.title === 'Synopsis')!.message
			);
			expect(notifications().filter((n) => n.tabId === tabId && !n.historyOnly)).toEqual([]);
		});
	}

	test(`${provider} classic U6: sidebar New conversation stays in the current agent and returns to the old tab`, async ({
		native,
	}) => {
		const prompt = `Recognisable ${provider} sidebar conversation`;
		const answer = `${provider} sidebar answer.`;
		const oldAnswer = `${provider} original conversation answer.`;
		const state = seed(
			native,
			{ newShell: false },
			{
				claude: [{ answer: oldAnswer }, { answer }],
				codex: [{ answer: oldAnswer }, { answer }],
			}
		);
		await native.start();
		await native.cli('focus-agent', agentId, '--tab', tabId);
		await native.send('Original conversation before the sidebar button');
		await expect(native.output()).toContainText(oldAnswer);
		await expect.poll(state.running).toEqual([]);
		const oldFile = await native.oneTranscript(provider);
		const oldIdentity = nativeIdentity(provider, oldFile);
		await native.input().fill('Old conversation draft');
		const before = state
			.saved()
			.find((s) => s.id === agentId)!
			.aiTabs.map((tab) => tab.id);
		await native.page.getByTestId('sidebar-new-conversation').click();
		await expect(native.input()).toBeFocused();
		await expect(native.input()).toHaveValue('');
		const activeRow = native.page.locator(
			'[data-conversation-key] button[data-tree-nav][aria-current="page"]'
		);
		await expect(activeRow.locator(':scope > span.truncate')).toHaveText('New conversation');
		await native.page.keyboard.type(prompt);
		await expect(native.input()).toHaveValue(prompt);
		await native.input().press('Enter');
		await expect(native.output()).toContainText(answer);
		await expect.poll(state.running).toEqual([]);
		await expect
			.poll(() => state.saved().find((s) => s.id === agentId)!.aiTabs.length)
			.toBe(before.length + 1);
		expect(state.saved()).toHaveLength(2);
		const created = state
			.saved()
			.find((s) => s.id === agentId)!
			.aiTabs.find((tab) => !before.includes(tab.id))!;
		expect(created).toBeDefined();
		expect(created.agentSessionId).toBeTruthy();
		expect(created.agentSessionId).not.toBe(oldIdentity.id);
		expect(native.files(provider)).toHaveLength(2);
		expect(fs.readFileSync(oldFile, 'utf8')).not.toContain(prompt);
		expect(state.saved().find((s) => s.id === agentId)!.activeTabId).toBe(created.id);
		expect(state.saved().find((s) => s.id === `classic-${other}`)!.aiTabs).toHaveLength(2);
		// Discovery can replace the first-prompt excerpt with the provider's
		// native title (the synthetic Codex record uses its answer). Both are
		// titles; the acceptance rule also permits the empty-conversation label.
		await expect(activeRow.locator(':scope > span.truncate')).toHaveText(
			new RegExp(`^(?:${prompt}|${provider} sidebar answer\\.|New conversation)$`)
		);
		for (const id of [agentId, created.id, created.agentSessionId!]) {
			await expect(activeRow).not.toContainText(id);
			await expect(activeRow).not.toContainText(id.slice(0, 8));
		}
		await native.page.locator(`[data-conversation-key$=":${tabId}"] button[data-tree-nav]`).click();
		await expect(native.output()).toContainText(oldAnswer);
		await expect(native.output()).not.toContainText(answer);
		await expect(native.input()).toHaveValue('Old conversation draft');
		await expect(native.input()).toBeFocused();
		await native.page
			.locator(`[data-conversation-key$=":${created.id}"] button[data-tree-nav]`)
			.click();
		await expect(native.output()).toContainText(answer);
		await expect(native.input()).toHaveValue('');
		await expect(native.input()).toBeFocused();
	});

	test(`${provider} classic C4: normal quit saves the last answer, model and unsent draft`, async ({
		native,
	}) => {
		const gate = path.join(native.root, 'answer-now');
		const answer = `${provider} final answer immediately before normal quit.`;
		const prompt = `${provider} answer before quitting`;
		const draft = `${provider} unsent draft must never reach the provider`;
		const scene: NativeScene = {
			answer,
			tools: [
				{
					id: 'quit-hold',
					command: 'synthetic hold',
					output: 'released',
					updates: ['held'],
					gates: [gate],
				},
			],
		};
		const state = seed(native, { newShell: false }, { claude: [scene], codex: [scene] });
		await native.start();
		await native.cli('focus-agent', agentId, '--tab', tabId);
		const mainLog: string[] = [];
		for (const stream of [native.app.process().stdout, native.app.process().stderr])
			stream?.on('data', (chunk: Buffer) => mainLog.push(chunk.toString()));
		await native.send(prompt);
		await expect
			.poll(() =>
				state.tab(tabId)?.logs.some((log) => log.source === 'user' && log.text === prompt)
			)
			.toBe(true);
		expect(state.tab(tabId)?.logs.some((log) => log.text === answer)).toBe(false);
		const file = await native.oneTranscript(provider);
		fs.writeFileSync(gate, 'continue');
		await expect(native.output().getByText(answer, { exact: true })).toBeVisible();
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await native.input().fill(draft);
		// No blur, save, tab switch or persistence poll here. NativeApp.close uses
		// app.quit and the same renderer quit-save handshake as the real Quit.
		await native.close();
		expect(mainLog.join('')).toContain('Quit confirmed by renderer');
		expect(mainLog.join('')).toContain('Application shutting down');
		expect(mainLog.join('')).not.toMatch(/Quit save (timed out|did not complete)/);
		const metadata = nativeIdentity(provider, file);
		expect(metadata.model).toBeTruthy();
		expect(state.tab(tabId)?.inputValue).toBe(draft);
		expect(state.tab(tabId)?.agentSessionId).toBe(metadata.id);
		expect(state.tab(tabId)?.logs).toEqual(
			expect.arrayContaining([expect.objectContaining({ text: answer, turnModel: metadata.model })])
		);
		expect(state.tab(tabId)?.logs.some((log) => log.text.includes(draft))).toBe(false);
		const transcriptBefore = fs.readFileSync(file, 'utf8');
		expect(transcriptBefore).not.toContain(draft);
		const invocationFile = path.join(native.providerHome(provider), 'fixture-invocations.jsonl');
		const invocationsBefore = fs.readFileSync(invocationFile, 'utf8');

		await native.start();
		await expect(native.output().getByText(answer, { exact: true })).toBeVisible();
		await expect(native.input()).toHaveValue(draft);
		await native.output().getByRole('button', { name: 'Message info', exact: true }).last().click();
		await expect(
			native.output().getByRole('group', { name: 'Message info', exact: true })
		).toContainText(metadata.model);
		await expect(native.output()).not.toContainText(draft);
		await expect.poll(state.running).toEqual([]);
		// Close the reopened app too: the full lifecycle must not submit the draft.
		await native.close();
		expect(state.tab(tabId)?.inputValue).toBe(draft);
		expect(state.tab(tabId)?.logs.some((log) => log.text.includes(draft))).toBe(false);
		expect(native.files(provider)).toEqual([file]);
		expect(fs.readFileSync(file, 'utf8')).toBe(transcriptBefore);
		expect(fs.readFileSync(invocationFile, 'utf8')).toBe(invocationsBefore);
	});
}
