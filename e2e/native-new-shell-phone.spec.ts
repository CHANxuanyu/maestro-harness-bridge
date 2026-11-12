import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';
import { NativeApp, type NativeScene } from './fixtures/native-app';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'The phone layout uses synthetic providers only');

/**
 * Opens the browser interface in a second Electron window emulating a phone.
 * The page loads the web-desktop bundle over HTTP with no preload, exactly what
 * a phone browser receives, so `window.maestro` is the WebSocket bridge.
 */
async function openPhone(native: NativeApp, url: string): Promise<Page> {
	const opened = native.app.waitForEvent('window');
	await native.app.evaluate(({ BrowserWindow }, target) => {
		const win = new BrowserWindow({ width: 390, height: 844, show: true });
		void win.loadURL(target);
	}, url);
	const phone = await opened;
	const cdp = await native.app.context().newCDPSession(phone);
	await cdp.send('Emulation.setDeviceMetricsOverride', {
		width: 390,
		height: 844,
		deviceScaleFactor: 3,
		mobile: true,
	});
	await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	// The layout breakpoint and pointer type are read at boot.
	await phone.reload();
	await expect(phone.locator('[data-shell-header="main"]')).toBeVisible({ timeout: 30_000 });
	return phone;
}

// eslint-disable-next-line no-empty-pattern
test('new shell phone: header, composer, drawer, right panel, send, hand off and open project', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	const second = path.join(native.root, 'second-project');
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(second, { recursive: true });
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
	git('config', 'user.name', 'Synthetic phone');
	git('config', 'user.email', 'phone@example.invalid');
	git('config', 'commit.gpgsign', 'false');
	fs.writeFileSync(path.join(native.project, 'cart.ts'), 'export const shipping = 12;\n');
	git('add', '.');
	git('commit', '-m', 'Synthetic baseline');
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
	fs.writeFileSync(
		path.join(native.data, 'maestro-agent-configs.json'),
		JSON.stringify({
			configs: {
				'claude-code': {
					customPath: path.resolve('e2e/fixtures/native/claude'),
					customEnvVars: { CLAUDE_CONFIG_DIR: native.claude, MAESTRO_NATIVE_SCRIPT: native.script },
				},
				codex: {
					customPath: path.resolve('e2e/fixtures/native/codex'),
					customEnvVars: { CODEX_HOME: native.codex, MAESTRO_NATIVE_SCRIPT: native.script },
				},
			},
		})
	);
	const scene = (value: NativeScene) =>
		fs.writeFileSync(
			native.script,
			JSON.stringify({ scene: value, synopsis: { answer: 'Synthetic summary' } })
		);
	let failed = false;
	let phoneForFailure: Page | undefined;
	try {
		await native.start(home);
		await native.app.evaluate(({ dialog }, project) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
		}, native.project);
		await native.page.getByRole('button', { name: 'Open project folder', exact: true }).click();
		await expect(native.input()).toBeFocused();
		scene({
			answer: 'Shipping is free over 80. See [cart.ts](cart.ts:2).',
			writes: { 'cart.ts': 'export const shipping = 0;\nexport const threshold = 80;\n' },
			tools: [
				{ id: 'write-cart', command: 'write cart.ts', output: 'cart.ts updated' },
				{
					id: 'plan',
					name: 'TodoWrite',
					command: '',
					output: 'Plan saved',
					input: {
						todos: [
							{ content: 'Implement shipping', status: 'completed' },
							{ content: 'Review shipping', status: 'in_progress' },
						],
					},
				},
			],
		});
		await native.send('Make shipping free over 80');
		await expect(native.output()).toContainText('Shipping is free over 80.');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);

		// A browser reads conversations from the desktop's saved copy, which lands
		// on the debounced save after the screen updates.
		const savedText = () =>
			fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8');
		await expect.poll(savedText).toContain('Shipping is free over 80.');
		const started = await native.page.evaluate(() => window.maestro.live.startServer());
		expect(started).toMatchObject({ success: true });
		// The server listens on every interface; the phone window uses loopback.
		const phoneUrl = new URL((started as { url: string }).url);
		phoneUrl.hostname = '127.0.0.1';
		const phone = await openPhone(native, phoneUrl.toString());
		phoneForFailure = phone;
		const backdrop = phone.locator('.maestro-mobile-backdrop');
		const header = phone.locator('[data-shell-header="main"]');

		await test.step('the header gives the title the room and the composer is open', async () => {
			const title = header.getByText('Make shipping free over 80', { exact: true });
			await expect(title).toBeVisible();
			expect((await title.boundingBox())!.width).toBeGreaterThan(150);
			const handoff = header.getByTestId('header-handoff');
			await expect(handoff).toHaveAccessibleName('Hand off to…');
			expect((await handoff.innerText()).trim()).toBe('');
			await expect(phone.getByPlaceholder(/^Message /)).toBeVisible();
		});

		await test.step('the composer sheet offers what the desktop new shell offers', async () => {
			await phone.getByTestId('composer-options-button').click();
			const sheet = phone.getByRole('dialog', { name: 'Composer options' });
			await expect(sheet).toBeVisible();
			await expect(sheet.getByTestId('composer-options-history')).toHaveCount(0);
			await sheet.getByRole('button', { name: 'Close', exact: true }).click();
			await expect(sheet).toHaveCount(0);
		});

		await test.step('the drawer titles the row and closes when a conversation is picked', async () => {
			await phone.getByRole('button', { name: 'Show projects and conversations' }).click();
			await expect(backdrop).toHaveCount(1);
			const row = phone
				.locator('[data-conversation-key]')
				.filter({ hasText: 'Make shipping free over 80' });
			await expect(row).toBeVisible();
			await row.locator(':scope > div > button[data-tree-nav]').last().click();
			await expect(backdrop).toHaveCount(0);
		});

		await test.step('switching right panel tabs keeps the panel open', async () => {
			await header.getByTitle(/^Show right panel/).click();
			await expect(backdrop).toHaveCount(1);
			await phone.locator('[data-tour="terminal-tab"]').click();
			await expect(phone.locator('.xterm').first()).toBeVisible();
			await expect(backdrop).toHaveCount(1);
			await phone.locator('[data-tour="tasks-tab"]').click();
			await expect(phone.getByText('Review shipping', { exact: true })).toBeVisible();
			await phone.locator('[data-tour="changes-tab"]').click();
			await phone
				.getByTestId('changes-list')
				.getByRole('button', { name: 'cart.ts', exact: true })
				.click();
			await expect(phone.locator('[data-tour="files-panel"]')).toContainText('threshold');
			await expect(backdrop).toHaveCount(1);
			await phone
				.locator('[data-shell-header="right"]')
				.getByTitle(/^Collapse Right Panel/)
				.click();
			await expect(backdrop).toHaveCount(0);
		});

		await test.step('a message sent from the phone gets its answer there', async () => {
			scene({ answer: 'Threshold confirmed from the phone.' });
			const composer = phone.getByPlaceholder(/^Message /);
			await composer.fill('Is the threshold still 80?');
			await composer.press('Enter');
			await expect(phone.getByLabel('Terminal output', { exact: true })).toContainText(
				'Threshold confirmed from the phone.'
			);
			await expect(native.output()).toContainText('Threshold confirmed from the phone.');
		});

		await test.step('hand off opens the same dialog on the phone', async () => {
			await header.getByTestId('header-handoff').click();
			const dialog = phone.getByTestId('ai-handoff-modal');
			await expect(dialog).toBeVisible();
			await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(dialog).toHaveCount(0);
		});

		await test.step('open project asks for a path instead of a desktop folder dialog', async () => {
			await native.app.evaluate(({ dialog }) => {
				dialog.showOpenDialog = async () => {
					(globalThis as { phoneDialogs?: number }).phoneDialogs =
						((globalThis as { phoneDialogs?: number }).phoneDialogs ?? 0) + 1;
					return { canceled: true, filePaths: [] };
				};
			});
			await phone.getByRole('button', { name: 'Show projects and conversations' }).click();
			await phone.getByRole('button', { name: 'Open project…', exact: true }).click();
			const input = phone.getByTestId('open-project-path').locator('input');
			await expect(input).toBeVisible();
			await input.fill(second);
			await input.press('Enter');
			await expect(input).toHaveCount(0);
			await expect(backdrop).toHaveCount(0);
			await expect(phone.getByTestId('empty-conversation-picker')).toContainText('second-project');
			const desktopDialogs = await native.app.evaluate(
				() => (globalThis as { phoneDialogs?: number }).phoneDialogs ?? 0
			);
			expect(desktopDialogs).toBe(0);
		});
	} catch (error) {
		failed = true;
		await phoneForFailure
			?.screenshot({ path: info.outputPath('phone-failure.png') })
			.catch(() => undefined);
		throw error;
	} finally {
		await native.close(failed);
	}
});
