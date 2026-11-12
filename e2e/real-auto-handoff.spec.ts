import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { RealAcceptanceApp, acceptanceEnabled } from './fixtures/real-acceptance';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import type { Session } from '../src/renderer/types';

// One synthetic quota error, one real Codex recipient turn. No Claude login needed.
test.skip(
	!acceptanceEnabled('AUTO_HANDOFF'),
	'requires MAESTRO_E2E_REAL=1 and MAESTRO_E2E_AUTO_HANDOFF=1 outside CI/smoke'
);
test.setTimeout(360_000);
test.describe.configure({ retries: 0 });

// eslint-disable-next-line no-empty-pattern
test('real auto handoff: synthetic Claude quota failure reaches Codex exactly once and names its account', async ({}, info) => {
	const native = new RealAcceptanceApp(info, 'AUTO_HANDOFF', ['codex']);
	let completed = false;
	try {
		native.initRepo({ 'marker.txt': 'AUTO_REAL_RESULT_7429\n' });
		await native.start();
		const target = await native.create('codex', 1);
		// Exactly the quota fixture used by native-auto-handoff.spec.ts.
		native.scriptTurns([
			{ answer: 'Claude AI usage limit reached|1999999999', quotaFailure: true },
		]);
		const source = createMockSession({
			id: 'quota-source',
			name: 'Synthetic Claude quota',
			toolType: 'claude-code',
			cwd: native.project,
			projectRoot: native.project,
			fullPath: native.project,
			customPath: path.resolve('e2e/fixtures/native/claude'),
			customEnvVars: { CLAUDE_CONFIG_DIR: native.claude, MAESTRO_NATIVE_SCRIPT: native.script },
			retryOnAvailabilityErrors: false,
			retryOnTokenExhaustion: false,
			activeTabId: 'quota-tab',
			aiTabs: [
				createMockAITab({
					id: 'quota-tab',
					permissionMode: 'readonly',
					readOnlyMode: true,
					saveToHistory: false,
				}),
			],
		});
		await native.page.evaluate((session) => window.maestro.sessions.setMany([session], []), source);
		await native.page.reload();
		// Reload before any turn, then reinstall the observer through the shared fixture function.
		const { observeRealProcesses } = await import('./fixtures/real-codex');
		await observeRealProcesses(native);
		expect(
			(await native.cli('project', 'settings', 'show', '--path', native.project)).settings
				.autoHandoffTarget
		).toBeUndefined();
		expect(
			(
				await native.cli(
					'project',
					'settings',
					'set',
					'--path',
					native.project,
					'--auto-handoff',
					target.owner
				)
			).success
		).toBe(true);
		expect((await native.cli('tab', 'select', 'quota-tab', '--agent', source.id)).success).toBe(
			true
		);
		const request =
			'Read only marker.txt in this working directory with one tool call. Reply with its exact contents. Do not modify files, inspect accounts or delegate.';
		await native.input().fill(request);
		await native.input().press('Enter');
		const saved = (): Session[] =>
			JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')).sessions;
		await expect
			.poll(() => saved().find((session) => session.id === source.id)?.aiTabs[0].agentError?.type)
			.toBe('rate_limited');
		await expect
			.poll(() =>
				saved()
					.flatMap((session) => session.aiTabs)
					.filter((tab) => tab.origin?.automatic)
			)
			.toHaveLength(1);
		const recipientTab = saved()
			.flatMap((session) => session.aiTabs)
			.find((tab) => tab.origin?.automatic)!;
		const recipient = await native.conversation(target.owner, 'codex', recipientTab.id);
		const notice = native.page.getByRole('button', {
			name: `Automatically handed off to Codex (account ${native.codex})`,
			exact: true,
		});
		await expect(notice).toBeVisible();
		await notice.click();
		await native.settled(recipient);
		expect(await native.answer(recipient)).toContain('AUTO_REAL_RESULT_7429');
		await expect(native.output()).toContainText('AUTO_REAL_RESULT_7429');
		const transcript = await native.transcript(recipient);
		const nativeRequests = transcript.rows.filter(
			(row) => row.type === 'event_msg' && row.payload?.type === 'user_message'
		);
		expect(nativeRequests).toHaveLength(1);
		expect(nativeRequests[0].payload.message.split(request)).toHaveLength(2);
		await expect
			.poll(
				() =>
					saved()
						.flatMap((session) => session.aiTabs)
						.find((tab) => tab.id === recipient.tab)
						?.logs.filter((log) => log.source === 'user').length
			)
			.toBe(1);
		// Observe beyond the coordinator's ten-second tick; polling never resends.
		await native.page.waitForTimeout(11_000);
		await native.settled(recipient);
		expect(native.invocations(target.owner)).toHaveLength(1);
		expect(
			saved()
				.flatMap((session) => session.aiTabs)
				.filter((tab) => tab.origin?.automatic)
		).toHaveLength(1);
		expect(
			(await native.cli('tab', 'show', recipient.tab, '--agent', recipient.owner)).tab
				.permissionMode
		).toBe('readonly');
		expect(fs.readFileSync(path.join(native.project, 'marker.txt'), 'utf8')).toBe(
			'AUTO_REAL_RESULT_7429\n'
		);
		native.checked(
			'Synthetic rate limit triggers one real Codex invocation, one native request and one account-labelled notice; readonly permissions preserved'
		);
		completed = true;
	} finally {
		await native.finish(completed);
	}
});
