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
			tools: [{ id: 'history-tool', command: 'printf history-result', output: 'history-result' }],
		});
		const before = fs.readFileSync(turn.file);
		const metadata = native.real
			? nativeIdentity(provider, turn.file)
			: { model: provider === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5.3-codex', effort: 'high' };
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

test('codex b: running output grows, follows the bottom and respects upward reading', async ({
	native,
}) => {
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
		const scroll = result.locator('div.overflow-auto');
		await expect(result).toContainText('line-59');
		await expect
			.poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight))
			.toBeGreaterThan(0);
		await expect
			.poll(() =>
				scroll.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))
			)
			.toBeLessThanOrEqual(1);
		fs.writeFileSync(gates[0], 'continue');
		await expect(result).toContainText('line-99');
		await expect
			.poll(() =>
				scroll.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))
			)
			.toBeLessThanOrEqual(1);
		await scroll.evaluate((node) => {
			node.scrollTop = 0;
			node.dispatchEvent(new Event('scroll'));
		});
		fs.writeFileSync(gates[1], 'continue');
		await expect(result).toContainText('line-139');
		await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(0);
		fs.writeFileSync(gates[2], 'continue');
		await expect(
			native.output().getByText('Streaming command finished.', { exact: true })
		).toBeVisible();
	} finally {
		for (const gate of gates) fs.writeFileSync(gate, 'continue');
	}
});
