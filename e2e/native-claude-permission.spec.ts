import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp, type NativeScene } from './fixtures/native-app';
import { createTurn } from './fixtures/native/protocol.cjs';
import { RELAY_DECISION_TIMEOUT_MS } from '../src/main/permission-relay/types';
import type { PermissionDecision, PermissionRequest } from '../src/main/permission-relay/types';

test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'Claude permission acceptance uses synthetic providers only'
);

for (const outcome of [
	'allow UI',
	'deny UI',
	'allow CLI',
	'deny CLI',
	'stop',
	'timeout',
	'classic allow',
] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`Claude standard approval: ${outcome}`, async ({}, info) => {
		test.setTimeout(outcome === 'timeout' ? RELAY_DECISION_TIMEOUT_MS + 90_000 : 90_000);
		const native = new NativeApp(info, { providerCli: false });
		const home = path.join(native.root, 'home');
		fs.mkdirSync(home);
		const newShell = outcome !== 'classic allow';
		const allowed = outcome.includes('allow');
		const settingsFile = path.join(native.data, 'maestro-settings.json');
		fs.writeFileSync(
			settingsFile,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
				newShell,
				defaultSaveToHistory: false,
				crashReportingEnabled: false,
			})
		);
		const marker = path.join(native.project, 'approved.txt');
		const nextMarker = path.join(native.project, 'second.txt');
		const content = 'Only this approved tool may write.\n';
		const approvalScene = (file: string, answer: string): NativeScene => ({
			approval: true,
			answer,
			toolDelay: 0,
			writes: { [path.basename(file)]: content },
			tools: [
				{
					id: path.basename(file),
					name: 'Write',
					command: '',
					input: { file_path: file, content },
					output: 'Synthetic write completed',
				},
			],
		});
		native.scriptTurns([
			approvalScene(marker, 'APPROVAL_ALLOWED_ONCE'),
			allowed
				? approvalScene(nextMarker, 'MUST_NOT_ALLOW_SECOND')
				: { answer: 'RECOVERED_AFTER_REFUSAL' },
		]);
		const rows = <T = Record<string, unknown>>(name: string): T[] => {
			const file = path.join(native.claude, name);
			return fs.existsSync(file)
				? fs
						.readFileSync(file, 'utf8')
						.trim()
						.split('\n')
						.filter(Boolean)
						.map((line) => JSON.parse(line))
				: [];
		};
		let failed = false;
		try {
			await native.start(home);
			const owner = await native.createAgent('claude');
			await native.cli('update-agent', owner, '--token-source', 'api');
			await native.cli('tab', 'permission', 'active', 'standard', '--agent', owner);
			const tab = (await native.cli('tab', 'show', 'active', '--agent', owner)).tab;
			await native.cli('tab', 'rename', tab.tabId, '审批所属对话');
			await native.send('Perform the synthetic approval write');
			const dialog = native.page.getByTestId('permission-prompt');
			await expect(dialog).toBeVisible();
			if (newShell) {
				await native.cli('settings', 'set', 'uiLanguage', 'zh-CN');
				await expect(dialog).toContainText('只批准这一次工具调用');
				await expect(dialog).toContainText(content.trim());
				await expect(dialog).toContainText(native.project);
				await expect(dialog).toContainText('对话：审批所属对话');
				await expect(dialog.getByRole('button', { name: '拒绝', exact: true })).toBeFocused();
			}
			expect(fs.existsSync(marker)).toBe(false);
			const requests: Omit<PermissionRequest, 'token'>[] = await native.cli('permission', 'list');
			expect(requests).toHaveLength(1);
			const request = requests[0];
			expect(request.tabId).toBe(tab.tabId);
			expect(
				await native.page.evaluate(
					(id) =>
						window.maestro.process
							.getActiveProcesses()
							.then((items) => items.some((item) => item.sessionId === id)),
					request.sessionId
				)
			).toBe(true);
			expect(request.cwd).toBe(native.project);
			expect(request.input).toEqual({ file_path: marker, content });
			expect(request).not.toHaveProperty('token');
			const invocation = rows<{ args: string[] }>('fixture-invocations.jsonl')[0];
			expect(invocation.args).toContain('--print');
			expect(invocation.args).toContain('--permission-prompt-tool');
			expect(invocation.args).toContain('mcp__maestro_permissions__approve');
			expect(invocation.args).not.toContain('--dangerously-skip-permissions');
			const configPath = invocation.args[invocation.args.indexOf('--mcp-config') + 1];
			expect(fs.existsSync(configPath)).toBe(true);

			if (outcome.endsWith('CLI')) {
				expect(await native.cli('permission', allowed ? 'allow' : 'deny', request.requestId)).toBe(
					true
				);
			} else if (outcome === 'stop') {
				// The approval overlay covers the composer Stop control. Exercise the
				// existing interrupt IPC while the bridge is still awaiting a decision.
				await native.page.evaluate((id) => window.maestro.process.interrupt(id), request.sessionId);
			} else if (outcome !== 'timeout') {
				await dialog
					.getByRole('button', {
						name: newShell ? (allowed ? '允许一次' : '拒绝') : 'Allow',
						exact: true,
					})
					.click();
			}
			await expect(dialog).toHaveCount(0, {
				timeout: outcome === 'timeout' ? RELAY_DECISION_TIMEOUT_MS + 15_000 : 15_000,
			});
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			await expect.poll(() => rows('fixture-permission-bridge-exits.jsonl').length).toBe(1);
			await expect.poll(() => fs.existsSync(configPath)).toBe(false);
			await expect
				.poll(() =>
					native.page.evaluate(
						(id) =>
							window.maestro.process
								.getActiveProcesses()
								.then((items) => items.filter((item) => item.sessionId === id)),
						request.sessionId
					)
				)
				.toEqual([]);
			expect(await native.cli('permission', 'list')).toEqual([]);
			await expect(native.cli('permission', 'allow', request.requestId)).rejects.toThrow(
				'no longer pending'
			);
			expect(fs.existsSync(marker)).toBe(allowed);
			if (allowed) {
				expect(fs.readFileSync(marker, 'utf8')).toBe(content);
				expect(rows('fixture-permission-writes.jsonl')).toEqual([{ target: marker }]);
				expect(rows('fixture-permission-events.jsonl')[0].decision).toEqual({
					behavior: 'allow',
					updatedInput: request.input,
				});
				await expect(native.page.getByText('APPROVAL_ALLOWED_ONCE', { exact: true })).toBeVisible();
			} else if (outcome !== 'stop') {
				const decision = rows<{ decision: Extract<PermissionDecision, { behavior: 'deny' }> }>(
					'fixture-permission-events.jsonl'
				)[0].decision;
				expect(decision.behavior).toBe('deny');
				if (outcome === 'timeout') expect(decision.message).toContain('timed out');
				await expect(
					native.page.getByText(`Permission denied: ${decision.message}`, { exact: true })
				).toBeVisible();
			}
			if (!allowed) expect(rows('fixture-permission-writes.jsonl')).toEqual([]);
			await native.cli('settings', 'set', 'uiLanguage', 'en');
			await native.send('Continue after the decision');
			if (allowed) {
				await expect(dialog).toBeVisible();
				const [second] = await native.cli('permission', 'list');
				expect(second.requestId).not.toBe(request.requestId);
				expect(second.input.file_path).toBe(nextMarker);
				expect(fs.existsSync(nextMarker)).toBe(false);
				await dialog.getByRole('button', { name: 'Deny', exact: true }).click();
				await expect(dialog).toHaveCount(0);
				await expect(
					native.page.getByText('Permission denied: Denied by user.', { exact: true })
				).toBeVisible();
				expect(fs.existsSync(nextMarker)).toBe(false);
			} else {
				await expect(
					native.page.getByText('RECOVERED_AFTER_REFUSAL', { exact: true })
				).toBeVisible();
			}
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			expect((await native.cli('tab', 'show', tab.tabId)).tab.permissionMode).toBe('standard');
			expect(await native.cli('permission', 'list')).toEqual([]);
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (native.app) await native.close(failed);
		}
	});
}

