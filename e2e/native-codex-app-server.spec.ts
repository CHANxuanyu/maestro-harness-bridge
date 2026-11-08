import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';

test.setTimeout(120_000);
test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'The prototype runs against a synthetic app-server only'
);

// eslint-disable-next-line no-empty-pattern
test('Codex prototype synthetic approval, steering, resume and stop', async ({}, info) => {
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
	let scenarioCompleted = false;
	try {
		await native.start(home);
		const owner = await native.createAgent('codex', {
			executable: path.resolve('e2e/fixtures/native/codex-app-server'),
			env: { MAESTRO_APP_SERVER_FIXTURE_ROOT: native.root },
		});
		await native.cli(
			'project',
			'settings',
			'set',
			'--path',
			native.project,
			'--permission',
			'standard'
		);
		const created = await native.cli('tab', 'new', '--agent', owner);
		expect(created.success).toBe(true);
		const selected = await native.cli('tab', 'show', created.tabId, '--agent', created.sessionId);
		expect(selected.tab.permissionMode).toBe('standard');
		await native.cli('tab', 'panel', created.tabId, 'tasks', '--agent', created.sessionId);
		await native.send('file approval allow');
		const dialog = native.page.getByRole('dialog', { name: 'Permission request' });
		await expect(dialog).toContainText('Codex wants to use');
		await expect(dialog).toContainText('approved.txt');
		expect(fs.existsSync(path.join(native.root, 'approved.txt'))).toBe(false);
		const pending = await native.cli('codex-turn', 'permissions');
		expect(pending).toHaveLength(1);
		const processId = pending[0].sessionId;
		await dialog.getByRole('button', { name: 'Allow once', exact: true }).click();
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

		await native.send('U5_HOLD U5_PLAN U5_DELAY_STEER for steer');
		await expect(native.page.getByTestId('tasks-progress')).toHaveText('1 / 3 completed');
		const tasks = native.page.getByTestId('tasks-panel');
		await expect(tasks.getByRole('listitem')).toHaveCount(3);
		await expect(
			tasks.getByRole('listitem').filter({ hasText: 'Wait for synthetic steer' })
		).toContainText('Wait for synthetic steer');
		await expect(tasks.getByLabel('In progress', { exact: true })).toHaveCount(1);
		await native.input().fill('Keep this synthetic instruction');
		await native.page.getByRole('button', { name: 'Add to this turn' }).click();
		await expect(native.page.getByRole('button', { name: 'Add to this turn' })).toBeDisabled();
		await native.input().press('Enter');
		await expect(native.input()).toHaveValue('Keep this synthetic instruction');
		await expect(native.page.getByTitle('Queue message', { exact: true })).toBeDisabled();
		fs.writeFileSync(path.join(native.root, 'release-steer'), 'release');
		await expect(native.output()).toContainText(
			'Synthetic steer accepted: Keep this synthetic instruction'
		);
		await expect(native.input()).toHaveValue('');
		await expect(native.page.getByTestId('tasks-progress')).toHaveText('3 / 3 completed');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await native.send('U5_HOLD for stop');
		await expect(native.page.getByTestId('stop-turn-button')).toBeVisible();
		// The composer becomes busy before the protocol turn is acknowledged.
		// Reach this turn before requiring a turn/interrupt receipt.
		await expect
			.poll(() => {
				const lines = fs.readFileSync(path.join(native.root, 'app-server-receipts.jsonl'), 'utf8');
				return lines
					.trim()
					.split('\n')
					.filter((line) => JSON.parse(line).method === 'turn/start').length;
			})
			.toBe(4);
		expect(await native.cli('codex-turn', 'stop', processId)).toEqual({ success: true });
		await expect.poll(async () => (await native.cli('codex-turn', 'permissions')).length).toBe(0);
		await expect
			.poll(() => fs.readFileSync(path.join(native.root, 'app-server-receipts.jsonl'), 'utf8'))
			.toContain('turn/interrupt');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		expect(
			await native.page.evaluate(async (id) => {
				const active = await window.maestro.process.getActiveProcesses({
					includeChildProcesses: false,
				});
				return active.some((process) => process.sessionId === id);
			}, processId)
		).toBe(false);
		const receipts = fs
			.readFileSync(path.join(native.root, 'app-server-receipts.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(receipts.filter((row) => row.method === 'thread/start')).toHaveLength(1);
		expect(receipts.filter((row) => row.method === 'thread/resume')).toHaveLength(3);
		expect(receipts.filter((row) => row.method === 'turn/start')).toHaveLength(4);
		expect(receipts.filter((row) => row.method === 'turn/steer')).toHaveLength(1);
		scenarioCompleted = true;
	} finally {
		// Playwright can still report "passed" here while an assertion is unwinding.
		// Preserve that failure's trace instead of replacing it with close's idle check.
		if (native.app) await native.close(!scenarioCompleted || info.status !== info.expectedStatus);
	}
});
