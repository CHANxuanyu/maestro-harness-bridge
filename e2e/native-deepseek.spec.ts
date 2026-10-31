import fs from 'node:fs';
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
