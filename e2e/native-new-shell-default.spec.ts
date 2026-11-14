import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'shell defaults use synthetic providers only');
test.setTimeout(120_000);

for (const upgraded of [false, true]) {
	// eslint-disable-next-line no-empty-pattern
	test(`new shell default: ${upgraded ? 'classic upgrade' : 'fresh data directory'}`, async ({}, info) => {
		const native = new NativeApp(info, { providerCli: false });
		const settingsFile = path.join(native.data, 'maestro-settings.json');
		if (upgraded) {
			fs.writeFileSync(
				settingsFile,
				JSON.stringify({
					uiLanguage: 'en',
					newShell: false,
					typographyPromptSeen: true,
					themePromptSeen: true,
					agentPowersPromptSeen: true,
					tourCompleted: true,
				})
			);
		} else fs.rmSync(settingsFile);
		const settings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
		let failed = false;
		try {
			await native.start();
			await expect(native.page.getByTestId('project-start')).toBeAttached();
			await expect(native.page.getByTestId('updates-choice-confirm')).toBeVisible();
			await native.page.getByTestId('updates-choice-confirm').click();
			await expect(native.page.getByTestId('project-start')).toBeVisible();
			await expect(native.page.getByTestId('typography-choice-confirm')).toHaveCount(0);
			await expect(native.page.getByTestId('theme-choice-confirm')).toHaveCount(0);
			await expect(native.page.getByTestId('agent-powers-confirm')).toHaveCount(0);
			await expect(native.page.getByText('Create your first agent', { exact: true })).toHaveCount(
				0
			);
			expect(settings()).toMatchObject({ newShell: true, newShellChoice: 'auto' });
			if (upgraded) {
				await native.cli('open', 'settings', '--tab', 'display');
				const toggle = native.page
					.getByRole('dialog', { name: 'Settings', exact: true })
					.locator('[data-setting-id="display-new-shell"]')
					.getByRole('switch', { name: 'Use the new shell', exact: true });
				await expect(toggle).toBeChecked();
				await toggle.click();
				await expect.poll(() => settings().newShellChoice).toBe('classic');
				await native.page.keyboard.press('Escape');
				await expect(native.page.getByTestId('project-start')).toHaveCount(0);
				await native.restart();
				expect(settings()).toMatchObject({ newShell: false, newShellChoice: 'classic' });
				expect(await native.cli('settings', 'get', 'newShell')).toMatchObject({ value: false });
				await expect(
					native.page.getByText('Create your first agent', { exact: true })
				).toBeVisible();
				await native.cli('settings', 'set', 'newShell', 'true');
				await expect(native.page.getByTestId('project-start')).toBeVisible();
				await native.restart();
				expect(settings()).toMatchObject({ newShell: true, newShellChoice: 'new' });
				await expect(native.page.getByTestId('project-start')).toBeVisible();
			}
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (native.app) await native.close(failed);
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	});
}

for (const upgraded of [false, true]) {
	// eslint-disable-next-line no-empty-pattern
	test(`new shell default: restores conversation panels after ${upgraded ? 'automatic upgrade' : 'explicit opt-in'}`, async ({}, info) => {
		const native = new NativeApp(info, { providerCli: false });
		const settingsFile = path.join(native.data, 'maestro-settings.json');
		const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
		settings.newShell = !upgraded;
		if (upgraded) delete settings.newShellChoice;
		else settings.newShellChoice = 'new';
		fs.writeFileSync(settingsFile, JSON.stringify(settings));
		const runner = createMockSession({
			id: 'panel-owner',
			cwd: native.project,
			fullPath: native.project,
			projectRoot: native.project,
			customPath: path.resolve('e2e/fixtures/native/claude'),
			customEnvVars: { CLAUDE_CONFIG_DIR: native.claude },
			aiTabs: [
				createMockAITab({
					id: 'panel-open',
					name: 'Open changes',
					newShellPanel: { tab: 'changes', open: true },
				}),
				createMockAITab({
					id: 'panel-closed',
					name: 'Closed changes',
					newShellPanel: { tab: 'changes', open: false },
				}),
			],
			activeTabId: 'panel-open',
			unifiedTabOrder: [
				{ type: 'ai', id: 'panel-open' },
				{ type: 'ai', id: 'panel-closed' },
			],
		});
		fs.writeFileSync(
			path.join(native.data, 'maestro-sessions.json'),
			JSON.stringify({ sessions: [runner], activeSessionId: runner.id })
		);
		let failed = false;
		try {
			await native.start();
			// A new window defaults to collapsed. The conversation choice wins
			// without first clicking Open or writing a replacement via the CLI.
			await expect(native.page.locator('[data-panel="right"]')).toHaveAttribute(
				'data-open',
				'true'
			);
			await expect(native.page.getByTestId('changes-panel')).toBeVisible();
			expect((await native.cli('tab', 'panel', 'panel-open')).tab.newShellPanel).toMatchObject({
				tab: 'changes',
				open: true,
			});
			expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))).toMatchObject({
				newShell: true,
				newShellChoice: upgraded ? 'auto' : 'new',
			});
			await native.page
				.locator('[data-panel="right"]')
				.getByTitle(/^Collapse Right Panel/)
				.click();
			await expect(native.page.locator('[data-panel="right"]')).toHaveAttribute(
				'data-open',
				'false'
			);
			await expect
				.poll(async () => (await native.cli('tab', 'panel', 'panel-open')).tab.newShellPanel.open)
				.toBe(false);
			await native.restart();
			await expect(native.page.locator('[data-panel="right"]')).toHaveAttribute(
				'data-open',
				'false'
			);
			await native.cli('tab', 'panel', 'panel-open', 'open');
			await expect(native.page.getByTestId('changes-panel')).toBeVisible();
			await native.restart();
			await expect(native.page.locator('[data-panel="right"]')).toHaveAttribute(
				'data-open',
				'true'
			);
			await expect(native.page.getByTestId('changes-panel')).toBeVisible();
			await native.page.locator('[data-conversation-key$=":panel-closed"] [data-tree-nav]').click();
			await expect(native.page.locator('[data-panel="right"]')).toHaveAttribute(
				'data-open',
				'false'
			);
			expect((await native.cli('tab', 'panel', 'panel-closed')).tab.newShellPanel.open).toBe(false);
			await native.page.locator('[data-conversation-key$=":panel-open"] [data-tree-nav]').click();
			await expect(native.page.getByTestId('changes-panel')).toBeVisible();
			expect(fs.existsSync(path.join(native.claude, 'fixture-turn-count'))).toBe(false);
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (native.app) await native.close(failed);
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	});
}
