import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { launchElectronApp } from './fixtures/electron-app';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import type { Session } from '../src/renderer/types';

test.setTimeout(180_000);
test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Split acceptance only uses synthetic providers');

// eslint-disable-next-line no-empty-pattern
test('new shell split: independent conversations, focus, resize, restore and classic isolation', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home);
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			defaultSaveToHistory: false,
			crashReportingEnabled: false,
		})
	);
	const sessions = (['claude', 'codex'] as const).map((provider, index) => {
		const script = path.join(native.root, `${provider}-split.json`);
		fs.writeFileSync(
			script,
			JSON.stringify({
				scene:
					provider === 'claude'
						? { answer: '', waitForStop: true }
						: { answer: 'Right pane synthetic answer' },
			})
		);
		const tab = createMockAITab({
			id: `split-${provider}-tab`,
			name: provider === 'claude' ? 'Left conversation' : 'Right conversation',
			inputValue: `${provider} saved draft`,
			permissionMode: 'readonly',
			readOnlyMode: true,
			saveToHistory: false,
			newShellPanel: { tab: 'tasks', open: true },
			logs: [
				{
					id: `${provider}-answer`,
					timestamp: 1,
					source: 'ai',
					text: `${provider} saved conversation`,
				},
				{
					id: `${provider}-tasks`,
					timestamp: 2,
					source: 'tool',
					text: provider === 'claude' ? 'TodoWrite' : 'update_plan',
					metadata: {
						toolState: {
							status: 'completed',
							input: { tasks: [{ content: `${provider} pane task`, status: 'pending' }] },
						},
					},
				},
			],
		});
		return createMockSession({
			id: `split-${provider}`,
			name: provider,
			toolType: provider === 'claude' ? 'claude-code' : 'codex',
			cwd: fs.realpathSync(native.project),
			fullPath: fs.realpathSync(native.project),
			projectRoot: fs.realpathSync(native.project),
			createdAt: index + 1,
			customPath: path.resolve(`e2e/fixtures/native/${provider}`),
			customEnvVars: {
				CLAUDE_CONFIG_DIR: native.claude,
				CODEX_HOME: native.codex,
				MAESTRO_NATIVE_SCRIPT: script,
			},
			aiTabs: [tab],
			activeTabId: tab.id,
			unifiedTabOrder: [{ type: 'ai', id: tab.id }],
		});
	});
	const sessionsFile = path.join(native.data, 'maestro-sessions.json');
	fs.writeFileSync(sessionsFile, JSON.stringify({ sessions }));
	const saved = (): Session[] => JSON.parse(fs.readFileSync(sessionsFile, 'utf8')).sessions;
	const savedTab = (id: string) =>
		saved()
			.flatMap((session) => session.aiTabs)
			.find((tab) => tab.id === id);
	const pane = (id: string) =>
		native.page.locator(`[data-testid="new-shell-split-pane"][data-tab-id="${id}"]`);
	const left = () => pane('split-claude-tab');
	const right = () => pane('split-codex-tab');
	const composer = (id: string) => pane(id).getByPlaceholder(/^(Talking to |Message )/);
	const resize = async (width: number) => {
		const window = await native.app.browserWindow(native.page);
		await window.evaluate((win, value) => win.setContentSize(value, 960), width);
	};
	let failed = false;
	try {
		await native.start(home);
		await resize(1800);
		await native.cli('focus-agent', 'split-claude', '--tab', 'split-claude-tab');
		await test.step('right-click pairs two providers without cloning or widening permissions', async () => {
			await native.page
				.locator('[data-conversation-key$=":split-codex-tab"] [data-tree-nav]')
				.click({ button: 'right' });
			await native.page.getByRole('menuitem', { name: 'Open on the right', exact: true }).click();
			await expect(native.page.getByTestId('new-shell-split-pane')).toHaveCount(2);
			await expect(left()).toContainText('Left conversation');
			await expect(right()).toContainText('Right conversation');
			await expect(left().getByLabel('Terminal output', { exact: true })).toContainText(
				'claude saved conversation'
			);
			await expect(right().getByLabel('Terminal output', { exact: true })).toContainText(
				'codex saved conversation'
			);
			await expect(composer('split-claude-tab')).toHaveValue('claude saved draft');
			await expect(composer('split-codex-tab')).toHaveValue('codex saved draft');
			const leftBox = await left().boundingBox();
			const rightBox = await right().boundingBox();
			expect(leftBox).not.toBeNull();
			expect(rightBox).not.toBeNull();
			expect(Math.abs(leftBox!.width - rightBox!.width)).toBeLessThan(3);
			expect(rightBox!.x).toBeGreaterThan(leftBox!.x + leftBox!.width - 1);
			expect(saved().flatMap((session) => session.aiTabs)).toHaveLength(2);
			for (const session of saved()) {
				expect(session.aiTabs[0]).toMatchObject({ permissionMode: 'readonly', readOnlyMode: true });
			}
		});
		await test.step('each composer keeps its draft and keyboard focus selects the right panel', async () => {
			await composer('split-claude-tab').focus();
			await expect(native.page.getByTestId('tasks-panel')).toContainText('claude pane task');
			await composer('split-claude-tab').fill('Left independent draft');
			await composer('split-codex-tab').focus();
			await expect(native.page.getByTestId('tasks-panel')).toContainText('codex pane task');
			await composer('split-codex-tab').fill('Right independent draft');
			await composer('split-claude-tab').focus();
			await expect(composer('split-claude-tab')).toHaveValue('Left independent draft');
			await expect(composer('split-codex-tab')).toHaveValue('Right independent draft');
			await expect
				.poll(() => savedTab('split-claude-tab')?.inputValue)
				.toBe('Left independent draft');
			await expect
				.poll(() => savedTab('split-codex-tab')?.inputValue)
				.toBe('Right independent draft');
		});
		await test.step('native work and Stop remain attached to the originating pane', async () => {
			await composer('split-claude-tab').press('Enter');
			await expect(left().getByTestId('stop-turn-button')).toBeVisible();
			await expect(right().getByTestId('stop-turn-button')).toHaveCount(0);
			await composer('split-codex-tab').focus();
			await composer('split-codex-tab').press('Enter');
			await expect(right().getByLabel('Terminal output', { exact: true })).toContainText(
				'Right pane synthetic answer'
			);
			await expect(left().getByTestId('stop-turn-button')).toBeVisible();
			await expect(left().getByLabel('Terminal output', { exact: true })).not.toContainText(
				'Right pane synthetic answer'
			);
			await left().getByTestId('stop-turn-button').click();
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			await composer('split-claude-tab').fill('Left restored draft');
			await composer('split-codex-tab').fill('Right restored draft');
			await composer('split-claude-tab').focus();
		});
		let resizedWidth = 0;
		let resizedShare = 0;
		// The saved value is a ratio. Pixel widths also move with the side panels.
		const leftShare = async () => {
			const leftBox = (await left().boundingBox())!;
			const rightBox = (await right().boundingBox())!;
			return leftBox.width / (leftBox.width + rightBox.width);
		};
		await test.step('the divider resizes the two columns and duplicate opens preserve both', async () => {
			const divider = native.page.getByTestId('new-shell-split-divider');
			const box = await divider.boundingBox();
			expect(box).not.toBeNull();
			const before = (await left().boundingBox())!.width;
			await native.page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
			await native.page.mouse.down();
			await native.page.mouse.move(box!.x + 100, box!.y + box!.height / 2, { steps: 8 });
			await native.page.mouse.up();
			resizedWidth = (await left().boundingBox())!.width;
			resizedShare = await leftShare();
			expect(resizedWidth).toBeGreaterThan(before + 50);
			expect((await native.cli('tab', 'split', 'split-codex-tab')).success).toBe(true);
			await expect(native.page.getByTestId('new-shell-split-pane')).toHaveCount(2);
			await expect(left()).toBeVisible();
			await expect(right()).toBeVisible();
			expect(saved().flatMap((session) => session.aiTabs)).toHaveLength(2);
		});
		await test.step('normal restart restores both columns, ratio, focused conversation and drafts', async () => {
			await expect.poll(() => savedTab('split-claude-tab')?.inputValue).toBe('Left restored draft');
			await expect.poll(() => savedTab('split-codex-tab')?.inputValue).toBe('Right restored draft');
			await native.close();
			// NativeApp.start expects one composer; restoration must explicitly expect two.
			native.app = await launchElectronApp(path.resolve('dist/main/index.js'), native.data, {
				...native.env,
				HOME: home,
			});
			await native.app.context().tracing.start({ screenshots: true, snapshots: true });
			native.page = await native.app.firstWindow();
			await native.page.waitForLoadState('domcontentloaded');
			await resize(1800);
			await expect(native.page.getByTestId('new-shell-split-pane')).toHaveCount(2);
			await expect(composer('split-claude-tab')).toHaveValue('Left restored draft');
			await expect(composer('split-codex-tab')).toHaveValue('Right restored draft');
			await expect(native.page.getByTestId('tasks-panel')).toContainText('codex pane task');
			await expect.poll(leftShare).toBeCloseTo(resizedShare, 2);
		});
		await test.step('narrow windows explain single-column mode without discarding the saved pair', async () => {
			await resize(1000);
			await expect(native.page.getByTestId('new-shell-split-notice')).toBeVisible();
			await expect(native.page.getByTestId('new-shell-split-divider')).toHaveCount(0);
			await expect(native.input()).toBeVisible();
			await resize(1800);
			await expect(native.page.getByTestId('new-shell-split-pane')).toHaveCount(2);
			await expect(composer('split-claude-tab')).toHaveValue('Left restored draft');
			await expect(composer('split-codex-tab')).toHaveValue('Right restored draft');
		});
		await test.step('closing either pane and CLI unsplit return to one conversation without closing tabs', async () => {
			await right().getByRole('button', { name: 'Close this pane', exact: true }).click();
			await expect(native.page.getByTestId('new-shell-split-divider')).toHaveCount(0);
			await expect(native.input()).toHaveValue('Left restored draft');
			expect(saved().flatMap((session) => session.aiTabs)).toHaveLength(2);
			expect((await native.cli('tab', 'split', 'split-codex-tab')).success).toBe(true);
			await expect(native.page.getByTestId('new-shell-split-pane')).toHaveCount(2);
			expect((await native.cli('tab', 'unsplit')).success).toBe(true);
			await expect(native.page.getByTestId('new-shell-split-divider')).toHaveCount(0);
			await expect(native.input()).toHaveValue('Right restored draft');
		});
		await test.step('classic mode keeps both conversations and hides the split entry', async () => {
			await native.page.getByRole('button', { name: 'Settings', exact: true }).click();
			const settings = native.page.getByRole('dialog', { name: 'Settings', exact: true });
			await settings.getByRole('button', { name: 'Display', exact: true }).click();
			await settings
				.locator('[data-setting-id="display-new-shell"]')
				.getByRole('switch', { name: 'Use the new shell', exact: true })
				.click();
			await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
			await expect(native.page.getByTestId('new-shell-split-divider')).toHaveCount(0);
			await native.page
				.locator('[data-conversation-key$=":split-claude-tab"] [data-tree-nav]')
				.click({ button: 'right' });
			await expect(
				native.page.getByRole('menuitem', { name: 'Open on the right', exact: true })
			).toHaveCount(0);
			await native.page.keyboard.press('Escape');
			expect(saved().flatMap((session) => session.aiTabs)).toHaveLength(2);
			for (const session of saved())
				expect(session.aiTabs[0]).toMatchObject({ permissionMode: 'readonly', readOnlyMode: true });
		});
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
		fs.rmSync(native.root, { recursive: true, force: true });
	}
});

