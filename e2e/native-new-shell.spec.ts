import { encodeClaudeProjectPath } from '../src/shared/pathUtils';
import { transcriptMessagesToLogEntries } from '../src/renderer/utils/transcriptMessages';
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
		const row = native.page.locator(`[data-conversation-key$=":${id}"]`);
		await row.locator(':scope > div > button[data-tree-nav]').last().click();
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
			await expect(native.page.getByTestId('changes-summary')).toHaveText('1 file changed +2 -1');
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
			const sourceRow = native.page.locator(`[data-conversation-key="${claudeId}:${claudeTab}"]`);
			await expect(sourceRow.locator(`[data-conversation-key$=":${codexTab}"]`)).toBeVisible();
			expect((await native.cli('tab', 'children', claudeTab, '--expand')).expanded).toBe(true);
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
			await select(claudeTab);
			await expect(sourceRow.locator(`[data-conversation-key$=":${codexTab}"]`)).toBeVisible();
			expect((await native.cli('tab', 'children', claudeTab)).expanded).toBe(true);
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
			await select(claudeTab);
			await native.restart(home);
			await expect(
				native.page.locator(
					`[data-conversation-key="${claudeId}:${claudeTab}"] [data-conversation-key$=":${codexTab}"]`
				)
			).toBeVisible();
			expect((await native.cli('tab', 'children', claudeTab)).expanded).toBe(true);
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
		await test.step('6b archive promotes the handoff and unarchive nests it again', async () => {
			const sourceNativeId = savedTab(claudeTab)!.agentSessionId!;
			expect((await native.cli('tab', 'children', claudeTab, '--collapse')).expanded).toBe(false);
			await expect(native.page.locator(`[data-conversation-key$=":${codexTab}"]`)).toHaveCount(0);
			expect((await native.cli('tab', 'children', claudeTab, '--expand')).expanded).toBe(true);
			await native.cli('tab', 'archive', claudeTab);
			const handoffRow = native.page.locator(`[data-conversation-key$=":${codexTab}"]`);
			await expect(handoffRow).toBeVisible();
			await expect(handoffRow.locator('xpath=ancestor::li[@data-conversation-key]')).toHaveCount(0);
			const closed = await native.cli(
				'tab',
				'children',
				'--native',
				sourceNativeId,
				'--agent',
				claudeId
			);
			expect(closed.expanded).toBe(true);
			expect(closed.children.map((tab: { tabId: string }) => tab.tabId)).toContain(codexTab);
			await native.cli('native-history', 'unarchive', claudeId, sourceNativeId);
			const sourceRow = native.page.locator(`[data-native-session-id="${sourceNativeId}"]`);
			await expect(sourceRow.locator(`[data-conversation-key$=":${codexTab}"]`)).toBeVisible();
			await sourceRow.locator(':scope > div > button[data-tree-nav]').last().click();
			// Reopening binds the native ID to a tab that can be replaced while the
			// open settles. Take the tab the sidebar row ends on, once it is saved.
			const reopenedTab = async () =>
				(await sourceRow.getAttribute('data-conversation-key'))?.split(':').at(-1) ?? '';
			await expect
				.poll(async () => {
					const shown = await reopenedTab();
					return saved()
						.find((owner) => owner.id === claudeId)
						?.aiTabs.some((tab) => tab.id === shown && tab.agentSessionId === sourceNativeId);
				})
				.toBe(true);
			claudeTab = await reopenedTab();
			answers[0][0] = claudeTab;
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

const seedNewShell = (native: NativeApp, settings: Record<string, unknown> = {}) => {
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			defaultSaveToHistory: false,
			crashReportingEnabled: false,
			...settings,
		})
	);
	fs.writeFileSync(
		path.join(native.data, 'maestro-agent-configs.json'),
		JSON.stringify({
			configs: {
				'claude-code': {
					customPath: path.resolve('e2e/fixtures/native/claude'),
					customEnvVars: { CLAUDE_CONFIG_DIR: native.claude, MAESTRO_NATIVE_SCRIPT: native.script },
				},
			},
		})
	);
	return () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
};

