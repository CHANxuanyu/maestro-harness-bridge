/**
 * A provider that stores no per-message time (Grok's chat_history) converts to
 * entries whose timestamp is NaN. The live pairing in `mergeNewerEntries`
 * normally proves "this native message is the send the tab already shows" by a
 * clock window, which can never hold against NaN, so a follow refresh appended
 * the stored copy of every live turn a second time.
 *
 * Without times the only evidence is ORDER: native messages after the anchor
 * pair with the tab's own unmatched entries one to one and in sequence. A real
 * repeated turn (the same words sent again, here or elsewhere) still has its own
 * native message and is still appended.
 *
 * The three steps run in the same order as the refresh service.
 */

import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../../renderer/types';
import {
	bindDelayedOwnSends,
	mergeNewerEntries,
	reconcileTranscriptEntries,
} from '../../../renderer/utils/transcriptMessages';

const NOW = 1_792_710_000_000;

/** A native message read back from history: native id, no time. */
const native = (n: number, source: LogEntry['source'], text: string): LogEntry => ({
	id: `grok-msg-${n}`,
	timestamp: Number.NaN,
	source,
	text,
	nativeTranscript: { messageId: `grok-msg-${n}` },
});

/** What the tab drew live: local id, renderer clock. */
const local = (
	id: string,
	minutes: number,
	source: LogEntry['source'],
	text: string
): LogEntry => ({
	id,
	timestamp: NOW + minutes * 60_000,
	source,
	text,
	...(source === 'user' ? { delivered: true } : {}),
});

function refresh(loaded: LogEntry[], visible: LogEntry[]) {
	const upgrade = reconcileTranscriptEntries(loaded, visible);
	const own = bindDelayedOwnSends(loaded, upgrade.logs);
	return mergeNewerEntries(loaded, own.logs);
}

const hydrated = [
	native(0, 'user', 'Before restart'),
	native(1, 'stdout', 'Before application restart.'),
];

