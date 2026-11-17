import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import scene from './fixtures/native/codex-plan-restart.json';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'synthetic Codex plan restart only');
test.describe.configure({ retries: 0 });
test.setTimeout(120_000);

// eslint-disable-next-line no-empty-pattern
test('codex: code-mode plan survives restart and reopening from native history', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const gate = path.join(native.root, 'release-plan-turn');
	const settings = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settings,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settings, 'utf8')),
			newShell: true,
			codexAppServer: false,
			defaultSaveToHistory: false,
		})
	);
	native.scriptTurns([{ ...scene, exitGate: gate }]);
	let completed = false;
	try {
		await native.start();
		const owner = await native.createAgent('codex');
		const selected = await native.cli('tab', 'show', 'active', '--agent', owner);
		const tab = selected.tab.tabId as string;
		expect((await native.cli('tab', 'panel', tab, 'tasks', '--agent', owner)).success).toBe(true);
		const assertPlan = async () => {
			const items = native.page.getByTestId('tasks-panel').getByRole('listitem');
			await expect(items).toHaveText(['Inspect the sample tiles', 'Verify the sample tiles']);
			await expect(items.nth(0).getByLabel('Completed', { exact: true })).toBeVisible();
			await expect(items.nth(1).getByLabel('Pending', { exact: true })).toBeVisible();
			await expect(native.page.getByTestId('tasks-progress')).toHaveText('1 / 2 completed');
		};
		await native.send('Show the synthetic tile plan');
		await assertPlan();
		// The writer is gated, so this assertion really observes the live turn.
		await expect(native.page.getByTestId('stop-turn-button')).toBeVisible();
		fs.writeFileSync(gate, 'release');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		const file = await native.oneTranscript('codex');
		const before = fs.readFileSync(file, 'utf8');
		expect(before).toContain('tools.update_plan');
		expect(before).not.toContain('"name":"update_plan"');
		expect(before).not.toContain('"type":"todo_list"');

		// Close the live tab before restart so a persisted live todo_list cannot
		// mask a broken native reader. Reopening must reconstruct the native plan.
		expect((await native.cli('tab', 'close', tab, '--agent', owner)).success).toBe(true);
		await native.restart();
		await native.page
			.locator('[data-conversation-kind="history"] button[data-tree-nav]')
			.filter({ hasText: scene.answer })
			.click();
		await expect(native.output()).toContainText(scene.answer);
		const reopened = await native.cli('tab', 'show', 'active', '--agent', owner);
		expect(reopened.tab.agentSessionId).toBe(scene.codexExecEvents[0].thread_id);
		expect(
			(await native.cli('tab', 'panel', reopened.tab.tabId, 'tasks', '--agent', owner)).success
		).toBe(true);
		await assertPlan();
		expect(fs.readFileSync(file, 'utf8')).toBe(before);
		expect(fs.readFileSync(path.join(native.codex, 'fixture-turn-count'), 'utf8')).toBe('1');
		completed = true;
	} finally {
		// Release even on assertion failure so the synthetic writer can exit.
		fs.writeFileSync(gate, 'release');
		try {
			if (native.app) await native.close(!completed);
		} finally {
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	}
});
