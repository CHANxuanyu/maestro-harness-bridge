import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Provider } from './fixtures/native-app';
import { nativeIdentity, nativeToolIds } from './fixtures/native-real';

for (const provider of ['claude', 'codex'] satisfies Provider[]) {
	test(`${provider} a: two turns append to the same native session`, async ({ native }) => {
		native.scriptTurns([{ answer: 'First native answer.' }, { answer: 'Second native answer.' }]);
		await native.createAgent(provider);
		await native.send('First acceptance turn');
		await expect(native.output().getByText('First native answer.', { exact: true })).toBeVisible();
		const file = await native.oneTranscript(provider);
		const before = fs.readFileSync(file);
		await native.send('Second acceptance turn');
		await expect(native.output().getByText('Second native answer.', { exact: true })).toBeVisible();
		expect(native.files(provider)).toEqual([file]);
		const after = fs.readFileSync(file);
		expect(after.subarray(0, before.length)).toEqual(before);
		expect(after.toString()).toContain('Second native answer.');
		await expect(native.output().getByText('First native answer.', { exact: true })).toBeVisible();
	});

	test(`${provider} b: parallel tools keep their own results and failure`, async ({ native }) => {
		const tools = [
			{ id: 'parallel-first', command: 'printf first-result', output: 'first-result' },
			{
				id: 'parallel-second',
				command: 'printf second-result',
				output: 'second-result',
				status: 'failed' as const,
			},
		];
		native.scriptTurns([{ answer: 'Tool acceptance complete.', tools, toolDelay: 1200 }]);
		await native.createAgent(provider);
		await native.send('Run two independent tools');
		await expect(native.output().locator('[data-tool-status="running"]').first()).toBeVisible();
		await expect(
			native.output().getByText('Tool acceptance complete.', { exact: true })
		).toBeVisible();
		// Same reason as codex b below: the answer can land before the native
		// process exits, and the finished turn then folds its tools. A real Codex
		// run lost the race and its detail buttons unmounted mid-click.
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await native.expandTools();
		for (const tool of tools) {
			const result = native
				.output()
				.getByTestId('tool-call-result')
				.filter({ hasText: tool.output });
			await expect(result).toBeVisible();
			const card = result.locator(
				'xpath=ancestor::*[@data-tool-call-fold or @data-feed-row="activity"][1]'
			);
			await expect(card).toContainText(tool.command);
			await expect(card.locator('[data-tool-status="error"]')).toHaveCount(tool.status ? 1 : 0);
		}
		await expect(native.output().locator('[data-tool-status="running"]')).toHaveCount(0);
		const file = await native.oneTranscript(provider);
		const content = fs.readFileSync(file, 'utf8');
		const ids = native.real
			? nativeToolIds(
					provider,
					file,
					tools.map((tool) => tool.command)
				)
			: tools.map((tool) => tool.id);
		expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
		expect(new Set(ids).size).toBe(tools.length);
		for (const id of ids) expect(content).toContain(id);
		for (const tool of tools) {
			expect(content).toContain(tool.output);
		}
	});

	test(`${provider} c: Stop settles a tool and the next send resumes its native ID`, async ({
		native,
	}) => {
		native.scriptTurns([
			{
				answer: '',
				tools: [{ id: 'stop-tool', command: 'sleep 60', output: '' }],
				waitForStop: true,
				stopDiagnostic: true,
			},
			{ answer: 'Resumed after Stop.' },
		]);
		await native.createAgent(provider);
		await native.send('Run a long tool');
		await expect(native.output().locator('[data-tool-status="running"]').first()).toBeVisible();
		const file = await native.oneTranscript(provider);
		await native.page.getByRole('button', { name: /^Stop/ }).click();
		await expect(native.output().locator('[data-tool-status="canceled"]').first()).toBeVisible();
		await native.send('Continue after stopping');
		await expect(native.output().getByText('Resumed after Stop.', { exact: true })).toBeVisible();
		expect(native.files(provider)).toEqual([file]);
		expect(fs.readFileSync(file, 'utf8')).toContain('Resumed after Stop.');
	});

	test(`${provider} d: a normal application restart preserves native resume`, async ({
		native,
	}) => {
		native.scriptTurns([
			{ answer: 'Before application restart.' },
			{ answer: 'After application restart.' },
		]);
		await native.createAgent(provider);
		await native.send('Before restart');
		await expect(
			native.output().getByText('Before application restart.', { exact: true })
		).toBeVisible();
		const file = await native.oneTranscript(provider);
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await native.restart();
		const historyTitle = provider === 'claude' ? 'Before restart' : 'Before application restart.';
		await native.page.locator('button[data-tree-nav]').filter({ hasText: historyTitle }).click();
		await expect(
			native.output().getByText('Before application restart.', { exact: true })
		).toBeVisible();
		await native.send('After restart');
		await expect(
			native.output().getByText('After application restart.', { exact: true })
		).toBeVisible();
		expect(native.files(provider)).toEqual([file]);
		expect(fs.readFileSync(file, 'utf8')).toContain('After application restart.');
	});

	test(`${provider} e: project history opens native results and model information`, async ({
		native,
	}) => {
		native.scriptTurns([]);
		const turn = await native.externalTurn(provider, 'External acceptance history', {
			answer: 'Answer from external history.',
			effort: 'high',
			tools: [{ id: 'history-tool', command: 'printf history-result', output: 'history-result' }],
		});
		const before = fs.readFileSync(turn.file);
		const metadata = nativeIdentity(provider, turn.file);
		expect(metadata.model).toBeTruthy();
		await native.createAgent(provider);
		await native.page
			.locator('[data-conversation-kind="history"] button[data-tree-nav]')
			.filter({ hasText: 'External acceptance history' })
			.click();
		await expect(
			native.output().getByText('Answer from external history.', { exact: true })
		).toBeVisible();
		await native.expandTools();
		await expect(native.output().getByTestId('tool-call-result')).toContainText('history-result');
		await native.output().getByRole('button', { name: 'Message info', exact: true }).last().click();
		await expect(native.output().getByText(metadata.model, { exact: true })).toBeVisible();
		if (provider === 'codex') {
			expect(metadata.effort).toBeTruthy();
			await expect(native.output().getByText(metadata.effort, { exact: true })).toBeVisible();
		}
		expect(fs.readFileSync(turn.file)).toEqual(before);
	});
}

