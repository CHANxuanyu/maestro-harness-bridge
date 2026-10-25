import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/native-app';
import { createOpenCodeTurn, readOpenCodeState } from './fixtures/native/opencode-protocol.cjs';
import { nativeIdentity } from './fixtures/native-real';

test('opencode a: two turns retain one native session and the previous rows', async ({
	native,
}) => {
	native.scriptTurns([{ answer: 'First native answer.' }, { answer: 'Second native answer.' }]);
	await native.createAgent('opencode');
	await native.send('First acceptance turn');
	await expect(native.output().getByText('First native answer.', { exact: true })).toBeVisible();
	await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
	const file = await native.oneTranscript('opencode');
	const before = readOpenCodeState(file);
	await native.send('Second acceptance turn');
	await expect(native.output().getByText('Second native answer.', { exact: true })).toBeVisible();
	await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
	const after = readOpenCodeState(file);
	expect(after.sessions.map((row) => row.id)).toEqual(before.sessions.map((row) => row.id));
	for (const row of before.messages) expect(after.messages).toContainEqual(row);
	for (const row of before.parts) expect(after.parts).toContainEqual(row);
	expect(after.parts.some((row) => row.data.text === 'Second native answer.')).toBe(true);
	await expect(native.output().getByText('First native answer.', { exact: true })).toBeVisible();
});

test('opencode b: parallel tools keep their own input, result and failure', async ({ native }) => {
	const tools = [
		{ id: 'parallel-first', command: 'printf first-result', output: 'first-result' },
		{
			id: 'parallel-second',
			command: 'printf second-result',
			output: 'second-result',
			status: 'failed' as const,
		},
	];
	native.scriptTurns([{ answer: 'Tool acceptance complete.', tools }]);
	await native.createAgent('opencode');
	await native.send('Run two independent tools');
	// run --format json emits tool_use only after completion/error, never running.
	await expect(
		native.output().getByText('Tool acceptance complete.', { exact: true })
	).toBeVisible();
	await native.expandTools();
	for (const tool of tools) {
		const result = native.output().getByTestId('tool-call-result').filter({ hasText: tool.output });
		await expect(result).toBeVisible();
		const card = result.locator(
			'xpath=ancestor::*[@data-tool-call-fold or @data-feed-row="activity"][1]'
		);
		await expect(card).toContainText(tool.command);
		await expect(card.locator('[data-tool-status="error"]')).toHaveCount(tool.status ? 1 : 0);
	}
	await expect(native.output().locator('[data-tool-status="running"]')).toHaveCount(0);
	const state = readOpenCodeState(await native.oneTranscript('opencode'));
	const calls = state.parts.filter((row) => row.data.type === 'tool');
	expect(new Set(calls.map((row) => row.data.callID)).size).toBe(2);
	for (const tool of tools) {
		const call = calls.find((row) => row.data.state.input.command.includes(tool.command));
		expect(call).toBeDefined();
		expect(call.data.state.status).toBe(tool.status ? 'error' : 'completed');
		expect(call.data.state.output ?? call.data.state.error).toContain(tool.output);
	}
});

test('opencode c: Stop retains native cancellation and resumes the same ID', async ({ native }) => {
	native.scriptTurns([
		{
			answer: '',
			tools: [{ id: 'stop-tool', command: 'sleep 60', output: '' }],
			waitForStop: true,
		},
		{ answer: 'Resumed after Stop.' },
	]);
	await native.createAgent('opencode');
	await native.send('Run a long tool');
	const file = await native.oneTranscript('opencode');
	await expect
		.poll(() =>
			readOpenCodeState(file).parts.some(
				(row) => row.data.type === 'tool' && row.data.state.status === 'running'
			)
		)
		.toBe(true);
	const id = readOpenCodeState(file).sessions[0].id;
	await native.page.getByRole('button', { name: /^Stop/ }).click();
	await expect(native.output().locator('[data-tool-status="canceled"]').first()).toBeVisible();
	await native.send('Continue after stopping');
	await expect(native.output().getByText('Resumed after Stop.', { exact: true })).toBeVisible();
	const after = readOpenCodeState(file);
	expect(after.sessions.map((row) => row.id)).toEqual([id]);
	expect(after.parts.some((row) => row.data.state?.metadata?.interrupted === true)).toBe(true);
});

test('opencode d: a normal application restart preserves native resume', async ({ native }) => {
	native.scriptTurns([
		{ answer: 'Before application restart.' },
		{ answer: 'After application restart.' },
	]);
	await native.createAgent('opencode');
	await native.send('Before restart');
	await expect(
		native.output().getByText('Before application restart.', { exact: true })
	).toBeVisible();
	await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
	const file = await native.oneTranscript('opencode');
	const before = readOpenCodeState(file);
	await native.restart();
	await native.page
		.locator('button[data-tree-nav]')
		.filter({ hasText: 'Before application restart.' })
		.click();
	await expect(
		native.output().getByText('Before application restart.', { exact: true })
	).toBeVisible();
	await native.send('After restart');
	await expect(
		native.output().getByText('After application restart.', { exact: true })
	).toBeVisible();
	expect(readOpenCodeState(file).sessions.map((row) => row.id)).toEqual(
		before.sessions.map((row) => row.id)
	);
});

