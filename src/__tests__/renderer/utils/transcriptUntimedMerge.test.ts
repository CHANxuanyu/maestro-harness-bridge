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