// Saving is provider independent, so one provider covers it. The tool holds the
// turn past the 2 s save debounce, so the copy on disk already has the prompt
// when the answer lands; quit then follows inside the next debounce window.
test('claude k: an answer that lands just before quit is saved with the tab', async ({
	native,
}) => {
	const answer = 'Saved right before quit.';
	native.scriptTurns([
		{
			answer,
			tools: [{ id: 'quit-hold', command: 'printf held', output: 'held' }],
			toolDelay: 2600,
		},
	]);
	await native.createAgent('claude');
	await native.send('Answer right before quit');
	await expect(native.output().getByText(answer, { exact: true })).toBeVisible();
	await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
	await native.restart();
	const saved = JSON.parse(
		fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')
	) as { sessions: { aiTabs?: { logs?: { source: string; text?: string }[] }[] }[] };
	const replies = saved.sessions.flatMap((session) =>
		(session.aiTabs ?? []).flatMap((tab) =>
			(tab.logs ?? []).filter((log) => log.source !== 'user').map((log) => log.text?.trim())
		)
	);
	expect(replies).toContain(answer);
	await expect(native.output().getByText(answer, { exact: true })).toBeVisible();
});

// The confirming window saves before it confirms (claude k). A second app
// window has its own save debounce, so main asks every app window to save
// after the confirm and waits for each answer. This one answers too.
test('claude l: an answer in a second window that lands just before quit is saved', async ({
	native,
}) => {
	test.skip(native.real, 'Window bookkeeping only; claude k covers the real CLI');
	const answer = 'Saved from the second window.';
	native.scriptTurns([
		{
			answer,
			tools: [{ id: 'quit-hold', command: 'printf held', output: 'held' }],
			toolDelay: 2600,
		},
	]);
	const agentId = await native.createAgent('claude');
	const opened = native.app.waitForEvent('window');
	expect(
		await native.page.evaluate((id) => window.maestro.windows.create([id]), agentId)
	).not.toBeNull();
	const second = await opened;
	await second.waitForLoadState('domcontentloaded');
	const input = second.getByPlaceholder(/^Talking to /);
	await input.fill('Answer in the second window right before quit');
	await input.press('Enter');
	const output = second.getByLabel('Terminal output', { exact: true });
	await expect(output.getByText(answer, { exact: true })).toBeVisible();
	await expect(second.getByTestId('stop-turn-button')).toHaveCount(0);
	// Main logs a window that never answered (timeout) or failed to save. The
	// two always-present lines prove the log was captured at all.
	const mainLog: string[] = [];
	for (const stream of [native.app.process().stdout, native.app.process().stderr])
		stream?.on('data', (chunk: Buffer) => mainLog.push(chunk.toString()));
	await native.close();
	const log = mainLog.join('');
	expect(log).toContain('Quit confirmed by renderer');
	expect(log).toContain('Application shutting down');
	expect(log).not.toMatch(/Quit save (timed out|did not complete)/);
	const saved = JSON.parse(
		fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')
	) as { sessions: { aiTabs?: { logs?: { source: string; text?: string }[] }[] }[] };
	const replies = saved.sessions.flatMap((session) =>
		(session.aiTabs ?? []).flatMap((tab) =>
			(tab.logs ?? []).filter((log) => log.source !== 'user').map((log) => log.text?.trim())
		)
	);
	expect(replies).toContain(answer);
	// Reopen in one window so the fixture can find the agent again.
	fs.rmSync(path.join(native.data, 'maestro-window-state.json'), { force: true });
	await native.start();
});