for (const split of [true, false]) {
	// eslint-disable-next-line no-empty-pattern
	test(`new shell ${split ? 'split button' : 'single pane Escape'} stops only one conversation of the same tool`, async ({}, info) => {
		const native = new NativeApp(info, { providerCli: false });
		const home = path.join(native.root, 'home');
		fs.mkdirSync(home);
		const gate = path.join(native.root, 'finish-background');
		const answer = 'Background answer first paragraph.\n\nBackground answer final paragraph.';
		const script = path.join(native.root, 'same-tool.json');
		fs.writeFileSync(
			script,
			JSON.stringify({
				turns: [
					{ answer: '', waitForStop: true },
					{
						answer,
						tools: [
							{
								id: 'background-tool',
								command: 'synthetic read',
								output: 'complete tool output',
								updates: ['background is running'],
								gates: [gate],
							},
						],
					},
				],
			})
		);
		const tabs = ['left', 'right'].map((id) =>
			createMockAITab({
				id,
				name: `${id} conversation`,
				permissionMode: 'readonly',
				readOnlyMode: true,
				saveToHistory: false,
				newShellPanel: { tab: 'files', open: false },
				logs: [{ id: `${id}-seed`, timestamp: 1, source: 'ai', text: `${id} saved answer` }],
			})
		);
		const session = createMockSession({
			id: 'same-tool',
			name: 'Shared project',
			toolType: 'claude-code',
			cwd: fs.realpathSync(native.project),
			fullPath: fs.realpathSync(native.project),
			projectRoot: fs.realpathSync(native.project),
			customPath: path.resolve('e2e/fixtures/native/claude'),
			customEnvVars: { CLAUDE_CONFIG_DIR: native.claude, MAESTRO_NATIVE_SCRIPT: script },
			aiTabs: tabs,
			activeTabId: 'left',
			unifiedTabOrder: tabs.map((tab) => ({ type: 'ai' as const, id: tab.id })),
		});
		const settingsFile = path.join(native.data, 'maestro-settings.json');
		fs.writeFileSync(
			settingsFile,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
				newShell: true,
				defaultSaveToHistory: false,
				crashReportingEnabled: false,
			})
		);
		const sessionsFile = path.join(native.data, 'maestro-sessions.json');
		fs.writeFileSync(sessionsFile, JSON.stringify({ sessions: [session] }));
		const saved = (): Session =>
			JSON.parse(fs.readFileSync(sessionsFile, 'utf8')).sessions.find(
				(item: Session) => item.id === session.id
			);
		const pane = (id: string) =>
			native.page.locator(`[data-testid="new-shell-split-pane"][data-tab-id="${id}"]`);
		const input = (id: string) =>
			split ? pane(id).getByPlaceholder(/^(Talking to |Message )/) : native.input();
		// Persistence writes every tab as idle, so only the live process list can
		// say which conversation is running.
		const running = async () =>
			(await native.page.evaluate(() => window.maestro.process.getActiveProcesses()))
				.map((process) => process.sessionId.replace(/-fp-.*$/, ''))
				.filter((id) => /^same-tool-ai-(left|right)$/.test(id))
				.sort();
		let failed = false;
		try {
			await native.start(home);
			const appWindow = await native.app.browserWindow(native.page);
			await appWindow.evaluate((win) => win.setContentSize(1800, 960));
			await native.cli('focus-agent', session.id, '--tab', 'left');
			if (split) {
				expect((await native.cli('tab', 'split', 'right')).success).toBe(true);
				await expect(native.page.getByTestId('new-shell-split-pane')).toHaveCount(2);
			}
			await input('left').fill('Run the foreground fixture');
			await input('left').press('Enter');
			await expect
				.poll(
					() =>
						fs.existsSync(path.join(native.claude, 'fixture-turn-count')) &&
						fs.readFileSync(path.join(native.claude, 'fixture-turn-count'), 'utf8')
				)
				.toBe('1');
			await native.cli('focus-agent', session.id, '--tab', 'right');
			await input('right').fill('Run the background fixture');
			await input('right').press('Enter');
			await expect.poll(running).toEqual(['same-tool-ai-left', 'same-tool-ai-right']);
			await expect
				.poll(() => fs.readFileSync(path.join(native.claude, 'fixture-turn-count'), 'utf8'))
				.toBe('2');
			await input('right').fill('Keep this background draft');
			if (split) {
				await pane('left').getByTestId('stop-turn-button').click();
			} else {
				await native.cli('focus-agent', session.id, '--tab', 'left');
				await input('left').press('Escape');
			}
			await expect.poll(running).toEqual(['same-tool-ai-right']);
			await expect.poll(() => saved().aiTabs[1].inputValue).toBe('Keep this background draft');
			fs.writeFileSync(gate, 'continue');
			await expect.poll(running).toEqual([]);
			await expect
				.poll(() =>
					saved()
						.aiTabs[1].logs.filter((log) => log.source === 'ai' || log.source === 'stdout')
						.map((log) => log.text)
						.join('\n')
				)
				.toContain(answer);
			expect(saved().aiTabs[0].logs.some((log) => log.text.includes('Background answer'))).toBe(
				false
			);
			expect(saved().aiTabs[1].logs.some((log) => /canceled by user/i.test(log.text))).toBe(false);
			await native.cli('focus-agent', session.id, '--tab', 'right');
			const output = split
				? pane('right').getByLabel('Terminal output', { exact: true })
				: native.output();
			await expect(output).toContainText('Background answer first paragraph.');
			await expect(output).toContainText('Background answer final paragraph.');
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (native.app) await native.close(failed);
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	});
}
