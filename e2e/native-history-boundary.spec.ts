import fs from 'node:fs';
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

test('opencode: unavailable SSH history never falls back to local sessions', async ({ native }) => {
	native.scriptTurns([]);
	// Reuse the pinned OpenCode transcript writer, or the explicitly selected real CLI.
	const turn = await native.externalTurn('opencode', 'Local history boundary needle', {
		answer: 'Only this local account contains the boundary needle.',
	});
	const before = fs.readFileSync(turn.file);
	const local = await native.page.evaluate(async (project) => {
		const api = window.maestro.agentSessions;
		return {
			list: await api.list('opencode', project),
			page: await api.listPaginated('opencode', project, { limit: 10 }),
			search: await api.search('opencode', project, 'boundary needle', 'all'),
		};
	}, native.project);
	expect(local.list).toHaveLength(1);
	const id = local.list[0].sessionId;
	expect(local.page.sessions.map((session) => session.sessionId)).toEqual([id]);
	expect(local.search.map((session) => session.sessionId)).toEqual([id]);

	const remoteResults = await native.page.evaluate(async (project) => {
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
			])
		);
		return results.map((result) =>
			result.status === 'rejected'
				? { status: result.status, error: String(result.reason) }
				: { status: result.status, error: '' }
		);
	}, native.project);
	expect(remoteResults).toHaveLength(6);
	for (const result of remoteResults) {
		expect(result.status).toBe('rejected');
		expect(result.error).toContain('SSH remote is unavailable');
	}
	expect(fs.readFileSync(turn.file)).toEqual(before);
});
