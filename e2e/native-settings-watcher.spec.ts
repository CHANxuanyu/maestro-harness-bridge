import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/native-app';

// The scenario launches no agent CLI, so real mode must not resolve one.
test.use({ nativeProviderCli: false });

test('settings watcher: immediate CLI write after an app write updates the window', async ({
	native,
}) => {
	const english = native.page.getByText('Create your first agent', { exact: true });
	await expect(english).toBeVisible();

	// Use an explicit IPC write, independent of agent or turn-end timing.
	await native.page.evaluate(() => window.maestro.settings.set('logLevel', 'debug'));
	const settingsPath = path.join(native.data, 'maestro-settings.json');
	const internalWriteAt = fs.statSync(settingsPath).mtimeMs;
	await native.cli('settings', 'set', 'uiLanguage', 'zh-CN');
	const cliWriteAt = fs.statSync(settingsPath).mtimeMs;
	// A slow CLI startup must not turn this into a false pass on the old code.
	expect(cliWriteAt - internalWriteAt).toBeLessThan(500);
	expect(await native.page.evaluate(() => window.maestro.settings.get('uiLanguage'))).toBe('zh-CN');
	await expect(native.page.getByText('创建你的第一个智能体', { exact: true })).toBeVisible({
		timeout: 5000,
	});
	await expect(english).toHaveCount(0);
});
