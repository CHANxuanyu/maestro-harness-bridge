// Real quota: 1 Codex parent turn and exactly 1 dispatched Claude or Codex child turn.
// Expected minimum 2 provider turns; command/read continuations can make more
// HTTP model requests. Polling Maestro uses no model. No callbacks or retries.
// Default skipped. See docs/verification/real-codex.md before opting in.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { RealCodexApp, observeRealProcesses } from './fixtures/real-codex';
import { buildShellCommand, shellEscape } from '../src/main/utils/shell-escape';

test.skip(process.env.MAESTRO_E2E_REAL !== '1', 'requires explicit real-run opt-in');
test.setTimeout(360_000);
test.describe.configure({ retries: 0 });

// eslint-disable-next-line no-empty-pattern
test('codex: real orchestrator dispatches the selected child and quotes its result', async ({}, info) => {
	// This independently verifies the existing full-access exec path as a parent.
	const native = new RealCodexApp(info, false);
	let completed = false;
	let observing = false;
	try {
		const childProvider = native.childProvider;
		const childName = childProvider === 'codex' ? 'Codex' : 'Claude Code';
		const executable =
			childProvider === 'codex' ? native.executable : process.env.MAESTRO_E2E_CLAUDE_PATH;
		if (!executable || !path.isAbsolute(executable))
			throw new Error('Set absolute MAESTRO_E2E_CLAUDE_PATH');
		const version =
			childProvider === 'codex'
				? native.version
				: execFileSync(executable, ['--version'], {
						cwd: native.project,
						env: { ...process.env, ...native.env },
						encoding: 'utf8',
						timeout: 10_000,
					}).trim();
		info.annotations.push({ type: 'native-cli-version', description: version });
		// The answer is unknown to the parent prompt and cannot be guessed.
		const firstLine = `README_RESULT_${randomUUID()}`;
		const readme = path.join(native.project, 'README.md');
		fs.writeFileSync(readme, `${firstLine}\nOnly read the first line.\n`);
		await native.start(native.syntheticHome);
		await observeRealProcesses(native);
		observing = true;
		expect(
			(
				await native.cli(
					'project',
					'settings',
					'set',
					'--path',
					native.project,
					'--permission',
					'full',
					'--acknowledge-full-access'
				)
			).success
		).toBe(true);
		const workerId = await native.createChild();
		if (childProvider === 'claude')
			expect((await native.cli('update-agent', workerId, '--token-source', 'api')).success).toBe(
				true
			);
		const owner = await native.createCodex();
		expect(workerId).not.toBe(owner);
		const parent = (await native.cli('tab', 'show', 'active', '--agent', owner)).tab;
		const parentTab = parent.tabId as string;
		expect(
			(await native.cli('tab', 'permission', parentTab, 'full', '--agent', owner)).success
		).toBe(true);
		expect((await native.cli('tab', 'show', parentTab, '--agent', owner)).tab.permissionMode).toBe(
			'full'
		);
		const parentProcess = `${owner}-ai-${parentTab}`;
		const childPrompt = `Run sleep 8 once, then ${childProvider === 'claude' ? 'use Read to read only' : 'run head -n 1 README.md to read'} the first line of README.md in the current project. Reply with that line verbatim and nothing else. Do not write files, delegate or browse.`;
		// Invoke the built maestro-cli with the runner's Node. Identity and bridge
		// discovery still come solely from the environment injected by Maestro.
		const cliCommand = buildShellCommand(shellEscape(process.execPath), [
			path.resolve('dist/cli/maestro-cli.js'),
		]);
		const dispatch = buildShellCommand(cliCommand, [
			'dispatch',
			workerId,
			childPrompt,
			'--new-tab',
		]);
		await native
			.input()
			.fill(
				[
					`You are the parent orchestrator. Delegate exactly once to the configured ${childName} reader.`,
					`Run this exact maestro-cli dispatch command once: ${dispatch}`,
					'Do not read README yourself, inspect account files, print environment variables, or set any MAESTRO_CALLER_* variables.',
					'Do not use --notify-on-complete or send any other prompts. If dispatch fails, report the error and stop; do not retry.',
					`Use the returned tabId to poll ${cliCommand} session show <tabId> --json until the assistant answer arrives.`,
					'Use a bounded shell polling loop with a two second delay, at most 60 polls. Do not mistake the user prompt for the assistant result.',
					`Finish with CHILD_RESULT: followed by the exact first line returned by ${childName}.`,
				].join('\n')
			);
		await native.input().press('Enter');

		await expect
			.poll(async () => (await native.cli('tab', 'children', parentTab)).children, {
				timeout: 150_000,
			})
			.toHaveLength(1);
		const [child] = (await native.cli('tab', 'children', parentTab)).children;
		expect(child.agentId).toBe(workerId);
		const childTab = child.tabId as string;
		const childProcess = `${workerId}-ai-${childTab}`;
		const activeChild = () =>
			native.page.evaluate(
				async (id) =>
					(await window.maestro.process.getActiveProcesses()).filter(
						(item) => item.sessionId === id
					),
				childProcess
			);
		await expect.poll(activeChild, { timeout: 30_000 }).toHaveLength(1);
		const live = (await activeChild())[0];
		expect(live.pid).toBeGreaterThan(0);
		if (childProvider === 'codex') {
			expect(live.args).toContain('exec');
			expect(live.args).not.toContain('app-server');
		} else {
			expect((live.args ?? []).some((arg: string) => arg === '--print' || arg === '-p')).toBe(true);
		}
		const parentRow = native.page.locator(`[data-conversation-key="${owner}:${parentTab}"]`);
		const childRow = parentRow.locator(`[data-conversation-key="${workerId}:${childTab}"]`);
		await expect(childRow).toBeVisible();
		await expect(childRow.getByRole('img', { name: childName })).toBeVisible();
		await expect(childRow.getByTitle('Working')).toBeVisible();
		await expect
			.poll(
				() =>
					native.page.evaluate(
						(id) => window.__realCodexProbe.exits.filter((row) => row.id === id),
						childProcess
					),
				{ timeout: 150_000 }
			)
			.toEqual([{ id: childProcess, code: 0, interrupted: undefined }]);
		await expect.poll(activeChild).toEqual([]);
		const childAnswer = await native.page.evaluate(
			(id) => window.__realCodexProbe.answers[id]?.join('') ?? '',
			childProcess
		);
		expect(childAnswer.trim()).toBe(firstLine);
		await expect
			.poll(
				() =>
					native.page.evaluate(
						(id) => window.__realCodexProbe.exits.filter((row) => row.id === id),
						parentProcess
					),
				{ timeout: 150_000 }
			)
			.toEqual([{ id: parentProcess, code: 0, interrupted: undefined }]);
		const parentAnswer = await native.page.evaluate(
			(id) => window.__realCodexProbe.answers[id]?.join('') ?? '',
			parentProcess
		);
		expect(parentAnswer).toContain(`CHILD_RESULT: ${firstLine}`);
		await expect(native.output()).toContainText(`CHILD_RESULT: ${firstLine}`);
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await expect(childRow).toBeVisible();
		await expect(childRow.getByTitle('Working')).toHaveCount(0);
		expect((await native.cli('tab', 'children', parentTab)).children).toHaveLength(1);
		expect(await native.page.evaluate(() => window.maestro.process.getActiveProcesses())).toEqual(
			[]
		);
		expect(fs.readFileSync(readme, 'utf8')).toBe(`${firstLine}\nOnly read the first line.\n`);
		await info.attach('orchestrator-result.json', {
			body: JSON.stringify(
				{
					codexVersion: native.version,
					childProvider,
					childVersion: version,
					parentTab,
					childTab,
					childAnswer,
					parentAnswer,
				},
				null,
				2
			),
			contentType: 'application/json',
		});
		completed = true;
	} finally {
		try {
			if (observing)
				await info.attach('orchestrator-process-events.json', {
					body: JSON.stringify(await native.page.evaluate(() => window.__realCodexProbe), null, 2),
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
