import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import type { Session } from '../src/renderer/types';

test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'Shell defect scenarios use synthetic providers only'
);
test.setTimeout(180_000);

// eslint-disable-next-line no-empty-pattern
test('terminal buffer, shell PID, running AI turn and draft survive both shell toggle directions', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
		})
	);
	let failed = true;
	try {
		await native.start();
		await native.createAgent('claude');
		const sessionsFile = path.join(native.data, 'maestro-sessions.json');
		const saved = (): Session[] => JSON.parse(fs.readFileSync(sessionsFile, 'utf8')).sessions;
		await expect.poll(() => saved().length).toBe(1);
		const owner = saved()[0];
		native.scriptTurns([{ answer: 'Still working', waitForStop: true }]);
		await native.send('Keep working across shell layout changes');
		await expect(native.page.getByTestId('stop-turn-button')).toBeVisible();
		await native.input().fill('Unsent draft across both layouts');
		const terminal = await native.cli(
			'open-terminal',
			'--agent',
			owner.id,
			'--name',
			'Toggle continuity'
		);
		const read = async () =>
			(await native.cli('read-terminal', '--agent', owner.id, '--tab', terminal.tabId)).lines.join(
				'\n'
			);
		await native.cli(
			'send-terminal',
			`printf 'SHELL_PID=%s\\n' "$$"; read -r HB_TOGGLE_LINE; printf 'AFTER_TOGGLE=%s\\n' "$HB_TOGGLE_LINE"`,
			'--agent',
			owner.id,
			'--tab',
			terminal.tabId
		);
		await expect.poll(read).toMatch(/SHELL_PID=\d+/);
		const before = await native.page.evaluate(() =>
			window.maestro.process.getActiveProcesses({ includeChildProcesses: false })
		);
		const shell = before.find(
			(process) => process.sessionId === `${owner.id}-terminal-${terminal.tabId}`
		)!;
		const ai = before.find((process) => !process.isTerminal)!;
		expect(shell.pid).toBeGreaterThan(0);
		expect(ai.pid).toBeGreaterThan(0);
		const xterm = native.page.getByTestId('terminal-panel').locator('.xterm:visible');
		await expect(xterm).toBeVisible();
		await xterm.evaluate((element) => element.setAttribute('data-toggle-buffer', 'original'));
		const terminalScreen = native.page.locator('[data-toggle-buffer="original"] .xterm-screen');
		await expect
			.poll(async () => (await terminalScreen.boundingBox())?.width ?? 0)
			.toBeGreaterThan(100);
		await expect
			.poll(async () => (await terminalScreen.boundingBox())?.height ?? 0)
			.toBeGreaterThan(100);
		await terminalScreen.click();
		for (const enabled of [false, true, false, true]) {
			await native.cli('settings', 'set', 'newShell', String(enabled));
			await expect(native.page.locator('html')).toHaveAttribute('data-new-shell', String(enabled));
			await expect.poll(read).toContain(`SHELL_PID=${shell.pid}`);
			const processes = await native.page.evaluate(() =>
				window.maestro.process.getActiveProcesses({ includeChildProcesses: false })
			);
			expect(processes.find((process) => process.sessionId === shell.sessionId)?.pid).toBe(
				shell.pid
			);
			expect(processes.find((process) => process.sessionId === ai.sessionId)?.pid).toBe(ai.pid);
			expect(
				(await native.cli('tab', 'show', owner.activeTabId, '--agent', owner.id)).tab.inputValue
			).toBe('Unsent draft across both layouts');
			if (enabled) {
				await expect(native.page.locator('[data-toggle-buffer="original"]')).toBeVisible();
				await expect(native.input()).toHaveValue('Unsent draft across both layouts');
			} else {
				await native.page.getByText('Toggle continuity', { exact: true }).click();
				await expect(native.page.locator('[data-toggle-buffer="original"]')).toBeVisible();
			}
			await expect
				.poll(async () => (await terminalScreen.boundingBox())?.width ?? 0)
				.toBeGreaterThan(100);
			await expect
				.poll(async () => (await terminalScreen.boundingBox())?.height ?? 0)
				.toBeGreaterThan(100);
			await terminalScreen.click();
		}
		await native.cli(
			'send-terminal',
			'still-the-same-shell',
			'--agent',
			owner.id,
			'--tab',
			terminal.tabId
		);
		await expect.poll(read).toContain('AFTER_TOGGLE=still-the-same-shell');
		await native.page.getByTestId('stop-turn-button').click();
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await native.cli(
			'tab',
			'panel',
			'terminal-close',
			'--terminal',
			terminal.tabId,
			'--agent',
			owner.id
		);
		failed = false;
	} finally {
		if (native.app) await native.close(failed);
		fs.rmSync(native.root, { recursive: true, force: true });
	}
});
