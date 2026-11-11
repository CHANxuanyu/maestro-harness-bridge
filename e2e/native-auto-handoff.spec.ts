import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import type { Session } from '../src/renderer/types';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Automatic handoff uses synthetic providers only');

for (const enabled of [false, true]) {
	// eslint-disable-next-line no-empty-pattern
	test(`quota auto handoff ${enabled ? 'enabled sends once and stops the chain' : 'defaults off'}`, async ({}, info) => {
		const native = new NativeApp(info, { providerCli: false });
		const codexScript = path.join(native.root, 'codex-script.json');
		const settingsFile = path.join(native.data, 'maestro-settings.json');
		fs.writeFileSync(
			settingsFile,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
				newShell: true,
				autoResumeOnLimit: true,
				defaultSaveToHistory: false,
				crashReportingEnabled: false,
			})
		);
		native.scriptTurns([
			{ answer: 'Claude AI usage limit reached|1999999999', quotaFailure: true },
		]);
		fs.writeFileSync(
			codexScript,
			JSON.stringify({ scene: { answer: 'Received the failed request once.' } })
		);
		const sessions = (['claude', 'codex'] as const).map((provider) =>
			createMockSession({
				id: provider,
				name: provider,
				toolType: provider === 'claude' ? 'claude-code' : 'codex',
				cwd: native.project,
				projectRoot: native.project,
				fullPath: native.project,
				customPath: path.resolve(`e2e/fixtures/native/${provider}`),
				customEnvVars: {
					CLAUDE_CONFIG_DIR: native.claude,
					CODEX_HOME: native.codex,
					MAESTRO_NATIVE_SCRIPT: provider === 'claude' ? native.script : codexScript,
				},
				retryOnAvailabilityErrors: false,
				retryOnTokenExhaustion: false,
				activeTabId: `${provider}-tab`,
				aiTabs: [
					createMockAITab({
						id: `${provider}-tab`,
						permissionMode: 'readonly',
						readOnlyMode: true,
						saveToHistory: false,
					}),
				],
			})
		);
		fs.writeFileSync(path.join(native.data, 'maestro-sessions.json'), JSON.stringify({ sessions }));
		const saved = (): Session[] =>
			JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')).sessions;
		let failed = false;
		try {
			await native.start();
			await native.cli('tab', 'select', 'claude-tab', '--agent', 'claude');
			expect(
				(await native.cli('project', 'settings', 'show', '--path', native.project)).settings
					.autoHandoffTarget
			).toBeUndefined();
			const targets = await native.cli('handoff', 'claude-tab', '--list-configurations');
			expect(targets.targets).toContainEqual(
				expect.objectContaining({ provider: 'codex', runnerId: 'codex', account: native.codex })
			);
			if (enabled)
				await native.cli(
					'project',
					'settings',
					'set',
					'--path',
					native.project,
					'--auto-handoff',
					'codex'
				);
			await native.send('Continue this exact failed request.');
			await expect
				.poll(() => saved().find((s) => s.id === 'claude')?.aiTabs[0].agentError?.type)
				.toBe('rate_limited');
			await expect
				.poll(() => native.page.evaluate(() => window.maestro.process.getActiveProcesses()))
				.toEqual([]);
			if (!enabled) {
				expect(
					saved()
						.flatMap((s) => s.aiTabs)
						.filter((tab) => tab.origin?.automatic)
				).toHaveLength(0);
				expect(fs.existsSync(path.join(native.codex, 'fixture-turn-count'))).toBe(false);
				return;
			}
			await expect
				.poll(
					() =>
						saved()
							.flatMap((s) => s.aiTabs)
							.filter((tab) => tab.origin?.automatic).length
				)
				.toBe(1);
			const note = native.page.getByRole('button', {
				name: `Automatically handed off to Codex (account ${native.codex})`,
				exact: true,
			});
			await expect(note).toBeVisible();
			await note.click();
			await expect(
				native.output().getByText('Received the failed request once.', { exact: true })
			).toBeVisible();
			await expect
				.poll(() => native.page.evaluate(() => window.maestro.process.getActiveProcesses()))
				.toEqual([]);
			// The handed-off message reaches disk on the debounced save, after the screen.
			const recipientTab = () =>
				saved()
					.flatMap((s) => s.aiTabs)
					.find((tab) => tab.origin?.automatic)!;
			await expect
				.poll(() => recipientTab().logs.filter((log) => log.source === 'user').length)
				.toBe(1);
			const recipient = recipientTab();
			expect(recipient).toMatchObject({ permissionMode: 'readonly', readOnlyMode: true });
			expect(recipient.logs.filter((log) => log.source === 'user')).toHaveLength(1);
			expect(
				recipient.logs
					.find((log) => log.source === 'user')
					?.text.split('Continue this exact failed request.')
			).toHaveLength(2);
			expect(fs.readFileSync(path.join(native.codex, 'fixture-turn-count'), 'utf8')).toBe('1');
			await native.cli(
				'project',
				'settings',
				'set',
				'--path',
				native.project,
				'--auto-handoff',
				'claude'
			);
			fs.writeFileSync(
				codexScript,
				JSON.stringify({
					scene: {
						answer: 'rate limit exceeded',
						codexExecEvents: [
							{ type: 'thread.started', thread_id: recipient.agentSessionId },
							{ type: 'turn.started' },
							{ type: 'turn.failed', error: { message: 'rate limit exceeded' } },
						],
					},
				})
			);
			await native.send('The recipient now reaches its quota.');
			await expect
				.poll(
					() =>
						saved()
							.flatMap((s) => s.aiTabs)
							.find((tab) => tab.id === recipient.id)?.agentError?.type
				)
				.toBe('rate_limited');
			// Observe beyond the global coordinator's 10 second startup tick.
			// It must not replay this captured prompt even when auto-resume is enabled.
			await native.page.waitForTimeout(11_000);
			await expect
				.poll(() => native.page.evaluate(() => window.maestro.process.getActiveProcesses()))
				.toEqual([]);
			expect(
				saved()
					.flatMap((s) => s.aiTabs)
					.filter((tab) => tab.origin?.automatic)
			).toHaveLength(1);
			expect(saved().find((s) => s.id === 'claude')?.aiTabs).toHaveLength(1);
			expect(fs.readFileSync(path.join(native.claude, 'fixture-turn-count'), 'utf8')).toBe('1');
			expect(fs.readFileSync(path.join(native.codex, 'fixture-turn-count'), 'utf8')).toBe('2');
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			try {
				if (native.app) await native.close(failed);
			} finally {
				fs.rmSync(native.root, { recursive: true, force: true });
			}
		}
	});
}