// eslint-disable-next-line no-empty-pattern
test('new shell first run asks only the updates question', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
	const settings = seedNewShell(native, {
		newShell: undefined,
		newShellChoice: undefined,
		typographyPromptSeen: false,
		themePromptSeen: false,
		updatesPromptSeen: false,
		agentPowersPromptSeen: false,
	});
	let failed = false;
	try {
		await native.start(home);
		const stderr: string[] = [];
		native.app.process().stderr?.on('data', (chunk) => stderr.push(String(chunk)));
		await expect(native.page.getByTestId('updates-choice-confirm')).toBeVisible();
		await expect(native.page.getByTestId('project-start')).toBeAttached();
		await native.page.getByTestId('updates-choice-confirm').click();
		await expect(native.page.getByTestId('updates-choice-confirm')).toHaveCount(0);
		await expect(native.page.getByTestId('typography-choice-confirm')).toHaveCount(0);
		await expect(native.page.getByTestId('theme-choice-confirm')).toHaveCount(0);
		await expect(native.page.getByTestId('agent-powers-confirm')).toHaveCount(0);
		await expect(native.page.getByTestId('project-start')).toContainText('Claude Code installed');
		await expect.poll(() => settings().updatesPromptSeen).toBe(true);
		// Skipped, not answered: the old shell still asks these questions.
		expect(settings().typographyPromptSeen).toBe(false);
		expect(settings().themePromptSeen).toBe(false);
		expect(settings().agentPowersPromptSeen).toBe(false);
		expect(stderr.join('')).not.toContain('PluginsDisabled');
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('new shell rejected login: dismiss, sign in from the card and replay the turn', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
	seedNewShell(native);
	let failed = false;
	try {
		await native.start(home);
		// The dialog types a real login into a real shell. It must not get one here.
		await native.app.evaluate(({ ipcMain }) => {
			ipcMain.removeHandler('process:spawnTerminalTab');
			ipcMain.handle('process:spawnTerminalTab', () => ({ pid: 1, success: true }));
			ipcMain.removeHandler('process:write');
			ipcMain.handle('process:write', () => true);
		});
		await native.app.evaluate(({ dialog }, project) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
		}, native.project);
		await native.page.getByRole('button', { name: 'Open project folder', exact: true }).click();
		await expect(native.input()).toBeFocused();
		await native.cli('settings', 'set', 'uiLanguage', 'zh-CN');
		await expect(native.page.locator('html')).toHaveAttribute('lang', /^zh/);
		native.scriptTurns([{ authFailure: true, answer: '' }, { answer: 'Recovered after sign-in' }]);
		const composer = native.page.locator('textarea:focus');
		await composer.fill('Fix the cart');
		await composer.press('Enter');

		const dialog = native.page.getByRole('dialog', { name: 'Claude Code 需要重新登录' });
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText('当前工作已暂停，重新登录后恢复。');
		await dialog.getByRole('button', { name: '稍后再说' }).click();
		await expect(dialog).toHaveCount(0);

		const card = native.page.getByLabel('终端输出', { exact: true });
		await expect(card).toContainText('需要重新登录');
		await expect(card).toContainText('Claude Code 不接受当前的登录凭据。');
		await expect(card).not.toContainText('Authentication failed');
		await card.getByRole('button', { name: '重新登录' }).click();
		await expect(dialog).toBeVisible();
		await dialog.getByTestId('reauth-resume').click();

		await expect(card).toContainText('Recovered after sign-in');
		await expect(card.getByRole('button', { name: '重新登录' })).toHaveCount(0);
		expect(Number(fs.readFileSync(path.join(native.claude, 'fixture-turn-count'), 'utf8'))).toBe(2);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('old shell wizard names a rejected login instead of an exit code', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
	seedNewShell(native, { newShell: false, newShellChoice: 'classic' });
	native.scriptTurns([{ authFailure: true, answer: '' }]);
	let failed = false;
	try {
		await native.start(home);
		await native.page.keyboard.press('Meta+Shift+N');
		await expect(
			native.page.getByRole('heading', { name: 'Create a Maestro Agent' })
		).toBeVisible();
		await native.page
			.getByRole('button', { name: /Claude Code/ })
			.first()
			.click();
		await native.page.getByRole('button', { name: 'Continue', exact: true }).click();
		await native.page.locator('input[type="text"]').first().fill(native.project);
		await native.page.getByRole('button', { name: 'Continue', exact: true }).click();
		const message = native.page.getByPlaceholder('Describe your project...');
		await message.fill('A cart');
		await native.page.getByRole('button', { name: 'Send', exact: true }).click();
		await expect(native.page.getByText('Authentication Required', { exact: true })).toBeVisible();
		await expect(
			native.page.getByText('Run "claude auth login" to sign in again, then try again.', {
				exact: true,
			})
		).toBeVisible();
		await expect(native.page.getByText(/Check the terminal/)).toHaveCount(0);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('new shell permission inheritance: readonly Codex stays readonly in a new conversation', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
	seedNewShell(native);
	const tab = createMockAITab({
		id: 'permission-source',
		permissionMode: 'readonly',
		readOnlyMode: true,
		saveToHistory: false,
	});
	const session = createMockSession({
		id: 'permission-codex',
		name: 'Codex',
		toolType: 'codex',
		cwd: fs.realpathSync(native.project),
		projectRoot: fs.realpathSync(native.project),
		customPath: path.resolve('e2e/fixtures/native/codex'),
		customEnvVars: { CODEX_HOME: native.codex, MAESTRO_NATIVE_SCRIPT: native.script },
		aiTabs: [tab],
		activeTabId: tab.id,
		unifiedTabOrder: [{ type: 'ai', id: tab.id }],
	});
	fs.writeFileSync(
		path.join(native.data, 'maestro-sessions.json'),
		JSON.stringify({ sessions: [session] })
	);
	native.scriptTurns([
		{ answer: 'Source readonly turn complete' },
		{ answer: 'New readonly turn complete' },
		{ answer: 'Keyboard readonly turn complete' },
	]);
	const saved = (): Session =>
		JSON.parse(
			fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')
		).sessions.find((item: Session) => item.id === session.id);
	let failed = false;
	try {
		await native.start(home);
		await expect(native.page.getByTestId('composer-permission')).toHaveText('Read only');
		await native.send('Read the source project');
		await expect(native.output()).toContainText('Source readonly turn complete');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await native.page.getByTestId('sidebar-new-conversation').click();
		await expect(native.page.getByTestId('empty-conversation-picker')).toBeVisible();
		await expect(native.page.getByTestId('composer-permission')).toHaveText('Read only');
		await expect(native.page.getByTestId('composer-permission')).not.toHaveText('Full Access');
		await expect.poll(() => saved().aiTabs.length).toBe(2);
		const newTabId = saved().activeTabId;
		expect(newTabId).not.toBe(tab.id);
		expect(saved().aiTabs.find((item) => item.id === newTabId)).toMatchObject({
			permissionMode: 'readonly',
			readOnlyMode: true,
		});
		await native.send('Read the project in the new conversation');
		await expect(native.output()).toContainText('New readonly turn complete');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		const invocations = fs
			.readFileSync(path.join(native.codex, 'fixture-invocations.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { args: string[] });
		expect(invocations).toHaveLength(2);
		for (const { args } of invocations) {
			expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
			expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
		}
		await native.page.getByTestId('composer-permission').click();
		await native.page.getByRole('menuitemradio', { name: 'Full Access', exact: true }).click();
		await expect(native.page.getByTestId('composer-permission')).toHaveText('Full Access');
		await native.page.locator(`[data-conversation-key$=":${tab.id}"] [data-tree-nav]`).click();
		await expect(native.page.getByTestId('composer-permission')).toHaveText('Read only');
		await expect(native.output()).toContainText('Source readonly turn complete');
		expect(saved().aiTabs.find((item) => item.id === tab.id)).toMatchObject({
			permissionMode: 'readonly',
			readOnlyMode: true,
		});
		await native.page.locator(`[data-conversation-key$=":${newTabId}"] [data-tree-nav]`).click();
		await expect(native.page.getByTestId('composer-permission')).toHaveText('Full Access');
		await native.page.keyboard.press('ControlOrMeta+1');
		await expect(native.page.getByTestId('composer-permission')).toHaveText('Read only');
		await native.page.keyboard.press('ControlOrMeta+t');
		await expect(native.page.getByTestId('empty-conversation-picker')).toBeVisible();
		await expect(native.page.getByTestId('composer-permission')).toHaveText('Read only');
		await native.send('Read after keyboard navigation');
		await expect(native.output()).toContainText('Keyboard readonly turn complete');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		const keyboardCall = fs
			.readFileSync(path.join(native.codex, 'fixture-invocations.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { args: string[] });
		expect(keyboardCall).toHaveLength(3);
		expect(keyboardCall[2].args[keyboardCall[2].args.indexOf('--sandbox') + 1]).toBe('read-only');
		expect(keyboardCall[2].args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('new shell permission inheritance: the owner window stays readonly', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
	seedNewShell(native);
	const sessions = ['owner-a', 'owner-b'].map((id, index) =>
		createMockSession({
			id,
			name: id,
			toolType: 'codex',
			cwd: fs.realpathSync(native.project),
			projectRoot: fs.realpathSync(native.project),
			customPath: path.resolve('e2e/fixtures/native/codex'),
			customEnvVars: { CODEX_HOME: native.codex, MAESTRO_NATIVE_SCRIPT: native.script },
			aiTabs: [
				createMockAITab({
					id: `${id}-tab`,
					createdAt: index + 1,
					permissionMode: 'full',
					readOnlyMode: false,
					saveToHistory: false,
				}),
			],
			activeTabId: `${id}-tab`,
			unifiedTabOrder: [{ type: 'ai', id: `${id}-tab` }],
		})
	);
	fs.writeFileSync(path.join(native.data, 'maestro-sessions.json'), JSON.stringify({ sessions }));
	let failed = false;
	try {
		await native.start(home);
		const opened = native.app.waitForEvent('window');
		expect(
			await native.page.evaluate(() => window.maestro.windows.create(['owner-b']))
		).not.toBeNull();
		const second = await opened;
		await second.waitForLoadState('domcontentloaded');
		await expect(second.getByTestId('composer-permission')).toHaveText('Full Access');
		await second.getByTestId('composer-permission').click();
		await second.getByRole('menuitemradio', { name: 'Read only', exact: true }).click();
		await second.locator('[data-conversation-key$=":owner-b-tab"] [data-tree-nav]').click();
		await expect(second.getByTestId('composer-permission')).toHaveText('Read only');
		const created = await native.cli('tab', 'new', '--agent', 'owner-a');
		expect(created.success).toBe(true);
		// The CLI reads the new tab once the owning window has reported it.
		const shown = () => native.cli('tab', 'show', created.tabId).catch(() => ({ tab: null }));
		await expect.poll(async () => (await shown()).tab?.permissionMode).toBe('readonly');
		expect((await shown()).tab).toMatchObject({ permissionMode: 'readonly', readOnly: true });
		await expect(native.page.getByTestId('composer-permission')).toHaveText('Read only');
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('new shell T5: stage commit and revert single files in a real worktree', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const isolatedHome = path.join(native.root, 'home');
	const worktree = path.join(native.root, 'worktree');
	fs.mkdirSync(isolatedHome, { recursive: true });
	// All Git configuration belongs to this fixture, including the app child's Git.
	fs.writeFileSync(
		path.join(isolatedHome, '.gitconfig'),
		'[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n'
	);
	const git = (cwd: string, ...args: string[]) =>
		execFileSync('git', args, {
			cwd,
			encoding: 'utf8',
			env: {
				...process.env,
				HOME: isolatedHome,
				USERPROFILE: isolatedHome,
				GIT_CONFIG_NOSYSTEM: '1',
				GIT_CONFIG_GLOBAL: path.join(isolatedHome, '.gitconfig'),
			},
		});
	git(native.project, 'init', '-b', 'main');
	git(native.project, 'config', 'user.name', 'Fixture');
	git(native.project, 'config', 'user.email', 'fixture@example.invalid');
	git(native.project, 'config', 'commit.gpgsign', 'false');
	git(native.project, 'config', 'core.hooksPath', path.join(native.root, 'hooks'));
	fs.writeFileSync(path.join(native.project, 'tracked.txt'), 'before\n');
	git(native.project, 'add', '.');
	git(native.project, 'commit', '-m', 'baseline');
	git(native.project, 'worktree', 'add', '-b', 'topic', worktree);
	fs.writeFileSync(path.join(native.project, 'tracked.txt'), 'main tree stays dirty\n');
	fs.writeFileSync(path.join(worktree, 'tracked.txt'), 'staged content\n');
	fs.writeFileSync(path.join(worktree, '-新 文件.txt'), 'new file\n');
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
	const tabId = 't5-conversation';
	const runner = createMockSession({
		id: 't5-project',
		name: 'T5 fixture',
		cwd: worktree,
		fullPath: worktree,
		projectRoot: worktree,
		isGitRepo: true,
		customPath: path.resolve('e2e/fixtures/native/claude'),
		customEnvVars: { CLAUDE_CONFIG_DIR: native.claude },
		aiTabs: [
			createMockAITab({
				id: tabId,
				name: 'Review changes',
				logs: [],
				newShellPanel: { tab: 'changes', open: true },
			}),
		],
		activeTabId: tabId,
		unifiedTabOrder: [{ type: 'ai', id: tabId }],
	});
	fs.writeFileSync(
		path.join(native.data, 'maestro-sessions.json'),
		JSON.stringify({ sessions: [runner], activeSessionId: runner.id })
	);
	let failed = false;
	try {
		await native.start(isolatedHome);
		await native.page.locator(`[data-conversation-key$=":${tabId}"] [data-tree-nav]`).click();
		const panel = native.page.getByTestId('changes-panel');
		await expect(native.page.locator('[data-panel="right"]')).toHaveAttribute('data-open', 'true');
		await expect(panel).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Commit', exact: true })).toBeDisabled();
		const stage = panel.getByRole('button', { name: 'Stage tracked.txt', exact: true });
		// Keyboard focus reveals the same affordance as pointer hover.
		await stage.focus();
		// :focus-within depends on OS window focus, which the Linux runner never has
		// even when document.hasFocus() says yes, so check the wiring instead.
		await expect(stage.locator('..')).toHaveClass(/group-focus-within\/changed-file:opacity-100/);
		await stage.press('Enter');
		await expect(panel.getByText('Staged (1)', { exact: true })).toBeVisible();
		expect(git(worktree, 'diff', '--cached', '--name-only')).toBe('tracked.txt\n');
		await panel.getByRole('button', { name: 'Unstage tracked.txt', exact: true }).click();
		await expect(panel.getByText('Staged (1)', { exact: true })).toHaveCount(0);
		expect(git(worktree, 'diff', '--cached', '--name-only')).toBe('');
		await panel.getByText('tracked.txt', { exact: true }).hover();
		await stage.click();
		await expect(panel.getByText('Staged (1)', { exact: true })).toBeVisible();
		fs.writeFileSync(path.join(worktree, 'tracked.txt'), 'later unstaged content\n');
		const input = panel.getByRole('textbox', { name: 'Commit message' });
		await input.fill('T5 commit');
		await input.press('ControlOrMeta+Enter');
		await expect(input).toHaveValue('');
		expect(git(worktree, 'show', 'HEAD:tracked.txt')).toBe('staged content\n');
		expect(git(worktree, 'status', '--porcelain', '--', 'tracked.txt')).toBe(' M tracked.txt\n');
		await panel.getByText('tracked.txt', { exact: true }).hover();
		await panel.getByRole('button', { name: 'Revert tracked.txt', exact: true }).click();
		const confirm = native.page.getByRole('dialog', { name: 'Revert file changes' });
		await expect(confirm).toContainText('tracked.txt');
		await confirm.getByRole('button', { name: 'Revert changes', exact: true }).click();
		await expect(
			panel.getByRole('button', { name: 'Revert tracked.txt', exact: true })
		).toHaveCount(0);
		expect(fs.readFileSync(path.join(worktree, 'tracked.txt'), 'utf8')).toBe('staged content\n');
		await panel.getByText('-新 文件.txt', { exact: true }).hover();
		await panel.getByRole('button', { name: 'Revert -新 文件.txt', exact: true }).click();
		await expect(confirm).toContainText('delete this new file');
		await expect(confirm).toContainText('-新 文件.txt');
		await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
		expect(fs.existsSync(path.join(worktree, '-新 文件.txt'))).toBe(true);
		await panel.getByText('-新 文件.txt', { exact: true }).hover();
		await panel.getByRole('button', { name: 'Revert -新 文件.txt', exact: true }).click();
		await confirm.getByRole('button', { name: 'Delete file', exact: true }).click();
		await expect(panel.getByText('No changes against the last commit.')).toBeVisible();
		expect(fs.existsSync(path.join(worktree, '-新 文件.txt'))).toBe(false);
		expect(git(worktree, 'status', '--porcelain')).toBe('');
		expect(git(native.project, 'diff', '--cached', '--name-only')).toBe('');
		expect(fs.readFileSync(path.join(native.project, 'tracked.txt'), 'utf8')).toBe(
			'main tree stays dirty\n'
		);

		// CLI readback and writes use the same selected worktree and IPC implementation.
		fs.writeFileSync(path.join(worktree, 'cli file.txt'), 'cli content\n');
		expect(await native.cli('changes', 'stage', 'cli file.txt', '--tab', tabId)).toMatchObject({
			success: true,
		});
		expect((await native.cli('changes', '--tab', tabId)).files).toContainEqual(
			expect.objectContaining({ path: 'cli file.txt', staged: true })
		);
		expect(await native.cli('changes', 'unstage', 'cli file.txt', '--tab', tabId)).toMatchObject({
			success: true,
		});
		await expect(native.cli('changes', 'revert', 'cli file.txt', '--tab', tabId)).rejects.toThrow();
		expect(fs.existsSync(path.join(worktree, 'cli file.txt'))).toBe(true);
		expect(
			await native.cli('changes', 'revert', 'cli file.txt', '--yes', '--tab', tabId)
		).toMatchObject({ success: true });
		expect(git(worktree, 'status', '--porcelain')).toBe('');
		fs.writeFileSync(path.join(worktree, 'cli file.txt'), 'cli content\n');
		await native.cli('changes', 'stage', 'cli file.txt', '--tab', tabId);
		expect(
			await native.cli('changes', 'commit', '--message', 'CLI commit', '--tab', tabId)
		).toMatchObject({ success: true });
		expect(git(worktree, 'show', 'HEAD:cli file.txt')).toBe('cli content\n');
		expect(git(worktree, 'status', '--porcelain')).toBe('');

		// A staged deletion and its same-name worktree file must stay one staged row.
		git(worktree, 'rm', '--cached', 'tracked.txt');
		await panel.getByRole('button', { name: 'Refresh changes' }).click();
		await expect(panel.getByText('Staged (1)', { exact: true })).toBeVisible();
		await expect(panel.getByTestId('changes-summary')).toContainText('1 file changed');
		await expect(panel.getByText('tracked.txt', { exact: true })).toHaveCount(1);
		await input.fill('staged deletion');
		await expect(panel.getByRole('button', { name: 'Commit 1 file', exact: true })).toBeEnabled();
		await panel.getByText('tracked.txt', { exact: true }).hover();
		await panel.getByRole('button', { name: 'Unstage tracked.txt', exact: true }).click();
		await expect(panel.getByText('No changes against the last commit.')).toBeVisible();
		expect(git(worktree, 'status', '--porcelain')).toBe('');
		expect(fs.readFileSync(path.join(worktree, 'tracked.txt'), 'utf8')).toBe('staged content\n');

		git(worktree, 'rm', 'tracked.txt');
		fs.writeFileSync(path.join(worktree, 'tracked.txt'), 'replacement\n');
		expect((await native.cli('changes', '--tab', tabId)).files).toContainEqual(
			expect.objectContaining({
				path: 'tracked.txt',
				status: 'deleted',
				staged: true,
				unstaged: true,
			})
		);
		expect(await native.cli('changes', 'unstage', 'tracked.txt', '--tab', tabId)).toMatchObject({
			success: true,
		});
		expect(git(worktree, 'status', '--porcelain')).toBe(' M tracked.txt\n');
		expect(fs.readFileSync(path.join(worktree, 'tracked.txt'), 'utf8')).toBe('replacement\n');
		expect(
			await native.cli('changes', 'revert', 'tracked.txt', '--yes', '--tab', tabId)
		).toMatchObject({ success: true });

		// RM must stage successfully alone and together with another changed path.
		const renamed = '改名 file.txt';
		git(worktree, 'mv', '--', 'tracked.txt', renamed);
		fs.writeFileSync(path.join(worktree, renamed), 'staged content\nlater\n');
		expect(git(worktree, 'status', '--porcelain=v2', '-z')).toContain('2 RM ');
		expect(await native.cli('changes', 'stage', renamed, '--tab', tabId)).toMatchObject({
			success: true,
		});
		expect(git(worktree, 'show', `:${renamed}`)).toBe('staged content\nlater\n');
		fs.writeFileSync(path.join(worktree, renamed), 'staged content\nlater\nbatch\n');
		fs.writeFileSync(path.join(worktree, 'cli file.txt'), 'cli content\nbatch\n');
		expect(
			await native.cli('changes', 'stage', renamed, 'cli file.txt', '--tab', tabId)
		).toMatchObject({ success: true });
		expect(git(worktree, 'show', `:${renamed}`)).toBe('staged content\nlater\nbatch\n');
		expect(git(worktree, 'show', ':cli file.txt')).toBe('cli content\nbatch\n');
		expect(git(worktree, 'diff', '--name-only')).toBe('');
		await panel.getByRole('button', { name: 'Refresh changes' }).click();
		await expect(panel.getByText('Staged (2)', { exact: true })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Commit 2 files', exact: true })).toBeEnabled();
		expect(git(native.project, 'diff', '--cached', '--name-only')).toBe('');
		expect(fs.readFileSync(path.join(native.project, 'tracked.txt'), 'utf8')).toBe(
			'main tree stays dirty\n'
		);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
		fs.rmSync(native.root, { recursive: true, force: true });
	}
});

// eslint-disable-next-line no-empty-pattern
test('new shell permission review: restore closed standard Claude after switching to Codex', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
	seedNewShell(native);
	let failed = false;
	try {
		await native.start(home);
		const owner = await native.createAgent('claude');
		await native.cli('tab', 'permission', 'active', 'standard', '--agent', owner);
		expect((await native.cli('tab', 'show', 'active', '--agent', owner)).tab.permissionMode).toBe(
			'standard'
		);
		await native.cli('tab', 'rename', 'active', 'Closed standard source', '--agent', owner);
		await native.cli('tab', 'close', 'active', '--agent', owner);
		await native.cli('update-agent', owner, '--provider', 'codex', '--force');
		await native.cli(
			'update-agent',
			owner,
			'--custom-path',
			path.resolve('e2e/fixtures/native/codex'),
			'--env',
			`CODEX_HOME=${native.codex}`,
			'--env',
			`MAESTRO_NATIVE_SCRIPT=${native.script}`
		);
		await expect(native.page.getByTestId('composer-permission')).toHaveText('Read only');
		await native.page.keyboard.press('ControlOrMeta+Shift+t');
		await expect(native.page.locator('[data-shell-header="main"]')).toContainText(
			'Closed standard source'
		);
		await expect(native.page.getByTestId('composer-permission')).toHaveText('Read only');
		// The CLI inventory follows the renderer's debounced persistence.
		await expect
			.poll(async () => (await native.cli('tab', 'show', 'active', '--agent', owner)).tab)
			.toMatchObject({
				permissionMode: 'readonly',
				readOnly: true,
				agentSessionId: null,
				name: 'Closed standard source',
			});
		native.scriptTurns([{ answer: 'Restored readonly conversation complete' }]);
		await native.send('Synthetic restored conversation');
		await expect(native.output()).toContainText('Restored readonly conversation complete');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		const invocations = fs
			.readFileSync(path.join(native.codex, 'fixture-invocations.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { args: string[] });
		expect(invocations).toHaveLength(1);
		expect(invocations[0].args[invocations[0].args.indexOf('--sandbox') + 1]).toBe('read-only');
		expect(invocations[0].args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

// This exercises the browser's real IPC route. The separate acceptance checklist
// also covers the browser-local permission control and its WebSocket transport.
// eslint-disable-next-line no-empty-pattern
test('new shell permission review: browser request tightens the desktop full source', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
	seedNewShell(native);
	let failed = false;
	try {
		await native.start(home);
		const owner = await native.createAgent('claude');
		await native.cli('tab', 'permission', 'active', 'full', '--agent', owner);
		const source = (await native.cli('tab', 'show', 'active', '--agent', owner)).tab;
		expect(source.permissionMode).toBe('full');
		const created = await native.page.evaluate(
			({ owner, sourceId }) => window.maestro.web.requestNewTab(owner, false, sourceId, 'readonly'),
			{ owner, sourceId: source.tabId }
		);
		expect(created).toMatchObject({ permissionMode: 'readonly', readOnlyMode: true });
		// Claude exposes readonly as plan mode; Codex calls the same field Read only.
		await expect(native.page.getByTestId('composer-permission')).toHaveText('Plan mode');
		await expect
			.poll(async () => {
				const list = await native.cli('session', 'list');
				return list.sessions.find((tab: { tabId: string }) => tab.tabId === created!.tabId);
			})
			.toMatchObject({ permissionMode: 'readonly', readOnly: true, active: true });
		expect((await native.cli('tab', 'show', source.tabId)).tab.permissionMode).toBe('full');
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

for (const scenario of ['timeout', 'moved project'] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`new shell permission review: owner ${scenario} cannot widen a new conversation`, async ({}, info) => {
		const native = new NativeApp(info, { providerCli: false });
		const home = path.join(native.root, 'home');
		fs.mkdirSync(home, { recursive: true });
		seedNewShell(native);
		const project = fs.realpathSync(native.project);
		const sessions = ['owner-a', 'owner-b'].map((id, index) =>
			createMockSession({
				id,
				name: id,
				toolType: 'codex',
				cwd: project,
				projectRoot: project,
				customPath: path.resolve('e2e/fixtures/native/codex'),
				customEnvVars: { CODEX_HOME: native.codex, MAESTRO_NATIVE_SCRIPT: native.script },
				aiTabs: [
					createMockAITab({
						id: `${id}-tab`,
						createdAt: index + 1,
						permissionMode: 'full',
						readOnlyMode: false,
						saveToHistory: false,
					}),
				],
				activeTabId: `${id}-tab`,
				unifiedTabOrder: [{ type: 'ai', id: `${id}-tab` }],
			})
		);
		fs.writeFileSync(path.join(native.data, 'maestro-sessions.json'), JSON.stringify({ sessions }));
		let failed = false;
		try {
			await native.start(home);
			const opened = native.app.waitForEvent('window');
			expect(
				await native.page.evaluate(() => window.maestro.windows.create(['owner-b']))
			).not.toBeNull();
			const second = await opened;
			await second.waitForLoadState('domcontentloaded');
			await expect(second.getByTestId('composer-permission')).toHaveText('Full Access');
			if (scenario === 'timeout') {
				await second.getByTestId('composer-permission').click();
				await second.getByRole('menuitemradio', { name: 'Read only', exact: true }).click();
				await expect(second.getByTestId('composer-permission')).toHaveText('Read only');
				const peerWindow = await native.app.browserWindow(second);
				// Drop only the permission query to reproduce a silent owner without
				// replacing its state or the real request timeout implementation.
				await peerWindow.evaluate((win) => {
					const send = win.webContents.send.bind(win.webContents);
					win.webContents.send = (channel: string, ...args: unknown[]) => {
						if (channel !== 'windows:readConversationPermissions') send(channel, ...args);
					};
				});
				const replies = await native.page.evaluate(() =>
					window.maestro.windows.getConversationPermissions(['owner-a', 'owner-b'])
				);
				expect(replies[0]?.tabs[0].permissionMode).toBe('full');
				expect(replies[1]).toBeNull();
			} else {
				await native.cli('tab', 'permission', 'owner-a-tab', 'readonly');
				const otherProject = path.join(native.root, 'other-project');
				fs.mkdirSync(otherProject);
				await native.cli('update-agent', 'owner-b', '--cwd', otherProject);
				await second.locator('[data-conversation-key$=":owner-b-tab"] [data-tree-nav]').click();
				const [snapshot] = await native.page.evaluate(() =>
					window.maestro.windows.getConversationPermissions(['owner-b'])
				);
				expect(snapshot).toMatchObject({
					projectKey: `path:local:${fs.realpathSync(otherProject)}`,
					host: null,
				});
				expect(snapshot!.tabs[0].permissionMode).toBe('full');
			}
			const created = await native.cli('tab', 'new', '--agent', 'owner-a');
			expect(created.success).toBe(true);
			await expect(native.page.getByTestId('composer-permission')).toHaveText('Read only');
			await expect
				.poll(async () => {
					const list = await native.cli('session', 'list');
					return list.sessions.find((tab: { tabId: string }) => tab.tabId === created.tabId);
				})
				.toMatchObject({ permissionMode: 'readonly', readOnly: true });
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			await native.close(failed);
		}
	});
}

// eslint-disable-next-line no-empty-pattern
test('new shell T8: group two synthetic write turns and preserve the conversation choice', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const isolatedHome = path.join(native.root, 'home');
	fs.mkdirSync(isolatedHome, { recursive: true });
	seedNewShell(native);
	const git = (...args: string[]) =>
		execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
			cwd: native.project,
			encoding: 'utf8',
			env: {
				...process.env,
				HOME: isolatedHome,
				USERPROFILE: isolatedHome,
				GIT_CONFIG_NOSYSTEM: '1',
				GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
			},
		});
	git('init', '-b', 'main');
	git('config', 'user.name', 'Fixture');
	git('config', 'user.email', 'fixture@example.invalid');
	git('config', 'commit.gpgsign', 'false');
	fs.writeFileSync(path.join(native.project, 'first.ts'), 'before\n');
	fs.writeFileSync(path.join(native.project, 'second.ts'), 'before\n');
	git('add', '.');
	git('commit', '-m', 'Synthetic baseline');
	fs.writeFileSync(path.join(native.project, 'first.ts'), 'first round then second round\n');
	fs.writeFileSync(path.join(native.project, 'second.ts'), 'second round\n');
	fs.writeFileSync(path.join(native.project, 'manual.txt'), 'manual change\n');
	const logs = transcriptMessagesToLogEntries([
		{
			type: 'user',
			uuid: 'round-1',
			timestamp: '2026-11-06T09:00:00Z',
			content: 'First round\nMore detail',
		},
		{
			type: 'assistant',
			uuid: 'write-1',
			timestamp: '2026-11-06T09:00:01Z',
			content: '',
			toolUse: [
				{
					type: 'tool_use',
					id: 'edit-first',
					name: 'Edit',
					input: { file_path: path.join(native.project, 'first.ts') },
				},
			],
		},
		{
			type: 'user',
			uuid: 'result-1',
			timestamp: '2026-11-06T09:00:02Z',
			content: '',
			toolUse: [{ type: 'tool_result', tool_use_id: 'edit-first', content: 'Updated' }],
		},
		{ type: 'user', uuid: 'round-2', timestamp: '2026-11-06T09:01:00Z', content: 'Second round' },
		{
			type: 'assistant',
			uuid: 'write-2',
			timestamp: '2026-11-06T09:01:01Z',
			content: '',
			toolUse: [
				{
					tool: 'apply_patch',
					id: 'patch-two',
					state: {
						status: 'completed',
						input:
							'*** Begin Patch\n*** Update File: first.ts\n@@\n-before\n+first round then second round\n*** Update File: second.ts\n@@\n-before\n+second round\n*** End Patch',
					},
				},
			],
		},
	]);
	const tabId = 't8-recorded-turns';
	logs.push(
		...Array.from({ length: 150 }, (_, index) => ({
			id: `t8-later-${index}`,
			source: 'stdout' as const,
			text: 'Later progress',
			timestamp: Date.parse('2026-11-06T09:02:00Z') + index,
		}))
	);
	const runner = createMockSession({
		id: 't8-project',
		name: 'T8 fixture',
		cwd: native.project,
		fullPath: native.project,
		projectRoot: native.project,
		isGitRepo: true,
		customPath: path.resolve('e2e/fixtures/native/claude'),
		customEnvVars: { CLAUDE_CONFIG_DIR: native.claude },
		aiTabs: [
			createMockAITab({
				id: tabId,
				name: 'Recorded turns',
				logs,
				newShellPanel: { tab: 'changes', open: true },
			}),
			createMockAITab({
				id: 't8-empty',
				name: 'No writes',
				logs: [],
				newShellPanel: { tab: 'changes', open: true },
			}),
		],
		activeTabId: tabId,
		unifiedTabOrder: [
			{ type: 'ai', id: tabId },
			{ type: 'ai', id: 't8-empty' },
		],
	});
	fs.writeFileSync(
		path.join(native.data, 'maestro-sessions.json'),
		JSON.stringify({ sessions: [runner], activeSessionId: runner.id })
	);
	const select = async (id: string) =>
		native.page.locator(`[data-conversation-key$=":${id}"] [data-tree-nav]`).click();
	let failed = false;
	try {
		await native.start(isolatedHome);
		await select(tabId);
		const panel = native.page.getByTestId('changes-panel');
		await expect(native.page.locator('[data-panel="right"]')).toHaveAttribute('data-open', 'true');
		await expect(panel).toBeVisible();
		await expect(panel.getByRole('radio', { name: 'By file', exact: true })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		await panel.getByRole('radio', { name: 'By turn', exact: true }).click();
		const headings = panel.getByTestId('changes-group-title');
		await expect(headings).toHaveCount(3);
		await expect(headings.nth(0)).toContainText('Second round');
		await expect(headings.nth(1)).toContainText('First round');
		await expect(headings.nth(2)).toHaveText('Other changes');
		await expect(panel.getByRole('button', { name: 'first.ts', exact: true })).toHaveCount(2);
		await expect(panel.getByRole('button', { name: 'second.ts', exact: true })).toHaveCount(1);
		await panel.getByRole('button', { name: 'Diff first.ts', exact: true }).first().click();
		await expect(
			panel.getByText('first round then second round', { exact: true }).first()
		).toBeVisible();
		await panel.getByRole('button', { name: 'Stage first.ts', exact: true }).first().click();
		await expect(panel.getByRole('button', { name: 'Unstage first.ts', exact: true })).toHaveCount(
			2
		);
		expect(git('diff', '--cached', '--name-only').trim()).toBe('first.ts');
		const grouped = await native.cli('changes', '--by-turn', '--tab', tabId);
		expect(grouped).toMatchObject({ diffScope: 'current', hasWriteRecords: true });
		expect(
			grouped.groups.map((group: { turnId: string | null; files: Array<{ path: string }> }) => [
				group.turnId,
				group.files.map((file) => file.path),
			])
		).toEqual([
			['round-2', ['first.ts', 'second.ts']],
			['round-1', ['first.ts']],
			[null, ['manual.txt']],
		]);
		await select('t8-empty');
		await expect(panel.getByRole('radio', { name: 'By file', exact: true })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		await native.cli('tab', 'panel', 't8-empty', 'changes-turns');
		await expect(panel).toContainText('No recorded file writes in this conversation.');
		await select(tabId);
		await expect(headings).toHaveCount(3);
		await native.cli('tab', 'panel', tabId, 'changes-files');
		await expect(panel.getByRole('radio', { name: 'By file', exact: true })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		await native.cli('tab', 'panel', tabId, 'changes-turns');
		await native.restart(isolatedHome);
		await select(tabId);
		await expect(native.page.getByTestId('changes-group-title')).toHaveCount(3);
		await expect(native.page.getByRole('radio', { name: 'By turn', exact: true })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		const afterRestart = await native.cli('changes', '--by-turn', '--tab', tabId);
		expect(afterRestart.groups).toEqual(grouped.groups);
		const saved = JSON.parse(
			fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')
		)
			.sessions.find((item: Session) => item.id === runner.id)
			.aiTabs.find((tab: AITab) => tab.id === tabId);
		expect(saved.logs).toHaveLength(100);
		expect(saved.logs.some((entry: { id: string }) => entry.id === 'round-1')).toBe(false);
		expect(saved.changeTurnIndex.turns.map((turn: { turnId: string }) => turn.turnId)).toEqual([
			'round-2',
			'round-1',
		]);
		expect(fs.existsSync(path.join(native.claude, 'fixture-turn-count'))).toBe(false);
		expect(fs.existsSync(path.join(native.codex, 'fixture-turn-count'))).toBe(false);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
		fs.rmSync(native.root, { recursive: true, force: true });
	}
});

for (const provider of ['claude-code', 'codex'] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`new shell T8: ${provider} indexes long native history without scrolling`, async ({}, info) => {
		const native = new NativeApp(info, { providerCli: false });
		const isolatedHome = path.join(native.root, 'home');
		fs.mkdirSync(isolatedHome, { recursive: true });
		seedNewShell(native);
		execFileSync('git', ['init', '-b', 'main'], {
			cwd: native.project,
			env: {
				...process.env,
				HOME: isolatedHome,
				USERPROFILE: isolatedHome,
				GIT_CONFIG_NOSYSTEM: '1',
				GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
			},
		});
		fs.writeFileSync(path.join(native.project, 'early.ts'), 'x'.repeat(5000));
		const nativeId = '11111111-2222-4333-8444-555555555555';
		const timestamp = '2026-11-06T09:00:00Z';
		const userText = 'Early native round';
		const patch = `*** Begin Patch\n*** Add File: early.ts\n+${'x'.repeat(5000)}\n*** End Patch`;
		const records =
			provider === 'claude-code'
				? [
						{
							type: 'user',
							uuid: 'early-user',
							timestamp,
							cwd: native.project,
							sessionId: nativeId,
							message: { role: 'user', content: userText },
						},
						{
							type: 'assistant',
							uuid: 'early-tool',
							timestamp,
							message: {
								role: 'assistant',
								content: [
									{
										type: 'tool_use',
										id: 'large-write',
										name: 'Write',
										input: {
											file_path: path.join(native.project, 'early.ts'),
											content: 'x'.repeat(5000),
										},
									},
								],
							},
						},
						{
							type: 'user',
							uuid: 'early-result',
							timestamp,
							message: {
								role: 'user',
								content: [{ type: 'tool_result', tool_use_id: 'large-write', content: 'ok' }],
							},
						},
						...Array.from({ length: 600 }, (_, index) => ({
							type: 'assistant',
							uuid: `later-${index}`,
							timestamp,
							message: {
								role: 'assistant',
								content: [{ type: 'text', text: `Progress ${index}` }],
							},
						})),
					]
				: [
						{
							type: 'session_meta',
							timestamp,
							payload: { id: nativeId, cwd: native.project, timestamp },
						},
						{
							type: 'response_item',
							timestamp,
							payload: {
								type: 'message',
								id: 'early-user',
								role: 'user',
								content: [{ type: 'input_text', text: userText }],
							},
						},
						{
							type: 'item.completed',
							timestamp,
							item: { type: 'tool_call', id: 'large-write', tool: 'apply_patch', args: patch },
						},
						{
							type: 'item.completed',
							timestamp,
							item: {
								type: 'tool_result',
								id: 'result-envelope',
								call_id: 'large-write',
								output: 'ok',
								is_error: false,
							},
						},
						...Array.from({ length: 600 }, (_, index) => ({
							type: 'response_item',
							timestamp,
							payload: {
								type: 'message',
								id: `later-${index}`,
								role: 'assistant',
								content: [{ type: 'output_text', text: `Progress ${index}` }],
							},
						})),
					];
		const transcriptDir =
			provider === 'claude-code'
				? path.join(native.claude, 'projects', encodeClaudeProjectPath(native.project))
				: path.join(native.codex, 'sessions', '2026', '11', '06');
		fs.mkdirSync(transcriptDir, { recursive: true });
		const transcript = path.join(
			transcriptDir,
			provider === 'claude-code'
				? `${nativeId}.jsonl`
				: `rollout-2026-11-06T09-00-00-${nativeId}.jsonl`
		);
		const bytes = Buffer.from(records.map((record) => JSON.stringify(record)).join('\n') + '\n');
		fs.writeFileSync(transcript, bytes);
		const tabId = 'long-history';
		const runner = createMockSession({
			id: 't8-native-project',
			name: 'Long native history',
			toolType: provider,
			cwd: native.project,
			fullPath: native.project,
			projectRoot: native.project,
			isGitRepo: true,
			customPath: path.resolve(`e2e/fixtures/native/${provider === 'codex' ? 'codex' : 'claude'}`),
			customEnvVars:
				provider === 'codex' ? { CODEX_HOME: native.codex } : { CLAUDE_CONFIG_DIR: native.claude },
			aiTabs: [
				createMockAITab({
					id: tabId,
					agentSessionId: nativeId,
					name: 'Long native history',
					logs: transcriptMessagesToLogEntries(
						Array.from({ length: 100 }, (_, index) => ({
							type: 'assistant',
							uuid: `later-${500 + index}`,
							content: `Progress ${500 + index}`,
							timestamp,
						}))
					),
					newShellPanel: { tab: 'changes', changesView: 'turn', open: true },
				}),
			],
			activeTabId: tabId,
			unifiedTabOrder: [{ type: 'ai', id: tabId }],
		});
		fs.writeFileSync(
			path.join(native.data, 'maestro-sessions.json'),
			JSON.stringify({ sessions: [runner], activeSessionId: runner.id })
		);
		let failed = false;
		try {
			await native.start(isolatedHome);
			await native.page.locator(`[data-conversation-key$=":${tabId}"] [data-tree-nav]`).click();
			await expect(native.page.getByTestId('changes-group-title')).toContainText(userText);
			const grouped = await native.cli('changes', '--by-turn', '--tab', tabId);
			expect(grouped.groups).toEqual([
				expect.objectContaining({
					turnId: 'early-user',
					title: userText,
					files: [expect.objectContaining({ path: 'early.ts' })],
				}),
			]);
			await native.restart(isolatedHome);
			await native.page.locator(`[data-conversation-key$=":${tabId}"] [data-tree-nav]`).click();
			await expect(native.page.getByTestId('changes-group-title')).toContainText(userText);
			expect((await native.cli('changes', '--by-turn', '--tab', tabId)).groups).toEqual(
				grouped.groups
			);
			expect(fs.readFileSync(transcript)).toEqual(bytes);
			expect(fs.existsSync(path.join(native.claude, 'fixture-turn-count'))).toBe(false);
			expect(fs.existsSync(path.join(native.codex, 'fixture-turn-count'))).toBe(false);
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (native.app) await native.close(failed);
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	});
}
