import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import planEvents from './fixtures/native/codex-plan-events.json';
import type { Session } from '../src/renderer/types';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'synthetic exec replay only');
test.describe.configure({ retries: 0 });

// eslint-disable-next-line no-empty-pattern
test('codex: completed plan keeps its final answer visible after the next message', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home);
	const settings = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settings,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settings, 'utf8')),
			newShell: true,
			defaultSaveToHistory: false,
		})
	);
	const final = planEvents[9].item!.text!;
	native.scriptTurns([
		{ answer: final, codexExecEvents: planEvents },
		{ answer: 'FOLLOW_UP: still here.' },
	]);
	let failed = false;
	try {
		await native.start(home);
		const agentId = await native.createAgent('codex');
		const selected = await native.cli('tab', 'show', 'active', '--agent', agentId);
		const tabId = selected.tab.tabId as string;
		const logs = () => {
			const saved: { sessions: Session[] } = JSON.parse(
				fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')
			);
			return (
				saved.sessions
					.find((session) => session.id === agentId)
					?.aiTabs.find((tab) => tab.id === tabId)?.logs ?? []
			);
		};
		expect((await native.cli('tab', 'panel', tabId, 'tasks', '--agent', agentId)).success).toBe(
			true
		);
		expect(
			(await native.cli('dispatch', agentId, 'Run the synthetic plan', '--tab', tabId)).success
		).toBe(true);
		await expect(native.page.getByTestId('tasks-progress')).toHaveText('2 / 2 completed');
		await expect(native.page.getByTestId('tasks-panel').getByRole('listitem')).toHaveCount(2);
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await expect
			.poll(() => logs().filter((log) => log.source === 'stdout' && log.text === final).length)
			.toBe(1);
		const answerId = logs().find((log) => log.source === 'stdout' && log.text === final)!.id;
		const answer = native.output().locator(`[data-log-id="${answerId}"]`);
		await expect(answer).toBeVisible();
		await expect(answer).toContainText(final);
		expect(
			logs().filter((log) => log.source !== 'stdout' && log.text.includes('PLAN_FINAL:'))
		).toEqual([]);

		expect(
			(await native.cli('dispatch', agentId, 'Send the synthetic follow-up', '--tab', tabId))
				.success
		).toBe(true);
		await expect(native.output()).toContainText('FOLLOW_UP: still here.');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		// Do not expand any activity folds. The previous answer must stay in the feed.
		await expect(answer).toBeVisible();
		await expect(answer).toContainText(final);
		await expect(answer).not.toHaveAttribute('data-feed-row', 'turn-activity');
		await expect
			.poll(() => logs().filter((log) => log.source === 'stdout' && log.text === final).length)
			.toBe(1);
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
