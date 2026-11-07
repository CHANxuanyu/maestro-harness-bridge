import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp, type NativeScene } from './fixtures/native-app';
import type { Session } from '../src/renderer/types';

// eslint-disable-next-line no-empty-pattern
test('new shell subtasks: mention, queued reply, CLI dispatch and closed parent', async ({}, info) => {
	if (process.env.MAESTRO_E2E_REAL === '1') {
		throw new Error('This regression requires synthetic providers. Unset MAESTRO_E2E_REAL.');
	}
	test.setTimeout(180_000);
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
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
	const saved = (): Session[] =>
		JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')).sessions;
	const savedTab = (id: string) =>
		saved()
			.flatMap((session) => session.aiTabs)
			.find((tab) => tab.id === id);
	const scene = (value: NativeScene) =>
		fs.writeFileSync(native.script, JSON.stringify({ scene: value }));
	const gate = path.join(native.root, 'finish-consult');
	let failed = false;
	try {
		await native.start(home);
		const parentId = await native.createAgent('claude');
		const parentTab = saved().find((session) => session.id === parentId)!.activeTabId;
		scene({ answer: 'Parent is ready.' });
		await native.send('Prepare the parent conversation.');
		await expect(native.output()).toContainText('Parent is ready.');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await expect.poll(() => savedTab(parentTab)?.agentSessionId).toBeTruthy();
		const parentNativeId = savedTab(parentTab)!.agentSessionId!;
		const workerId = await native.createAgent('codex');
		await native.cli('rename-agent', workerId, 'Worker');
		await native.cli('tab', 'select', parentTab);
		await expect(native.output()).toContainText('Parent is ready.');

		await test.step('mention creates a nested running conversation without unread', async () => {
			scene({ answer: 'Consult finished.', exitGate: gate });
			await native.send('@Worker Inspect the queue. Then inspect shutdown.');
			await expect
				.poll(() =>
					saved()
						.find((session) => session.id === workerId)
						?.aiTabs.some((tab) => tab.origin?.sourceTabId === parentTab && tab.state === 'busy')
				)
				.toBe(true);
		});
		const child = saved()
			.find((session) => session.id === workerId)!
			.aiTabs.find((tab) => tab.origin?.sourceTabId === parentTab)!;
		expect(child.name).toBe('Inspect the queue.');
		expect(child.hidden).toBe(true);
		expect(child.hasUnread).toBe(false);
		const parentRow = native.page.locator(`[data-conversation-key="${parentId}:${parentTab}"]`);
		const childRow = parentRow.locator(`[data-conversation-key="${workerId}:${child.id}"]`);
		await expect(childRow).toBeVisible();
		await expect(childRow.getByRole('img', { name: 'Codex' })).toBeVisible();
		await expect(childRow.getByTitle('Working')).toBeVisible();
		expect(
			(await native.cli('tab', 'children', parentTab)).children.map(
				(tab: { tabId: string }) => tab.tabId
			)
		).toEqual([child.id]);

		await test.step('open the child and queue a reply while its consult is running', async () => {
			await childRow.locator(':scope > div > button[data-tree-nav]').last().click();
			await expect.poll(() => savedTab(child.id)?.hidden).toBe(false);
			scene({ answer: 'Queued reply continued the same child.' });
			await native.send('Continue with this extra check.');
			await expect
				.poll(() =>
					saved()
						.find((session) => session.id === workerId)
						?.executionQueue.some((item) => item.tabId === child.id)
				)
				.toBe(true);
			fs.writeFileSync(gate, 'release');
			await expect(native.output()).toContainText('Queued reply continued the same child.');
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			expect(native.files('codex')).toHaveLength(1);
			expect(fs.readFileSync(native.files('codex')[0], 'utf8')).toContain(
				'Continue with this extra check.'
			);
			await expect.poll(() => savedTab(child.id)?.hasUnread).toBe(false);
		});

		await test.step('CLI delegation records the same parent and first sentence', async () => {
			scene({ answer: 'CLI child finished.' });
			const result = await native.cliWithEnv(
				{
					MAESTRO_CALLER_AGENT_ID: parentId,
					MAESTRO_CALLER_TAB_ID: parentTab,
				},
				'dispatch',
				'Check CLI delegation. Then report.',
				'--agent',
				workerId,
				'--new-tab'
			);
			expect(result.success).toBe(true);
			await expect.poll(() => savedTab(result.tabId)?.origin?.sourceTabId).toBe(parentTab);
			expect(savedTab(result.tabId)?.name).toBe('Check CLI delegation.');
			await expect
				.poll(() =>
					savedTab(result.tabId)?.logs.some((log) => log.text.includes('CLI child finished.'))
				)
				.toBe(true);
			await expect.poll(() => savedTab(result.tabId)?.state).toBe('idle');
			expect(
				(await native.cli('tab', 'children', parentTab)).children.map(
					(tab: { tabId: string }) => tab.tabId
				)
			).toContain(result.tabId);
		});

		await test.step('closed parent stays above its child through native history and restart', async () => {
			await native.cli('tab', 'select', child.id);
			await native.cli('tab', 'close', parentTab);
			await expect.poll(() => savedTab(parentTab)).toBeUndefined();
			const historyParent = () =>
				native.page.locator(`[data-native-session-id="${parentNativeId}"]`);
			await expect(
				historyParent().locator(`[data-conversation-key="${workerId}:${child.id}"]`)
			).toBeVisible();
			await native.restart(home);
			await native.cli('tab', 'select', child.id);
			await expect(
				historyParent().locator(`[data-conversation-key="${workerId}:${child.id}"]`)
			).toBeVisible();
			expect(savedTab(child.id)?.origin?.sourceNativeSessionId).toBe(parentNativeId);
			scene({ answer: 'Child continued after restart.' });
			await native.send('Continue after restart.');
			await expect(native.output()).toContainText('Child continued after restart.');
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		});
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		fs.writeFileSync(gate, 'release');
		await native.close(failed);
	}
});
