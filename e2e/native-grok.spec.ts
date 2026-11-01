import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Provider } from './fixtures/native-app';
import { nativeIdentity, nativeToolIds } from './fixtures/native-real';
import { createGrokTurn } from './fixtures/native/grok-protocol.cjs';

for (const provider of ['grok'] satisfies Provider[]) {
	test(`${provider} h: a live-created tab follows without opening history`, async ({ native }) => {
		native.scriptTurns([{ answer: 'Live-created answer.' }]);
		await native.createAgent(provider);
		await native.send('Start a new live conversation');
		await expect(native.output().getByText('Live-created answer.', { exact: true })).toBeVisible();
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		const file = await native.oneTranscript(provider);
		const id = nativeIdentity(provider, file).id;
		const before = fs.readFileSync(file);
		await native.input().fill('Keep the live-tab draft.');
		await native.externalTurn(
			provider,
			'External continuation of the live tab',
			{
				answer: 'External answer on the live tab.',
			},
			id
		);
		await expect(
			native.output().getByText('External answer on the live tab.', { exact: true })
		).toBeVisible();
		await native.page.waitForTimeout(4200);
		await expect(
			native.output().getByText('External answer on the live tab.', { exact: true })
		).toHaveCount(1);
		await expect(native.output().getByText('Live-created answer.', { exact: true })).toHaveCount(1);
		await expect(native.input()).toHaveValue('Keep the live-tab draft.');
		expect(native.files(provider)).toEqual([file]);
		expect(fs.readFileSync(file).subarray(0, before.length)).toEqual(before);
	});

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
		// The tab saved at quit comes back bound to its native session, so the
		// conversation is the restored open tab rather than a separate history row.
		await native.page
			.locator(
				`[data-conversation-kind="open"][data-native-session-id="${id}"] button[data-tree-nav]`
			)
			.click();
		await expect(
			native.output().getByText('Before application restart.', { exact: true })
		).toBeVisible();
		await expect(
			native.page.getByText('Loading conversation history...', { exact: true })
		).toHaveCount(0);
		await expect(native.page.locator(`[data-native-session-id="${id}"]`)).toHaveCount(1);
		await native.send('After restart');
		await expect(
			native.output().getByText('After application restart.', { exact: true })
		).toBeVisible();
		expect(native.files(provider)).toEqual([file]);
		expect(fs.readFileSync(file, 'utf8')).toContain('After application restart.');
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		// Let both idle follow probes reconcile the untimed native answer with
		// the live answer; an immediate assertion alone misses the duplicate.
		await native.page.waitForTimeout(4200);
		await expect(
			native.output().getByText('After application restart.', { exact: true })
		).toHaveCount(1);
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
		// Grok stores no per-message time: Message info must say so and still name
		// the native model and effort (it used to crash formatting NaN).
		await native.output().getByRole('button', { name: 'Message info', exact: true }).last().click();
		const info = native.output().locator('[data-message-info]').last();
		await expect(info).toContainText('Not recorded');
		await expect(native.output().getByText(metadata.model, { exact: true })).toBeVisible();
		if (metadata.effort) {
			await expect(native.output().getByText(metadata.effort, { exact: true })).toBeVisible();
		}
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
		const configDir = native.grok;
		const seed = await native.externalTurn(provider, 'External follow history', {
			answer: Array.from({ length: 80 }, (_, i) => `History paragraph ${i}.`).join('\n\n'),
		});
		const identity = { provider, configDir, cwd: native.project, id: seed.id };
		await native.createAgent(provider);
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
		const originalRevision = await revision();
		expect(originalRevision).toBeTruthy();
		expect(
			(await read(true)).messages.some((message) =>
				message.content.includes('History paragraph 0.')
			)
		).toBe(true);
		await native.page
			.locator('[data-conversation-kind="history"] button[data-tree-nav]')
			.filter({ hasText: 'External follow history' })
			.click();
		await expect(native.output().getByText('History paragraph 79.', { exact: true })).toBeVisible();
		const scroll = native.output().locator(':scope > .overflow-y-auto');
		await native.externalTurn(
			provider,
			'An external idle turn',
			{ answer: 'Idle external answer.' },
			seed.id
		);
		expect(await revision()).not.toBe(originalRevision);
		const bytes = fs.readFileSync(seed.file);
		const updateFile = path.join(path.dirname(seed.file), 'updates.jsonl');
		const updates = fs.readFileSync(updateFile);
		await expect(native.output().getByText('Idle external answer.', { exact: true })).toBeVisible();
		const incremental = await read(true);
		expect(incremental).toEqual(await read(false));
		expect(
			incremental.messages.filter((message) => message.content === 'Idle external answer.')
		).toHaveLength(1);
		expect(fs.readFileSync(seed.file)).toEqual(bytes);
		expect(fs.readFileSync(updateFile)).toEqual(updates);
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
			: createGrokTurn({ ...identity, prompt: 'External work while reading' });
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
		// This checks the idle read guard during an ordinary native append.
		await native.page.waitForTimeout(4200);
		await expect(
			native.output().getByText('Wait until Maestro becomes idle.', { exact: true })
		).toHaveCount(0);
		await native.page.getByRole('button', { name: /^Stop/ }).click();
		await concurrent;
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		// grok-build@2bdd1d6a, shell/src/session/storage/jsonl/mod.rs:
		// append_chat_message_commit_aware (1333) uses append_jsonl, whose
		// per-record lock_append (594) preserves ordinary foreign appends.
		// There is no OMP leaf/side-branch model. Full-file compaction rewrites
		// bypass this lock and are outside this concurrent-append assertion.
		await expect(
			native.output().getByText('Wait until Maestro becomes idle.', { exact: true })
		).toBeVisible();
		await native.externalTurn(
			provider,
			'An external turn after Stop',
			{
				answer: 'Idle refresh resumed after Stop.',
			},
			seed.id
		);
		await expect(
			native.output().getByText('Idle refresh resumed after Stop.', { exact: true })
		).toBeVisible();
		expect(native.files(provider)).toHaveLength(1);
	});

	test(`${provider} g: chat-only history keeps tool results unknown`, async ({ native }) => {
		native.scriptTurns([]);
		// A stored-format case in both modes, not a claim that a live CLI omits
		// updates. ConversationItem and the independent JSONL files come from
		// grok-build@2bdd1d6a, sampling-types/src/conversation.rs and
		// shell/src/session/storage/jsonl/mod.rs. No invented outcome field.
		const turn = createGrokTurn({
			configDir: native.grok,
			cwd: native.project,
			prompt: 'Chat-only external history',
			persistUpdates: false,
		});
		const tool = {
			id: 'unknown-outcome',
			command: 'printf legacy-output',
			output: 'legacy-output',
		};
		turn.startTool(tool);
		turn.finishTool(tool);
		turn.finish('Chat-only external answer.');
		const before = fs.readFileSync(turn.file);
		const updateFile = path.join(path.dirname(turn.file), 'updates.jsonl');
		expect(fs.existsSync(updateFile)).toBe(false);
		await native.createAgent(provider);
		await native.page
			.locator(
				`[data-conversation-kind="history"][data-conversation-key*="${turn.id}"] button[data-tree-nav]`
			)
			.click();
		await expect(
			native.output().getByText('Chat-only external answer.', { exact: true })
		).toBeVisible();
		await expect(native.output().locator('[data-tool-status="unknown"]').first()).toBeVisible();
		await expect(
			native.output().getByText('Result unknown', { exact: true }).first()
		).toBeVisible();
		await native.expandTools();
		await expect(native.output().getByTestId('tool-call-result')).toContainText('legacy-output');
		await expect(native.output().locator('[data-tool-status="unknown"]').first()).toBeVisible();
		await expect(native.output().locator('[data-tool-status="running"]')).toHaveCount(0);
		await expect(native.output().locator('[data-tool-status="completed"]')).toHaveCount(0);
		expect(fs.readFileSync(turn.file)).toEqual(before);
		expect(fs.existsSync(updateFile)).toBe(false);
	});
}
