import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createTurn } from './fixtures/native/protocol.cjs';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import type { Session } from '../src/renderer/types';

test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'Cross-window subtasks use synthetic providers only'
);

// eslint-disable-next-line no-empty-pattern
test('CLI child survives source window closure and reattaches after restart', async ({}, info) => {
	test.setTimeout(180_000);
	const native = new NativeApp(info, { providerCli: false });
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			uiLanguage: 'en',
			defaultSaveToHistory: false,
			crashReportingEnabled: false,
		})
	);
	const parentNative = createTurn({
		provider: 'claude',
		configDir: native.claude,
		cwd: native.project,
		prompt: 'Cross-window parent',
	});
	const parent = createMockSession({
		id: 'source-owner',
		name: 'Parent',
		toolType: 'claude-code',
		cwd: native.project,
		projectRoot: native.project,
		customPath: path.resolve('e2e/fixtures/native/claude'),
		customEnvVars: { CLAUDE_CONFIG_DIR: native.claude },
		activeTabId: 'parent-tab',
		aiTabs: [
			createMockAITab({
				id: 'parent-tab',
				name: 'Cross-window parent',
				agentSessionId: parentNative.id,
				permissionMode: 'readonly',
				readOnlyMode: true,
			}),
		],
	});
	const target = createMockSession({
		id: 'target-owner',
		name: 'Worker',
		toolType: 'codex',
		cwd: native.project,
		projectRoot: native.project,
		customPath: path.resolve('e2e/fixtures/native/codex'),
		customEnvVars: { CODEX_HOME: native.codex },
		activeTabId: 'target-tab',
		aiTabs: [
			createMockAITab({
				id: 'target-tab',
				name: 'Worker conversation',
				permissionMode: 'full',
				readOnlyMode: false,
			}),
		],
	});
	const sessionsFile = path.join(native.data, 'maestro-sessions.json');
	fs.writeFileSync(sessionsFile, JSON.stringify({ sessions: [parent, target] }));
	const saved = (): Session[] => JSON.parse(fs.readFileSync(sessionsFile, 'utf8')).sessions;
	const tab = (id: string) =>
		saved()
			.flatMap((session) => session.aiTabs)
			.find((item) => item.id === id);
	const gate = path.join(native.root, 'child-finish');
	fs.writeFileSync(
		native.script,
		JSON.stringify({ scene: { answer: 'Cross-window child complete.', exitGate: gate } })
	);
	let failed = true;
	try {
		await native.start();
		const mainId = (await native.page.evaluate(() => window.maestro.windows.list())).find(
			(win) => win.isMain
		)!.id;
		const opened = native.app.waitForEvent('window');
		const created = await native.page.evaluate(
			(id) => window.maestro.windows.create([id]),
			parent.id
		);
		const sourcePage = await opened;
		await sourcePage.waitForLoadState('domcontentloaded');
		expect(created?.id).toBeTruthy();
		await native.page.evaluate(
			([id, from, to]) => window.maestro.windows.moveSession(id, from, to),
			[parent.id, mainId, created!.id]
		);
		await expect(
			sourcePage.getByText('Cross-window parent', { exact: true }).first()
		).toBeVisible();
		await expect
			.poll(
				async () =>
					(await native.page.evaluate(() => window.maestro.windows.list())).find(
						(win) => win.id === created!.id
					)?.sessionIds
			)
			.toContain(parent.id);

		const result = await native.dispatchWithEnv(
			{ MAESTRO_CALLER_AGENT_ID: parent.id, MAESTRO_CALLER_TAB_ID: 'parent-tab' },
			target.id,
			'Check cross-window saving. Then report.',
			'--new-tab'
		);
		expect(result.success).toBe(true);
		// The CLI receipt must follow the owner's write, so no polling for provenance.
		expect(tab(result.tabId)).toMatchObject({
			name: 'Check cross-window saving.',
			permissionMode: 'readonly',
			readOnlyMode: true,
			origin: {
				kind: 'subtask',
				sourceSessionId: parent.id,
				sourceTabId: 'parent-tab',
				sourceProvider: 'claude-code',
				sourceNativeSessionId: parentNative.id,
				sourceTitle: 'Cross-window parent',
			},
		});
		await expect
			.poll(() => tab('parent-tab')?.logs.some((log) => log.delegation?.toTabId === result.tabId))
			.toBe(true);
		const active = () =>
			native.page.evaluate(
				async ({ owner, child }) =>
					(await window.maestro.process.getActiveProcesses()).some(
						(process) => process.sessionId === `${owner}-ai-${child}`
					),
				{ owner: target.id, child: result.tabId }
			);
		await expect.poll(active).toBe(true);
		await native.page.evaluate((id) => window.maestro.windows.close(id), created!.id);
		await expect
			.poll(async () => (await native.page.evaluate(() => window.maestro.windows.list())).length)
			.toBe(1);
		expect(tab(result.tabId)?.origin?.sourceNativeSessionId).toBe(parentNative.id);
		fs.writeFileSync(gate, 'finish');
		await expect.poll(active).toBe(false);
		await expect
			.poll(() =>
				tab(result.tabId)?.logs.some((log) => log.text.includes('Cross-window child complete.'))
			)
			.toBe(true);
		await native.cli('tab', 'select', result.tabId);
		await native.cli('tab', 'close', 'parent-tab');
		await expect.poll(() => tab('parent-tab')).toBeUndefined();
		const nested = () =>
			native.page.locator(
				`[data-native-session-id="${parentNative.id}"] [data-conversation-key="${target.id}:${result.tabId}"]`
			);
		await expect(nested()).toBeVisible();
		await native.restart();
		await native.cli('tab', 'select', result.tabId);
		await expect(nested()).toBeVisible();
		expect(tab(result.tabId)?.origin?.sourceNativeSessionId).toBe(parentNative.id);
		expect(tab(result.tabId)?.permissionMode).toBe('readonly');
		failed = false;
	} finally {
		fs.writeFileSync(gate, 'finish');
		if (native.app) await native.close(failed);
	}
});
