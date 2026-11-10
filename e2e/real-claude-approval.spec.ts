import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';

// Spends real model quota: one Write request. See e2e/claude-standard-approval.md.
// The skip precedes NativeApp construction and any credential or binary access.
test.skip(process.env.MAESTRO_E2E_REAL !== '1', 'requires explicit real-run opt-in');
test.setTimeout(300_000);
test.describe.configure({ retries: 0 });

// eslint-disable-next-line no-empty-pattern
test('claude: real Standard approval writes only after Allow once', async ({}, info) => {
	// Temporary home, project, app data and CLAUDE_CONFIG_DIR. The login is passed
	// as a read-only access token; nothing under the user's ~/.claude is written.
	const native = new NativeApp(info);
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home);
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			uiLanguage: 'en',
			defaultSaveToHistory: false,
			crashReportingEnabled: false,
		})
	);
	const target = path.join(native.project, 'approval-smoke.txt');
	// Every file under the project, so a write anywhere before approval is caught.
	const projectEntries = () =>
		(fs.readdirSync(native.project, { recursive: true }) as string[]).sort();
	let failed = false;
	try {
		await native.start(home);
		const owner = await native.createAgent('claude');
		await native.cli('update-agent', owner, '--token-source', 'api');
		await native.cli('tab', 'permission', 'active', 'standard', '--agent', owner);
		const tab = (await native.cli('tab', 'show', 'active', '--agent', owner)).tab;
		expect(tab.permissionMode).toBe('standard');

		// Maestro creates its own .maestro folder while setting up, so snapshot here.
		const before = projectEntries();
		// Typed directly: the real-mode send helper would swap in a scripted workload.
		await native
			.input()
			.fill(
				'Use only the Write tool to create approval-smoke.txt in the current project with the exact content "approval smoke". Do not read, list or change anything else.'
			);
		await native.input().press('Enter');
		const dialog = native.page.getByTestId('permission-prompt');
		await expect(dialog).toBeVisible({ timeout: 180_000 });
		// Nothing may be written before the decision.
		expect(fs.existsSync(target)).toBe(false);
		expect(projectEntries()).toEqual(before);
		await expect(dialog).toContainText('Write');
		await expect(dialog).toContainText('approval-smoke.txt');
		await expect(dialog).toContainText(native.project);
		const requests = await native.cli('permission', 'list');
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({ tabId: tab.tabId, toolName: 'Write' });
		expect(path.resolve(native.project, requests[0].input.file_path)).toBe(target);
		expect(requests[0]).not.toHaveProperty('token');
		// The live process is the real CLI on print with the relay, never the bypass flag.
		const live = await native.page.evaluate(
			(id) =>
				window.maestro.process
					.getActiveProcesses()
					.then((items) => items.find((item) => item.sessionId === id)),
			requests[0].sessionId
		);
		const args: string[] = live?.args ?? [];
		expect(args.some((arg) => arg === '--print' || arg === '-p')).toBe(true);
		expect(args).toContain('--permission-prompt-tool');
		expect(args).not.toContain('--dangerously-skip-permissions');
		const mcpConfig = args[args.indexOf('--mcp-config') + 1];
		expect(mcpConfig && fs.existsSync(mcpConfig)).toBe(true);

		await dialog.getByRole('button', { name: 'Allow once', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect.poll(() => fs.existsSync(target), { timeout: 120_000 }).toBe(true);
		expect(fs.readFileSync(target, 'utf8').trim()).toBe('approval smoke');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0, { timeout: 120_000 });
		expect(await native.cli('permission', 'list')).toEqual([]);
		// The relay's temporary MCP config is removed when the turn ends.
		await expect.poll(() => fs.existsSync(mcpConfig), { timeout: 15_000 }).toBe(false);
		// Only the approved file appeared.
		expect(projectEntries()).toEqual([...before, 'approval-smoke.txt'].sort());
		info.annotations.push({ type: 'approval-smoke', description: 'allowed once, file written' });
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
	}
});