// A window holds a live copy of the agents it owns and a stale copy of the rest,
// so an agent that changes window must arrive with what its old owner last saved.
test('claude m: an agent keeps its conversation when it changes window', async ({ native }) => {
	test.skip(native.real, 'Window bookkeeping only; claude k covers the real CLI');
	const firstAnswer = 'Answer before the move.';
	const secondAnswer = 'Answer after the move.';
	native.scriptTurns([{ answer: firstAnswer }, { answer: secondAnswer }]);
	await native.createAgent('claude');
	const moving = await native.createAgent('claude');
	const other = await native.createAgent('claude');
	const { page } = native;
	const savedTab = (id: string) => {
		const { sessions } = JSON.parse(
			fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8')
		) as {
			sessions: {
				id: string;
				aiTabs?: {
					inputValue?: string;
					agentSessionId?: string | null;
					logs?: { text?: string }[];
				}[];
			}[];
		};
		return sessions.find((session) => session.id === id)?.aiTabs?.[0];
	};
	const savedTexts = (id: string) => (savedTab(id)?.logs ?? []).map((log) => log.text?.trim());
	const list = () => page.evaluate(() => window.maestro.windows.list());
	const mainWindowId = (await list()).find((entry) => entry.isMain)?.id as string;

	// The product's move: create the window, then transfer ownership out of the source.
	const opened = native.app.waitForEvent('window');
	const created = await page.evaluate((id) => window.maestro.windows.create([id]), other);
	const second = await opened;
	await second.waitForLoadState('domcontentloaded');
	const secondId = created?.id as string;
	await page.evaluate(
		([id, from, to]) => window.maestro.windows.moveSession(id, from, to),
		[other, mainWindowId, secondId]
	);
	const secondInput = second.getByPlaceholder(/^Talking to /);
	const secondOutput = second.getByLabel('Terminal output', { exact: true });
	await expect(secondInput).toBeVisible();

	// Into an existing window, with a draft typed just before the move.
	expect((await native.cli('focus-agent', moving)).success).toBe(true);
	await native.send('Turn before the move');
	await expect(native.output().getByText(firstAnswer, { exact: true })).toBeVisible();
	await expect(page.getByTestId('stop-turn-button')).toHaveCount(0);
	await native.input().fill('Draft before the move');
	// Reaching Move to Window takes focus out of the composer, which saves the draft.
	await native.input().blur();
	await page.evaluate(
		([id, from, to]) => window.maestro.windows.moveSession(id, from, to),
		[moving, mainWindowId, secondId]
	);
	// A window follows a focus request only once it has learned it owns the agent.
	await expect(async () => {
		expect((await native.cli('focus-agent', moving)).success).toBe(true);
		await expect(secondOutput.getByText(firstAnswer, { exact: true })).toBeVisible({
			timeout: 1000,
		});
	}).toPass();
	await expect(secondInput).toHaveValue('Draft before the move');
	const nativeId = savedTab(moving)?.agentSessionId;
	expect(nativeId).toBeTruthy();

	// The first edit in the new window writes this copy, so it must be the real one.
	await secondInput.fill('Turn after the move');
	await secondInput.press('Enter');
	await expect(secondOutput.getByText(secondAnswer, { exact: true })).toBeVisible();
	await expect(second.getByTestId('stop-turn-button')).toHaveCount(0);
	await secondInput.fill('Draft before the window closes');

	// Closing the window hands its agents back to the main window.
	await page.evaluate((id) => window.maestro.windows.close(id), secondId);
	await expect.poll(async () => (await list()).length).toBe(1);
	await expect(async () => {
		expect((await native.cli('focus-agent', moving)).success).toBe(true);
		await expect(native.output().getByText(secondAnswer, { exact: true })).toBeVisible({
			timeout: 1000,
		});
	}).toPass();
	await expect(native.output().getByText(firstAnswer, { exact: true })).toBeVisible();
	await expect(native.input()).toHaveValue('Draft before the window closes');

	await native.input().fill('Draft after the window closed');
	await expect.poll(() => savedTab(moving)?.inputValue).toBe('Draft after the window closed');
	expect(savedTab(moving)?.agentSessionId).toBe(nativeId);
	expect(savedTexts(moving)).toEqual(expect.arrayContaining([firstAnswer, secondAnswer]));

	await native.restart();
	expect((await native.cli('focus-agent', moving)).success).toBe(true);
	await expect(native.output().getByText(secondAnswer, { exact: true })).toBeVisible();
	await expect(native.input()).toHaveValue('Draft after the window closed');
});

