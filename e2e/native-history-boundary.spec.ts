import fs from 'node:fs';
import path from 'node:path';
import { createTurn } from './fixtures/native/protocol.cjs';
import { test, expect } from './fixtures/native-app';

// Native formats come from the version-pinned protocol.cjs and
// opencode-protocol.cjs writers used by NativeApp.externalTurn.
test('codex: history pagination keeps the selected agent account', async ({ native }) => {
	native.scriptTurns([]);
	const turns = [
		await native.externalTurn('codex', 'First selected-account history', {
			answer: 'First selected-account answer.',
		}),
		await native.externalTurn('codex', 'Second selected-account history', {
			answer: 'Second selected-account answer.',
		}),
	];
	const before = turns.map((turn) => fs.readFileSync(turn.file));
	const ownerAgentId = await native.createAgent('codex');
	const first = await native.page.evaluate(
		({ project, ownerAgentId }) =>
			window.maestro.agentSessions.listPaginated('codex', project, { ownerAgentId, limit: 1 }),
		{ project: native.project, ownerAgentId }
	);
	expect(first.totalCount).toBe(2);
	expect(first.hasMore).toBe(true);
	expect(first.nextCursor).toBe(first.sessions[0].sessionId);
	const second = await native.page.evaluate(
		({ project, ownerAgentId, cursor }) =>
			window.maestro.agentSessions.listPaginated('codex', project, {
				ownerAgentId,
				cursor,
				limit: 1,
			}),
		{ project: native.project, ownerAgentId, cursor: first.nextCursor! }
	);
	expect(
		[...first.sessions, ...second.sessions].map((session) => session.sessionId).sort()
	).toEqual(turns.map((turn) => turn.id).sort());
	expect(second.totalCount).toBe(2);
	expect(second.hasMore).toBe(false);
	expect(second.nextCursor).toBeNull();
	for (const [index, turn] of turns.entries())
		expect(fs.readFileSync(turn.file)).toEqual(before[index]);
});

test('opencode: history queries preserve the search mode and remote host', async ({ native }) => {
	native.scriptTurns([]);
	// Reuse the pinned OpenCode transcript writer, or the explicitly selected real CLI.
	const turn = await native.externalTurn('opencode', 'Local history boundary needle', {
		answer: 'Assistant boundary needle reply.',
	});
	const before = fs.readFileSync(turn.file);
	const local = await native.page.evaluate(async (project) => {
		const api = window.maestro.agentSessions;
		return {
			list: await api.list('opencode', project),
			page: await api.listPaginated('opencode', project, { limit: 10 }),
			search: await api.search('opencode', project, 'boundary needle', 'all'),
			assistantSearch: await api.search('opencode', project, 'boundary needle', 'assistant'),
			userSearch: await api.search('opencode', project, 'boundary needle', 'user'),
		};
	}, native.project);
	expect(local.list).toHaveLength(1);
	const id = local.list[0].sessionId;
	expect(local.page.sessions.map((session) => session.sessionId)).toEqual([id]);
	expect(local.search.map((session) => session.sessionId)).toEqual([id]);
	expect(local.assistantSearch).toEqual([
		{
			sessionId: id,
			matchType: 'assistant',
			matchCount: 1,
			matchPreview: 'Assistant boundary needle reply.',
		},
	]);
	expect(local.userSearch).toEqual([
		{
			sessionId: id,
			matchType: 'user',
			matchCount: 1,
			// Real-mode prompts append workload instructions after this opening line.
			matchPreview: expect.stringMatching(/^Local history boundary needle(?:$|\n)/),
		},
	]);

	const remoteResults = await native.page.evaluate(
		async ({ project, id }) => {
			await window.maestro.settings.set('sshRemotes', [
				{
					id: 'disabled-history-remote',
					name: 'Disabled synthetic remote',
					host: 'history.invalid',
					port: 22,
					username: 'synthetic',
					privateKeyPath: '',
					enabled: false,
				},
			]);
			const api = window.maestro.agentSessions;
			const results = await Promise.allSettled(
				['missing-history-remote', 'disabled-history-remote'].flatMap((remote) => [
					api.list('opencode', project, remote),
					api.listPaginated('opencode', project, { limit: 10 }, remote),
					api.search('opencode', project, 'boundary needle', 'all', remote),
					api.getPath('opencode', project, id, remote),
				])
			);
			return results.map((result) =>
				result.status === 'rejected'
					? { status: result.status, error: String(result.reason) }
					: { status: result.status, error: '' }
			);
		},
		{ project: native.project, id }
	);
	expect(remoteResults).toHaveLength(8);
	for (const result of remoteResults) {
		expect(result.status).toBe('rejected');
		expect(result.error).toContain('SSH remote is unavailable');
	}
	expect(fs.readFileSync(turn.file)).toEqual(before);
});

