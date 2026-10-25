import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Provider } from './fixtures/native-app';
import { createCopilotTurn } from './fixtures/native/copilot-protocol.cjs';
import { nativeIdentity, nativeToolIds } from './fixtures/native-real';

for (const provider of ['copilot'] satisfies Provider[]) {
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
		const history = await native.page.evaluate(
			({ cwd, id }) =>
				window.maestro.agentSessions.read('copilot-cli', cwd, id, { readOnly: true }),
			{ cwd: native.project, id: nativeIdentity(provider, file).id }
		);
		const calls = history.messages.flatMap(
			(message) =>
				(message.toolUse ?? []) as Array<{
					id: string;
					state: { status: string; input: { command: string }; output: unknown };
				}>
		);
		for (const [index, tool] of tools.entries()) {
			const call = calls.find((entry) => entry.id === ids[index]);
			expect(call?.state.input.command).toBe(tool.command);
			expect(call?.state.status).toBe(tool.status ?? 'completed');
			expect(JSON.stringify(call?.state.output)).toContain(tool.output);
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

	test(`${provider} e: project history opens native results and model information`, async ({
		native,
	}) => {
		native.scriptTurns([]);
		const turn = await native.externalTurn(provider, 'External acceptance history', {
			answer: 'Answer from external history.',
			tools: [{ id: 'history-tool', command: 'printf history-result', output: 'history-result' }],
		});
		const before = fs.readFileSync(turn.file);
		const metadata = nativeIdentity(provider, turn.file);
		expect(metadata.effort).toBeUndefined(); // Per-call effort is ephemeral in the pinned native format.
		expect(metadata.model).toBeTruthy();
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
		await native.output().getByRole('button', { name: 'Message info', exact: true }).last().click();
		await expect(native.output().getByText(metadata.model, { exact: true })).toBeVisible();
		if (metadata.effort) {
			expect(metadata.effort).toBeTruthy();
			await expect(native.output().getByText(metadata.effort, { exact: true })).toBeVisible();
		}
		expect(fs.readFileSync(turn.file)).toEqual(before);
	});
	test(`${provider} f: external turns follow only when idle and preserve reading and drafts`, async ({
		native,
	}) => {
		native.scriptTurns([
			{
				answer: '',
				waitForStop: true,
				tools: [{ id: 'busy-tool', command: 'sleep 60', output: '' }],
			},
		]);
		const configDir = native.copilot;
		const seed = await native.externalTurn(provider, 'External follow history', {
			answer: Array.from({ length: 80 }, (_, i) => `History paragraph ${i}.`).join('\n\n'),
		});
		const identity = { provider, configDir, cwd: native.project, id: seed.id };
		await native.createAgent(provider);
		await native.page
			.locator(
				`[data-conversation-kind="history"][data-conversation-key*="${seed.id}"] button[data-tree-nav]`
			)
			.click();
		await expect(native.output().getByText('History paragraph 79.', { exact: true })).toBeVisible();
		const scroll = native.output().locator(':scope > .overflow-y-auto');
		await native.externalTurn(
			provider,
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
					provider,
					'External work while reading',
					{
						answer: 'External work completed.',
						tools: [{ ...tool, updates: ['external-output'], gates: [gate] }],
					},
					seed.id
				)
			: undefined;
		external?.catch(() => {}); // Awaited below after releasing the workload gate.
		const synthetic = native.real
			? undefined
			: createCopilotTurn({ ...identity, prompt: 'External work while reading' });
		synthetic?.startTool(tool);
		const unread = native
			.output()
			.getByTitle('New messages (click to pin to bottom)', { exact: true });
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
		await expect(native.output().locator('[data-tool-status="running"]').first()).toBeVisible();
		const concurrent = native.externalTurn(
			provider,
			'An external append while Maestro is busy',
			{ answer: 'Wait until Maestro becomes idle.' },
			seed.id
		);
		concurrent.catch(() => {}); // Awaited after Stop; never turn a CLI refusal into success.
		// Observe two real 2-second probes from useNativeTranscriptFollow.
		// This synthetic append tests the read guard, not supported concurrent writes.
		await native.page.waitForTimeout(4200);
		await expect(
			native.output().getByText('Wait until Maestro becomes idle.', { exact: true })
		).toHaveCount(0);
		await native.page.getByRole('button', { name: /^Stop/ }).click();
		await concurrent;
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await expect(
			native.output().getByText('Wait until Maestro becomes idle.', { exact: true })
		).toBeVisible();
		expect(native.files(provider)).toHaveLength(1);
	});
}
