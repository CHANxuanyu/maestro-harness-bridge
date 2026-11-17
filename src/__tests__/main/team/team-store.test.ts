import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createTeamStore } from '../../../main/team/team-store';
import { DEFAULT_TEAM_AUTHORIZATIONS, type TeamConfig } from '../../../shared/team/types';

vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));
vi.mock('fs/promises', async (original) => {
	const actual = await original<typeof import('fs/promises')>();
	return { ...actual, open: vi.fn(actual.open) };
});

describe('team store', () => {
	let root: string;
	let config: TeamConfig;
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'team-store-'));
		config = {
			id: 'one',
			title: 'Team',
			idea: 'Build it',
			projectRoot: root,
			createdAt: 1,
			seats: { pm: { tool: 'claude-code' }, dev: { tool: 'codex' }, qa: { tool: 'claude-code' } },
			turnBudget: 40,
			authorizations: DEFAULT_TEAM_AUTHORIZATIONS,
		};
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(root, { recursive: true, force: true });
	});

	it('creates exclusively and serializes concurrent appends across instances and restart', async () => {
		const store = createTeamStore(root);
		expect(await store.listTeams()).toEqual([]);
		await store.createTeam(config);
		await expect(store.createTeam(config)).rejects.toThrow();
		const other = createTeamStore(root);
		const events = await Promise.all(
			Array.from({ length: 25 }, (_, i) =>
				(i % 2 ? store : other).append('one', {
					id: String(i),
					at: i,
					actor: 'app',
					kind: 'paused',
				})
			)
		);
		expect(events.map((event) => event.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
		expect((await createTeamStore(root).loadTeam('one')).events).toEqual(events);
		expect(await store.listTeams()).toEqual([config]);
		expect(
			(await fs.readFile(path.join(root, 'teams/one/ledger.jsonl'), 'utf8')).endsWith('\n')
		).toBe(true);
	});

	it('fsyncs before emitting or resolving, and does not emit a failed append', async () => {
		const store = createTeamStore(root);
		await store.createTeam(config);
		const order: string[] = [];
		vi.mocked(fs.open).mockImplementation(async (...args) => {
			const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
			const handle = await actual.open(...args);
			const sync = handle.sync.bind(handle);
			vi.spyOn(handle, 'sync').mockImplementation(async () => {
				await sync();
				order.push('sync');
			});
			return handle;
		});
		const unsubscribe = store.subscribe(() => {
			order.push('event');
		});
		await store.append('one', { id: 'a', at: 1, actor: 'app', kind: 'paused' });
		order.push('resolved');
		expect(order).toEqual(['sync', 'event', 'resolved']);
		unsubscribe();
		vi.mocked(fs.open).mockRejectedValueOnce(new Error('disk full'));
		await expect(
			store.append('one', { id: 'b', at: 2, actor: 'app', kind: 'paused' })
		).rejects.toThrow('disk full');
		expect(order).toHaveLength(3);
	});

	it('preserves corrupt bytes, skips isolated and torn lines, and seals the tail on append', async () => {
		const recovery = vi.fn();
		const store = createTeamStore(root, recovery);
		await store.createTeam(config);
		const one = await store.append('one', { id: 'a', at: 1, actor: 'app', kind: 'paused' });
		const three = { ...one, id: 'c', seq: 3 };
		const bytes = Buffer.from(
			`${JSON.stringify(one)}\n{bad}\n${JSON.stringify(three)}\n{"seq":4`,
			'utf8'
		);
		const file = path.join(root, 'teams/one/ledger.jsonl');
		await fs.writeFile(file, bytes);
		expect((await store.loadTeam('one')).events).toEqual([one, three]);
		expect(recovery.mock.calls[0][0].lines).toEqual([2, 4]);
		expect(await fs.readFile(recovery.mock.calls[0][0].sidecar)).toEqual(
			Buffer.from('{bad}\n{"seq":4')
		);
		await store.loadTeam('one');
		expect(recovery).toHaveBeenCalledTimes(1);
		expect((await store.append('one', { id: 'd', at: 4, actor: 'app', kind: 'resumed' })).seq).toBe(
			4
		);
		expect((await store.loadTeam('one')).events.map((event) => event.id)).toEqual(['a', 'c', 'd']);
		expect((await fs.readFile(file)).subarray(0, bytes.length)).toEqual(bytes);
	});

	it('quarantines invalid configs without hiding good teams or accepting traversal', async () => {
		const recovery = vi.fn();
		const store = createTeamStore(root, recovery);
		await store.createTeam(config);
		await store.createTeam({ ...config, id: 'two' });
		await fs.writeFile(path.join(root, 'teams/two/config.json'), '{oops');
		expect(await store.listTeams()).toEqual([config]);
		expect(await fs.readFile(recovery.mock.calls[0][0].sidecar, 'utf8')).toBe('{oops');
		expect(() => store.loadTeam('../escape')).toThrow('Invalid team id');
	});
});
