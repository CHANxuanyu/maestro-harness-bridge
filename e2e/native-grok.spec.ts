import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Provider } from './fixtures/native-app';
import { nativeIdentity, nativeToolIds } from './fixtures/native-real';

for (const provider of ['grok'] satisfies Provider[]) {
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
		const id = nativeIdentity(provider, file).id;
		await native.restart();
		await native.page
			.locator(
				`[data-conversation-kind="history"][data-conversation-key*="${id}"] button[data-tree-nav]`
			)
			.click();
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

	test(`${provider} e: project history opens results and IPC preserves native model information`, async ({
		native,
	}) => {
		native.scriptTurns([]);
		const turn = await native.externalTurn(provider, 'External acceptance history', {
			answer: 'Answer from external history.',
			tools: [{ id: 'history-tool', command: 'printf history-result', output: 'history-result' }],
		});
		const before = fs.readFileSync(turn.file);
		const updateFile = path.join(path.dirname(turn.file), 'updates.jsonl');
		const updateBytes = fs.readFileSync(updateFile);
		const metadata = nativeIdentity(provider, turn.file);
		expect(metadata.model).toBeTruthy();
		if (!native.real) expect(metadata.effort).toBe('high');
		await native.createAgent(provider);
		await native.page
			.locator(
				`[data-conversation-kind="history"][data-conversation-key*="${turn.id}"] button[data-tree-nav]`
			)
			.click();
		await expect(
			native.output().getByText('Answer from external history.', { exact: true })
		).toBeVisible();
		await native.expandTools();
		await expect(native.output().getByTestId('tool-call-result')).toContainText('history-result');
		// The separate Message info UI acceptance is blocked by its invalid-date
		// crash on Grok's absent timestamps. Preserve the failing UI reproduction
		// in docs/native-provider-contracts.md; this case verifies the backend IPC.
		const read = await native.page.evaluate(
			({ cwd, id }) => window.maestro.agentSessions.read('grok', cwd, id, { readOnly: true }),
			{ cwd: native.project, id: turn.id }
		);
		const answer = read.messages.find(
			(message) => message.content === 'Answer from external history.'
		);
		expect(answer?.model).toBe(metadata.model);
		expect(answer?.effort).toBe(metadata.effort);
		expect(answer?.timestamp).toBe('');
		expect(fs.readFileSync(turn.file)).toEqual(before);
		expect(fs.readFileSync(updateFile)).toEqual(updateBytes);
	});
	test(`${provider} f: backend revision and read-only IPC expose external appends`, async ({
		native,
	}) => {
		native.scriptTurns([]);
		const seed = await native.externalTurn(provider, 'External backend follow history', {
			answer: 'Original history.',
		});
		await native.createAgent(provider);
		const identity = { cwd: native.project, id: seed.id };
		const revision = () =>
			native.page.evaluate(
				({ cwd, id }) => window.maestro.agentSessions.getTranscriptRevision('grok', cwd, id),
				identity
			);
		const read = (readOnly: boolean) =>
			native.page.evaluate(
				({ cwd, id, readOnly }) => window.maestro.agentSessions.read('grok', cwd, id, { readOnly }),
				{ ...identity, readOnly }
			);
		const before = await revision();
		expect(before).toBeTruthy();
		expect(
			(await read(true)).messages.some((message) => message.content === 'Original history.')
		).toBe(true);
		await native.externalTurn(
			provider,
			'External append',
			{ answer: 'Externally appended answer.' },
			seed.id
		);
		expect(await revision()).not.toBe(before);
		const bytes = fs.readFileSync(seed.file);
		const updates = fs.readFileSync(path.join(path.dirname(seed.file), 'updates.jsonl'));
		const incremental = await read(true);
		expect(incremental).toEqual(await read(false));
		expect(
			incremental.messages.filter((message) => message.content === 'Externally appended answer.')
		).toHaveLength(1);
		expect(fs.readFileSync(seed.file)).toEqual(bytes);
		expect(fs.readFileSync(path.join(path.dirname(seed.file), 'updates.jsonl'))).toEqual(updates);
	});
}