describe('following an untimed conversation that was only shown live', () => {
	it('anchors a unique user sequence and adds an external turn once', () => {
		const visible = [local('u1', 0, 'user', 'Mine'), local('a1', 1, 'stdout', 'My answer')];
		const loaded = [
			native(0, 'user', 'Mine'),
			native(1, 'stdout', 'My answer'),
			native(2, 'user', 'Elsewhere'),
			native(3, 'stdout', 'External answer'),
		];
		const merged = refresh(loaded, visible);
		expect(merged?.added).toBe(2);
		expect(merged?.logs.map((e) => e.id)).toEqual(['u1', 'a1', 'grok-msg-2', 'grok-msg-3']);
		expect(refresh(loaded, merged!.logs)?.added).toBe(0);
	});

	it.each([NOW, Number.NaN])('refuses multiple user alignments even at time %s', (timestamp) => {
		const visible = [{ ...local('u1', 0, 'user', 'continue'), timestamp }];
		const loaded = [native(0, 'user', 'continue'), native(1, 'user', 'continue')];
		expect(refresh(loaded, visible)).toBeNull();
	});

	it('does not ignore an unpersisted failed send to force a match', () => {
		const visible = [
			local('u1', 0, 'user', 'Mine'),
			local('a1', 1, 'stdout', 'My answer'),
			{ ...local('failed', 2, 'user', 'Never persisted'), delivered: false },
		];
		expect(
			refresh(
				[
					native(0, 'user', 'Mine'),
					native(1, 'stdout', 'My answer'),
					native(2, 'user', 'Elsewhere'),
				],
				visible
			)
		).toBeNull();
	});

	it.each(['External answer', 'Second answer'])(
		'keeps an external turn between local turns, including repeated reply text: %s',
		(externalAnswer) => {
			const visible = [
				local('u1', 0, 'user', 'First'),
				local('a1', 1, 'stdout', 'First answer'),
				local('u2', 2, 'user', 'Second'),
				local('a2', 3, 'stdout', 'Second answer'),
			];
			const loaded = [
				native(0, 'user', 'First'),
				native(1, 'stdout', 'First answer'),
				native(2, 'user', 'Elsewhere'),
				native(3, 'stdout', externalAnswer),
				native(4, 'user', 'Second'),
				native(5, 'stdout', 'Second answer'),
			];
			const merged = refresh(loaded, visible);
			expect(merged?.added).toBe(2);
			expect(merged?.logs.map((e) => e.id)).toEqual([
				'u1',
				'a1',
				'grok-msg-2',
				'grok-msg-3',
				'u2',
				'a2',
			]);
			expect(refresh(loaded, merged!.logs)?.added).toBe(0);
		}
	);

	it('allows repeated local prompts when the complete alignment is unique', () => {
		const visible = [
			local('u1', 0, 'user', 'continue'),
			local('a1', 1, 'stdout', 'One'),
			local('u2', 2, 'user', 'continue'),
			local('a2', 3, 'stdout', 'Two'),
		];
		const loaded = [
			native(0, 'user', 'continue'),
			native(1, 'stdout', 'One'),
			native(2, 'user', 'continue'),
			native(3, 'stdout', 'Two'),
			native(4, 'user', 'Elsewhere'),
		];
		expect(refresh(loaded, visible)?.logs.map((e) => e.id)).toEqual([
			'u1',
			'a1',
			'u2',
			'a2',
			'grok-msg-4',
		]);
	});

	it('keeps a stopped turn’s own progress and tool while adding an external reply', () => {
		const visible: LogEntry[] = [
			local('u1', 0, 'user', 'Run work'),
			{ ...local('progress', 1, 'stdout', 'Working'), purpose: 'commentary' },
			{
				...local('tool', 1, 'tool', 'run_command'),
				metadata: { toolState: { status: 'canceled' } },
			},
		];
		const loaded = [
			native(0, 'user', 'Run work'),
			{
				...native(1, 'stdout', 'Working'),
				nativeTranscript: { messageId: 'grok-msg-1', channel: 'commentary' },
			},
			native(2, 'tool', 'run_command'),
			native(3, 'user', 'Elsewhere'),
			native(4, 'stdout', 'Working'),
		];
		const merged = refresh(loaded, visible);
		expect(merged?.added).toBe(2);
		expect(merged?.logs.map((e) => e.id)).toEqual([
			'u1',
			'progress',
			'tool',
			'grok-msg-3',
			'grok-msg-4',
		]);
	});

	it('requires a user-message sequence, not just matching answer text', () => {
		expect(
			refresh([native(0, 'stdout', 'Same answer')], [local('a1', 0, 'stdout', 'Same answer')])
		).toBeNull();
		expect(refresh([native(0, 'user', '')], [local('u1', 0, 'user', '')])).toBeNull();
	});

	it('does not use the untimed sequence fallback for a timed provider', () => {
		expect(
			refresh(
				[{ ...native(0, 'user', 'Same prompt'), timestamp: NOW + 24 * 60 * 60_000 }],
				[local('u1', 0, 'user', 'Same prompt')]
			)
		).toBeNull();
	});
});

