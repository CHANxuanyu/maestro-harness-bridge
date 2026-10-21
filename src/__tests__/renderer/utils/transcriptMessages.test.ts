/**
 * Tests for the transcript message helpers that back scroll-to-top history
 * loading (issue #1407).
 *
 * `selectOlderEntries` is the load-bearing piece: it decides where a freshly
 * read transcript window overlaps what the tab already shows. Getting it wrong
 * either duplicates the visible conversation or silently drops history, so the
 * cases below cover both id-matched tabs (hydrated from disk) and text-matched
 * tabs (ran live, then survived a restart with locally generated ids).
 */

import { describe, it, expect } from 'vitest';
import type { LogEntry } from '../../../renderer/types';
import {
	isSynopsisRequest,
	mergeNewerEntries,
	selectOlderEntries,
	stripSynopsisTurns,
	transcriptMessagesToLogEntries,
	type TranscriptMessage,
} from '../../../renderer/utils/transcriptMessages';
import { embedSystemPromptInPrompt } from '../../../shared/embeddedSystemPrompt';

function entry(id: string, text: string, source: LogEntry['source'] = 'user', ts = 0): LogEntry {
	return { id, text, source, timestamp: ts };
}

function message(overrides: Partial<TranscriptMessage> = {}): TranscriptMessage {
	return {
		type: 'user',
		content: 'hello',
		timestamp: '2026-01-01T00:00:00.000Z',
		uuid: 'uuid-1',
		...overrides,
	};
}

describe('transcriptMessagesToLogEntries', () => {
	it('keeps messages with text and maps user vs assistant to log sources', () => {
		const entries = transcriptMessagesToLogEntries([
			message({ uuid: 'a', type: 'user', content: 'question' }),
			message({ uuid: 'b', type: 'assistant', content: 'answer' }),
		]);

		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({ id: 'a', text: 'question', source: 'user' });
		expect(entries[1]).toMatchObject({ id: 'b', text: 'answer', source: 'stdout' });
	});

	it('drops tool-only messages but keeps image-only ones', () => {
		const entries = transcriptMessagesToLogEntries([
			message({ uuid: 'tool', content: '   ' }),
			message({ uuid: 'img', content: '', images: ['data:image/png;base64,AAA'] }),
		]);

		expect(entries.map((e) => e.id)).toEqual(['img']);
		expect(entries[0].images).toEqual(['data:image/png;base64,AAA']);
	});

	// Issue #1533: every provider but Claude Code takes Maestro's system prompt
	// embedded in the first user turn, and that turn is what lands on disk. A
	// hydrated tab used to render the whole envelope as if the user had typed it.
	it('unwraps the embedded system prompt from a hydrated user turn', () => {
		const wrapped = embedSystemPromptInPrompt(
			'# Maestro System Context\n\nYou are **Scout**, working in /repo.',
			'run the test suite'
		);

		const entries = transcriptMessagesToLogEntries([
			message({ uuid: 'u', type: 'user', content: wrapped }),
		]);

		expect(entries[0].text).toBe('run the test suite');
		expect(entries[0].text).not.toContain('Maestro System Context');
	});

	it('drops a turn that carried nothing but the envelope', () => {
		const entries = transcriptMessagesToLogEntries([
			message({ uuid: 'sys', type: 'user', content: embedSystemPromptInPrompt('# Context', '') }),
			message({ uuid: 'a', type: 'assistant', content: 'done' }),
		]);

		expect(entries.map((e) => e.id)).toEqual(['a']);
	});

	it('leaves an assistant message that quotes the marker alone', () => {
		// Only a user turn is ever wrapped, and an agent explaining the format
		// must not have its answer truncated.
		const quoted = 'The spawn path sends:\n\n---\n\n# User Request\n\n<your prompt>';
		const entries = transcriptMessagesToLogEntries([
			message({ uuid: 'a', type: 'assistant', content: quoted }),
		]);

		expect(entries[0].text).toBe(quoted);
	});

	// The backfill matches a hydrated entry against what the live tab logged to
	// find its splice point, and a live tab logs the CLEAN prompt. Unwrapping is
	// what lets those two texts line up at all.
	it('produces a first turn that matches the entry a live tab logged', () => {
		const wrapped = embedSystemPromptInPrompt('# Maestro System Context', 'fix the flaky test');
		const loaded = transcriptMessagesToLogEntries([
			message({ uuid: 'disk-1', type: 'user', content: wrapped }),
			message({ uuid: 'disk-2', type: 'assistant', content: 'on it' }),
		]);

		const visible = [entry('live-2', 'on it', 'stdout')];
		expect(selectOlderEntries(loaded, visible).map((e) => e.text)).toEqual(['fix the flaky test']);
	});
});

