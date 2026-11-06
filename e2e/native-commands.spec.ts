import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Commands discovery uses temporary accounts only');
test.setTimeout(120_000);

// eslint-disable-next-line no-empty-pattern
test('native commands refresh on slash reopen without sending a turn', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'isolated-home');
	fs.mkdirSync(home, { recursive: true });
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			crashReportingEnabled: false,
		})
	);
	const tabId = 'commands-conversation';
	const session = createMockSession({
		id: 'commands-project',
		cwd: native.project,
		projectRoot: native.project,
		fullPath: native.project,
		customPath: path.resolve('e2e/fixtures/native/claude'),
		customEnvVars: { CLAUDE_CONFIG_DIR: native.claude },
		aiTabs: [createMockAITab({ id: tabId, logs: [], name: 'Command discovery' })],
		activeTabId: tabId,
		unifiedTabOrder: [{ type: 'ai', id: tabId }],
	});
	fs.writeFileSync(
		path.join(native.data, 'maestro-sessions.json'),
		JSON.stringify({ sessions: [session], activeSessionId: session.id })
	);
	const commands = path.join(native.claude, 'commands');
	fs.mkdirSync(commands, { recursive: true });
	fs.writeFileSync(path.join(commands, 'before.md'), 'Before refresh');
	let failed = false;
	try {
		await native.start(home);
		await native.page.locator(`[data-conversation-key$=":${tabId}"] [data-tree-nav]`).click();
		await native.input().fill('/');
		await expect(
			native.page.getByRole('button', { name: '/before User Before refresh' })
		).toBeVisible();
		await native.input().press('Escape');
		await native.input().fill('');
		fs.writeFileSync(path.join(commands, 'added.md'), 'Added after first open');
		await native.input().fill('/');
		await expect(
			native.page.getByRole('button', { name: '/added User Added after first open' })
		).toBeVisible();
		const listed = await native.cli('tab', 'commands', tabId);
		expect(listed.commands).toEqual(
			expect.arrayContaining([
				{ command: '/added', description: 'Added after first open', source: 'user' },
			])
		);
		const projectCommands = path.join(native.project, '.claude', 'commands');
		fs.mkdirSync(projectCommands, { recursive: true });
		fs.writeFileSync(path.join(projectCommands, 'added.md'), 'Project wins');
		await native.input().press('Escape');
		await native.input().fill('');
		await native.input().fill('/');
		await expect(
			native.page.getByRole('button', { name: '/added Project Project wins' })
		).toBeVisible();
		await expect(
			native.page.getByRole('button', { name: '/added User Added after first open' })
		).toHaveCount(0);
		expect(fs.existsSync(path.join(native.claude, 'fixture-turn-count'))).toBe(false);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
		fs.rmSync(native.root, { recursive: true, force: true });
	}
});
