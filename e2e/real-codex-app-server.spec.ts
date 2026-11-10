// Real quota: 4 Codex turns (hello, deny, allow plus steer, stop), 1 steer RPC.
// Tool continuations and steering can issue additional model requests; HTTP
// request count is provider dependent. No test retries or automatic resubmits.
// Default skipped. See docs/verification/real-codex.md before opting in.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import {
	RealCodexApp,
	observeRealProcesses,
	observeCodexWire,
	readCodexWire,
} from './fixtures/real-codex';

test.skip(process.env.MAESTRO_E2E_REAL !== '1', 'requires explicit real-run opt-in');
test.setTimeout(600_000);
test.describe.configure({ retries: 0 });

// eslint-disable-next-line no-empty-pattern
test('codex: real app-server approval, steering and stop', async ({}, info) => {
	const native = new RealCodexApp(info, true);
	let completed = false;
	let observing = false;
	try {
		// .git is excluded from workspace-write even when the project is in /tmp.
		// A sibling under /tmp would be writable without approval on some hosts.
		execFileSync('git', ['init', native.project], { env: { ...process.env, ...native.env } });
		const target = path.join(native.project, '.git', 'maestro-real-approval.txt');
		await native.start(native.syntheticHome);
		await observeRealProcesses(native);
		await observeCodexWire(native);
		observing = true;
		const owner = await native.createCodex();
		const created = await native.cli('tab', 'new', '--agent', owner);
		expect(created.success).toBe(true);
		const tabId = created.tabId as string;
		const processId = `${owner}-ai-${tabId}`;
		expect(
			(await native.cli('tab', 'permission', tabId, 'standard', '--agent', owner)).success
		).toBe(true);
		expect((await native.cli('tab', 'show', tabId, '--agent', owner)).tab.permissionMode).toBe(
			'standard'
		);
		const active = () =>
			native.page.evaluate(
				async (id) =>
					(await window.maestro.process.getActiveProcesses()).filter(
						(item) => item.sessionId === id
					),
				processId
			);
		const answers = () =>
			native.page.evaluate((id) => window.__realCodexProbe.answers[id]?.join('') ?? '', processId);
		const settled = async (count: number) => {
			await expect
				.poll(
					() =>
						native.page.evaluate(
							(id) => window.__realCodexProbe.exits.filter((item) => item.id === id),
							processId
						),
					{ timeout: 120_000 }
				)
				.toHaveLength(count);
			await expect.poll(active, { timeout: 15_000 }).toEqual([]);
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			expect(await native.cli('codex-turn', 'permissions')).toEqual([]);
		};

		await test.step('new conversation completes its first real turn', async () => {
			// NativeApp.send deliberately substitutes scripted real workloads.
			await native.input().fill('Reply exactly REAL_CODEX_HELLO. Do not use tools.');
			await native.input().press('Enter');
			await expect.poll(answers, { timeout: 120_000 }).toContain('REAL_CODEX_HELLO');
			await settled(1);
		});

		const dialog = native.page.getByRole('dialog', { name: 'Permission request' });
		const writePrompt =
			`Use apply_patch to create ${target} with exactly one line: approval smoke\n` +
			'Obtain the required file approval. Do not use a shell write or another path. ' +
			'If denied, do not retry or work around it; reply REAL_CODEX_DENIED and end the turn.';
		await test.step('deny one write and finish without creating the file', async () => {
			await native.input().fill(writePrompt);
			await native.input().press('Enter');
			await expect(dialog).toBeVisible({ timeout: 120_000 });
			await expect(dialog).toContainText('maestro-real-approval.txt');
			expect(fs.existsSync(target)).toBe(false);
			const pending = await native.cli('codex-turn', 'permissions');
			expect(pending).toHaveLength(1);
			expect(pending[0]).toMatchObject({ provider: 'codex', sessionId: processId, tabId });
			const live = await active();
			expect(live).toHaveLength(1);
			expect(live[0].args).toContain('app-server');
			expect(live[0].args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
			await dialog.getByRole('button', { name: 'Deny', exact: true }).click();
			await expect.poll(answers, { timeout: 120_000 }).toContain('REAL_CODEX_DENIED');
			await settled(2);
			expect(fs.existsSync(target)).toBe(false);
		});

		await test.step('allow once, then steer the same running turn', async () => {
			await native
				.input()
				.fill(
					writePrompt +
						'\nThis is a new request for one approval. ' +
						'If allowed, after writing run the shell command sleep 20 exactly once. ' +
						'When it returns, include any instruction added during the wait in your final answer.'
				);
			await native.input().press('Enter');
			await expect(dialog).toBeVisible({ timeout: 120_000 });
			await expect(dialog).toContainText('maestro-real-approval.txt');
			expect(fs.existsSync(target)).toBe(false);
			expect(await native.cli('codex-turn', 'permissions')).toHaveLength(1);
			await dialog.getByRole('button', { name: 'Allow once', exact: true }).click();
			await expect.poll(() => fs.existsSync(target), { timeout: 120_000 }).toBe(true);
			expect(fs.readFileSync(target, 'utf8')).toBe('approval smoke\n');
			await expect
				.poll(
					async () =>
						(await readCodexWire(native)).some(
							(row) =>
								row.direction === 'receive' &&
								row.message.method === 'item/started' &&
								row.message.params?.item?.type === 'commandExecution' &&
								row.message.params.item.command?.includes('sleep 20')
						),
					{ timeout: 120_000 }
				)
				.toBe(true);
			expect(await active()).toHaveLength(1);
			await native.input().fill('In your final answer include exactly STEER_APPLIED_7429.');
			await native.page.getByRole('button', { name: 'Add to this turn', exact: true }).click();
			await expect(native.input()).toHaveValue('');
			await expect.poll(answers, { timeout: 120_000 }).toContain('STEER_APPLIED_7429');
			await settled(3);
			const wire = await readCodexWire(native);
			const steering = wire.filter(
				(row) => row.direction === 'send' && row.message.method === 'turn/steer'
			);
			expect(steering).toHaveLength(1);
			const request = steering[0].message;
			expect(request.params?.expectedTurnId).toEqual(expect.any(String));
			expect(
				wire.find((row) => row.direction === 'receive' && row.message.id === request.id)?.message
					.result
			).toEqual({ turnId: request.params!.expectedTurnId });
		});

		await test.step('stop a running command and wait for the native process to exit', async () => {
			await native
				.input()
				.fill('Run the shell command sleep 120 once. Do nothing else until it returns.');
			await native.input().press('Enter');
			await expect
				.poll(
					async () =>
						(await readCodexWire(native)).some(
							(row) =>
								row.direction === 'receive' &&
								row.message.method === 'item/started' &&
								row.message.params?.item?.command?.includes('sleep 120')
						),
					{ timeout: 120_000 }
				)
				.toBe(true);
			const live = await active();
			expect(live).toHaveLength(1);
			const pid = live[0].pid;
			expect(pid).toBeGreaterThan(0);
			await native.page.getByTestId('stop-turn-button').click();
			await settled(4);
			await expect
				.poll(
					() => {
						try {
							process.kill(pid, 0);
							return true;
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
							throw error;
						}
					},
					{ timeout: 15_000 }
				)
				.toBe(false);
		});

		const wire = await readCodexWire(native);
		const sent = wire.filter((row) => row.direction === 'send').map((row) => row.message);
		expect(sent.filter((row) => row.method === 'thread/start')).toHaveLength(1);
		expect(sent.filter((row) => row.method === 'thread/resume')).toHaveLength(3);
		expect(sent.filter((row) => row.method === 'turn/start')).toHaveLength(4);
		expect(sent.filter((row) => row.method === 'turn/interrupt')).toHaveLength(1);
		expect(
			wire
				.filter((row) => row.direction === 'receive' && row.message.method === 'turn/completed')
				.map((row) => row.message.params?.turn?.status)
		).toEqual(['completed', 'completed', 'completed', 'interrupted']);
		const approvals = wire.filter(
			(row) =>
				row.direction === 'receive' && row.message.method === 'item/fileChange/requestApproval'
		);
		expect(approvals).toHaveLength(2);
		expect(sent.filter((row) => row.result?.decision).map((row) => row.result?.decision)).toEqual([
			'decline',
			'accept',
		]);
		const exits = await native.page.evaluate(
			(id) => window.__realCodexProbe.exits.filter((row) => row.id === id),
			processId
		);
		expect(exits.slice(0, 3).map((row) => row.code)).toEqual([0, 0, 0]);
		expect(exits[3]).toMatchObject({ code: 130, interrupted: true });
		completed = true;
	} finally {
		try {
			if (observing)
				await info.attach('codex-wire.json', {
					body: JSON.stringify(
						{
							version: native.version,
							model: native.model,
							wire: await readCodexWire(native),
							processes: await native.page.evaluate(() => window.__realCodexProbe),
						},
						null,
						2
					),
					contentType: 'application/json',
				});
		} finally {
			try {
				if (native.app) await native.close(!completed);
			} finally {
				fs.rmSync(native.root, { recursive: true, force: true });
			}
		}
	}
});
