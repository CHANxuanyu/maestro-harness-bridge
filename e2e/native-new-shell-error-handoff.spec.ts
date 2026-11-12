import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import type { Session } from '../src/renderer/types';

test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'Shell defect scenarios use synthetic providers only'
);
test.setTimeout(180_000);

// eslint-disable-next-line no-empty-pattern
test('quota error and header share handoff targets and continue the failed conversation with Codex', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			autoResumeOnLimit: false,
			defaultSaveToHistory: false,
		})
	);
	const codexScript = path.join(native.root, 'codex-script.json');
	fs.writeFileSync(
		codexScript,
		JSON.stringify({ scene: { answer: 'Codex continued the failed request.' } })
	);
	native.scriptTurns([{ answer: 'Claude AI usage limit reached|1999999999', quotaFailure: true }]);
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
					name: provider === 'claude' ? 'Failed request' : 'Codex',
					permissionMode: 'readonly',
					readOnlyMode: true,
					saveToHistory: false,
				}),
			],
		})
	);
	const sessionsFile = path.join(native.data, 'maestro-sessions.json');
	fs.writeFileSync(sessionsFile, JSON.stringify({ sessions }));
	const saved = (): Session[] => JSON.parse(fs.readFileSync(sessionsFile, 'utf8')).sessions;
	let failed = true;
	try {
		await native.start();
		await native.cli('tab', 'select', 'claude-tab', '--agent', 'claude');
		await native.send('Continue the shipping calculation after this limit');
		await expect
			.poll(() => saved().find((session) => session.id === 'claude')?.aiTabs[0].agentError?.type)
			.toBe('rate_limited');
		const card = native.output().locator('[data-feed-row="error"]');
		await expect(card).toContainText('Quota exhausted');
		await expect(
			card.getByRole('button', { name: 'Continue with another AI', exact: true })
		).toBeVisible();
		const quotaDialog = native.page.getByRole('dialog', {
			name: 'Usage limit reached',
			exact: true,
		});
		await expect(quotaDialog).toBeVisible();
		await quotaDialog.getByRole('button', { name: /^Continue with another AI/ }).click();
		await expect(quotaDialog).toHaveCount(0);
		const dialog = native.page.getByTestId('ai-handoff-modal');
		await expect(dialog).toContainText('Failed request');
		await expect(dialog.getByRole('radio', { name: /^Codex/ })).toBeVisible();
		const quotaTargets = await dialog.getByRole('radio').evaluateAll((radios) =>
			radios.map((radio) => ({
				value: (radio as HTMLInputElement).value,
				label: radio.closest('label')?.textContent,
			}))
		);
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await native.page.getByTestId('header-handoff').click();
		await expect(dialog).toContainText('Failed request');
		await expect(dialog.getByRole('radio', { name: /^Codex/ })).toBeVisible();
		const headerTargets = await dialog.getByRole('radio').evaluateAll((radios) =>
			radios.map((radio) => ({
				value: (radio as HTMLInputElement).value,
				label: radio.closest('label')?.textContent,
			}))
		);
		expect(headerTargets).toEqual(quotaTargets);
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await card.getByRole('button', { name: 'Continue with another AI', exact: true }).click();
		await expect(dialog).toContainText('Failed request');
		await expect(dialog.getByRole('radio', { name: /^Codex/ })).toBeVisible();
		expect(
			await dialog.getByRole('radio').evaluateAll((radios) =>
				radios.map((radio) => ({
					value: (radio as HTMLInputElement).value,
					label: radio.closest('label')?.textContent,
				}))
			)
		).toEqual(headerTargets);
		await dialog.getByRole('radio', { name: /^Codex/ }).check();
		await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(native.input()).toHaveValue(/Continue the shipping calculation after this limit/);
		await native.input().press('Enter');
		await expect(native.output()).toContainText('Codex continued the failed request.');
		await expect
			.poll(() =>
				saved().some(
					(session) =>
						session.toolType === 'codex' &&
						session.aiTabs.some((tab) => tab.origin?.sourceTabId === 'claude-tab')
				)
			)
			.toBe(true);
		const recipient = saved().find((session) =>
			session.aiTabs.some((tab) => tab.origin?.sourceTabId === 'claude-tab')
		)!;
		expect(recipient.toolType).toBe('codex');
		expect(recipient.cwd).toBe(native.project);
		failed = false;
	} finally {
		if (native.app) await native.close(failed);
		fs.rmSync(native.root, { recursive: true, force: true });
	}
});
