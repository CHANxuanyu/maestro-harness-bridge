import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { buildShellCommand, shellEscape } from '../../src/main/utils/shell-escape';
import { RealAcceptanceApp } from './real-acceptance';

/** Both real parent directions exercise the same dispatch protocol and origin assertions. */
export async function realOrchestrator(
	native: RealAcceptanceApp,
	parentProvider: 'claude' | 'codex',
	childProvider: 'claude' | 'codex',
	interject: boolean
) {
	const firstLine = `README_RESULT_${randomUUID()}`;
	native.initRepo({ 'README.md': `${firstLine}\nRead only the first line.\n` });
	await native.start();
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
	const worker = await native.create(childProvider, interject ? 2 : 1);
	const parent = await native.create(parentProvider, 1);
	const cli = buildShellCommand(shellEscape(process.execPath), [
		path.resolve('dist/cli/maestro-cli.js'),
	]);
	const childPrompt =
		'Run sleep 12 once, read only the first line of README.md, write that exact line plus newline to child-result.txt, then reply with that line verbatim and nothing else. Use at most four tool calls. Do not delegate, browse, inspect accounts or environment.';
	const dispatch = buildShellCommand(cli, ['dispatch', worker.owner, childPrompt, '--new-tab']);
	await native.select(parent);
	await native
		.input()
		.fill(
			[
				`Delegate exactly once by running this exact command: ${dispatch}`,
				'Do not read README.md or child-result.txt yourself. Do not inspect account files or environment variables or set any MAESTRO_CALLER_* variables.',
				'Do not use --notify-on-complete, retry dispatch, or send additional prompts. On failure report it and stop.',
				`Use the returned tabId to poll ${cli} session show <tabId> --json for the assistant result. Use one shell loop with a two second delay, at most 60 polls.`,
				'Use at most four tool calls total. Finish with CHILD_RESULT: followed by the exact README_RESULT_ line from the child assistant response.',
			].join('\n')
		);
	await native.input().press('Enter');
	await expect
		.poll(async () => (await native.cli('tab', 'children', parent.tab)).children, {
			timeout: 150_000,
		})
		.toHaveLength(1);
	const [dispatched] = (await native.cli('tab', 'children', parent.tab)).children;
	expect(dispatched.agentId).toBe(worker.owner);
	const child = await native.conversation(worker.owner, childProvider, dispatched.tabId);
	const nested = native
		.row(parent)
		.locator(`[data-conversation-key="${child.owner}:${child.tab}"]`);
	await expect(nested).toBeVisible();
	await expect(nested.getByTitle('Working')).toBeVisible();
	await nested.locator(':scope > div > button[data-tree-nav]').last().click();
	const interjection = `INTERJECTION_${randomUUID()}`;
	if (interject) {
		// The user may arrive during the turn or just after it. Both must continue
		// this native child, using the ordinary queue when it is still running.
		const running = await native.page.getByTestId('stop-turn-button').count();
		await native
			.input()
			.fill(`Reply exactly ${interjection}. Do not use any tools or change files.`);
		await native.input().press('Enter');
		native.evidence.interjectionSubmittedWhileRunning = running > 0;
		await native.settled(child, 2);
		expect(await native.answer(child)).toContain(interjection);
		await expect(native.output()).toContainText(interjection);
	} else await native.settled(child);
	await native.settled(parent);
	expect(await native.answer(child)).toContain(firstLine);
	if (!interject) expect((await native.answer(child)).trim()).toBe(firstLine);
	expect(await native.answer(parent)).toContain(`CHILD_RESULT: ${firstLine}`);
	expect(fs.readFileSync(path.join(native.project, 'child-result.txt'), 'utf8')).toBe(
		`${firstLine}\n`
	);
	expect(fs.readFileSync(path.join(native.project, 'README.md'), 'utf8')).toBe(
		`${firstLine}\nRead only the first line.\n`
	);
	const parentCalls = native.invocations(parent.owner);
	expect(parentCalls).toHaveLength(1);
	expect(parentCalls[0].caller).toEqual({ agentId: parent.owner, tabId: parent.tab });
	expect(parentCalls[0].args).toContain(parentProvider === 'claude' ? '--print' : 'exec');
	expect(native.invocations(child.owner)).toHaveLength(interject ? 2 : 1);
	expect(native.invocations(child.owner)[0].args).toContain(
		childProvider === 'claude' ? '--print' : 'exec'
	);
	const childNative = await native.transcript(child);
	await native.transcript(parent);
	if (interject) expect(fs.readFileSync(childNative.file, 'utf8')).toContain(interjection);
	await native.select(parent);
	await expect(native.output()).toContainText(`CHILD_RESULT: ${firstLine}`);
	expect((await native.cli('tab', 'children', parent.tab)).children).toHaveLength(1);
	await expect
		.poll(() => native.page.evaluate(() => window.maestro.process.getActiveProcesses()))
		.toEqual([]);
	native.evidence.orchestrator = {
		parentProvider,
		childProvider,
		firstLine,
		interjection: interject ? interjection : null,
		parent: parent.tab,
		child: child.tab,
	};
	native.checked(
		'One dispatch with application-stamped caller; nested child is clickable; parent quotes an unguessable child result; files and both native transcripts verified'
	);
	if (interject)
		native.checked(
			'Child answers the interjection in its same native conversation, with exactly two child turns'
		);
}
