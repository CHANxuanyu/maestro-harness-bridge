import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { holdNativeCommandScan } from './fixtures/native/command-scan-gate';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Commands discovery uses temporary accounts only');
test.setTimeout(120_000);

// eslint-disable-next-line no-empty-pattern
test('native commands refresh, preserve drafts and retain scoped plugin reports', async ({}, info) => {
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
		await native.input().press('Escape');
		await native.input().fill('');
		await native.cli('update-agent', session.id, '--token-source', 'api');
		const projectSkill = path.join(native.project, '.claude', 'skills', 'deploy');
		const personalSkill = path.join(native.claude, 'skills', 'deploy');
		fs.mkdirSync(projectSkill, { recursive: true });
		fs.mkdirSync(personalSkill, { recursive: true });
		fs.writeFileSync(path.join(projectSkill, 'SKILL.md'), 'Project deployment $ARGUMENTS');
		fs.writeFileSync(path.join(personalSkill, 'SKILL.md'), 'Personal deployment must not run');
		fs.writeFileSync(
			native.script,
			JSON.stringify({
				scene: { answer: 'Project command completed', slashCommands: ['plugin:review'] },
				synopsis: { answer: 'Command completed' },
			})
		);
		const scanGate = await native.app.evaluateHandle(holdNativeCommandScan, {
			cwd: native.project,
			accountDir: native.claude,
		});
		try {
			await native.send('/deploy staging');
			await expect(native.input()).toHaveValue('');
			await expect.poll(() => scanGate.evaluate((gate) => gate.waiting)).toBe(true);
			await native.input().press('Enter');
			await native.input().fill('Keep this next draft');
			expect(fs.existsSync(path.join(native.claude, 'fixture-turn-count'))).toBe(false);
		} finally {
			await scanGate.evaluate((gate) => gate.release());
			await scanGate.dispose();
		}
		await expect(
			native.output().getByText('Project command completed', { exact: true })
		).toBeVisible();
		await expect(native.input()).toHaveValue('Keep this next draft');
		expect(fs.readFileSync(path.join(native.claude, 'fixture-turn-count'), 'utf8')).toBe('1');
		const transcripts = path.join(
			native.claude,
			'projects',
			native.project.replace(/[^a-zA-Z0-9]/g, '-')
		);
		const history = fs
			.readdirSync(transcripts)
			.filter((name) => name.endsWith('.jsonl'))
			.map((name) => fs.readFileSync(path.join(transcripts, name), 'utf8'))
			.join('\n');
		expect(history).toContain('Project deployment staging');
		expect(history).not.toContain('Personal deployment must not run');
		// The automatic synopsis reports an empty command list. Check after it
		// finishes so an early lookup cannot hide an overwritten plugin report.
		await expect
			.poll(() =>
				native.page.evaluate(
					async ({ project, agentId }) =>
						(await window.maestro.history.getAll(project, agentId)).map((entry) => entry.summary),
					{ project: native.project, agentId: session.id }
				)
			)
			.toContain('Command completed');
		await native.input().fill('/plugin');
		await expect(
			native.page.getByRole('button', { name: '/plugin:review Reported by tool' })
		).toBeVisible();
		expect((await native.cli('tab', 'commands', tabId)).commands).toContainEqual({
			command: '/plugin:review',
			description: '',
			source: 'reported',
		});
		await native.input().press('Escape');
		await native.input().fill('');
		const otherAccount = path.join(native.root, 'other-account');
		fs.mkdirSync(otherAccount, { recursive: true });
		await native.cli('update-agent', session.id, '--env', `CLAUDE_CONFIG_DIR=${otherAccount}`);
		await native.input().fill('/plugin');
		await expect(
			native.page.getByRole('button', { name: '/plugin:review Reported by tool' })
		).toHaveCount(0);
		expect(
			(await native.cli('tab', 'commands', tabId)).commands.some(
				(c: { command: string }) => c.command === '/plugin:review'
			)
		).toBe(false);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
		fs.rmSync(native.root, { recursive: true, force: true });
	}
});
