import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { NativeApp, type NativeScene } from './fixtures/native-app';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import { DEEPSEEK_PRESET } from '../src/shared/agentPresets';
import type { Session, AITab } from '../src/renderer/types';

// Skip before constructing NativeApp so a real-mode run never inspects credentials.
test.skip(process.env.MAESTRO_E2E_REAL === '1', 'new shell uses synthetic providers only');
test.setTimeout(180_000);

// eslint-disable-next-line no-empty-pattern
test('new shell hb.7: Claude changes, Codex handoff, DeepSeek review and restart', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	const deepseekHome = path.join(native.root, 'deepseek');
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(deepseekHome, { recursive: true });
	const git = (...args: string[]) =>
		execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
			cwd: native.project,
			env: {
				...process.env,
				HOME: home,
				USERPROFILE: home,
				GIT_CONFIG_NOSYSTEM: '1',
				GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
			},
			encoding: 'utf8',
		});
	git('init', '-b', 'main');
	git('config', 'user.name', 'Synthetic shell');
	git('config', 'user.email', 'shell@example.invalid');
	git('config', 'commit.gpgsign', 'false');
	fs.writeFileSync(path.join(native.project, 'cart.ts'), 'export const shipping = 12;\n');
	git('add', '.');
	git('commit', '-m', 'Synthetic baseline');
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			// Hydrate the renderer with the new shell on its first load.
			newShell: true,
			defaultSaveToHistory: false,
			crashReportingEnabled: false,
		})
	);
	const claudeBin = path.resolve('e2e/fixtures/native/claude');
	const codexBin = path.resolve('e2e/fixtures/native/codex');
	fs.writeFileSync(
		path.join(native.data, 'maestro-agent-configs.json'),
		JSON.stringify({
			configs: {
				'claude-code': {
					customPath: claudeBin,
					customEnvVars: { CLAUDE_CONFIG_DIR: native.claude, MAESTRO_NATIVE_SCRIPT: native.script },
				},
				codex: {
					customPath: codexBin,
					customEnvVars: { CODEX_HOME: native.codex, MAESTRO_NATIVE_SCRIPT: native.script },
				},
			},
		})
	);
	const saved = (): Session[] =>
		JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')).sessions;
	const savedTab = (id: string): AITab | undefined =>
		saved()
			.flatMap((s) => s.aiTabs)
			.find((tab) => tab.id === id);
	const scene = (value: NativeScene) =>
		fs.writeFileSync(
			native.script,
			JSON.stringify({ scene: value, synopsis: { answer: 'Synthetic summary' } })
		);
	const calls = (dir: string) =>
		fs.existsSync(path.join(dir, 'fixture-turn-count'))
			? Number(fs.readFileSync(path.join(dir, 'fixture-turn-count'), 'utf8'))
			: 0;
	let claudeId = '',
		claudeTab = '',
		codexTab = '',
		reviewTab = '';
	let failed = false;
	let claudeFile = '',
		codexFile = '',
		reviewFile = '';
	let claudeBytes = Buffer.alloc(0);
	let claudeLogs: AITab['logs'] = [];
	const edited = 'export const shipping = 0;\nexport const threshold = 80;\n';
	const select = async (id: string) => {
		await native.page.locator(`[data-conversation-key$=":${id}"] [data-tree-nav]`).click();
	};
	try {
		await native.start(home);
		await test.step('1 open the new shell and project with the composer focused', async () => {
			await expect(native.page.getByTestId('project-start')).toBeVisible();
			await expect(
				native.page.getByRole('button', { name: 'Open project folder', exact: true })
			).toBeVisible();
			await native.app.evaluate(({ dialog }, project) => {
				dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
			}, native.project);
			await native.page.getByRole('button', { name: 'Open project folder', exact: true }).click();
			await expect(native.input()).toBeFocused();
			await expect(native.page.getByTestId('empty-conversation-picker')).toContainText('project');
			await expect.poll(() => saved().length).toBe(1);
			claudeId = saved()[0].id;
			claudeTab = saved()[0].activeTabId;
			expect(saved()[0].cwd).toBe(fs.realpathSync(native.project));
			expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).newShell).toBe(true);
			expect(calls(native.claude)).toBe(0);
		});
		await test.step('2 Claude creates a real file change and its name opens the right preview', async () => {
			native.scriptTurns([
				{
					answer: 'Claude implemented shipping. See [cart.ts](cart.ts:2).',
					writes: { 'cart.ts': edited },
					tools: [
						{ id: 'write-cart', command: 'write cart.ts', output: 'cart.ts updated' },
						{
							id: 'shipping-plan',
							name: 'TodoWrite',
							command: '',
							output: 'Plan saved',
							input: {
								todos: [
									{ content: 'Implement shipping', status: 'completed' },
									{ content: 'Review shipping', status: 'in_progress' },
									{ content: 'Merge shipping', status: 'pending' },
								],
							},
						},
					],
				},
			]);
			await native.send('Implement free shipping');
			await expect(native.output()).toContainText('Claude implemented shipping.');
			await expect(native.page.getByTestId('empty-conversation-picker')).toHaveCount(0);
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			expect(fs.readFileSync(path.join(native.project, 'cart.ts'), 'utf8')).toBe(edited);
			expect(git('diff', '--numstat').trim()).toBe('2\t1\tcart.ts');
			await native.page
				.locator('[data-shell-header="main"]')
				.getByTitle(/^Show right panel/)
				.click();
			await native.page.locator('[data-tour="changes-tab"]').click();
			await expect(native.page.getByTestId('changes-summary')).toHaveText('1 files changed +2 -1');
			await native.page
				.getByTestId('changes-list')
				.getByRole('button', { name: 'cart.ts', exact: true })
				.click();
			await expect(native.page.locator('[data-tour="files-panel"]')).toContainText('threshold');
			await expect.poll(() => savedTab(claudeTab)?.newShellPanel?.tab).toBe('files');
			const fileId = savedTab(claudeTab)!.newShellPanel!.fileTabId;
			expect(
				saved()
					.find((s) => s.id === claudeId)!
					.filePreviewTabs.find((f) => f.id === fileId)?.path
			).toBe(path.join(native.project, 'cart.ts'));
			claudeFile = await native.oneTranscript('claude');
			claudeBytes = fs.readFileSync(claudeFile);
			await expect
				.poll(() =>
					savedTab(claudeTab)?.logs.some((log) => log.text.includes('Claude implemented shipping.'))
				)
				.toBe(true);
			claudeLogs = savedTab(claudeTab)!.logs;
		});
		await test.step('3 prepare Codex without a call, then send its draft', async () => {
			await native.page.getByTestId('header-handoff').click();
			const dialog = native.page.getByTestId('ai-handoff-modal');
			await dialog.getByRole('radio', { name: /^Codex/ }).check();
			await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
			await expect(dialog).toHaveCount(0);
			await expect(native.input()).toHaveValue(/Implement free shipping/);
			await expect.poll(() => saved().some((s) => s.toolType === 'codex')).toBe(true);
			const codex = saved().find((s) => s.toolType === 'codex')!;
			codexTab = codex.activeTabId;
			await expect(native.page.locator(`[data-conversation-key$=":${codexTab}"]`)).toBeVisible();
			expect(savedTab(codexTab)!.inputValue).toContain('Claude implemented shipping.');
			expect(savedTab(codexTab)!.logs).toEqual([]);
			expect(calls(native.codex)).toBe(0);
			expect(native.files('codex')).toEqual([]);
			scene({ answer: 'Codex checked the implementation.' });
			await native.input().press('Enter');
			await expect(native.output()).toContainText('Codex checked the implementation.');
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			codexFile = await native.oneTranscript('codex');
			expect(fs.readFileSync(codexFile, 'utf8')).toContain('Codex checked the implementation.');
			expect(fs.readFileSync(claudeFile)).toEqual(claudeBytes);
			expect(savedTab(claudeTab)!.logs).toEqual(claudeLogs);
		});
		await test.step('4 prepare and send a DeepSeek review from Changes', async () => {
			// Configure a synthetic preset runner without creating an extra conversation.
			const deepseek = createMockSession({
				id: 'synthetic-deepseek',
				name: 'DeepSeek',
				toolType: 'claude-code',
				cwd: native.project,
				fullPath: native.project,
				projectRoot: native.project,
				aiTabs: [createMockAITab({ id: 'synthetic-deepseek-empty', logs: [] })],
				activeTabId: 'synthetic-deepseek-empty',
				unifiedTabOrder: [{ type: 'ai', id: 'synthetic-deepseek-empty' }],
				customPath: claudeBin,
				customModel: 'deepseek-chat',
				customEnvVars: {
					CLAUDE_CONFIG_DIR: deepseekHome,
					ANTHROPIC_BASE_URL: DEEPSEEK_PRESET.baseUrl,
					ANTHROPIC_AUTH_TOKEN: 'synthetic-key',
					MAESTRO_NATIVE_SCRIPT: native.script,
				},
			});
			await native.page.evaluate(
				(runner) => window.maestro.sessions.setMany([runner], []),
				deepseek
			);
			await native.page.reload();
			await select(codexTab);
			await native.page.locator('[data-tour="changes-tab"]').click();
			await native.page.getByTestId('changes-review').click();
			const dialog = native.page.getByTestId('ai-handoff-modal');
			await dialog.locator('label').filter({ hasText: 'DeepSeek' }).click();
			await expect(dialog.getByRole('radio', { name: /^DeepSeek/ })).toBeChecked();
			await dialog.getByRole('button', { name: 'Prepare review', exact: true }).click();
			await expect(dialog).toHaveCount(0);
			await expect(native.input()).toHaveValue(/cart\.ts/);
			await expect
				.poll(() => {
					const runner = saved().find((s) => s.id === deepseek.id);
					return runner?.aiTabs.length === 1 && runner.activeTabId === runner.aiTabs[0].id;
				})
				.toBe(true);
			reviewTab = saved().find((s) => s.id === deepseek.id)!.activeTabId;
			expect(savedTab(reviewTab)!.origin?.kind).toBe('review');
			expect(savedTab(reviewTab)!.inputValue).toContain('cart.ts');
			expect(calls(deepseekHome)).toBe(0);
			scene({ answer: 'DeepSeek review: shipping changes are consistent.' });
			await native.input().press('Enter');
			await expect(native.output()).toContainText(
				'DeepSeek review: shipping changes are consistent.'
			);
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			reviewFile = await native.oneTranscript('claude', deepseekHome);
			expect(fs.readFileSync(reviewFile, 'utf8')).toContain(
				'DeepSeek review: shipping changes are consistent.'
			);
		});
		const answers = [
			[claudeTab, 'Claude implemented shipping.'],
			[codexTab, 'Codex checked the implementation.'],
			[reviewTab, 'DeepSeek review: shipping changes are consistent.'],
		];
		await test.step('5 each sidebar conversation keeps its own answer', async () => {
			for (const [tabId, answer] of answers) {
				await select(tabId);
				await expect(native.output()).toContainText(answer);
				await expect
					.poll(() =>
						savedTab(tabId)?.logs.some(
							(log) => log.source === 'stdout' && log.text.includes(answer)
						)
					)
					.toBe(true);
				const assistant = savedTab(tabId)!.logs.filter(
					(log) => log.source === 'stdout' && log.text.includes(answer)
				);
				expect(assistant).toHaveLength(1);
				await expect(native.output().locator(`[data-log-id="${assistant[0].id}"]`)).toContainText(
					answer
				);
				for (const [, other] of answers.filter(([id]) => id !== tabId))
					expect(
						savedTab(tabId)!
							.logs.filter((log) => log.source === 'stdout')
							.map((log) => log.text)
							.join('\n')
					).not.toContain(other);
			}
		});
		await test.step('5b terminal output survives conversation switches and TodoWrite appears in Tasks', async () => {
			await select(claudeTab);
			await native.page.locator('[data-tour="terminal-tab"]').click();
			const terminal = native.page.getByTestId('terminal-panel');
			await expect(terminal).toBeVisible();
			await expect
				.poll(() => saved().find((s) => s.id === claudeId)?.terminalTabs?.[0]?.id || '')
				.not.toBe('');
			const terminalId = saved().find((s) => s.id === claudeId)!.terminalTabs[0].id;
			const input = terminal.locator('.xterm-helper-textarea').first();
			await input.focus();
			await input.pressSequentially('echo HB8_TERMINAL_RETAINED');
			await input.press('Enter');
			const readBuffer = () =>
				native.app.evaluate(
					async ({ ipcMain, BrowserWindow }, args) => {
						const response = `remote:readTerminalTab:response:hb8-${Date.now()}`;
						return new Promise<string>((resolve, reject) => {
							const timer = setTimeout(() => {
								ipcMain.removeAllListeners(response);
								reject(new Error('Terminal buffer timeout'));
							}, 5000);
							ipcMain.once(response, (_event, result) => {
								clearTimeout(timer);
								if (result.success) resolve(result.content);
								else reject(new Error(result?.error || 'Terminal buffer unavailable'));
							});
							// Same preload event consumed by CLI read-terminal.
							const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())!;
							win.webContents.send(
								'remote:readTerminalTab',
								args.agent,
								{ tabRef: args.tab },
								response
							);
						});
					},
					{ agent: claudeId, tab: terminalId }
				);
			await expect.poll(readBuffer).toMatch(/(?:^|\n)HB8_TERMINAL_RETAINED\r?(?:\n|$)/);
			await select(codexTab);
			await select(claudeTab);
			await expect(terminal).toBeVisible();
			await expect.poll(readBuffer).toMatch(/(?:^|\n)HB8_TERMINAL_RETAINED\r?(?:\n|$)/);
			expect(saved().find((s) => s.id === claudeId)!.terminalTabs[0].id).toBe(terminalId);
			await terminal.getByRole('button', { name: 'New terminal' }).click();
			const selector = terminal.getByRole('combobox', { name: 'Select terminal' });
			await expect(selector).toBeVisible();
			await expect(selector.locator('option')).toHaveCount(2);
			const secondTerminalId = await selector.inputValue();
			expect(secondTerminalId).not.toBe(terminalId);
			await selector.selectOption(terminalId);
			await expect(selector).toHaveValue(terminalId);
			await expect.poll(() => savedTab(claudeTab)?.newShellPanel?.terminalTabId).toBe(terminalId);
			await expect.poll(readBuffer).toMatch(/(?:^|\n)HB8_TERMINAL_RETAINED\r?(?:\n|$)/);
			await selector.selectOption(secondTerminalId);
			await expect(selector).toHaveValue(secondTerminalId);
			await expect
				.poll(() => savedTab(claudeTab)?.newShellPanel?.terminalTabId)
				.toBe(secondTerminalId);
			await selector.selectOption(terminalId);
			await expect(selector).toHaveValue(terminalId);

			await native.page.locator('[data-tour="tasks-tab"]').click();
			await expect(native.page.getByTestId('tasks-progress')).toHaveText('1 / 3 completed');
			await expect(native.page.getByTestId('tasks-panel')).toContainText('Review shipping');
			// Restore this conversation's file panel for the restart acceptance below.
			await native.page.locator('[data-tour="files-tab"]').click();
		});
		await test.step('6 normal restart restores conversations, panels and drafts', async () => {
			await select(claudeTab);
			await expect(native.page.locator('[data-tour="files-panel"]')).toContainText('threshold');
			await native.input().fill('Claude draft after review');
			await select(codexTab);
			await native.page.locator('[data-tour="changes-tab"]').click();
			await native.input().fill('Codex follow-up draft');
			await expect.poll(() => savedTab(codexTab)?.inputValue).toBe('Codex follow-up draft');
			await expect.poll(() => savedTab(claudeTab)?.inputValue).toBe('Claude draft after review');
			const before = [claudeFile, codexFile, reviewFile].map((file) => fs.readFileSync(file));
			await native.restart(home);
			for (const [tabId, answer] of answers) {
				await select(tabId);
				await expect(native.output()).toContainText(answer);
			}
			await select(claudeTab);
			await expect(native.input()).toHaveValue('Claude draft after review');
			await expect(native.page.locator('[data-tour="files-panel"]')).toContainText('threshold');
			await select(codexTab);
			await expect(native.input()).toHaveValue('Codex follow-up draft');
			await expect(native.page.getByTestId('changes-panel')).toBeVisible();
			expect(savedTab(claudeTab)!.newShellPanel!.tab).toBe('files');
			expect(savedTab(codexTab)!.newShellPanel!.tab).toBe('changes');
			[claudeFile, codexFile, reviewFile].forEach((file, i) =>
				expect(fs.readFileSync(file)).toEqual(before[i])
			);
			expect([calls(native.claude), calls(native.codex), calls(deepseekHome)]).toEqual([1, 1, 1]);
		});
		await test.step('7 classic shell brings back the old right panel and every conversation', async () => {
			// The settings UI updates both Zustand and disk; raw settings IPC only persists.
			await native.page.getByRole('button', { name: 'Settings', exact: true }).click();
			const settings = native.page.getByRole('dialog', { name: 'Settings', exact: true });
			await settings.getByRole('button', { name: 'Display', exact: true }).click();
			const newShellSwitch = settings
				.locator('[data-setting-id="display-new-shell"]')
				.getByRole('switch', { name: 'Use the new shell', exact: true });
			await expect(newShellSwitch).toBeChecked();
			await newShellSwitch.click();
			await expect(newShellSwitch).not.toBeChecked();
			await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
			// The classic default navigates by conversation and only draws its tab
			// strip once a file or terminal tab exists, so the old right panel is
			// what proves the switch took effect.
			await expect(native.page.locator('[data-tour="history-tab"]')).toBeVisible();
			await expect(native.page.locator('[data-tour="changes-tab"]')).toHaveCount(0);
			await expect
				.poll(() => JSON.parse(fs.readFileSync(settingsFile, 'utf8')).newShell)
				.toBe(false);
			for (const [tabId, answer] of answers) {
				await select(tabId);
				await expect(native.output()).toContainText(answer);
				expect(savedTab(tabId)).toBeDefined();
			}
			expect(fs.readFileSync(path.join(native.project, 'cart.ts'), 'utf8')).toBe(edited);
		});
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
		fs.rmSync(native.root, { recursive: true, force: true });
	}
});
