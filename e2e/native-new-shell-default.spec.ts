import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';

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
