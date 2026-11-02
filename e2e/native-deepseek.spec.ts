import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/native-app';

// The preset uses the same pinned Claude Code protocol.cjs writer as native-resume.
// Real mode invokes the installed Claude CLI and requires DEEPSEEK_API_KEY too.
test('claude DeepSeek: isolated history, Stop, resume and restart', async ({ native }) => {
	native.scriptTurns([
		{ answer: 'DeepSeek first answer.' },
		{
			answer: '',
			tools: [{ id: 'deepseek-stop', command: 'sleep 60', output: '' }],
			waitForStop: true,
		},
		{ answer: 'DeepSeek resumed answer.' },
		{ answer: 'DeepSeek restarted answer.' },
	]);
	const claudeTurn = await native.externalTurn('claude', 'Claude account history', {
		answer: 'Claude account answer.',
	});
	const claudeBefore = fs.readFileSync(claudeTurn.file);
	const claudeAgent = await native.createAgent('claude');
	const deepseekAgent = await native.createAgent('claude', { preset: 'deepseek' });
	const agent = await native.page.evaluate(
		async (id) => (await window.maestro.sessions.getAll()).find((s: { id: string }) => s.id === id),
		deepseekAgent
	);
	const configDir = agent.customEnvVars.CLAUDE_CONFIG_DIR as string;
	expect(configDir).not.toBe(native.claude);
	expect(agent.customModel).toBe('deepseek-flash[1m]');
	await native.send('DeepSeek first turn');
	await expect(native.output().getByText('DeepSeek first answer.', { exact: true })).toBeVisible();
	const file = await native.oneTranscript('claude', configDir);
	const first = fs.readFileSync(file);
	await native.send('DeepSeek long tool');
	await expect(native.output().locator('[data-tool-status="running"]').first()).toBeVisible();
	await native.page.getByTestId('stop-turn-button').click();
	await expect(native.output().locator('[data-tool-status="canceled"]').first()).toBeVisible();
	await native.send('DeepSeek continue after Stop');
	await expect(
		native.output().getByText('DeepSeek resumed answer.', { exact: true })
	).toBeVisible();
	await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
	await native.restart();
	await native.page
		.locator('button[data-tree-nav]')
		.filter({ hasText: 'DeepSeek first turn' })
		.click();
	await native.send('DeepSeek continue after restart');
	await expect(
		native.output().getByText('DeepSeek restarted answer.', { exact: true })
	).toBeVisible();
	expect(native.files('claude', configDir)).toEqual([file]);
	expect(fs.readFileSync(file).subarray(0, first.length)).toEqual(first);
	expect(fs.readFileSync(claudeTurn.file)).toEqual(claudeBefore);
	const accounts = await native.page.evaluate(
		async ({ project, claudeAgent, deepseekAgent }) => {
			const api = window.maestro.agentSessions;
			return Promise.all(
				[claudeAgent, deepseekAgent].map((ownerAgentId) =>
					api.listPaginated('claude-code', project, { ownerAgentId, limit: 10 })
				)
			);
		},
		{ project: native.project, claudeAgent, deepseekAgent }
	);
	expect(accounts[0].sessions.map((s) => s.sessionId)).toEqual([claudeTurn.id]);
	expect(accounts[1].sessions).toHaveLength(1);
	expect(accounts[1].sessions[0].sessionId).not.toBe(claudeTurn.id);
	expect(fs.readFileSync(file, 'utf8')).toContain('deepseek-flash');
});

// Fake mode only: real mode would type the real key into the page, and Playwright's
// action log records typed values in the trace. The CLI scenario above covers the
// real gateway; this one covers the dialog and where DeepSeek is named afterwards.
test('claude DeepSeek dialog: a preset made in the New Agent dialog is DeepSeek everywhere', async ({
	native,
}) => {
	test.skip(native.real, 'Typing the real key would record it in the Playwright trace');
	native.scriptTurns([{ answer: 'DeepSeek dialog answer.' }]);
	const fixtureCli = path.resolve('e2e/fixtures/native/claude');
	const page = native.page;

	await page.keyboard.press('ControlOrMeta+n');
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Agent Name').fill('DeepSeek dialog');
	await dialog.getByLabel('Working Directory').fill(native.project);
	// Never the detected Claude Code: a real binary here would send the synthetic key to
	// DeepSeek. The preset runs whatever the Claude Code row points at.
	await dialog.getByRole('option', { name: /^Claude Code/ }).click();
	await dialog.getByPlaceholder('/path/to/claude').fill(fixtureCli);
	await dialog.getByRole('option', { name: 'DeepSeek', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Create Agent' })).toBeDisabled();
	await dialog.getByLabel('DeepSeek API key').fill('synthetic-deepseek-key');
	await dialog.getByRole('button', { name: 'Create Agent' }).click();
	await expect(native.input()).toBeVisible();

	// The store is written after the renderer's save debounce, so wait for the record.
	type SavedAgent = {
		toolType: string;
		customPath?: string;
		customModel?: string;
		customEnvVars: Record<string, string>;
	};
	let agent: SavedAgent | undefined;
	await expect
		.poll(async () => {
			agent = await page.evaluate(
				async () =>
					(await window.maestro.sessions.getAll()).find(
						(s: { name: string }) => s.name === 'DeepSeek dialog'
					) as SavedAgent | undefined
			);
			return !!agent;
		})
		.toBe(true);
	if (!agent) throw new Error('unreachable');
	expect(agent.toolType).toBe('claude-code');
	expect(agent.customPath).toBe(fixtureCli);
	expect(agent.customModel).toBe('deepseek-flash[1m]');
	expect(agent.customEnvVars.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic');
	const configDir = agent.customEnvVars.CLAUDE_CONFIG_DIR;
	expect(configDir).toBeTruthy();
	expect(configDir).not.toBe(native.claude);

	await native.send('DeepSeek dialog turn');
	await expect(native.output().getByText('DeepSeek dialog answer.', { exact: true })).toBeVisible();
	const file = await native.oneTranscript('claude', configDir);
	expect(fs.readFileSync(file, 'utf8')).toContain('DeepSeek dialog answer.');
	expect(native.files('claude')).toEqual([]);

	await expect(
		page.getByTestId('header-conversation-title').getByRole('img', { name: 'DeepSeek' })
	).toBeVisible();
	const sidebar = page.locator('[data-conversation-kind="open"]');
	await expect(sidebar.getByRole('img', { name: 'DeepSeek' })).toHaveCount(1);
	await expect(page.getByRole('img', { name: 'Claude Code', exact: true })).toHaveCount(0);
});
