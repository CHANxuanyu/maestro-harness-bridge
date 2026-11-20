import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Session } from '../src/renderer/types';
import { test, expect } from '@playwright/test';
import { NativeApp, type NativeTool } from './fixtures/native-app';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Synthetic provider scenarios only');
test.describe.configure({ retries: 0, timeout: 120_000 });

for (const provider of ['claude', 'codex'] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`${provider}: fixed activity, public notes, honest outcomes and turn delivery`, async ({}, info) => {
		const native = new NativeApp(info, { providerCli: false });
		execFileSync('git', ['init', '-b', 'main'], { cwd: native.project });
		const settings = path.join(native.data, 'maestro-settings.json');
		fs.writeFileSync(
			settings,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settings, 'utf8')),
				newShell: true,
				defaultSaveToHistory: false,
				uiLanguage: 'en',
			})
		);
		const home = path.join(native.root, 'home');
		fs.mkdirSync(home);
		const gates = Array.from({ length: 11 }, (_, index) => path.join(native.root, `step-${index}`));
		const notes = [
			'Inspecting the files',
			'Checking the expected failure',
			'Verifying the changes',
		];
		const tools: NativeTool[] = Array.from({ length: 11 }, (_, index) => ({
			id: `activity-${index}`,
			command: `printf step-${index}`,
			output: index === 4 ? 'Exit code: 1\nExpected regression failure' : 'ok',
			...(index === 4 ? { status: 'failed' as const } : {}),
		}));
		const writes: NativeTool[] =
			provider === 'claude'
				? ['activity-a.txt', 'activity-b.txt'].map((file, index) => ({
						id: `write-${index}`,
						name: 'Write',
						input: { file_path: file, content: index ? 'three\n' : 'one\ntwo\n' },
						command: '',
						output: 'Written',
					}))
				: [
						{
							id: 'write-patch',
							name: 'file_change',
							command: '',
							output: 'Written',
							input: {
								patch:
									'*** Begin Patch\n*** Add File: activity-a.txt\n+one\n+two\n*** Add File: activity-b.txt\n+three\n*** End Patch',
								changes: [
									{ path: 'activity-a.txt', kind: 'add' },
									{ path: 'activity-b.txt', kind: 'add' },
								],
							},
						},
					];
		native.scriptTurns([
			{
				answer: 'ACTIVITY_DONE',
				sequentialTools: true,
				toolDelay: 3000,
				tools,
				activityGates: gates,
				narrations: notes.map((text, index) => ({ beforeTool: index * 4, text })),
			},
			{ answer: '', tools: [tools[4]], terminalError: 'Activity fixture tool crashed' },
			{
				answer: 'DELIVERY_DONE',
				tools: writes,
				writes: { 'activity-a.txt': 'one\ntwo\n', 'activity-b.txt': 'three\n' },
			},
		]);
		let failed = false;
		try {
			await native.start(home);
			const agentId = await native.createAgent(provider);
			const selected = await native.cli('tab', 'show', 'active', '--agent', agentId);
			const tabId = selected.tab.tabId as string;
			if (provider === 'claude')
				await native.cli('tab', 'model', tabId, 'claude-sonnet-5-5', '--agent', agentId);
			await native.cli('tab', 'panel', tabId, 'tasks', '--agent', agentId);
			await native.send('Run eleven synthetic calls with three public notes');
			const bar = native.page.getByTestId('turn-activity-bar');
			let firstHeight = 0;
			let firstScroll = 0;
			for (let index = 0; index < 11; index++) {
				await expect(native.page.getByTestId('activity-counts')).toContainText(
					`Commands ${index + 1}`
				);
				await expect(native.page.getByTestId('activity-note')).toHaveText(
					notes[Math.floor(index / 4)]
				);
				const height = (await bar.boundingBox())!.height;
				const scroll = await native.output().evaluate((element) => element.scrollHeight);
				if (index === 0) {
					firstHeight = height;
					firstScroll = scroll;
				}
				expect(height).toBe(firstHeight);
				expect(scroll - firstScroll).toBeLessThanOrEqual(24);
				await expect(native.output().locator('[data-tool-activity]')).toHaveCount(0);
				await expect(native.output().locator('.animate-pulse, .animate-spin')).toHaveCount(1);
				await expect(
					native.page.locator(
						'[data-shell-header] .animate-pulse, [data-shell-header] .animate-spin'
					)
				).toHaveCount(0);
				await expect(native.page.getByTestId('activity-plan')).toHaveCount(0);
				await expect(bar).not.toContainText('0/0');
				await expect(native.page.getByTestId('tasks-empty')).toContainText(
					'This conversation has no task list.'
				);
				if (provider === 'claude')
					await expect(native.page.getByTestId('tasks-empty')).toContainText(
						'Claude 5-series models do not provide a task-list tool.'
					);
				fs.writeFileSync(gates[index], 'continue');
			}
			await expect(native.output()).toContainText('ACTIVITY_DONE');
			await expect(bar).toHaveCount(0);
			const summary = native.page.getByTestId('activity-collapsed').first();
			await expect(summary).toContainText('11 steps');
			await expect(summary.locator('[data-tool-status="error"]')).toHaveCount(0);
			await summary.click();
			await expect(
				native.output().locator('[data-turn-activity-steps] [data-tool-activity]')
			).toHaveCount(11);
			await expect(native.output()).toContainText('exit code 1');
			const detail = await native.output().locator('[data-turn-activity-steps]').innerText();
			expect(notes.map((note) => detail.indexOf(note))).toEqual(
				[...notes.map((note) => detail.indexOf(note))].sort((a, b) => a - b)
			);
			for (const note of notes) expect(detail).toContain(note);
			await summary.click();

			await native.send('End this synthetic turn with an error');
			await expect(
				native.page.getByTestId('activity-collapsed').last().locator('[data-tool-status="error"]')
			).toBeVisible();
			await expect(native.page.getByTestId('activity-collapsed').last()).toContainText(
				'Activity fixture tool crashed'
			);

			await native.send('Write two synthetic files');
			await expect(native.output()).toContainText('DELIVERY_DONE');
			const delivery = native.page.getByTestId('turn-delivery').last();
			await expect(delivery).toContainText('Changed 2 files · +3 -0');
			const turnId = await delivery.getAttribute('data-turn-id');
			await delivery.getByRole('button').click();
			await expect(native.page.getByTestId('changes-list')).toHaveAttribute(
				'data-turn-filter',
				turnId!
			);
			await expect(native.page.getByTestId('changes-list')).toContainText('activity-a.txt');
			await expect(native.page.getByTestId('changes-list')).toContainText('activity-b.txt');
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

// eslint-disable-next-line no-empty-pattern
test('codex: script-recorded plan survives a cold native-history restore', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const settings = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settings,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settings, 'utf8')),
			newShell: true,
			defaultSaveToHistory: false,
		})
	);
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home);
	native.scriptTurns([
		{
			answer: 'PLAN_RESTORE_DONE',
			plan: [
				{ step: 'Inspect files', status: 'completed' },
				{ step: 'Review result', status: 'pending' },
			],
			tools: [{ id: 'hold', command: 'printf ready', output: 'ready' }],
			toolDelay: 3000,
		},
	]);
	let failed = false;
	try {
		await native.start(home);
		const agentId = await native.createAgent('codex');
		await native.cli('tab', 'panel', 'active', 'tasks', '--agent', agentId);
		await native.send('Restore this plan from native history');
		await expect(native.page.getByTestId('activity-plan')).toHaveText('1/2 tasks');
		await expect(native.page.getByTestId('tasks-progress')).toHaveText('1 / 2 completed');
		await expect(native.output()).toContainText('PLAN_RESTORE_DONE');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		const transcript = await native.oneTranscript('codex');
		expect(fs.readFileSync(transcript, 'utf8')).toContain('tools.update_plan');
		await native.close();
		// Saved display logs must not mask a broken native-plan reader.
		const file = path.join(native.data, 'maestro-sessions.json');
		const stored: { sessions: Session[] } = JSON.parse(fs.readFileSync(file, 'utf8'));
		for (const owner of stored.sessions) for (const tab of owner.aiTabs) tab.logs = [];
		fs.writeFileSync(file, JSON.stringify(stored));
		await native.start(home);
		await native.page
			.locator('button[data-tree-nav]')
			.filter({ hasText: /Restore this plan|PLAN_RESTORE_DONE/ })
			.first()
			.click();
		await native.cli('tab', 'panel', 'active', 'tasks', '--agent', agentId);
		await expect(native.page.getByTestId('tasks-progress')).toHaveText('1 / 2 completed');
		await expect(native.page.getByTestId('tasks-panel').getByRole('listitem')).toHaveText([
			'Inspect files',
			'Review result',
		]);
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
