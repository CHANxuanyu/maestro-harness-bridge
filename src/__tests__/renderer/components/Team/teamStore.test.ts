import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTeamStore } from '../../../../renderer/stores/teamStore';
import { reduceLedger } from '../../../../shared/team/ledger';
import type { TeamClient } from '../../../../renderer/services/teamClient';
import { defaultPath, teamConfig } from './defaultPath';
import { resetStore } from '../../../helpers';

const client = vi.hoisted(() => ({ current: undefined as TeamClient | undefined }));
vi.mock('../../../../renderer/services/teamClient', () => ({ teamClient: () => client.current }));

beforeEach(() => {
	resetStore(useTeamStore);
	vi.clearAllMocks();
	client.current = undefined;
});

describe('team ledger mirror', () => {
	it('reduces the default path and memoizes duplicate events per team', () => {
		const store = useTeamStore.getState();
		store.mirror({ config: teamConfig, events: defaultPath });
		const state = useTeamStore.getState().teams[teamConfig.id].state;
		expect(state).toEqual(reduceLedger(defaultPath));
		store.receive(teamConfig.id, defaultPath[0]);
		expect(useTeamStore.getState().teams[teamConfig.id].state).toBe(state);
	});
	it('subscribes before loading and merges events that race the initial snapshot', async () => {
		let listener: Parameters<TeamClient['onChanged']>[0] | undefined;
		let resolve!: (snapshot: { config: typeof teamConfig; events: typeof defaultPath }) => void;
		const off = vi.fn();
		client.current = {
			list: vi.fn().mockResolvedValue([teamConfig]),
			get: vi.fn(
				() =>
					new Promise((done) => {
						resolve = done;
					})
			),
			onChanged: vi.fn((fn) => {
				listener = fn;
				return off;
			}),
		} as unknown as TeamClient;
		const close = useTeamStore.getState().connect();
		await vi.waitFor(() => expect(resolve).toBeDefined());
		listener!({ teamId: teamConfig.id, event: defaultPath[0] });
		listener!({ teamId: teamConfig.id, event: defaultPath.at(-1)! });
		resolve({ config: teamConfig, events: defaultPath.slice(0, -1) });
		await vi.waitFor(() => expect(useTeamStore.getState().loading).toBe(false));
		expect(useTeamStore.getState().teams[teamConfig.id].state.terminal).toBe('all');
		expect(useTeamStore.getState().teams[teamConfig.id].events).toHaveLength(defaultPath.length);
		close();
		close();
		expect(off).toHaveBeenCalledOnce();
	});
	it('buffers an unknown team event until get resolves', async () => {
		let listener: Parameters<TeamClient['onChanged']>[0] | undefined;
		let resolve!: (snapshot: { config: typeof teamConfig; events: typeof defaultPath }) => void;
		client.current = {
			list: vi.fn().mockResolvedValue([]),
			get: vi.fn(
				() =>
					new Promise((done) => {
						resolve = done;
					})
			),
			onChanged: vi.fn((fn) => {
				listener = fn;
				return vi.fn();
			}),
		} as unknown as TeamClient;
		const close = useTeamStore.getState().connect();
		listener!({ teamId: teamConfig.id, event: defaultPath.at(-1)! });
		resolve({ config: teamConfig, events: defaultPath.slice(0, -1) });
		await vi.waitFor(() =>
			expect(useTeamStore.getState().teams[teamConfig.id]?.state.terminal).toBe('all')
		);
		close();
	});
	it('ignores snapshot results that arrive after the last subscriber disconnects', async () => {
		let resolve!: (snapshot: { config: typeof teamConfig; events: typeof defaultPath }) => void;
		client.current = {
			list: vi.fn().mockResolvedValue([teamConfig]),
			get: vi.fn(
				() =>
					new Promise((done) => {
						resolve = done;
					})
			),
			onChanged: vi.fn(() => vi.fn()),
		} as unknown as TeamClient;
		const close = useTeamStore.getState().connect();
		await vi.waitFor(() => expect(resolve).toBeDefined());
		close();
		resolve({ config: teamConfig, events: defaultPath });
		await Promise.resolve();
		expect(useTeamStore.getState().teams).toEqual({});
	});
	it('does not invent state on a failed command and coalesces double answers', async () => {
		let finish!: () => void;
		const answer = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		);
		client.current = { answer } as unknown as TeamClient;
		const first = useTeamStore.getState().answer('team', 'card', 'confirm');
		expect(await useTeamStore.getState().answer('team', 'card', 'confirm')).toBe(false);
		expect(answer).toHaveBeenCalledOnce();
		finish();
		expect(await first).toBe(true);
		expect(useTeamStore.getState().teams).toEqual({});
		answer.mockRejectedValueOnce(new Error('Offline'));
		expect(await useTeamStore.getState().answer('team', 'card', 'confirm')).toBe(false);
		expect(useTeamStore.getState().error).toBe('Offline');
	});
	it('closes setup after creation even when the follow-up snapshot read fails', async () => {
		client.current = {
			create: vi.fn().mockResolvedValue(teamConfig),
			get: vi.fn().mockRejectedValue(new Error('Snapshot unavailable')),
		} as unknown as TeamClient;
		useTeamStore.setState({ setupOpen: true });
		await useTeamStore.getState().create(teamConfig);
		expect(useTeamStore.getState().setupOpen).toBe(false);
		expect(useTeamStore.getState().activeTeamId).toBe(teamConfig.id);
		expect(useTeamStore.getState().teams[teamConfig.id].events).toEqual([]);
		expect(useTeamStore.getState().error).toBe('Snapshot unavailable');
	});
});
