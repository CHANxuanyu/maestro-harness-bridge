import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
	createFollowUpStore,
	FOLLOW_UP_POLL_MS,
	FOLLOW_UP_WAIT_MS,
	type FollowUpCommands,
} from '../../main/follow-ups';
import type { FollowUpExternalStatus, FollowUpRegistration } from '../../shared/followUp';

vi.mock('../../main/utils/sentry', () => ({ captureException: vi.fn() }));
vi.mock('../../main/utils/atomic-json-store', async (original) => {
	const actual = await original<typeof import('../../main/utils/atomic-json-store')>();
	return { ...actual, atomicWriteJson: vi.fn(actual.atomicWriteJson) };
});
import { atomicWriteJson } from '../../main/utils/atomic-json-store';

describe('follow-ups', () => {
	let root: string;
	let stores: ReturnType<typeof createFollowUpStore>[];
	let input: FollowUpRegistration;
	const make = (deps: Partial<Parameters<typeof createFollowUpStore>[0]> = {}) => {
		const store = createFollowUpStore({ userData: root, ...deps });
		stores.push(store);
		return store;
	};
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'follow-ups-'));
		stores = [];
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		input = {
			target: { kind: 'conversation', sessionId: 'owner', tabId: 'exact-tab' },
			reason: 'Check later',
			condition: { kind: 'time', at: Date.now() + 20_000 },
			deadline: Date.now() + 7_200_000,
		};
	});
	afterEach(async () => {
		stores.forEach((store) => store.stop());
		vi.useRealTimers();
		await fs.rm(root, { recursive: true, force: true });
	});
	// Timer callbacks perform real disk writes. list() joins the store's write
	// queue, so assertions wait for persistence rather than sleeping.
	const advance = async (store: ReturnType<typeof createFollowUpStore>, ms: number) => {
		await vi.advanceTimersByTimeAsync(ms);
		await store.list();
	};

	it('persists fired state before emitting to the exact target and never re-fires after restart', async () => {
		const store = make();
		const fired = vi.fn();
		store.onFire(fired);
		await store.register(input);
		await store.start();
		await advance(store, 20_000);
		expect(fired).toHaveBeenCalledTimes(1);
		expect(fired.mock.calls[0][0]).toMatchObject({
			kind: 'ready',
			late: false,
			followUp: { target: input.target, state: 'fired' },
		});
		expect(JSON.parse(await fs.readFile(path.join(root, 'follow-ups.json'), 'utf8'))[0].state).toBe(
			'fired'
		);
		store.stop();
		const restarted = make();
		restarted.onFire(fired);
		await restarted.start();
		await advance(restarted, 60_000);
		expect(fired).toHaveBeenCalledTimes(1);
	});

	it('fires overdue restored timers immediately with late true', async () => {
		await make().register(input);
		vi.setSystemTime(Date.now() + 25_000);
		const restarted = make();
		const fired = vi.fn();
		restarted.onFire(fired);
		await restarted.start();
		expect(fired.mock.calls[0][0]).toMatchObject({ kind: 'ready', late: true });
	});

	it('cancels durably, stops timers, and resumes with the original deadline', async () => {
		const store = make();
		const entry = await store.register(input);
		await store.start();
		expect(await store.cancel(entry.id)).toBe(true);
		expect(await store.cancel(entry.id)).toBe(false);
		store.stop();
		expect(vi.getTimerCount()).toBe(0);
		const restarted = make();
		const fire = vi.fn();
		restarted.onFire(fire);
		await restarted.start();
		await advance(restarted, 100_000);
		expect(fire).not.toHaveBeenCalled();
		expect((await restarted.list())[0]).toMatchObject({
			state: 'canceled',
			deadline: input.deadline,
		});
	});

	it('fires a wait timeout with external status and leaves the external command running', async () => {
		const status: FollowUpExternalStatus = {
			state: 'running',
			status: 'building',
			observedAt: Date.now(),
		};
		const commands: FollowUpCommands = {
			getStatus: vi.fn(() => status),
			subscribe: vi.fn(() => vi.fn()),
		};
		const store = make({ commands });
		const fired = vi.fn();
		store.onFire(fired);
		await store.register({ ...input, condition: { kind: 'command', processId: 'app-process' } });
		await store.start();
		await advance(store, FOLLOW_UP_WAIT_MS);
		expect(fired).toHaveBeenCalledTimes(1);
		expect(fired.mock.calls[0][0]).toMatchObject({
			kind: 'wait-timeout',
			externalStatus: { state: 'running', status: 'building' },
		});
		expect(status.state).toBe('running');
	});

	it('observes command completion events and gives absolute expiration priority', async () => {
		let listener!: Parameters<FollowUpCommands['subscribe']>[0];
		const commands: FollowUpCommands = {
			getStatus: () => ({ state: 'running', observedAt: Date.now() }),
			subscribe: (callback) => {
				listener = callback;
				return vi.fn();
			},
		};
		const store = make({ commands });
		const fired = vi.fn();
		store.onFire(fired);
		await store.register({ ...input, condition: { kind: 'command', processId: 'app-process' } });
		await store.start();
		listener('unrelated', { state: 'completed', observedAt: Date.now(), exitCode: 0 });
		expect(fired).not.toHaveBeenCalled();
		listener('app-process', {
			state: 'completed',
			observedAt: Date.now(),
			exitCode: 1,
			outputTail: 'failed check',
		});
		await store.list();
		expect(fired.mock.calls[0][0]).toMatchObject({
			kind: 'ready',
			externalStatus: { exitCode: 1, outputTail: 'failed check' },
		});
		await store.register({
			...input,
			id: 'expire',
			condition: { kind: 'time', at: Date.now() + 5000 },
			deadline: Date.now() + 5000,
		});
		await advance(store, 5000);
		expect(fired.mock.calls[1][0].kind).toBe('expired');
	});

	it('rejects unobservable processes, unknown condition kinds and inaccessible CI', async () => {
		const store = make({ gh: vi.fn().mockRejectedValue(new Error('gh not logged in')) });
		await expect(
			store.register({ ...input, condition: { kind: 'command', processId: 'not-ours' } })
		).rejects.toThrow('cannot observe');
		await expect(
			store.register({ ...input, condition: { kind: 'imaginary' } as never })
		).rejects.toThrow('cannot be observed');
		await expect(
			store.register({ ...input, condition: { kind: 'ci', runId: '42', cwd: root } })
		).rejects.toThrow('not logged in');
		expect(await store.list()).toEqual([]);
	});

	it('polls CI with fixed argv and interval, then fires once with its conclusion', async () => {
		const gh = vi.fn().mockResolvedValue({ status: 'queued', conclusion: null });
		const store = make({ gh });
		const fired = vi.fn();
		store.onFire(fired);
		await store.register({ ...input, condition: { kind: 'ci', runId: '482', cwd: root } });
		await store.start();
		expect(gh).toHaveBeenCalledTimes(1);
		gh.mockResolvedValue({ status: 'completed', conclusion: 'failure' });
		await advance(store, FOLLOW_UP_POLL_MS);
		await store.list();
		expect(gh).toHaveBeenCalledTimes(2);
		expect(gh).toHaveBeenLastCalledWith(
			['run', 'view', '482', '--json', 'status,conclusion'],
			root
		);
		expect(fired.mock.calls[0][0]).toMatchObject({
			kind: 'ready',
			externalStatus: { conclusion: 'failure' },
		});
	});

	it('takes a fresh CI observation at the single-wait limit, and expires even if a poll is stuck', async () => {
		const gh = vi.fn().mockResolvedValue({ status: 'queued', conclusion: null });
		const store = make({ gh });
		const fired = vi.fn();
		store.onFire(fired);
		await store.register({
			...input,
			id: 'short-wait',
			waitLimitMs: 5000,
			condition: { kind: 'ci', runId: '42', cwd: root },
		});
		await store.start();
		gh.mockResolvedValue({ status: 'in_progress', conclusion: null });
		await advance(store, 5000);
		await store.list();
		expect(fired.mock.calls[0][0]).toMatchObject({
			kind: 'wait-timeout',
			externalStatus: { status: 'in_progress', observedAt: Date.now() },
		});
		gh.mockResolvedValueOnce({ status: 'queued', conclusion: null });
		await store.register({
			...input,
			id: 'deadline',
			waitLimitMs: 5000,
			deadline: Date.now() + 6000,
			condition: { kind: 'ci', runId: '43', cwd: root },
		});
		gh.mockImplementation(() => new Promise(() => {}));
		await advance(store, 5000);
		expect(fired).toHaveBeenCalledTimes(1);
		await advance(store, 1000);
		expect(fired.mock.calls[1][0]).toMatchObject({ kind: 'expired' });
	});

	it('does not fire from a stale CI poll after cancellation or stop', async () => {
		const gh = vi.fn().mockResolvedValueOnce({ status: 'queued', conclusion: null });
		let complete!: (result: { status: string; conclusion: string }) => void;
		gh.mockImplementationOnce(
			() =>
				new Promise((done) => {
					complete = done;
				})
		);
		const store = make({ gh });
		const fired = vi.fn();
		store.onFire(fired);
		const entry = await store.register({
			...input,
			condition: { kind: 'ci', runId: '42', cwd: root },
		});
		await store.start();
		await advance(store, FOLLOW_UP_POLL_MS);
		await store.cancel(entry.id);
		store.stop();
		complete({ status: 'completed', conclusion: 'success' });
		await store.list();
		expect(fired).not.toHaveBeenCalled();
	});

	it('preserves a corrupt store and reports recovery', async () => {
		await fs.writeFile(path.join(root, 'follow-ups.json'), '{broken');
		const onError = vi.fn();
		const store = make({ onError });
		await store.start();
		expect(await store.list()).toEqual([]);
		expect(onError).toHaveBeenCalledOnce();
		const sidecar = (await fs.readdir(root)).find((name) => name.includes('.corrupt-'))!;
		expect(await fs.readFile(path.join(root, sidecar), 'utf8')).toBe('{broken');
	});

	it('does not emit on a failed persistence write and retries without duplicate firing', async () => {
		const onError = vi.fn();
		const store = make({ onError });
		const fired = vi.fn();
		store.onFire(fired);
		await store.register(input);
		await store.start();
		vi.mocked(atomicWriteJson).mockRejectedValueOnce(new Error('disk unavailable'));
		await advance(store, 20_000);
		expect(fired).not.toHaveBeenCalled();
		expect((await store.list())[0].state).toBe('pending');
		expect(onError).toHaveBeenCalled();
		await advance(store, FOLLOW_UP_POLL_MS);
		expect(fired).toHaveBeenCalledTimes(1);
		expect((await store.list())[0].state).toBe('fired');
	});
});
