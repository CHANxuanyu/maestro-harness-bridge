import { describe, it, expect } from 'vitest';
import type { LogEntry } from '../../../../renderer/types';
import {
	foldTurnActivity,
	summarizeTurnActivity,
	turnActivityOutcome,
} from '../../../../renderer/components/TerminalOutput/utils/foldTurnActivity';

const entry = (id: string, ts: number, source: LogEntry['source'], extra: Partial<LogEntry> = {}) =>
	({ id, timestamp: ts, source, text: id, ...extra }) as LogEntry;
const user = (id: string, ts: number) => entry(id, ts, 'user');
const reply = (id: string, ts: number) => entry(id, ts, 'stdout');
const note = (id: string, ts: number) => entry(id, ts, 'stdout', { purpose: 'commentary' });
const thinking = (id: string, ts: number) => entry(id, ts, 'thinking');
const tool = (id: string, ts: number, status: 'completed' | 'failed' | 'canceled' = 'completed') =>
	entry(id, ts, 'tool', { metadata: { toolState: { status } } });

const ids = (logs: LogEntry[]) => logs.map((log) => log.id);
const fold = (logs: LogEntry[], keepLastTurnOpen = false) =>
	foldTurnActivity(logs, { keepLastTurnOpen });

describe('foldTurnActivity', () => {
	it("folds a finished turn's activity and interim text behind its first step", () => {
		const { logs, activityByHostId } = fold([
			user('u1', 0),
			note('n1', 1_000),
			tool('t1', 2_000),
			reply('r1', 3_000),
			thinking('k1', 4_000),
			tool('t2', 5_000),
			reply('a1', 9_000),
			user('u2', 10_000),
			reply('a2', 11_000),
		]);
		expect(ids(logs)).toEqual(['u1', 'n1', 'a1', 'u2', 'a2']);
		const activity = activityByHostId.get('n1')!;
		expect(ids(activity.entries)).toEqual(['n1', 't1', 'r1', 'k1', 't2']);
		expect(activity.durationMs).toBe(9_000);
		expect(activity.status).toBe('completed');
		expect(activityByHostId.size).toBe(1);
	});

	it('leaves turns without activity, and logs without any, untouched', () => {
		const logs = [user('u1', 0), reply('a1', 1), user('u2', 2), reply('a2', 3)];
		expect(fold(logs).logs).toBe(logs);
		const mixed = [user('u1', 0), reply('a1', 1), user('u2', 2), tool('t2', 3), reply('a2', 4)];
		expect(ids(fold(mixed).logs)).toEqual(['u1', 'a1', 'u2', 't2', 'a2']);
	});

	it('keeps errors, notices and anything after the answer on the page, in order', () => {
		const { logs, activityByHostId } = fold([
			user('u1', 0),
			tool('t1', 1),
			entry('e1', 2, 'error'),
			tool('t2', 3),
			reply('a1', 4),
			tool('t3', 5),
			entry('s1', 6, 'system'),
			user('u2', 7),
			reply('a2', 8),
		]);
		expect(ids(logs)).toEqual(['u1', 't1', 'e1', 'a1', 't3', 's1', 'u2', 'a2']);
		expect(ids(activityByHostId.get('t1')!.entries)).toEqual(['t1', 't2']);
	});

	it('reports the worst state of the folded calls', () => {
		const failed = fold([user('u1', 0), tool('t1', 1), tool('t2', 2, 'failed'), reply('a1', 3)]);
		expect(failed.activityByHostId.get('t1')!.status).toBe('error');
		// A stopped turn with no answer folds all of its work.
		const stopped = fold([
			user('u1', 0),
			tool('t1', 1, 'canceled'),
			entry('s1', 2, 'system'),
			user('u2', 3),
		]);
		expect(ids(stopped.logs)).toEqual(['u1', 't1', 's1', 'u2']);
		expect(stopped.activityByHostId.get('t1')!.status).toBe('canceled');
	});

	it('keeps the running turn open, and a last turn still working without an answer', () => {
		const running = [user('u1', 0), tool('t1', 1), reply('a1', 2)];
		expect(fold(running, true).activityByHostId.size).toBe(0);
		expect(fold(running, false).activityByHostId.size).toBe(1);
		// No answer yet and still ending in activity: still working.
		const working = [user('u1', 0), reply('a0', 1), user('u2', 2), note('n2', 3), tool('t2', 4)];
		expect(ids(fold(working).logs)).toEqual(['u1', 'a0', 'u2', 'n2', 't2']);
		// The same shape before a later turn is finished, and folds.
		const finished = [...working, user('u3', 5)];
		expect(ids(fold(finished).logs)).toEqual(['u1', 'a0', 'u2', 'n2', 'u3']);
	});

	it('times a turn with no user message from its own first entry, and omits zero', () => {
		const { activityByHostId } = fold([tool('t1', 1_000), reply('a1', 4_000), user('u1', 5_000)]);
		expect(activityByHostId.get('t1')!.durationMs).toBe(3_000);
		const instant = fold([user('u1', 0), tool('t1', 0), reply('a1', 0)]);
		expect(instant.activityByHostId.get('t1')!.durationMs).toBeUndefined();
	});
});

