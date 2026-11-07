import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';

test.setTimeout(120_000);
// eslint-disable-next-line no-empty-pattern
test('Codex prototype synthetic approval, steering, resume and stop', async ({}, info) => {
	if (process.env.MAESTRO_E2E_REAL === '1') throw new Error('This test requires synthetic mode');
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'isolated-home');
	fs.mkdirSync(home);
	const settings = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settings,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settings, 'utf8')),
			newShell: true,
			codexAppServer: true,
			defaultSaveToHistory: false,
			crashReportingEnabled: false,
		})
	);
	try {
		await native.start(home);
		const owner = await native.createAgent('codex', {
			executable: path.resolve('e2e/fixtures/native/codex-app-server'),
			env: { MAESTRO_APP_SERVER_FIXTURE_ROOT: native.root },
		});
		await native.cli('tab', 'permission', 'active', 'standard', '--agent', owner);
		await native.send('file approval allow');
		const dialog = native.page.getByRole('dialog', { name: 'Permission request' });
		await expect(dialog).toContainText('Codex wants to use');
		await expect(dialog).toContainText('approved.txt');
		expect(fs.existsSync(path.join(native.root, 'approved.txt'))).toBe(false);
		const pending = await native.cli('codex-turn', 'permissions');
		expect(pending).toHaveLength(1);
		const processId = pending[0].sessionId;
		await dialog.getByRole('button', { name: 'Allow', exact: true }).click();
		await expect(native.output()).toContainText('Synthetic approval accepted');
		expect(fs.readFileSync(path.join(native.root, 'approved.txt'), 'utf8')).toBe('synthetic\n');
		fs.unlinkSync(path.join(native.root, 'approved.txt'));

		await native.send('command approval deny');
		await expect(dialog).toBeVisible();
		const denied = await native.cli('codex-turn', 'permissions');
		await native.cli('permission-respond', denied[0].requestId, 'deny');
		await expect(dialog).toHaveCount(0);
		await expect(native.output()).toContainText('Synthetic approval denied');
		expect(fs.existsSync(path.join(native.root, 'approved.txt'))).toBe(false);

		await native.send('U5_HOLD for steer');
		await native.input().fill('Keep this synthetic instruction');
		await native.page.getByRole('button', { name: 'Add to this turn' }).click();
		await expect(native.output()).toContainText(
			'Synthetic steer accepted: Keep this synthetic instruction'
		);
		await expect(native.input()).toHaveValue('');
		await native.send('U5_HOLD for stop');
		await expect(native.page.getByTestId('stop-turn-button')).toBeVisible();
		await native.cli('codex-turn', 'stop', processId);
		await expect.poll(async () => (await native.cli('codex-turn', 'permissions')).length).toBe(0);
		await expect
			.poll(() => fs.readFileSync(path.join(native.root, 'app-server-receipts.jsonl'), 'utf8'))
			.toContain('turn/interrupt');
		const receipts = fs
			.readFileSync(path.join(native.root, 'app-server-receipts.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(receipts.filter((row) => row.method === 'thread/start')).toHaveLength(1);
		expect(receipts.filter((row) => row.method === 'thread/resume')).toHaveLength(3);
		expect(receipts.filter((row) => row.method === 'turn/start')).toHaveLength(4);
		expect(receipts.filter((row) => row.method === 'turn/steer')).toHaveLength(1);
	} finally {
		if (native.app) await native.close(info.status !== info.expectedStatus);
	}
});