describe('mergeNewerEntries without native times', () => {
	it('does not append the stored copy of a turn the tab ran live after reopening it', () => {
		const visible = [
			...hydrated,
			local('u1', 0, 'user', 'After restart'),
			local('a1', 1, 'stdout', 'After application restart.'),
		];
		const loaded = [
			...hydrated,
			native(2, 'user', 'After restart'),
			native(3, 'stdout', 'After application restart.'),
		];
		const merged = refresh(loaded, visible)!;
		expect(merged.added).toBe(0);
		expect(merged.logs.map((e) => e.id)).toEqual(visible.map((e) => e.id));
	});

	it('skips the stored reply of a live turn even when its words differ from the stream', () => {
		const visible = [
			...hydrated,
			local('u1', 0, 'user', 'After restart'),
			local('t1', 0, 'tool', 'run_command'),
			local('a1', 1, 'stdout', 'Streamed wording'),
		];
		const loaded = [
			...hydrated,
			native(2, 'user', 'After restart'),
			native(3, 'tool', 'run_command'),
			native(4, 'stdout', 'Stored wording'),
		];
		const merged = refresh(loaded, visible)!;
		expect(merged.added).toBe(0);
	});

	it('still appends a genuinely repeated prompt sent from another app', () => {
		const visible = [
			...hydrated,
			local('u1', 0, 'user', 'continue'),
			local('a1', 1, 'stdout', 'First continuation.'),
		];
		const loaded = [
			...hydrated,
			native(2, 'user', 'continue'),
			native(3, 'stdout', 'First continuation.'),
			native(4, 'user', 'continue'),
			native(5, 'stdout', 'Second continuation.'),
		];
		const merged = refresh(loaded, visible)!;
		expect(merged.added).toBe(2);
		expect(merged.logs.map((e) => e.id)).toEqual([
			'grok-msg-0',
			'grok-msg-1',
			'u1',
			'a1',
			'grok-msg-4',
			'grok-msg-5',
		]);
		// Idempotent: the next refresh finds nothing new.
		expect(refresh(loaded, merged.logs)!.added).toBe(0);
	});

	it('pairs two identical live turns with their two native copies, once each', () => {
		const visible = [
			...hydrated,
			local('u1', 0, 'user', 'continue'),
			local('a1', 1, 'stdout', 'One.'),
			local('u2', 2, 'user', 'continue'),
			local('a2', 3, 'stdout', 'Two.'),
		];
		const loaded = [
			...hydrated,
			native(2, 'user', 'continue'),
			native(3, 'stdout', 'One.'),
			native(4, 'user', 'continue'),
			native(5, 'stdout', 'Two.'),
		];
		expect(refresh(loaded, visible)!.added).toBe(0);
	});

	it('keeps disk order for an external turn written before the tab’s own send', () => {
		const visible = [
			...hydrated,
			local('u1', 0, 'user', 'Mine'),
			local('a1', 1, 'stdout', 'Reply to mine.'),
		];
		const loaded = [
			...hydrated,
			native(2, 'user', 'From the other app'),
			native(3, 'stdout', 'Reply elsewhere.'),
			native(4, 'user', 'Mine'),
			native(5, 'stdout', 'Reply to mine.'),
		];
		const merged = refresh(loaded, visible)!;
		expect(merged.added).toBe(2);
		expect(merged.logs.map((e) => e.id)).toEqual([
			'grok-msg-0',
			'grok-msg-1',
			'grok-msg-2',
			'grok-msg-3',
			'u1',
			'a1',
		]);
		expect(refresh(loaded, merged.logs)!.added).toBe(0);
	});

	it('appends an external turn written after a stopped live turn, without its tool twice', () => {
		const visible = [
			...hydrated,
			local('u1', 0, 'user', 'Run a long tool'),
			{
				...local('t1', 0, 'tool', 'run_command'),
				metadata: { toolState: { status: 'canceled' as const } },
			},
		];
		const loaded = [
			...hydrated,
			native(2, 'user', 'Run a long tool'),
			native(3, 'tool', 'run_command'),
			native(4, 'user', 'An external turn after Stop'),
			native(5, 'stdout', 'Idle refresh resumed after Stop.'),
		];
		const merged = refresh(loaded, visible)!;
		expect(merged.logs.map((e) => e.id)).toEqual([
			'grok-msg-0',
			'grok-msg-1',
			'u1',
			't1',
			'grok-msg-4',
			'grok-msg-5',
		]);
	});

	it('never pairs out of order: a later native copy cannot claim an earlier local entry', () => {
		// The tab shows "A" then "B" live; disk has "B" then "A" (two different
		// turns written elsewhere around them). Only "B" is in sequence after the
		// anchor for the first local, so "A" on disk comes after the pairing
		// with local "B" and is a new turn.
		const visible = [...hydrated, local('uA', 0, 'user', 'A'), local('uB', 1, 'user', 'B')];
		const loaded = [...hydrated, native(2, 'user', 'B'), native(3, 'user', 'A')];
		const merged = refresh(loaded, visible)!;
		expect(merged.added).toBe(1);
		expect(merged.logs.filter((e) => e.text === 'A')).toHaveLength(2);
		expect(merged.logs.filter((e) => e.text === 'B')).toHaveLength(1);
	});
});