describe('new shell running turn', () => {
	it.each(['completion only', 'error card', 'history slice'])(
		'keeps an error summary without activity: %s',
		(shape) => {
			const prompt = {
				...user('u', 0),
				turnCompletion: { status: 'error' as const, timestamp: 2, reason: 'Connection lost' },
			};
			const error = entry('failure', 1, 'error', { text: 'Connection lost' });
			const logs =
				shape === 'completion only' ? [prompt] : shape === 'error card' ? [prompt, error] : [error];
			const result = foldTurnActivity(logs, { newShell: true, keepLastTurnOpen: false });
			expect([...result.activityByHostId.values()]).toEqual([
				expect.objectContaining({ status: 'error', reason: 'Connection lost', entries: [] }),
			]);
			if (shape !== 'completion only') expect(result.logs).toContain(error);
			const classic = foldTurnActivity(logs, { keepLastTurnOpen: false });
			expect(classic.logs).toBe(logs);
			expect(classic.activityByHostId.size).toBe(0);
		}
	);

	it('keeps one activity row from before the first call through eleven calls', () => {
		const prompt = user('u', 0);
		const start = foldTurnActivity([prompt], { keepLastTurnOpen: true, newShell: true });
		const calls = Array.from({ length: 11 }, (_, index) => tool(`t${index}`, index + 1));
		const end = foldTurnActivity(
			[prompt, note('n1', 1), ...calls, note('n2', 12), note('n3', 13)],
			{ keepLastTurnOpen: true, newShell: true }
		);
		expect(ids(start.logs)).toEqual(['u', 'activity:u']);
		expect(ids(end.logs)).toEqual(['u', 'n1']);
		expect(
			end.activityByHostId.get('n1')?.entries.filter((entry) => entry.source === 'tool')
		).toHaveLength(11);
		expect(
			end.activityByHostId
				.get('n1')
				?.entries.filter((entry) => entry.purpose)
				.map((entry) => entry.text)
		).toEqual(['n1', 'n2', 'n3']);
		// Opting out retains the classic expanded running path.
		expect(foldTurnActivity([prompt, ...calls], { keepLastTurnOpen: true }).logs).toHaveLength(12);
	});

	it('derives counts, the latest public note and only an actual top-level plan', () => {
		const entries = [
			{ ...tool('r', 1), text: 'Read', metadata: { toolState: { input: { file_path: 'a.ts' } } } },
			{ ...tool('e', 2), text: 'Edit', metadata: { toolState: { input: { file_path: 'a.ts' } } } },
			{
				...tool('c', 3),
				text: 'Bash',
				metadata: { toolState: { status: 'running' as const, input: { command: 'npm test' } } },
			},
			thinking('secret', 4),
			note('public', 5),
		];
		expect(summarizeTurnActivity(entries)).toMatchObject({
			counts: { reads: 1, edits: 1, commands: 1 },
			steps: 3,
			note: 'public',
			current: { target: 'npm test' },
			plan: null,
		});
		const plan = {
			...tool('p', 6),
			metadata: {
				toolState: {
					input: {
						plan: [
							{ step: 'Test', status: 'completed' },
							{ step: 'Review', status: 'pending' },
						],
					},
				},
			},
		};
		expect(summarizeTurnActivity([...entries, plan]).plan?.completed).toBe(1);
		expect(
			summarizeTurnActivity([
				...entries,
				{ ...plan, metadata: { ...plan.metadata, parentToolUseId: 'child' } },
			]).plan
		).toBeNull();
		expect(
			summarizeTurnActivity([
				plan,
				{ ...tool('clear', 7), metadata: { toolState: { input: { plan: [] } } } },
			]).plan
		).toBeNull();
	});

	it('classifies the terminal outcome independently from step failures', () => {
		const entries = [tool('failed', 1, 'failed'), reply('answer', 2)];
		expect(turnActivityOutcome(entries)).toBe('completed');
		expect(
			turnActivityOutcome(
				entries,
				entry('u', 0, 'user', {
					turnCompletion: { status: 'error', timestamp: 3, reason: 'Transport lost' },
				})
			)
		).toBe('error');
		expect(turnActivityOutcome([tool('c', 1, 'canceled')])).toBe('canceled');
		expect(turnActivityOutcome([tool('c', 1, 'canceled'), reply('answer', 2)])).toBe('completed');
		expect(turnActivityOutcome([tool('t', 1)])).toBe('unknown');
	});
});