test('codex: browser search, preview and resume use the selected account', async ({ native }) => {
	await native.close();
	const homeDir = path.join(native.root, 'isolated-home');
	fs.mkdirSync(homeDir);
	await native.start(homeDir);
	native.scriptTurns([{ answer: 'Selected account resumed answer.' }]);
	const selected = await native.externalTurn('codex', 'selected-account-needle', {
		answer: 'Selected account preview answer.',
	});
	// The same native UUID in a different account must never supply the preview.
	// This default-account transcript always uses the pinned writer, including in real mode.
	const fallback = createTurn({
		provider: 'codex',
		configDir: path.join(homeDir, '.codex'),
		cwd: native.project,
		id: selected.id,
		prompt: 'default-account-needle',
	});
	fallback.finish('Default account preview must remain private.');
	const before = fs.readFileSync(selected.file);
	const defaultBefore = fs.readFileSync(fallback.file);
	const ownerAgentId = await native.createAgent('codex');
	await native.input().press(process.platform === 'darwin' ? 'Meta+Shift+L' : 'Control+Shift+L');
	const search = native.page.getByPlaceholder('Search all content...', { exact: true });
	await expect(search).toBeVisible();
	await search.fill('default-account-needle');
	await expect(
		native.page.getByText('No sessions match your search', { exact: true })
	).toBeVisible();
	await search.fill('selected-account-needle');
	await expect(native.page.getByText('No sessions match your search', { exact: true })).toHaveCount(
		0
	);
	await search.press('Enter');
	await expect(
		native.page.getByText('Selected account preview answer.', { exact: true })
	).toBeVisible();
	await expect(
		native.page.getByText('Default account preview must remain private.', { exact: true })
	).toHaveCount(0);
	await native.page.getByRole('button', { name: 'Resume', exact: true }).click();
	await expect(
		native.output().getByText('Selected account preview answer.', { exact: true })
	).toBeVisible();
	await native.send('Continue the selected account');
	await expect(
		native.output().getByText('Selected account resumed answer.', { exact: true })
	).toBeVisible();
	expect(native.files('codex')).toEqual([selected.file]);
	expect(fs.readFileSync(selected.file).subarray(0, before.length)).toEqual(before);
	expect(fs.readFileSync(fallback.file)).toEqual(defaultBefore);
	// This CLI endpoint reads the persisted store; renderer persistence is debounced by 2 seconds.
	await expect
		.poll(async () => {
			const current = await native.cli('tab', 'show', 'active', '--agent', ownerAgentId);
			return { id: current.tab.agentSessionId, state: current.tab.state };
		})
		.toEqual({ id: selected.id, state: 'idle' });
	fs.renameSync(native.codex, `${native.codex}-removed`);
	try {
		const failures = await native.page.evaluate(
			async ({ project, ownerAgentId, id }) => {
				const api = window.maestro.agentSessions;
				const results = await Promise.allSettled([
					api.search('codex', project, 'default-account-needle', 'all', undefined, {
						ownerAgentId,
					}),
					api.read('codex', project, id, { ownerAgentId }),
				]);
				return results.map((result) =>
					result.status === 'rejected' ? String(result.reason) : 'unexpected success'
				);
			},
			{ project: native.project, ownerAgentId, id: selected.id }
		);
		expect(failures).toHaveLength(2);
		for (const error of failures) expect(error).toContain('ENOENT');
	} finally {
		fs.renameSync(`${native.codex}-removed`, native.codex);
	}
	expect(fs.readFileSync(fallback.file)).toEqual(defaultBefore);
});
