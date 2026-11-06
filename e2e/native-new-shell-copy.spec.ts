import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';

// No provider creation or prompt sending. All settings and account homes are temporary.
test('new shell copy: update preferences remain neutral and keep saved choices', async ({}, info) => {
	expect(process.env.MAESTRO_E2E_REAL).not.toBe('1');
	const native = new NativeApp(info, { providerCli: false });
	const homeDir = path.join(native.root, 'home');
	fs.mkdirSync(homeDir);
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			updatesPromptSeen: false,
			checkForUpdatesOnStartup: false,
			enableBetaUpdates: false,
			crashReportingEnabled: false,
		})
	);
	let failed = true;
	try {
		await native.start(homeDir);
		const modal = native.page.getByTestId('updates-choice-modal');
		await expect(
			modal.getByRole('heading', { name: 'Update preferences', exact: true })
		).toBeVisible();
		await expect(modal.getByText('Recommended', { exact: true })).toHaveCount(0);
		await expect(modal.getByTestId('updates-choice-crash-reports')).toContainText('after restart');
		await native.cliWithEnv({ HOME: homeDir }, 'settings', 'set', 'uiLanguage', 'zh-CN');
		await expect(modal.getByRole('heading', { name: '更新偏好', exact: true })).toBeVisible();
		await expect(modal.getByText('推荐', { exact: true })).toHaveCount(0);
		await expect(modal.getByTestId('updates-choice-crash-reports')).toContainText(
			'此设置在重启后生效'
		);
		for (const key of ['checkForUpdatesOnStartup', 'enableBetaUpdates', 'crashReportingEnabled']) {
			expect(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))[key]).toBe(false);
		}
		await native.cliWithEnv({ HOME: homeDir }, 'settings', 'set', 'newShell', 'false');
		await expect(modal.getByText('推荐', { exact: true })).toBeVisible();
		await expect(
			modal.getByRole('heading', { name: '抢先体验最新功能', exact: true })
		).toBeVisible();
		await native.cliWithEnv({ HOME: homeDir }, 'settings', 'set', 'newShell', 'true');
		await expect(modal.getByRole('heading', { name: '更新偏好', exact: true })).toBeVisible();
		await modal.getByTestId('updates-choice-beta').click();
		await expect
			.poll(() => JSON.parse(fs.readFileSync(settingsFile, 'utf8')).enableBetaUpdates)
			.toBe(true);
		await modal.getByTestId('updates-choice-beta').click();
		await expect
			.poll(() => JSON.parse(fs.readFileSync(settingsFile, 'utf8')).enableBetaUpdates)
			.toBe(false);
		await modal.getByTestId('updates-choice-confirm').click();
		await expect(modal).toHaveCount(0);
		await expect
			.poll(() => JSON.parse(fs.readFileSync(settingsFile, 'utf8')).updatesPromptSeen)
			.toBe(true);
		failed = false;
	} finally {
		try {
			if (native.app) await native.close(failed);
		} finally {
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	}
});