describe('stripSynopsisTurns', () => {
	it('removes the Auto Run synopsis request and the reply that follows it', () => {
		const kept = stripSynopsisTurns([
			message({ uuid: 'a', content: 'real question' }),
			message({
				uuid: 'b',
				content: 'Give a brief synopsis of what you just accomplished',
			}),
			message({ uuid: 'c', type: 'assistant', content: '**Summary:** did things' }),
			message({ uuid: 'd', type: 'assistant', content: 'real answer' }),
		]);

		expect(kept.map((m) => m.uuid)).toEqual(['a', 'd']);
	});

	it('only treats user turns as synopsis requests', () => {
		expect(
			isSynopsisRequest({
				type: 'assistant',
				content: 'Give a brief synopsis of what you just accomplished',
			})
		).toBe(false);
	});
});

describe('selectOlderEntries', () => {
	it('returns everything when the tab is empty', () => {
		const loaded = [entry('1', 'a'), entry('2', 'b')];
		expect(selectOlderEntries(loaded, [])).toEqual(loaded);
	});

	it('prepends only what sits above the first visible entry, matched by id', () => {
		const loaded = [entry('1', 'a'), entry('2', 'b'), entry('3', 'c'), entry('4', 'd')];
		const visible = [entry('3', 'c'), entry('4', 'd')];

		expect(selectOlderEntries(loaded, visible).map((e) => e.id)).toEqual(['1', '2']);
	});

	it('falls back to source+text when the tab holds locally generated ids', () => {
		// The restart path: same conversation, but the visible entries were built
		// live so their ids do not match the on-disk uuids.
		const loaded = [entry('u1', 'a'), entry('u2', 'b'), entry('u3', 'c')];
		const visible = [entry('local-x', 'c'), entry('local-y', 'd')];

		expect(selectOlderEntries(loaded, visible).map((e) => e.text)).toEqual(['a', 'b']);
	});

	it('returns nothing when the visible tab already starts at the first message', () => {
		const loaded = [entry('1', 'a'), entry('2', 'b')];
		const visible = [entry('1', 'a'), entry('2', 'b')];

		expect(selectOlderEntries(loaded, visible)).toEqual([]);
	});

	it('picks the boundary nearest the expected splice point when text repeats', () => {
		// "continue" appears three times. The window is 6 long and the tab shows the
		// newest 3, so the real boundary is index 3 - not the first or last match.
		const loaded = [
			entry('1', 'continue'),
			entry('2', 'work'),
			entry('3', 'continue'),
			entry('4', 'continue'),
			entry('5', 'more'),
			entry('6', 'done'),
		];
		const visible = [entry('x', 'continue'), entry('y', 'more'), entry('z', 'done')];

		expect(selectOlderEntries(loaded, visible).map((e) => e.id)).toEqual(['1', '2', '3']);
	});

	// The expected splice point is only an estimate: it is off by however many
	// renderer-only entries the tab holds (system notices, outage markers). Push
	// that estimate past one repetition of a repeated message and the NEAREST
	// source+text hit is the wrong occurrence, which silently drops the genuine
	// older turns between the two. A match needs corroboration, not just proximity.
	it('prefers the occurrence whose timestamp matches over a nearer text-only hit', () => {
		const loaded = [
			entry('1', 'start', 'user', 0),
			entry('2', 'continue', 'user', 100),
			entry('3', 'work', 'user', 200),
			entry('4', 'continue', 'user', 300),
			entry('5', 'more', 'user', 400),
			entry('6', 'done', 'user', 500),
		];
		// Tab was hydrated from disk (timestamps survive) but holds two
		// renderer-only notices, so expected lands on index 1 - the WRONG
		// "continue". The timestamp pins the real boundary at index 3.
		const visible = [
			entry('local-a', 'continue', 'user', 300),
			entry('sys-1', 'Agent reconnected', 'system', 310),
			entry('sys-2', 'Retrying', 'system', 320),
			entry('local-b', 'more', 'user', 400),
			entry('local-c', 'done', 'user', 500),
		];

		expect(selectOlderEntries(loaded, visible).map((e) => e.id)).toEqual(['1', '2', '3']);
	});

	it('prefers the occurrence whose following entry also lines up', () => {
		const loaded = [
			entry('1', 'start', 'user', 0),
			entry('2', 'continue', 'user', 100),
			entry('3', 'work', 'user', 200),
			entry('4', 'continue', 'user', 300),
			entry('5', 'more', 'user', 400),
			entry('6', 'done', 'user', 500),
		];
		// The restart path: local ids AND renderer clock timestamps, so neither id
		// nor timestamp can pick between the two "continue" entries. The entry that
		// FOLLOWS the boundary is what breaks the tie.
		const visible = [
			entry('local-a', 'continue', 'user', 9001),
			entry('local-b', 'more', 'user', 9002),
			entry('local-c', 'done', 'user', 9003),
			entry('sys-1', 'Agent reconnected', 'system', 9004),
			entry('sys-2', 'Retrying', 'system', 9005),
		];

		expect(selectOlderEntries(loaded, visible).map((e) => e.id)).toEqual(['1', '2', '3']);
	});

	it('still takes the nearest match when nothing corroborates either occurrence', () => {
		// No timestamps, no usable next entry: fall back to proximity, which is the
		// best guess available and the behavior every non-repeating case relies on.
		const loaded = [entry('1', 'continue'), entry('2', 'work'), entry('3', 'continue')];
		const visible = [entry('local-a', 'continue')];

		expect(selectOlderEntries(loaded, visible).map((e) => e.id)).toEqual(['1', '2']);
	});

	it('cuts on timestamp when the boundary entry never reached disk', () => {
		// Maestro-injected system notices live only in the tab, so there is nothing
		// on disk to match. Anything strictly older than it is still safe to prepend.
		const loaded = [entry('1', 'a', 'user', 100), entry('2', 'b', 'user', 300)];
		const visible = [entry('sys', 'Agent reconnected', 'system', 200)];

		expect(selectOlderEntries(loaded, visible).map((e) => e.id)).toEqual(['1']);
	});
});

