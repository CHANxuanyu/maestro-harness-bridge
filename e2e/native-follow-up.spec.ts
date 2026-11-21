import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import type { ConversationAutomationState } from '../src/shared/conversationAutomation';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Synthetic follow-up scenarios only');
test.describe.configure({ retries: 0, timeout: 150_000 });

// eslint-disable-next-line no-empty-pattern
test('F1: the agent shell registers a 20 second follow-up that wakes the same conversation', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	native.scriptTurns([
		{
			answer: 'WAIT_REGISTERED',
			maestroCliCommands: [
				['follow-up', 'add', '--after', '20', '--reason', 'Inspect the original CI result'],
			],
		},
		{ answer: 'SAME_CONVERSATION_AWAKE' },
	]);
	let failed = false;
	try {
		await native.start();
		const agent = await native.createAgent('claude');
		const tab = (await native.cli('tab', 'show', 'active', '--agent', agent)).tab.tabId as string;
		await native.send('Register the follow-up before finishing this turn.');
		await expect(native.output().getByText('WAIT_REGISTERED', { exact: true })).toBeVisible();
		await expect(native.output().getByText('SAME_CONVERSATION_AWAKE', { exact: true })).toBeVisible(
			{ timeout: 25_000 }
		);
		const state = (await native.cli(
			'follow-up',
			'list',
			'--agent',
			agent,
			'--tab',
			tab
		)) as ConversationAutomationState;
		const follow = state.followUps[0];
		const invocations = fs
			.readFileSync(path.join(native.claude, 'fixture-invocations.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		const wake = invocations.find((entry) => entry.prompt?.includes(`[follow-up:${follow.id}]`));
		expect(wake.prompt).toContain('Inspect the original CI result');
		expect(
			Math.abs(wake.startedAt - (follow.condition.kind === 'time' ? follow.condition.at : 0))
		).toBeLessThanOrEqual(2000);
		expect(follow.target).toEqual({ kind: 'conversation', sessionId: agent, tabId: tab });
		expect(native.files('claude')).toHaveLength(1);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('F1: an observed command exits 1 after 8 seconds and delivers its exit code and tail; unknown events are rejected', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	native.scriptTurns([
		{
			answer: 'COMMAND_REGISTERED',
			maestroCliCommands: [
				[
					'follow-up',
					'add',
					'--process',
					'b4-observed-command',
					'--reason',
					'Inspect the failed command',
				],
			],
		},
		{ answer: 'COMMAND_RESULT_RECEIVED' },
	]);
	let failed = false;
	try {
		await native.start();
		const agent = await native.createAgent('claude');
		const tab = (await native.cli('tab', 'show', 'active', '--agent', agent)).tab.tabId as string;
		fs.writeFileSync(
			path.join(native.project, 'command.cjs'),
			"setTimeout(() => { console.log('B4_OUTPUT_TAIL'); process.exit(1); }, 8000);"
		);
		await native.page.evaluate((cwd) => {
			void window.maestro.process.runCommand({
				sessionId: 'b4-observed-command',
				command: 'node command.cjs',
				cwd,
			});
		}, native.project);
		await native.send('Wait for the observed command.');
		await expect(native.output().getByText('COMMAND_RESULT_RECEIVED', { exact: true })).toBeVisible(
			{ timeout: 20_000 }
		);
		const state = (await native.cli(
			'follow-up',
			'list',
			'--agent',
			agent,
			'--tab',
			tab
		)) as ConversationAutomationState;
		expect(state.followUps[0].externalStatus).toMatchObject({
			exitCode: 1,
			outputTail: expect.stringContaining('B4_OUTPUT_TAIL'),
		});
		expect(state.deliveries[0].prompt).toContain('"exitCode":1');
		await expect(
			native.cli(
				'follow-up',
				'add',
				'--process',
				'unobservable',
				'--reason',
				'unknown',
				'--agent',
				agent,
				'--tab',
				tab
			)
		).rejects.toThrow(/cannot observe|time condition/);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('F2: a 60 second follow-up survives forced quit, is marked late after restart, and canceled work stays canceled', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	native.scriptTurns([{ answer: 'RESTORE_BASE' }, { answer: 'RESTORED_FOLLOW_UP' }]);
	let failed = false;
	try {
		await native.start();
		const agent = await native.createAgent('claude');
		const tab = (await native.cli('tab', 'show', 'active', '--agent', agent)).tab.tabId as string;
		await native.send('Establish a native conversation.');
		await expect(native.output().getByText('RESTORE_BASE', { exact: true })).toBeVisible();
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		const first = (await native.cli(
			'follow-up',
			'add',
			'--after',
			'60',
			'--reason',
			'Original restart reason',
			'--agent',
			agent,
			'--tab',
			tab
		)) as ConversationAutomationState;
		const second = (await native.cli(
			'follow-up',
			'add',
			'--after',
			'60',
			'--reason',
			'Must never wake',
			'--agent',
			agent,
			'--tab',
			tab
		)) as ConversationAutomationState;
		await native.cli('follow-up', 'cancel', second.followUps[1].id, '--agent', agent, '--tab', tab);
		await native.app.context().tracing.stop();
		const closed = native.app.waitForEvent('close');
		native.app.process().kill('SIGKILL');
		await closed;
		await new Promise((resolve) =>
			setTimeout(resolve, Math.max(0, first.followUps[0].createdAt + 61_000 - Date.now()))
		);
		await native.start();
		await expect(native.output().getByText('RESTORED_FOLLOW_UP', { exact: true })).toBeVisible({
			timeout: 20_000,
		});
		const state = (await native.cli(
			'follow-up',
			'list',
			'--agent',
			agent,
			'--tab',
			tab
		)) as ConversationAutomationState;
		expect(state.followUps[0].fire?.late).toBe(true);
		expect(
			state.deliveries.find((entry) => entry.id === `follow:${first.followUps[0].id}`)?.prompt
		).toContain('Late follow-up');
		expect(state.followUps[1].state).toBe('canceled');
		expect(state.deliveries.some((entry) => entry.prompt.includes('Must never wake'))).toBe(false);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});