for (const delivery of ['direct', 'queued'] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`Claude standard approval: worktree ${delivery}`, async ({}, info) => {
		test.setTimeout(90_000);
		const native = new NativeApp(info, { providerCli: false });
		const home = path.join(native.root, 'home');
		const cwd = path.join(native.project, '.claude', 'worktrees', 'approval');
		fs.mkdirSync(home);
		fs.mkdirSync(cwd, { recursive: true });
		const historyTitle = 'Worktree approval history';
		const seed = createTurn({
			provider: 'claude',
			configDir: native.claude,
			cwd,
			prompt: historyTitle,
		});
		seed.finish('Synthetic worktree history ready.');
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
		const exitGate = path.join(native.root, 'release-first-turn');
		const content = 'approved\n';
		const marker = path.join(cwd, 'marker.txt');
		const command = 'echo approved > marker.txt';
		native.scriptTurns([
			...(delivery === 'queued' ? [{ answer: 'QUEUE_READY', exitGate }] : []),
			{
				approval: true,
				answer: 'WORKTREE_APPROVAL_COMPLETED',
				writes: { 'marker.txt': content },
				tools: [
					{ id: 'relative-write', name: 'Bash', command, input: { command }, output: 'done' },
				],
			},
		]);
		let failed = false;
		try {
			await native.start(home);
			const owner = await native.createAgent('claude');
			await native.page
				.locator('[data-conversation-kind="history"] button[data-tree-nav]')
				.filter({ hasText: historyTitle })
				.click();
			await expect(
				native.page.getByText('Synthetic worktree history ready.', { exact: true })
			).toBeVisible();
			// The CLI reads the saved snapshot. Seeing the transcript only proves
			// renderer readiness; wait for its debounced persistence before reading.
			await expect
				.poll(
					async () =>
						(await native.cli('tab', 'show', 'active', '--agent', owner)).tab.agentSessionId
				)
				.toBe(seed.id);
			const tab = (await native.cli('tab', 'show', 'active', '--agent', owner)).tab;
			expect(tab.agentSessionId).toBe(seed.id);
			expect((await native.cli('show', 'agent', owner)).cwd).toBe(native.project);
			await native.cli('tab', 'rename', tab.tabId, '工作树审批对话');
			await native.cli('tab', 'permission', tab.tabId, 'standard');
			if (delivery === 'queued') {
				await native.send('Hold the first synthetic turn');
				await expect(native.page.getByText('QUEUE_READY', { exact: true })).toBeVisible();
				await expect(native.page.getByTestId('stop-turn-button')).toBeVisible();
				expect(
					await native.page.evaluate(
						(id) =>
							window.maestro.process
								.getActiveProcesses()
								.then((items) => items.some((item) => item.sessionId === id)),
						`${owner}-ai-${tab.tabId}`
					)
				).toBe(true);
				const queued = await native.dispatchWithEnv(
					{},
					owner,
					'Run the queued approval',
					'--tab',
					tab.tabId,
					'--queue'
				);
				expect(queued.queued).toBe(true);
				fs.writeFileSync(exitGate, 'release');
			} else {
				await native.send('Run the direct approval');
			}
			const dialog = native.page.getByTestId('permission-prompt');
			await expect(dialog).toBeVisible();
			await expect(dialog).toContainText('工作树审批对话');
			await expect(dialog.getByText(cwd, { exact: true })).toBeVisible();
			await expect(dialog.getByText(native.project, { exact: true })).toHaveCount(0);
			await expect(dialog).toContainText(command);
			const requests: Omit<PermissionRequest, 'token'>[] = await native.cli('permission', 'list');
			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({ tabId: tab.tabId, cwd, input: { command } });
			expect(requests[0]).not.toHaveProperty('token');
			expect(fs.existsSync(marker)).toBe(false);
			expect(fs.existsSync(path.join(native.project, 'marker.txt'))).toBe(false);
			await dialog.getByRole('button', { name: 'Allow once', exact: true }).click();
			await expect(dialog).toHaveCount(0);
			await expect(
				native.page.getByText('WORKTREE_APPROVAL_COMPLETED', { exact: true })
			).toBeVisible();
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			await expect
				.poll(() =>
					native.page.evaluate(
						(id) =>
							window.maestro.process
								.getActiveProcesses()
								.then((items) => items.filter((item) => item.sessionId === id)),
						`${owner}-ai-${tab.tabId}`
					)
				)
				.toEqual([]);
			expect(fs.readFileSync(marker, 'utf8')).toBe(content);
			expect(fs.existsSync(path.join(native.project, 'marker.txt'))).toBe(false);
			expect(await native.cli('permission', 'list')).toEqual([]);
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (native.app) await native.close(failed);
		}
	});
}

