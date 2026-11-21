import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { NativeApp, type NativeScene } from './fixtures/native-app';
import type { ConversationAutomationState } from '../src/shared/conversationAutomation';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Synthetic check scenarios only');
test.describe.configure({ retries: 0, timeout: 120_000 });

function enableNewShell(native: NativeApp): void {
	const file = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		file,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(file, 'utf8')),
			newShell: true,
			uiLanguage: 'en',
			defaultSaveToHistory: false,
		})
	);
	execFileSync('git', ['init', '-b', 'main'], { cwd: native.project });
}

// eslint-disable-next-line no-empty-pattern
test('F3: project authorization, app evidence, delivery count and an outside-scope request', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	enableNewShell(native);
	native.scriptTurns([
		{
			answer: 'All checks passed according to the assistant.',
			tools: [
				{
					id: 'write',
					name: 'Write',
					command: '',
					input: { file_path: 'check.txt', content: 'changed' },
					output: 'Written',
				},
			],
			writes: { 'check.txt': 'changed' },
		},
	]);
	let failed = false;
	try {
		await native.start();
		const agent = await native.createAgent('claude');
		const tab = (await native.cli('tab', 'show', 'active', '--agent', agent)).tab.tabId as string;
		await native.cli('checks', 'set', '--command', 'true', 'false', '--agent', agent, '--tab', tab);
		await native.cli('tab', 'panel', tab, 'checks', '--agent', agent);
		await expect(native.page.getByTestId('checks-project-permission')).toBeVisible();
		await native.page.getByRole('button', { name: 'Allow for this project', exact: true }).click();
		await native.send('Change the file and state that all checks passed.');
		await expect(
			native.output().getByText('All checks passed according to the assistant.', { exact: true })
		).toBeVisible();
		await expect(native.output().getByTestId('conversation-check-delivery')).toContainText(
			'1/2 passed'
		);
		await expect(native.output().locator('[data-check-status="failed"]')).toBeVisible();
		let state = (await native.cli(
			'checks',
			'status',
			'--agent',
			agent,
			'--tab',
			tab
		)) as ConversationAutomationState;
		expect(state.batches.at(-1)?.checks.map((check) => check.outcome)).toEqual(['pass', 'fail']);
		expect(state.batches.at(-1)?.revision).toBeTruthy();
		await native.cli(
			'checks',
			'set',
			'--command',
			'echo APP_EVIDENCE',
			'false',
			'--agent',
			agent,
			'--tab',
			tab
		);
		await expect(native.page.getByTestId('checks-project-permission')).toHaveCount(0);
		state = (await native.cli(
			'checks',
			'status',
			'--agent',
			agent,
			'--tab',
			tab
		)) as ConversationAutomationState;
		expect(state.batches.at(-1)?.checks[0].outputTail).toContain('APP_EVIDENCE');
		await native.cli(
			'checks',
			'set',
			'--command',
			'cat ../outside-project',
			'--agent',
			agent,
			'--tab',
			tab
		);
		await expect(native.page.getByTestId('checks-scope-request').first()).toContainText(
			'outside the project'
		);
		await expect(
			native.page.getByRole('button', { name: 'Only this once', exact: true }).first()
		).toBeVisible();
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('F4: three app-observed attempts include a repeat, then diagnosis instead of owner escalation', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	enableNewShell(native);
	const scene = (index: number, content: string): NativeScene => ({
		answer: `FIX_${index}`,
		writes: { 'fix.txt': content },
		tools: [
			{
				id: `write-${index}`,
				name: 'Write',
				command: '',
				input: { file_path: 'fix.txt', content },
				output: 'Written',
			},
		],
		maestroCliCommands: [
			[
				'checks',
				'plan',
				'--proposal',
				JSON.stringify({
					basis: `Hypothesis ${index}`,
					difference: `Experiment ${index}`,
					expectation: 'Failure changes',
					candidates: [],
				}),
			],
		],
	});
	native.scriptTurns([
		scene(1, 'first'),
		scene(2, 'second'),
		scene(3, 'first'),
		{ answer: 'DIAGNOSIS_RECORDED', waitForStop: true },
	]);
	let failed = false;
	try {
		await native.start();
		const agent = await native.createAgent('claude');
		const tab = (await native.cli('tab', 'show', 'active', '--agent', agent)).tab.tabId as string;
		await native.cli('checks', 'set', '--command', 'false', '--agent', agent, '--tab', tab);
		await native.cli('checks', 'authorize', 'project', '--agent', agent, '--tab', tab);
		await native.cli('checks', 'fix', 'auto', '--agent', agent, '--tab', tab);
		await expect
			.poll(
				async () =>
					(await native.cli('checks', 'status', '--agent', agent, '--tab', tab)).decision?.kind,
				{ timeout: 60_000 }
			)
			.toBe('diagnose');
		const state = (await native.cli(
			'checks',
			'status',
			'--agent',
			agent,
			'--tab',
			tab
		)) as ConversationAutomationState;
		expect(state.progress.attempts.map((attempt) => attempt.verdict)).toEqual([
			'first',
			'none',
			'dup',
		]);
		expect(state.deliveries.at(-1)?.prompt).toContain('Diagnose');
		await native.cli('tab', 'panel', tab, 'checks', '--agent', agent);
		await expect(native.page.getByTestId('checks-attempt-ledger').first()).toBeVisible();
		await expect(native.page.getByTestId('checks-boundary-card')).toHaveCount(0);
		await native.cli('follow-up', 'stop', '--agent', agent, '--tab', tab);
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('F6: the displayed shared limit expires with a report and explicit extend or stop choices', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	enableNewShell(native);
	native.scriptTurns([{ answer: 'EXPIRY_REPORTED' }]);
	let failed = false;
	try {
		await native.start();
		const agent = await native.createAgent('claude');
		const tab = (await native.cli('tab', 'show', 'active', '--agent', agent)).tab.tabId as string;
		await native.cli(
			'follow-up',
			'add',
			'--after',
			'60',
			'--total-minutes',
			'0.1',
			'--reason',
			'Waiting past the total limit',
			'--agent',
			agent,
			'--tab',
			tab
		);
		await native.cli('tab', 'panel', tab, 'follow-ups', '--agent', agent);
		await expect(native.page.getByTestId('follow-up-card')).toContainText('Come back to look');
		await expect(native.page.getByTestId('follow-up-expiry')).toBeVisible({ timeout: 15_000 });
		await expect(
			native.page.getByRole('button', { name: 'Extend 1 hour', exact: true }).first()
		).toBeVisible();
		await expect(
			native.page.getByRole('button', { name: 'Stop following', exact: true }).first()
		).toBeVisible();
		const state = (await native.cli(
			'follow-up',
			'list',
			'--agent',
			agent,
			'--tab',
			tab
		)) as ConversationAutomationState;
		expect(state.stopped).toBe(true);
		expect(state.report).toContain('stopped-incomplete');
		expect(state.followUps.some((entry) => entry.state === 'pending')).toBe(false);
		await expect(native.output().getByText('EXPIRY_REPORTED', { exact: true })).toBeVisible();
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('F6: queued CI wakes at the single-wait boundary and re-registers at ten minutes without a failure', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	enableNewShell(native);
	const bin = path.join(native.root, 'bin');
	fs.mkdirSync(bin);
	fs.writeFileSync(
		path.join(bin, 'gh'),
		`#!${process.execPath}\nconsole.log(JSON.stringify({status:'queued',conclusion:null,jobs:[]}));\n`,
		{ mode: 0o755 }
	);
	native.scriptTurns([{ answer: 'CI_STILL_WAITING' }, { answer: 'CI_EXPIRY_REPORT' }]);
	let failed = false;
	try {
		await native.start(undefined, { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` });
		const agent = await native.createAgent('claude');
		const tab = (await native.cli('tab', 'show', 'active', '--agent', agent)).tab.tabId as string;
		await native.cli(
			'follow-up',
			'add',
			'--ci',
			'42',
			'--cwd',
			native.project,
			'--reason',
			'Wait for the queued CI',
			'--wait-minutes',
			'0.016667',
			'--total-minutes',
			'0.2',
			'--agent',
			agent,
			'--tab',
			tab
		);
		await expect(native.output().getByText('CI_STILL_WAITING', { exact: true })).toBeVisible({
			timeout: 10_000,
		});
		const state = (await native.cli(
			'follow-up',
			'list',
			'--agent',
			agent,
			'--tab',
			tab
		)) as ConversationAutomationState;
		expect(state.attempts).toHaveLength(0);
		expect(state.followUps.find((entry) => entry.state === 'pending')?.waitLimitMs).toBe(600_000);
		await expect(native.page.getByTestId('conversation-waiting-ci')).toBeVisible();
		await native.cli('tab', 'panel', tab, 'follow-ups', '--agent', agent);
		await expect(native.page.getByTestId('follow-up-expiry')).toBeVisible({ timeout: 20_000 });
		await expect(native.output().getByText('CI_EXPIRY_REPORT', { exact: true })).toBeVisible();
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		await native.close(failed);
	}
});
