import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import type { ToolExecutionEvent } from '../src/main/preload/process/core';
import { extractAgentTaskList, latestAgentTaskList } from '../src/renderer/utils/agentTaskList';
import { transcriptMessagesToLogEntries } from '../src/renderer/utils/transcriptMessages';

// This diagnostic spends real model quota. See docs/verification/codex-plan.md.
// The skip precedes NativeApp construction and any credential or binary access.
test.skip(process.env.MAESTRO_E2E_REAL !== '1', 'requires explicit real-run opt-in');
test.setTimeout(240_000);
test.describe.configure({ retries: 0 });

type PlanProbe = {
	tools: Array<{ toolCallId?: string; state: unknown }>;
	exits: number[];
	answers: string[];
	commentary: string[];
};

declare global {
	interface Window {
		__realCodexPlan: PlanProbe;
	}
}

// eslint-disable-next-line no-empty-pattern
test('codex: real task list and final answer through the panel', async ({}, info) => {
	const executable = process.env.MAESTRO_E2E_CODEX_PATH;
	const model = process.env.MAESTRO_E2E_CODEX_MODEL;
	const mode = process.env.MAESTRO_E2E_CODEX_PLAN ?? 'enabled';
	const auth = process.env.MAESTRO_E2E_CODEX_AUTH ?? 'api-key';
	if (auth !== 'api-key' && auth !== 'login')
		throw new Error('MAESTRO_E2E_CODEX_AUTH must be api-key or login');
	const login = auth === 'login';
	if (login && (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY))
		throw new Error('Login mode requires CODEX_API_KEY and OPENAI_API_KEY to be unset.');
	if (
		!executable ||
		!path.isAbsolute(executable) ||
		(!login && (!model || !process.env.CODEX_API_KEY))
	) {
		throw new Error(
			'Set an absolute MAESTRO_E2E_CODEX_PATH. API-key mode also requires MAESTRO_E2E_CODEX_MODEL and CODEX_API_KEY.'
		);
	}
	if (mode !== 'enabled' && mode !== 'disabled')
		throw new Error('MAESTRO_E2E_CODEX_PLAN must be enabled or disabled');
	const native = new NativeApp(info, { providerCli: false, inheritCodexHome: login });
	let failed = false;
	try {
		const home = login ? undefined : path.join(native.root, 'home');
		if (home) fs.mkdirSync(home);
		const homeEnv: Record<string, string> = home ? { HOME: home, USERPROFILE: home } : {};
		const cli = (...args: string[]) => native.cliWithEnv(homeEnv, ...args);
		const version = execFileSync(executable, ['--version'], {
			env: { ...process.env, ...native.env, ...homeEnv },
			cwd: native.project,
			encoding: 'utf8',
			timeout: 10_000,
		}).trim();
		// Diagnostic pin only. This does not admit a version into the shared connector matrix.
		expect(version).toBe(
			process.env.MAESTRO_E2E_CODEX_EXPECT_VERSION ?? 'codex-cli 0.166.0-alpha.6'
		);
		info.annotations.push({ type: 'native-cli-version', description: version });
		if (!login) {
			fs.writeFileSync(
				path.join(native.codex, 'config.toml'),
				[
					'cli_auth_credentials_store = "file"',
					'mcp_oauth_credentials_store = "file"',
					'web_search = "disabled"',
					// Built-in provider overrides are rejected by 0.166. Use the same
					// public OpenAI endpoint with explicit zero request/stream retries.
					'model_provider = "maestro_plan_e2e"',
					'[features]',
					'apps = false',
					'plugins = false',
					'hooks = false',
					'multi_agent = false',
					'code_mode = false',
					'unbounded_connection_retries = false',
					'[model_providers.maestro_plan_e2e]',
					'name = "OpenAI plan diagnostic"',
					'base_url = "https://api.openai.com/v1"',
					'env_key = "CODEX_API_KEY"',
					'wire_api = "responses"',
					'request_max_retries = 0',
					'stream_max_retries = 0',
				].join('\n') + '\n'
			);
		}
		const settingsFile = path.join(native.data, 'maestro-settings.json');
		fs.writeFileSync(
			settingsFile,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
				newShell: true,
				defaultSaveToHistory: false,
				crashReportingEnabled: false,
			})
		);
		const marker = path.join(native.project, 'read-only-marker.txt');
		fs.writeFileSync(marker, 'Must remain unchanged.\n');
		await native.start(home);
		// Do not use createAgent()/realCliFor(): their general real-runtime fixture
		// copies credentials from a user's account. Login mode leaves HOME and
		// CODEX_HOME inherited and lets Codex use its own existing login.
		const created = await cli(
			'create-agent',
			'Codex plan diagnostic',
			'--type',
			'codex',
			'--cwd',
			native.project,
			'--custom-path',
			executable,
			...(model ? ['--model', model] : []),
			...(login ? [] : ['--env', `CODEX_HOME=${native.codex}`]),
			'--custom-args',
			[
				...(login
					? [
							'--ephemeral',
							// Tool availability does not depend on effort; keep the diagnostic short.
							'-c model_reasoning_effort="low"',
							'-c web_search="disabled"',
							'-c features.apps=false',
							'-c features.plugins=false',
							'-c features.hooks=false',
							'-c features.multi_agent=false',
							'-c features.code_mode=false',
							'-c features.unbounded_connection_retries=false',
						]
					: []),
				...(mode === 'disabled' ? ['-c tools.update_plan.enabled=false'] : []),
			].join(' ')
		);
		expect(created.success).toBe(true);
		const agentId = created.agentId as string;
		const selected = await cli('tab', 'show', 'active', '--agent', agentId);
		const tabId = selected.tab.tabId as string;
		expect((await cli('tab', 'permission', tabId, 'readonly', '--agent', agentId)).success).toBe(
			true
		);
		expect((await cli('tab', 'save-to-history', tabId, 'false', '--agent', agentId)).success).toBe(
			true
		);
		expect((await cli('tab', 'panel', tabId, 'tasks', '--agent', agentId)).success).toBe(true);
		await expect(native.page.getByTestId('tasks-empty')).toContainText(
			'The tools in this conversation have not provided a task list.'
		);
		await native.page.evaluate((owner) => {
			const probe: PlanProbe = { tools: [], exits: [], answers: [], commentary: [] };
			window.__realCodexPlan = probe;
			window.maestro.process.onData((sessionId, text) => {
				if (sessionId.startsWith(`${owner}-ai-`)) probe.answers.push(text);
			});
			window.maestro.process.onThinkingChunk((sessionId, text, purpose) => {
				if (sessionId.startsWith(`${owner}-ai-`) && purpose === 'commentary')
					probe.commentary.push(text);
			});
			window.maestro.process.onToolExecution((sessionId, event: ToolExecutionEvent) => {
				if (sessionId.startsWith(`${owner}-ai-`) && event.toolName === 'update_plan') {
					probe.tools.push({ toolCallId: event.toolCallId, state: event.state });
				}
			});
			window.maestro.process.onExit((sessionId, code) => {
				if (sessionId.startsWith(`${owner}-ai-`)) probe.exits.push(code);
			});
		}, agentId);
		const prompt = [
			'This is a read-only task-list diagnostic. Do not read or write files, run commands, browse, or delegate.',
			'If update_plan is available, call it exactly three times with exactly these two steps:',
			'"Calculate two plus two" and "Calculate three plus three".',
			'First mark the first in_progress and the second pending.',
			'Calculate 2+2 mentally, then mark the first completed and the second in_progress.',
			'Calculate 3+3 mentally, then mark both completed. Finish by saying "PLAN_CHECK_DONE 4 6".',
			'If update_plan is unavailable, do not simulate a tool call. Reply "PLAN_TOOL_UNAVAILABLE" and a plain markdown checklist of those two completed calculations.',
		].join('\n');
		// Use the composer without native.send's real-workload prompt suffix,
		// which forbids tools when no shell workload is defined.
		// Submit once. Assertion polling below never resubmits a prompt.
		await native.input().fill(prompt);
		await native.input().press('Enter');
		await expect
			.poll(() => native.page.evaluate(() => window.__realCodexPlan.exits.length), {
				timeout: 180_000,
			})
			.toBe(1);
		const probe = await native.page.evaluate(() => window.__realCodexPlan);
		expect(probe.exits).toEqual([0]);
		await expect(native.output()).toContainText(
			mode === 'enabled' ? 'PLAN_CHECK_DONE 4 6' : 'PLAN_TOOL_UNAVAILABLE'
		);
		await info.attach('plan-ipc-events.json', {
			body: JSON.stringify({ version, mode, auth, model, ...probe }, null, 2),
			contentType: 'application/json',
		});
		if (mode === 'enabled') {
			expect(probe.answers.join('')).toContain('PLAN_CHECK_DONE 4 6');
			expect(probe.commentary.join('')).not.toContain('PLAN_CHECK_DONE 4 6');
			const lists = probe.tools.map((event) =>
				extractAgentTaskList((event.state as { input?: unknown })?.input)
			);
			expect(lists.every((list) => list?.tasks.length === 2)).toBe(true);
			expect(lists.map((list) => list?.completed)).toEqual([0, 1, 2, 2]);
			expect(
				probe.tools.every(
					(event) => typeof event.toolCallId === 'string' && event.toolCallId.length > 0
				)
			).toBe(true);
			expect(new Set(probe.tools.map((event) => event.toolCallId)).size).toBe(1);
			await expect(native.page.getByTestId('tasks-progress')).toHaveText('2 / 2 completed');
			await expect(native.page.getByTestId('tasks-panel').getByRole('listitem')).toHaveCount(2);
		} else {
			expect(probe.tools).toEqual([]);
			await expect(native.page.getByTestId('tasks-empty')).toContainText(
				'Checklists in replies are not shown here.'
			);
			await expect(native.page.getByTestId('tasks-panel')).toHaveCount(0);
		}
		// Ephemeral login mode intentionally has no history read or restart assertion.
		if (!login) {
			const completed = await cli('tab', 'show', tabId, '--agent', agentId);
			expect(completed.tab.agentSessionId).toBeTruthy();
			const history = await cli('native-history', 'read', agentId, completed.tab.agentSessionId);
			expect(history.success).toBe(true);
			const historical = latestAgentTaskList(
				transcriptMessagesToLogEntries(history.result.messages)
			);
			if (mode === 'enabled') expect(historical?.completed).toBe(2);
			else expect(historical).toBeNull();
			await native.restart(home);
			expect((await cli('focus-agent', agentId)).success).toBe(true);
			expect((await cli('tab', 'panel', tabId, 'tasks', '--agent', agentId)).success).toBe(true);
			if (mode === 'enabled')
				await expect(native.page.getByTestId('tasks-progress')).toHaveText('2 / 2 completed');
			else await expect(native.page.getByTestId('tasks-empty')).toBeVisible();
		}
		expect(fs.readFileSync(marker, 'utf8')).toBe('Must remain unchanged.\n');
		// Maestro keeps its own .maestro folder in a project; Codex must add nothing else.
		expect(fs.readdirSync(native.project).filter((name) => name !== '.maestro')).toEqual([
			'read-only-marker.txt',
		]);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		try {
			if (native.app) await native.close(failed);
		} finally {
			// Keep failure diagnostics in Playwright's output only. No credentials or
			// user account snapshots belong in an acceptance artifact.
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	}
});