test('codex e: default effort information matches the native record', async ({ native }) => {
	native.scriptTurns([]);
	const turn = await native.externalTurn('codex', 'Default effort history', {
		answer: 'Default effort answer.',
	});
	const metadata = nativeIdentity('codex', turn.file);
	const before = fs.readFileSync(turn.file);
	await native.createAgent('codex');
	await native.page
		.locator('[data-conversation-kind="history"] button[data-tree-nav]')
		.filter({ hasText: 'Default effort history' })
		.click();
	await expect(native.output().getByText('Default effort answer.', { exact: true })).toBeVisible();
	await native.output().getByRole('button', { name: 'Message info', exact: true }).last().click();
	const info = native.output().getByRole('group', { name: 'Message info', exact: true });
	await expect(
		info
			.locator('div.contents')
			.filter({ has: native.page.locator('dt', { hasText: /^Effort$/ }) })
			.locator('dd')
	).toHaveText(metadata.effort ?? 'Not recorded');
	expect(fs.readFileSync(turn.file)).toEqual(before);
});

test('codex b: exec command output appears at completion', async ({ native }) => {
	const updates = [60, 100, 140].map((count) =>
		Array.from({ length: count }, (_, index) => `line-${index}\n`).join('')
	);
	const gates = updates.map((_, index) => path.join(native.root, `output-${index}.continue`));
	const tool = {
		id: 'streaming-command',
		command: 'printf streaming-lines',
		output: updates[2],
		updates,
		gates,
	};
	try {
		native.scriptTurns([{ answer: 'Streaming command finished.', tools: [tool] }]);
		await native.createAgent('codex');
		await native.send('Run a command with streaming output');
		await expect(native.output().locator('[data-tool-status="running"]').first()).toBeVisible();
		await native.expandTools();
		const result = native.output().getByTestId('tool-call-result');
		await expect(result).toHaveCount(0);
		for (const gate of gates) fs.writeFileSync(gate, 'continue');
		await expect(
			native.output().getByText('Streaming command finished.', { exact: true })
		).toBeVisible();
		// The answer lands before the exec process exits, and the finished turn
		// then folds its tools behind "Worked for". Expand once the turn has ended,
		// or the fold closes the rows being read.
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await native.expandTools();
		await expect(result).toContainText('line-0');
		await expect(result).toContainText('line-139');
		await expect(native.output().locator('[data-tool-status="running"]')).toHaveCount(0);
	} finally {
		for (const gate of gates) fs.writeFileSync(gate, 'continue');
	}
});
