import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/native-app';
import { realPrompt } from './fixtures/native-real';
import { installedCli } from './fixtures/native/real-runtime.cjs';

// Native formats are emitted by the pinned Claude/Codex protocol.cjs writers,
// or by those installed CLIs in real mode. No handoff-only native fields.
test('claude handoff: six directions stay drafts until explicit send', async ({ native }) => {
	const providers = ['claude-code', 'codex', 'deepseek'] as const;
	const origins: Record<
		string,
		{ agentId: string; tabId: string; nativeId: string; file: string; home: string }
	> = {};
	for (const provider of providers) {
		native.scriptTurns([{ answer: 'Original handoff answer.' }]);
		const agentId = await native.createAgent(
			provider === 'codex' ? 'codex' : 'claude',
			provider === 'deepseek' ? { preset: 'deepseek' } : {}
		);
		if (native.real) {
			const configured = await native.page.evaluate(
				async (id) =>
					(await window.maestro.sessions.getAll()).find((item: { id: string }) => item.id === id),
				agentId
			);
			expect(configured.customEnvVars.MAESTRO_E2E_CLI).toBe(
				installedCli(provider === 'codex' ? 'codex' : 'claude', process.env).executable
			);
		}
		await native.cli('tab', 'save-to-history', 'active', 'false', '--agent', agentId);
		await native.send(`Original ${provider} handoff question.`);
		await expect(
			native.output().getByText('Original handoff answer.', { exact: true })
		).toBeVisible();
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
		await expect
			.poll(
				async () =>
					(await native.cli('tab', 'show', 'active', '--agent', agentId)).tab.agentSessionId
			)
			.not.toBeNull();
		const tab = (await native.cli('tab', 'show', 'active', '--agent', agentId)).tab;
		const agent = await native.page.evaluate(
			async (id) =>
				(await window.maestro.sessions.getAll()).find((item: { id: string }) => item.id === id),
			agentId
		);
		const home = provider === 'codex' ? native.codex : agent.customEnvVars.CLAUDE_CONFIG_DIR;
		origins[provider] = {
			agentId,
			tabId: tab.tabId,
			nativeId: tab.agentSessionId,
			home,
			file: await native.oneTranscript(provider === 'codex' ? 'codex' : 'claude', home),
		};
	}
	await native.input().fill('Keep the live source draft.');
	const before = new Map(
		Object.values(origins).map((origin) => [origin.file, fs.readFileSync(origin.file)])
	);
	// Both the pinned fake CLI and the real relay record each actual turn's PID.
	// Inspection commands do not write these files; drafting must not either.
	const processes = new Map(
		[...new Set([native.claude, native.codex, ...Object.values(origins).map((item) => item.home)])]
			.map((home) => path.join(home, 'fixture-process'))
			.filter((file) => fs.existsSync(file))
			.map((file) => [file, fs.readFileSync(file)])
	);
	const targets = await native.cli('handoff', origins['claude-code'].tabId, '--list-targets');
	expect(targets.targets.map((item: { provider: string }) => item.provider).sort()).toEqual([
		'codex',
		'deepseek',
	]);
	for (const from of providers) {
		for (const to of providers.filter((provider) => provider !== from)) {
			// The desktop IPC and CLI converge on the same service and draft contract.
			const result =
				from === 'claude-code' && to === 'codex'
					? await native.page.evaluate((request) => window.maestro.context.handoff(request), {
							sourceAgentId: origins[from].agentId,
							sourceTabId: origins[from].tabId,
							targetProvider: to,
							background: true,
						})
					: await native.cli('handoff', origins[from].tabId, to);
			expect(result).toMatchObject({
				success: true,
				agentId: origins[to].agentId,
				state: 'draft',
				createdAgent: false,
			});
			expect(result.tabId).not.toBe(origins[to].tabId);
			expect(result.draft.text).toContain(`Original ${from} handoff question.`);
			expect(result.draft.text).toContain('Original handoff answer.');
			const stored = await native.page.evaluate(
				async ({ agentId, tabId }) => {
					const agents = await window.maestro.sessions.getAll();
					return {
						count: agents.length,
						tab: agents
							.find((agent: { id: string }) => agent.id === agentId)
							.aiTabs.find((tab: { id: string }) => tab.id === tabId),
					};
				},
				{ agentId: result.agentId, tabId: result.tabId }
			);
			expect(stored.count).toBe(3);
			expect(stored.tab).toMatchObject({
				inputValue: result.draft.text,
				agentSessionId: null,
				logs: [],
			});
		}
	}
	await expect(native.input()).toHaveValue('Keep the live source draft.');
	for (const [file, bytes] of [...before, ...processes])
		expect(fs.readFileSync(file)).toEqual(bytes);
	for (const provider of providers)
		expect(native.files(provider === 'codex' ? 'codex' : 'claude', origins[provider].home)).toEqual(
			[origins[provider].file]
		);

	const scene = { answer: 'Handoff finished.' };
	fs.writeFileSync(
		native.script,
		JSON.stringify({ scene, synopsis: { answer: 'Handoff acceptance completed.' } })
	);
	const instruction = native.real
		? realPrompt(native, 'Continue from this handoff.', scene)
		: 'Continue from this handoff.';
	const sent = await native.cli(
		'handoff',
		origins['claude-code'].tabId,
		'codex',
		'--send',
		'--focus',
		'--instruction',
		instruction
	);
	expect(sent).toMatchObject({
		success: true,
		agentId: origins.codex.agentId,
		state: 'queued',
		createdAgent: false,
	});
	await expect(native.output().getByText('Handoff finished.', { exact: true })).toBeVisible();
	await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
	await expect
		.poll(async () => (await native.cli('tab', 'show', sent.tabId)).tab.agentSessionId)
		.not.toBeNull();
	const nativeId = (await native.cli('tab', 'show', sent.tabId)).tab.agentSessionId;
	expect(Object.values(origins).map((origin) => origin.nativeId)).not.toContain(nativeId);
	const messages = await native.page.evaluate(
		({ project, nativeId, ownerAgentId }) =>
			window.maestro.agentSessions.read('codex', project, nativeId, {
				ownerAgentId,
				readOnly: true,
			}),
		{ project: native.project, nativeId, ownerAgentId: sent.agentId }
	);
	expect(messages.messages.find((message) => message.role === 'user')?.content).toContain(
		sent.draft.text
	);
	for (const [file, bytes] of before) expect(fs.readFileSync(file)).toEqual(bytes);
	expect(native.files('codex')).toHaveLength(2);
});

