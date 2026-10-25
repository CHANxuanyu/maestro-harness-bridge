import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type NativeApp } from './fixtures/native-app';
import { startAppServer } from './fixtures/native/app-server.cjs';
import { startRealShared } from './fixtures/native-shared-real';
import { realPrompt } from './fixtures/native-real';
import { runSharedExec } from '../scripts/codex-shared/shared-exec.cjs';

async function shared(native: NativeApp, scenes: unknown[], extraEnv: Record<string, string> = {}) {
	native.scriptTurns(
		scenes.map((scene: any, index) => ({
			...scene,
			exitGate: index === 0 ? extraEnv.MAESTRO_NATIVE_EXIT_GATE : undefined,
		}))
	);
	const seed = await native.externalTurn('codex', 'Shared acceptance history', {
		answer: 'Initial shared answer.',
	});
	let socket = path.join(native.root, 'shared.sock');
	const server = native.real
		? await startRealShared(native, seed.id)
		: await startAppServer({
				socket,
				configDir: native.codex,
				cwd: native.project,
				id: seed.id,
				scenes,
			});
	if (native.real) socket = server.socket;
	try {
		const agentId = await native.createAgent('codex', {
			executable: path.resolve(
				native.real ? 'e2e/fixtures/native/real-cli' : 'e2e/fixtures/native/codex-shared'
			),
			env: { MAESTRO_NATIVE_SOCKET: socket, ...extraEnv, ...server.env },
		});
		await native.page
			.locator('[data-conversation-kind="history"] button[data-tree-nav]')
			.filter({ hasText: 'Shared acceptance history' })
			.click();
		await expect(
			native.output().getByText('Initial shared answer.', { exact: true })
		).toBeVisible();
		return { server, socket, seed, agentId };
	} catch (error) {
		await server.close();
		throw error;
	}
}

test('codex g: real connector keeps two clients in one thread with live output and confirmation notices', async ({
	native,
}) => {
	const gates = [path.join(native.root, 'shared-first'), path.join(native.root, 'shared-second')];
	const updates = ['shared first line\n', 'shared first line\nshared second line\n'];
	const tool = {
		id: 'shared-stream',
		command: 'printf shared-lines',
		output: updates[1],
		updates,
		gates,
	};
	const { server, socket, seed } = await shared(native, [
		{ answer: 'Maestro shared answer.', tools: [tool], approval: true },
		{ answer: 'Other client shared answer.' },
	]);
	try {
		await native.send('Send through the shared connector');
		if (native.real) await expect.poll(() => server.approvals.length).toBeGreaterThan(0);
		const confirmation = native.real
			? server.approvals.at(-1)!.method
			: 'item/commandExecution/requestApproval';
		await expect(
			native
				.output()
				.getByText(
					`Codex is waiting for a client confirmation: ${confirmation}. Open this same conversation in Codex to respond, or stop this turn.`,
					{ exact: true }
				)
		).toBeVisible();
		if (native.real) server.approve();
		await expect(native.output().locator('[data-tool-status="running"]').first()).toBeVisible();
		await native.expandTools();
		const result = native.output().getByTestId('tool-call-result');
		await expect(result).toContainText('shared first line');
		await expect(result).not.toContainText('shared second line');
		fs.writeFileSync(gates[0], 'continue');
		await expect(result).toContainText('shared second line');
		await expect(native.output().locator('[data-tool-status="running"]').first()).toBeVisible();
		fs.writeFileSync(gates[1], 'continue');
		await expect(
			native.output().getByText('Maestro shared answer.', { exact: true })
		).toBeVisible();
		await expect(native.output().locator('[data-tool-status="running"]')).toHaveCount(0);
		await runSharedExec(
			socket,
			[
				'exec',
				'--json',
				'resume',
				seed.id,
				'--',
				native.real
					? realPrompt(native, 'Send from the other client', {
							answer: 'Other client shared answer.',
						})
					: 'Send from the other client',
			],
			{ output: () => {} }
		);
		await expect(
			native.output().getByText('Other client shared answer.', { exact: true })
		).toBeVisible();
		await server.refresh?.();
		expect(server.state.turns).toHaveLength(2);
		expect(native.files('codex')).toEqual([seed.file]);
		expect(fs.readFileSync(seed.file, 'utf8')).toContain('Other client shared answer.');
	} finally {
		for (const gate of gates) fs.writeFileSync(gate, 'continue');
		try {
			await expect
				.poll(async () => {
					await server.refresh?.();
					return server.state.status;
				})
				.toBe('idle');
		} finally {
			await server.close();
		}
	}
});

for (const blocker of ['active', 'queued'] as const) {
	test(`codex g: the connector refuses an ${blocker} shared thread without adding a turn`, async ({
		native,
	}) => {
		const { server, seed } = await shared(native, [{ answer: 'Unexpected accepted turn.' }]);
		if (native.real) await server.block(blocker);
		else if (blocker === 'active') server.state.status = 'active';
		else server.state.queue = [{ id: 'queued' }]; // connector.test.cjs queue response fixture
		const before = fs.readFileSync(seed.file);
		const turnsBefore = server.state.turns.length;
		const queueBefore = [...server.state.queue];
		try {
			await native.send('This turn must not be sent');
			const text =
				blocker === 'active'
					? /still generating in another client|session is busy/i
					: /already has queued messages/i;
			await expect(native.page.getByText(text).first()).toBeVisible();
			await server.refresh?.();
			expect(server.state.turns).toHaveLength(turnsBefore);
			if (!native.real)
				expect(
					server.state.requests.filter(
						(request: { method: string }) => request.method === 'turn/start'
					)
				).toHaveLength(0);
			expect(fs.readFileSync(seed.file)).toEqual(before);
			expect(native.files('codex')).toEqual([seed.file]);
			expect(server.state.queue).toEqual(queueBefore);
		} finally {
			await server.close();
		}
	});
}

test('codex h: shared history uses the final answer without sending a Summary turn', async ({
	native,
}) => {
	const gate = path.join(native.root, 'shared-exit');
	const { server, seed, agentId } = await shared(
		native,
		[
			{
				answer: 'Shared saved work.',
				tools: [
					{ id: 'shared-history-work', command: 'printf shared-work', output: 'shared-work' },
				],
			},
			{ answer: 'Unexpected Summary turn.' },
		],
		{ MAESTRO_NATIVE_EXIT_GATE: gate }
	);
	try {
		await native.cli('tab', 'save-to-history', 'active', 'true', '--agent', agentId);
		await expect(native.page.getByTitle(/^Save to History/)).not.toHaveClass(/opacity-40/);
		await native.send('Complete a shared work turn');
		await expect(native.output().getByText('Shared saved work.', { exact: true })).toBeVisible();
		const before = fs.readFileSync(seed.file);
		const rows = await native.page.locator('[data-conversation-key]').count();
		fs.writeFileSync(gate, 'exit');
		await native.page.locator('[data-tour="history-tab"]').click();
		await expect(
			native.page
				.locator('[data-tour="history-panel"]')
				.getByText('Shared saved work.', { exact: true })
				.first()
		).toBeVisible();
		expect(fs.readFileSync(seed.file)).toEqual(before);
		expect(native.files('codex')).toEqual([seed.file]);
		await server.refresh?.();
		expect(server.state.turns).toHaveLength(1);
		await expect(native.page.locator('[data-conversation-key]')).toHaveCount(rows);
	} finally {
		fs.writeFileSync(gate, 'exit');
		await server.close();
	}
});