describe('mergeNewerEntries', () => {
	const ids = (logs: LogEntry[] | undefined) => (logs ?? []).map((e) => e.id);

	it('appends what the native transcript gained, keeping earlier history and local errors', () => {
		// The tab was hydrated from disk (ids match), backfilled with older turns
		// the newest window no longer covers, and ends in local-only error cards.
		const visible = [
			entry('old-1', 'very old question', 'user', 1),
			entry('n1', 'question', 'user', 10),
			entry('n2', 'answer', 'stdout', 20),
			entry('err', 'Provider busy', 'error', 30),
		];
		const loaded = [
			entry('n1', 'question', 'user', 10),
			entry('n2', 'answer', 'stdout', 20),
			entry('n3', 'tonight question', 'user', 1000),
			entry('n4', 'tonight answer', 'stdout', 1001),
		];

		const merged = mergeNewerEntries(loaded, visible);

		expect(merged?.added).toBe(2);
		expect(ids(merged?.logs)).toEqual(['old-1', 'n1', 'n2', 'err', 'n3', 'n4']);
	});

	it('interleaves new disk entries with a local tail by time', () => {
		const visible = [entry('n1', 'q', 'user', 10), entry('failed', 'unsent', 'user', 50)];
		const loaded = [
			entry('n1', 'q', 'user', 10),
			entry('n2', 'external', 'stdout', 40),
			entry('n3', 'later', 'stdout', 60),
		];
		expect(ids(mergeNewerEntries(loaded, visible)?.logs)).toEqual(['n1', 'n2', 'failed', 'n3']);
	});

	it('is idempotent: a second refresh with the same window adds nothing', () => {
		const visible = [entry('n1', 'q', 'user', 10)];
		const loaded = [entry('n1', 'q', 'user', 10), entry('n2', 'a', 'stdout', 20)];
		const first = mergeNewerEntries(loaded, visible)!;
		const second = mergeNewerEntries(loaded, first.logs)!;
		expect(second.added).toBe(0);
		expect(second.logs).toBe(first.logs);
	});

	it('does not duplicate a reply Maestro sent live that the provider wrote with its own id', () => {
		// Live tab: local ids and renderer timestamps for both turns.
		const visible = [
			entry('local-q1', 'first', 'user', 11),
			entry('local-a1', 'first answer', 'stdout', 21),
			entry('local-q2', 'second', 'user', 31),
		];
		const loaded = [
			entry('u1', 'first', 'user', 10),
			entry('u2', 'first answer', 'stdout', 20),
			entry('u3', 'second', 'user', 30),
			entry('u4', 'second answer', 'stdout', 40),
		];
		const merged = mergeNewerEntries(loaded, visible)!;
		expect(ids(merged.logs)).toEqual(['local-q1', 'local-a1', 'local-q2', 'u4']);
		expect(mergeNewerEntries(loaded, merged.logs)!.added).toBe(0);
	});

	it('keeps an unsent local message that repeats text already on disk only once', () => {
		// The anchor is "first answer"; the disk then has "retry" once, and the tab
		// has two local "retry" entries (one delivered, one that failed locally).
		const visible = [
			entry('a1', 'first answer', 'stdout', 20),
			entry('local-1', 'retry', 'user', 31),
			entry('local-2', 'retry', 'user', 32),
		];
		const loaded = [entry('a1', 'first answer', 'stdout', 20), entry('u9', 'retry', 'user', 30)];
		const merged = mergeNewerEntries(loaded, visible)!;
		expect(merged.added).toBe(0);
		expect(ids(merged.logs)).toEqual(['a1', 'local-1', 'local-2']);
	});

	it('appends a genuine external repetition of a short message sent long before', () => {
		const hour = 60 * 60_000;
		// A local "continue" failed this afternoon and never reached disk; the
		// user typed "continue" again tonight in the provider's own app.
		const visible = [
			entry('n1', 'question', 'user', 10),
			entry('local-failed', 'continue', 'user', 20),
		];
		const loaded = [
			entry('n1', 'question', 'user', 10),
			entry('n2', 'continue', 'user', 20 + 5 * hour),
			entry('n3', 'continuing', 'stdout', 21 + 5 * hour),
		];
		const merged = mergeNewerEntries(loaded, visible)!;
		expect(ids(merged.logs)).toEqual(['n1', 'local-failed', 'n2', 'n3']);
	});

	it('does not anchor a live tab on a later repetition of its last turn, so the caller widens', () => {
		const at = (hhmm: string) => Date.parse(`2026-10-16T${hhmm}:00Z`);
		// Live tab: renderer ids, ending in "continue" / "OK" this afternoon.
		const visible = [
			entry('local-q', 'continue', 'user', at('13:00')),
			entry('local-a', 'OK', 'stdout', at('13:01')),
		];
		// The newest window only reaches back to tonight's identical exchange.
		const newestWindow = [
			entry('d5', 'continue', 'user', at('16:00')),
			entry('d6', 'OK', 'stdout', at('16:01')),
			entry('d7', 'newest', 'user', at('16:02')),
		];
		expect(mergeNewerEntries(newestWindow, visible)).toBeNull();

		// The widened window holds the real afternoon turns: splice there, gap-free.
		const widened = [
			entry('d1', 'continue', 'user', at('13:00') + 2_000),
			entry('d2', 'OK', 'stdout', at('13:01') + 40_000),
			entry('d3', 'external question', 'user', at('14:00')),
			entry('d4', 'external answer', 'stdout', at('14:01')),
			...newestWindow,
		];
		const merged = mergeNewerEntries(widened, visible)!;
		expect(ids(merged.logs)).toEqual(['local-q', 'local-a', 'd3', 'd4', 'd5', 'd6', 'd7']);
	});

	it('treats a user send minutes later as a new turn, but still dedups a slow streamed reply', () => {
		const t0 = Date.parse('2026-10-16T13:00:00Z');
		const visible = [
			entry('n1', 'question', 'user', t0),
			entry('local-a', 'long answer', 'stdout', t0 + 1_000),
			entry('local-failed', 'continue', 'user', t0 + 10_000),
		];
		const loaded = [
			entry('n1', 'question', 'user', t0),
			// The reply finished streaming four minutes after its first chunk.
			entry('d-a', 'long answer', 'stdout', t0 + 4 * 60_000),
			// "continue" typed again in the other app two minutes after the local
			// one failed: a genuine turn, not the failed send.
			entry('d-c', 'continue', 'user', t0 + 10_000 + 2 * 60_000),
		];
		const merged = mergeNewerEntries(loaded, visible)!;
		expect(ids(merged.logs)).toEqual(['n1', 'local-a', 'local-failed', 'd-c']);
	});

	it('never treats two different image-only turns as the same message', () => {
		const localShot: LogEntry = {
			id: 'local-img',
			text: '',
			source: 'user',
			timestamp: 50,
			images: ['data:image/png;base64,AAA'],
		};
		const diskShot: LogEntry = {
			id: 'disk-img',
			text: '',
			source: 'user',
			timestamp: 60,
			images: ['data:image/png;base64,BBB'],
		};
		const merged = mergeNewerEntries(
			[entry('n1', 'q', 'user', 10), diskShot],
			[entry('n1', 'q', 'user', 10), localShot]
		)!;
		expect(ids(merged.logs)).toEqual(['n1', 'local-img', 'disk-img']);
		// With nothing else to line up on, a textless entry is no anchor at all.
		expect(mergeNewerEntries([diskShot], [localShot])).toBeNull();
	});

	it('returns null instead of guessing when the window shares nothing with the tab', () => {
		const visible = [entry('x', 'tab only', 'user', 5)];
		const loaded = [entry('n9', 'something else', 'user', 900)];
		expect(mergeNewerEntries(loaded, visible)).toBeNull();
	});
});