test('opencode e: project history opens native results and the actual model without writing', async ({
	native,
}) => {
	native.scriptTurns([]);
	const turn = await native.externalTurn('opencode', 'External acceptance history', {
		answer: 'Answer from external history.',
		tools: [{ id: 'history-tool', command: 'printf history-result', output: 'history-result' }],
	});
	const before = readOpenCodeState(turn.file);
	const metadata = nativeIdentity('opencode', turn.file);
	expect(metadata.model).toBeTruthy();
	await native.createAgent('opencode');
	await native.page
		.locator('[data-conversation-kind="history"] button[data-tree-nav]')
		.filter({ hasText: 'Answer from external history.' })
		.click();
	await expect(
		native.output().getByText('Answer from external history.', { exact: true })
	).toBeVisible();
	await native.expandTools();
	await expect(native.output().getByTestId('tool-call-result')).toContainText('history-result');
	await native.output().getByRole('button', { name: 'Message info', exact: true }).last().click();
	await expect(native.output().getByText(metadata.model, { exact: true })).toBeVisible();
	expect(readOpenCodeState(turn.file)).toEqual(before);
});

test('opencode f: external turns follow only when idle and preserve reading and drafts', async ({
	native,
}) => {
	native.scriptTurns([
		{
			answer: '',
			waitForStop: true,
			tools: [{ id: 'busy-tool', command: 'sleep 60', output: '' }],
		},
	]);
	const seed = await native.externalTurn('opencode', 'External follow history', {
		answer: Array.from({ length: 80 }, (_, i) => `History paragraph ${i}.`).join('\n\n'),
	});
	await native.createAgent('opencode');
	await native.page
		.locator('[data-conversation-kind="history"] button[data-tree-nav]')
		.filter({ hasText: 'History paragraph 0.' })
		.click();
	await expect(native.output().getByText('History paragraph 79.', { exact: true })).toBeVisible();
	const scroll = native.output().locator(':scope > .overflow-y-auto');
	await native.externalTurn(
		'opencode',
		'An external idle turn',
		{ answer: 'Idle external answer.' },
		seed.id
	);
	await expect(native.output().getByText('Idle external answer.', { exact: true })).toBeVisible();
	await expect
		.poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
		.toBeLessThanOrEqual(1);
	await native.input().fill('Preserve this draft.');
	await scroll.evaluate((node) => {
		node.scrollTop = 0;
		node.dispatchEvent(new Event('scroll'));
	});
	const anchor = native.output().getByText('History paragraph 0.', { exact: true });
	const before = await anchor.boundingBox();
	const tool = {
		id: 'external-result',
		command: 'printf external-output',
		output: 'external-output',
	};
	const gate = path.join(native.root, 'external-work');
	const external = native.real
		? native.externalTurn(
				'opencode',
				'External work while reading',
				{
					answer: 'External work completed.',
					tools: [{ ...tool, updates: ['external-output'], gates: [gate] }],
				},
				seed.id
			)
		: undefined;
	external?.catch(() => {});
	const synthetic = native.real
		? undefined
		: createOpenCodeTurn({
				configDir: native.opencode,
				cwd: native.project,
				id: seed.id,
				prompt: 'External work while reading',
			});
	synthetic?.startTool(tool);
	const unread = native
		.output()
		.getByTitle('New messages (click to pin to bottom)', { exact: true });
	try {
		await expect(unread).toHaveText('1');
		fs.writeFileSync(gate, 'continue');
		if (external) await external;
		else {
			synthetic.finishTool(tool);
			synthetic.finish('External work completed.');
		}
		await expect(
			native.output().getByText('External work completed.', { exact: true })
		).toBeVisible();
		await expect(unread).toHaveText('2');
		expect(await scroll.evaluate((node) => node.scrollTop)).toBe(0);
		expect(Math.abs((await anchor.boundingBox())!.y - before!.y)).toBeLessThanOrEqual(1);
		await expect(native.input()).toHaveValue('Preserve this draft.');
		await unread.click();
		await native.send('Run a tool while the other writer appends');
		await expect
			.poll(() =>
				readOpenCodeState(seed.file).parts.some(
					(row) => row.data.type === 'tool' && row.data.state.status === 'running'
				)
			)
			.toBe(true);
		const concurrent = native.externalTurn(
			'opencode',
			'An external append while Maestro is busy',
			{ answer: 'Wait until Maestro becomes idle.' },
			seed.id
		);
		concurrent.catch(() => {});
		// Two ordinary two-second probes; this checks the read guard, not writer safety.
		await native.page.waitForTimeout(4200);
		await expect(
			native.output().getByText('Wait until Maestro becomes idle.', { exact: true })
		).toHaveCount(0);
		await native.page.getByRole('button', { name: /^Stop/ }).click();
		await concurrent;
		await expect(
			native.output().getByText('Wait until Maestro becomes idle.', { exact: true })
		).toBeVisible();
		expect(readOpenCodeState(seed.file).sessions.map((row) => row.id)).toEqual([seed.id]);
	} finally {
		fs.writeFileSync(gate, 'continue');
	}
});
