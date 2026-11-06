import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp, type NativeScene } from './fixtures/native-app';
import { RELAY_DECISION_TIMEOUT_MS } from '../src/main/permission-relay/types';
import type { PermissionRequest } from '../src/main/permission-relay/types';

// Refuse real mode before constructing the harness or inspecting credentials.
if (process.env.MAESTRO_E2E_REAL === '1')
	throw new Error('Claude permission acceptance only supports synthetic providers');

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
		const rows = (name: string): Record<string, any>[] => {
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
			await native.cli('tab', 'permission', 'active', 'standard', '--agent', owner);
			// A saved TUI preference must still run standard approval through print.
			await native.cli('update-agent', owner, '--token-source', newShell ? 'interactive' : 'api');
			const tab = (await native.cli('tab', 'show', 'active', '--agent', owner)).tab;
			await native.send('Perform the synthetic approval write');
			const dialog = native.page.getByTestId('permission-prompt');
			await expect(dialog).toBeVisible();
			if (newShell) {
				await native.cli('settings', 'set', 'uiLanguage', 'zh-CN');
				await expect(dialog).toContainText('只批准这一次工具调用');
				await expect(dialog).toContainText(content.trim());
				await expect(dialog).toContainText(native.project);
				await expect(dialog.getByRole('button', { name: '拒绝', exact: true })).toBeFocused();
			}
			expect(fs.existsSync(marker)).toBe(false);
			const requests: Omit<PermissionRequest, 'token'>[] = await native.cli('permission', 'list');
			expect(requests).toHaveLength(1);
			const request = requests[0];
			expect(request.tabId).toBe(tab.tabId);
			expect(request.input).toEqual({ file_path: marker, content });
			expect(request).not.toHaveProperty('token');
			const invocation = rows('fixture-invocations.jsonl')[0];
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
				const decision = rows('fixture-permission-events.jsonl')[0].decision;
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