for (const tokenSource of ['tui', 'dynamic'] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`Claude standard unavailable: ${tokenSource}`, async ({}, info) => {
		test.setTimeout(90_000);
		const native = new NativeApp(info, { providerCli: false });
		const home = path.join(native.root, 'home');
		fs.mkdirSync(home);
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
		native.scriptTurns([{ answer: 'MUST_NOT_START' }]);
		let failed = false;
		try {
			await native.start(home);
			const owner = await native.createAgent('claude');
			await native.cli('update-agent', owner, '--token-source', 'api');
			await native.cli('tab', 'permission', 'active', 'standard', '--agent', owner);
			const tab = (await native.cli('tab', 'show', 'active', '--agent', owner)).tab;
			// Preserve the saved standard choice while explicitly changing its transport.
			await native.cli('update-agent', owner, '--token-source', tokenSource);
			await native.page.getByTestId('composer-permission').click();
			const menu = native.page.getByRole('menu');
			await expect(
				menu.getByRole('menuitemradio', { name: 'Standard', exact: true })
			).toBeDisabled();
			await expect(menu).toContainText(
				'Unavailable with TUI Wrapper or Dynamic: maestro-p skips confirmations. To approve each step, switch this conversation to claude -p.'
			);
			await expect(
				menu.getByRole('menuitemradio', { name: 'Full Access', exact: true })
			).toBeEnabled();
			await expect(
				menu.getByRole('menuitemradio', { name: 'Plan mode', exact: true })
			).toBeEnabled();
			await native.page.keyboard.press('Escape');
			const refusal =
				'This conversation uses TUI Wrapper or Dynamic, so Standard cannot take effect. Choose Read-only or Full Access, or switch this conversation to claude -p.';
			await expect(native.cli('tab', 'permission', tab.tabId, 'standard')).rejects.toThrow(refusal);
			await expect(
				native.dispatchWithEnv({}, owner, 'Refuse CLI dispatch', '--tab', tab.tabId)
			).rejects.toThrow(refusal);
			await expect(
				native.dispatchWithEnv({}, owner, 'Refuse CLI queue', '--tab', tab.tabId, '--queue')
			).rejects.toThrow(refusal);
			await native.send('Refuse the saved standard turn', { expectRefusal: refusal });
			expect(
				await native.page.evaluate(
					(id) =>
						window.maestro.process
							.getActiveProcesses()
							.then((items) => items.filter((item) => item.sessionId.startsWith(`${id}-ai-`))),
					owner
				)
			).toEqual([]);
			const invocations = path.join(native.claude, 'fixture-invocations.jsonl');
			// An invocation would record every argument, including any permission bypass.
			expect(fs.existsSync(invocations) ? fs.readFileSync(invocations, 'utf8') : '').toBe('');
			expect(await native.cli('permission', 'list')).toEqual([]);
			expect((await native.cli('tab', 'show', tab.tabId)).tab.permissionMode).toBe('standard');
			const saved = JSON.parse(
				fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')
			).sessions.find((session: { id: string }) => session.id === owner);
			expect(saved).toMatchObject({
				enableMaestroP: true,
				maestroPMode: tokenSource === 'tui' ? 'interactive' : 'dynamic',
			});
			await native.cli('settings', 'set', 'uiLanguage', 'zh-CN');
			await native.page.getByTestId('composer-permission').click();
			await expect(menu.getByRole('menuitemradio', { name: '标准', exact: true })).toBeDisabled();
			await expect(menu).toContainText(
				'TUI 包装器和动态切换模式下不可用：maestro-p 会跳过确认。要逐次批准，请把这条对话改为 claude -p。'
			);
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (native.app) await native.close(failed);
		}
	});
}
