import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp, type NativeScene } from './fixtures/native-app';
import { createTurn } from './fixtures/native/protocol.cjs';
import type { Session } from '../src/renderer/types';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Subtask acceptance uses synthetic providers only');

// eslint-disable-next-line no-empty-pattern
test('new shell subtasks: mention, queued reply, CLI dispatch and closed parent', async ({}, info) => {
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
	const activeConsults = () =>
		native.page.evaluate(async () =>
			(await window.maestro.process.getActiveProcesses()).filter((process) =>
				process.sessionId.startsWith('cross-agent-')
			)
		);
	// A changing native title proves the sidebar scanned after the consult wrote
	// its record. This avoids passing absence checks against an older snapshot.
	const historyMarker = createTurn({
		provider: 'claude',
		configDir: native.claude,
		cwd: native.project,
		prompt: 'History refresh marker',
	});
	let historyScan = 0;
	const refreshHistory = async () => {
		const title = `History refresh marker ${++historyScan}`;
		fs.appendFileSync(
			historyMarker.file,
			JSON.stringify({ type: 'custom-title', customTitle: title }) + '\n'
		);
		await native.page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await expect(native.page.getByText(title, { exact: true })).toBeVisible();
	};

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
						?.aiTabs.some((tab) => tab.origin?.sourceTabId === parentTab)
				)
				.toBe(true);
			await expect.poll(async () => (await activeConsults()).length).toBe(1);
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
		await expect.poll(() => savedTab(child.id)?.consultOrigin?.nativeSessionIds?.[0]).toBeTruthy();
		const consultNativeId = savedTab(child.id)!.consultOrigin!.nativeSessionIds![0];
		expect(savedTab(child.id)?.agentSessionId).toBeFalsy();
		expect(
			(await native.cli('native-history', 'list', workerId)).result.conversations.map(
				(record: { nativeSessionId: string }) => record.nativeSessionId
			)
		).toContain(consultNativeId);
		await refreshHistory();
		await expect(
			native.page.locator('[data-conversation-key]').filter({ hasText: 'You are being consulted' })
		).toHaveCount(0);
		await expect(
			native.page.locator(
				`[data-conversation-kind="history"][data-native-session-id="${consultNativeId}"]`
			)
		).toHaveCount(0);
		await expect(
			native.page.locator('[data-conversation-key] > div').filter({ hasText: 'Inspect the queue.' })
		).toHaveCount(1);

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

		await test.step('stopping a child waits for the actual consult process to disappear', async () => {
			await native.cli('tab', 'select', parentTab);
			scene({ answer: 'Waiting for Stop.', waitForStop: true });
			await native.send('@Worker Inspect cancellation.');
			await expect.poll(async () => (await activeConsults()).length).toBe(1);
			const process = (await activeConsults())[0];
			expect(
				(await native.cli('tab', 'children', parentTab)).children.find(
					(tab: { tabId: string }) => tab.tabId === child.id
				).state
			).toBe('busy');
			await expect(native.cli('tab', 'archive', parentTab)).rejects.toThrow('conversation-running');
			await native.cli('tab', 'select', child.id);
			await native.page.getByTestId('stop-turn-button').click();
			await expect
				.poll(async () =>
					(await activeConsults()).some((entry) => entry.sessionId === process.sessionId)
				)
				.toBe(false);
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			expect(
				(await native.cli('tab', 'children', parentTab)).children.find(
					(tab: { tabId: string }) => tab.tabId === child.id
				).state
			).toBe('idle');
			expect(savedTab(parentTab)?.agentSessionId).toBe(parentNativeId);
			await expect.poll(() => savedTab(child.id)?.agentSessionId).toBeNull();
			await refreshHistory();
			await expect(
				native.page
					.locator('[data-conversation-key]')
					.filter({ hasText: 'You are being consulted' })
			).toHaveCount(0);
			await expect(
				native.page.locator(
					`[data-conversation-kind="history"][data-native-session-id="${consultNativeId}"]`
				)
			).toHaveCount(0);
			await expect(
				native.page
					.locator('[data-conversation-key] > div')
					.filter({ hasText: 'Inspect the queue.' })
			).toHaveCount(1);
		});

		await test.step('a first consult stopped before success claims its history without becoming resumable', async () => {
			const freshParent = await native.cli('tab', 'new', '--agent', parentId);
			await native.cli('tab', 'select', freshParent.tabId);
			scene({ answer: 'Unfinished first consult.', waitForStop: true });
			await native.send('@Worker Inspect interrupted work. Then report.');
			await expect.poll(async () => (await activeConsults()).length).toBe(1);
			const interrupted = () =>
				saved()
					.find((session) => session.id === workerId)!
					.aiTabs.find((tab) => tab.origin?.sourceTabId === freshParent.tabId);
			await expect.poll(() => interrupted()?.consultOrigin?.nativeSessionIds?.[0]).toBeTruthy();
			const stopped = interrupted()!;
			const nativeId = stopped.consultOrigin!.nativeSessionIds![0];
			expect(stopped.agentSessionId).toBeFalsy();
			await native.cli('tab', 'select', stopped.id);
			await native.page.getByTestId('stop-turn-button').click();
			await expect.poll(async () => (await activeConsults()).length).toBe(0);
			await expect.poll(() => savedTab(stopped.id)?.state).toBe('idle');
			expect(savedTab(stopped.id)?.agentSessionId).toBeNull();
			await refreshHistory();
			await expect(
				native.page
					.locator('[data-conversation-key]')
					.filter({ hasText: 'You are being consulted' })
			).toHaveCount(0);
			await expect(
				native.page.locator(
					`[data-conversation-kind="history"][data-native-session-id="${nativeId}"]`
				)
			).toHaveCount(0);
			await expect(
				native.page
					.locator('[data-conversation-key] > div')
					.filter({ hasText: 'Inspect interrupted work.' })
			).toHaveCount(1);
			await native.cli('tab', 'close', stopped.id);
			await expect(
				native.page
					.locator(`[data-conversation-kind="history"][data-native-session-id="${nativeId}"]`)
					.getByText('Inspect interrupted work.', { exact: true })
			).toBeVisible();
			await native.cli('tab', 'close', freshParent.tabId);
		});

		await test.step('CLI delegation records the same parent and first sentence', async () => {
			scene({ answer: 'CLI child finished.' });
			const result = await native.dispatchWithEnv(
				{
					MAESTRO_CALLER_AGENT_ID: parentId,
					MAESTRO_CALLER_TAB_ID: parentTab,
				},
				workerId,
				'Check CLI delegation. Then report.',
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
			await expect
				.poll(() =>
					native.page.evaluate(
						async ({ ownerId, tabId }) =>
							(await window.maestro.process.getActiveProcesses()).some((process) =>
								process.sessionId.startsWith(ownerId + '-ai-' + tabId)
							),
						{ ownerId: workerId, tabId: result.tabId }
					)
				)
				.toBe(false);
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
		await test.step('archive hides completed descendants and unarchive restores their parent', async () => {
			await native.cli('native-history', 'archive', parentId, parentNativeId);
			await expect(
				native.page.locator(`[data-conversation-key="${workerId}:${child.id}"]`)
			).toHaveCount(0);
			await expect(native.page.locator(`[data-native-session-id="${parentNativeId}"]`)).toHaveCount(
				0
			);
			await native.cli('native-history', 'unarchive', parentId, parentNativeId);
			const restoredParent = native.page.locator(`[data-native-session-id="${parentNativeId}"]`);
			await expect(restoredParent).toBeVisible();
			await expect(
				restoredParent.locator(`[data-conversation-key="${workerId}:${child.id}"]`)
			).toBeVisible();
			expect(savedTab(child.id)?.origin?.sourceNativeSessionId).toBe(parentNativeId);
		});
		await test.step('closing the child leaves a clean native title and reopening shows the question', async () => {
			await native.cli('tab', 'close', child.id);
			await expect.poll(() => savedTab(child.id)).toBeUndefined();
			await refreshHistory();
			const historyRow = native.page.locator(
				`[data-conversation-kind="history"][data-native-session-id="${consultNativeId}"]`
			);
			await expect(historyRow).toHaveCount(1);
			await expect(historyRow.getByText('Inspect the queue.', { exact: true })).toBeVisible();
			await expect(
				native.page
					.locator('[data-conversation-key]')
					.filter({ hasText: 'You are being consulted' })
			).toHaveCount(0);
			await historyRow.locator(':scope > div > button[data-tree-nav]').last().click();
			await expect(native.output()).toContainText(
				'@Worker Inspect the queue. Then inspect shutdown.'
			);
			await expect(native.output()).not.toContainText('You are being consulted');
		});
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		fs.writeFileSync(gate, 'release');
		await native.close(failed);
	}
});
