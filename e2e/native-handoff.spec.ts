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