// The dialog is only a way in to the same draft service: open it from the
// palette, pick the other provider, and land on an unsent draft that explains
// itself. Sending is the composer's ordinary Send.
test('claude handoff dialog: the palette prepares an unsent draft that the normal Send sends', async ({
	native,
}) => {
	test.skip(native.real, 'The dialog adds no CLI behaviour; claude handoff: covers the real CLIs');
	const { page } = native;
	const codexId = await native.createAgent('codex');
	native.scriptTurns([{ answer: 'Original dialog answer.' }]);
	const claudeId = await native.createAgent('claude');
	await native.send('Original dialog question.');
	await expect(native.output().getByText('Original dialog answer.', { exact: true })).toBeVisible();
	await expect(page.getByTestId('stop-turn-button')).toHaveCount(0);
	const source = (await native.cli('tab', 'show', 'active', '--agent', claudeId)).tab;
	const sourceLogs = () =>
		page.evaluate(
			async ({ claudeId, sourceTab }) =>
				(await window.maestro.sessions.getAll())
					.find((agent: { id: string }) => agent.id === claudeId)
					.aiTabs.find((tab: { id: string }) => tab.id === sourceTab).logs,
			{ claudeId, sourceTab: source.tabId }
		);
	await expect.poll(async () => (await sourceLogs()).length).toBeGreaterThan(1);
	const sourceBefore = await sourceLogs();
	const claudeFile = await native.oneTranscript('claude');
	const claudeBytes = fs.readFileSync(claudeFile);
	expect(native.files('codex')).toEqual([]);

	await page.keyboard.press('ControlOrMeta+k');
	await page.keyboard.type('Continue with Another AI');
	await page.keyboard.press('Enter');
	const dialog = page.getByTestId('ai-handoff-modal');
	const codex = dialog.getByRole('radio', { name: /^Codex/ });
	await expect(codex).toBeChecked();
	await expect(dialog.getByText('New tab in Native codex', { exact: true })).toBeVisible();
	await expect(dialog.getByRole('radio')).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Prepare draft' }).click();
	await expect(dialog).toHaveCount(0);

	// The user is on the codex draft, nothing has run, and the note says why.
	await expect(native.input()).toHaveAttribute('placeholder', /^Talking to Native codex/);
	await expect(native.input()).toHaveValue(/Original dialog question\./);
	await expect(native.input()).toHaveValue(/Original dialog answer\./);
	const note = page.getByTestId('handoff-draft-bar');
	await expect(note).toContainText('Handoff draft');
	await expect(note).toContainText('from Native claude (Claude Code)');
	await expect(note).toContainText('tokens');
	const stored = await page.evaluate(async (codexId) => {
		const agents = await window.maestro.sessions.getAll();
		const codexAgent = agents.find((agent: { id: string }) => agent.id === codexId);
		return {
			count: agents.length,
			draft: codexAgent.aiTabs.find((tab: { inputValue: string }) => tab.inputValue),
			codexTabs: codexAgent.aiTabs.length,
		};
	}, codexId);
	expect(stored.count).toBe(2);
	expect(stored.codexTabs).toBe(2);
	expect(stored.draft).toMatchObject({
		agentSessionId: null,
		logs: [],
		handoffDraft: {
			sourceAgentId: claudeId,
			sourceName: 'Native claude',
			sourceProvider: 'claude-code',
			budgetTokens: 8000,
			omittedEntries: 0,
		},
	});
	expect(await sourceLogs()).toEqual(sourceBefore);
	expect(fs.readFileSync(claudeFile)).toEqual(claudeBytes);
	expect(native.files('codex')).toEqual([]);

	native.scriptTurns([{ answer: 'Dialog handoff finished.' }]);
	await native.input().press('Enter');
	await expect(
		native.output().getByText('Dialog handoff finished.', { exact: true })
	).toBeVisible();
	await expect(page.getByTestId('stop-turn-button')).toHaveCount(0);
	await expect(note).toHaveCount(0);
	const codexFile = await native.oneTranscript('codex');
	expect(fs.readFileSync(codexFile, 'utf8')).toContain('Original dialog question.');
	expect(fs.readFileSync(claudeFile)).toEqual(claudeBytes);
});
