/**
 * Another Codex thread's message delivered into this one (the official app's
 * `send_message_to_thread`) starts a NEW turn without a user row. After a turn
 * Maestro ran and the user stopped, the merge kept treating everything up to
 * the next user row as that live turn, so the other app's continuation and its
 * reply were never shown. Shape follows the observed recovery refresh; texts
 * are synthetic.
 */

import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../../renderer/types';
import {
	bindDelayedOwnSends,
	isInboundThreadMessage,
	mergeNewerEntries,
} from '../../../renderer/utils/transcriptMessages';

const T = 1_792_710_413_796;

const envelope = (input: string, source = '22222222-3333-4444-8555-666666666666') =>
	`<codex_delegation>\n  <source_thread_id>${source}</source_thread_id>\n  <input>${input}</input>\n</codex_delegation>`;

const inbound = (overrides: Partial<LogEntry> = {}): LogEntry => ({
	id: 'codex-msg-3435',
	timestamp: T + 402_676,
	source: 'tool',
	text: 'send_message_to_thread',
	metadata: {
		toolState: {
			status: 'completed',
			output: envelope('Recovery check after the stop: reply and recall the token.'),
		},
	},
	nativeTranscript: { messageId: 'codex-msg-3435' },
	...overrides,
});

const externalReply: LogEntry = {
	id: 'msg_external_final',
	timestamp: T + 410_321,
	source: 'stdout',
	text: 'Recovered after the stop; token ginkgo-862; the previous turn was stopped by the user.',
	nativeTranscript: { messageId: 'msg_external_final', channel: 'final' },
};

const STOP_PROMPT = 'Shared stop check: say progress, run sleep 45 once; I will stop it.';

/** The shared native exec card the tab already holds (the merge's anchor). */
const sharedExec: LogEntry = {
	id: 'call_shared_exec',
	timestamp: T,
	source: 'tool',
	text: 'exec',
	metadata: {
		toolState: { status: 'completed', input: 'printf OK', output: 'Script completed\nOK' },
	},
	nativeTranscript: { messageId: 'call_shared_exec' },
};

/** What the tab shows: the end of the previous turn, then the stopped turn, live. */
const visible = (): LogEntry[] => [
	sharedExec,
	{
		id: 'tool-exec-inner',
		timestamp: T + 85,
		source: 'tool',
		text: 'shell',
		metadata: {
			toolState: {
				status: 'completed',
				input: { command: "/bin/zsh -lc 'printf OK'" },
				output: 'OK',
			},
		},
	},
	{
		id: 'live-reply-prev',
		timestamp: T + 5_441,
		source: 'stdout',
		text: 'Maestro side continued.',
	},
	{
		id: 'local-stop-prompt',
		timestamp: T + 190_414,
		source: 'user',
		text: STOP_PROMPT,
		images: [],
	},
	{
		id: 'live-progress',
		timestamp: T + 194_680,
		source: 'stdout',
		purpose: 'commentary',
		text: 'Shared stop wait starts',
	},
	{
		id: 'tool-exec-sleep',
		timestamp: T + 195_457,
		source: 'tool',
		text: 'shell',
		metadata: {
			toolState: { status: 'canceled', input: { command: "/bin/zsh -lc 'sleep 45'" } },
		},
	},
	{ id: 'local-stopped', timestamp: T + 228_700, source: 'system', text: 'Canceled by user' },
];

/** What the native read returns after the other app continued the same thread. */
const loaded = (boundary: LogEntry = inbound()): LogEntry[] => [
	sharedExec,
	{
		id: 'msg_prev_final',
		timestamp: T + 5_409,
		source: 'stdout',
		text: 'Maestro side continued.',
		nativeTranscript: { messageId: 'msg_prev_final', channel: 'final' },
	},
	{
		id: 'msg_stop_prompt',
		timestamp: T + 190_742,
		source: 'user',
		text: STOP_PROMPT,
		nativeTranscript: { messageId: 'msg_stop_prompt' },
	},
	{
		id: 'msg_stop_progress',
		timestamp: T + 194_678,
		source: 'stdout',
		text: 'Shared stop wait starts',
		nativeTranscript: { messageId: 'msg_stop_progress', channel: 'commentary' },
	},
	{
		id: 'call_sleep',
		timestamp: T + 195_281,
		source: 'tool',
		text: 'exec',
		metadata: {
			toolState: {
				status: 'completed',
				input: 'const r = await tools.exec_command({cmd:"sleep 45"}); text(r);',
				output: 'Script completed\nWall time 1.2 seconds',
			},
		},
		nativeTranscript: { messageId: 'call_sleep' },
	},
	{
		id: 'call_wait',
		timestamp: T + 201_242,
		source: 'tool',
		text: 'exec',
		metadata: {
			toolState: {
				status: 'canceled',
				input: 'const r = await tools.write_stdin({session_id:1,chars:""}); text(r);',
				output: 'aborted by user after 27.5s',
			},
		},
		nativeTranscript: { messageId: 'call_wait' },
	},
	boundary,
	externalReply,
];

describe('isInboundThreadMessage', () => {
	it('recognises a stored delivery: tool card, no input, whole output is the envelope', () => {
		expect(isInboundThreadMessage(inbound())).toBe(true);
	});

	it('recognises an envelope capped for storage', () => {
		const capped = `${envelope('x'.repeat(50)).slice(0, 120)}\n... [tool output truncated, 9000 chars total]`;
		expect(
			isInboundThreadMessage(
				inbound({ metadata: { toolState: { status: 'completed', output: capped } } })
			)
		).toBe(true);
	});

	it('refuses anything without the full structure', () => {
		// A live card is the tab's own turn.
		expect(isInboundThreadMessage(inbound({ nativeTranscript: undefined }))).toBe(false);
		// An OUTBOUND call this thread made carries its arguments.
		expect(
			isInboundThreadMessage(
				inbound({
					metadata: {
						toolState: {
							status: 'completed',
							input: { thread_id: 'other', message: 'hi' },
							output: envelope('hi'),
						},
					},
				})
			)
		).toBe(false);
		// Another tool that merely printed the envelope.
		expect(isInboundThreadMessage(inbound({ text: 'exec' }))).toBe(false);
		// Prose around the envelope, or an envelope without its parts.
		expect(
			isInboundThreadMessage(
				inbound({
					metadata: {
						toolState: { status: 'completed', output: `${envelope('hi')}\nand then more` },
					},
				})
			)
		).toBe(false);
		expect(
			isInboundThreadMessage(
				inbound({
					metadata: {
						toolState: {
							status: 'completed',
							output: '<codex_delegation><input>hi</input></codex_delegation>',
						},
					},
				})
			)
		).toBe(false);
		// Not a tool card at all.
		expect(
			isInboundThreadMessage({ ...inbound(), source: 'stdout', text: envelope('hi') } as LogEntry)
		).toBe(false);
	});
});

describe('merging a turn another thread delivered after a stopped live turn', () => {
	it('appends the delivery and its reply, at the end, and nothing of the live turn', () => {
		const merged = mergeNewerEntries(loaded(), visible())!;
		expect(merged.added).toBe(2);
		expect(merged.logs.map((e) => e.id)).toEqual([
			...visible().map((e) => e.id),
			'codex-msg-3435',
			'msg_external_final',
		]);
		// The stopped turn's stored calls stay hidden behind its own live cards.
		expect(merged.logs.some((e) => e.id === 'call_sleep' || e.id === 'call_wait')).toBe(false);
		// The prompt is not duplicated.
		expect(merged.logs.filter((e) => e.source === 'user')).toHaveLength(1);
	});

	it('is idempotent', () => {
		const first = mergeNewerEntries(loaded(), visible())!.logs;
		expect(mergeNewerEntries(loaded(), first)).toEqual({ logs: first, added: 0 });
	});

	it('shows the other thread’s full turn: progress, tools and the reply', () => {
		const externalProgress: LogEntry = {
			id: 'msg_external_progress',
			timestamp: T + 404_000,
			source: 'stdout',
			text: 'Checking from the other app',
			nativeTranscript: { messageId: 'msg_external_progress', channel: 'commentary' },
		};
		const externalTool: LogEntry = {
			id: 'call_external',
			timestamp: T + 405_000,
			source: 'tool',
			text: 'exec',
			metadata: { toolState: { status: 'completed', input: 'pwd', output: '/repo' } },
			nativeTranscript: { messageId: 'call_external' },
		};
		const disk = [...loaded().slice(0, -1), externalProgress, externalTool, externalReply];
		const merged = mergeNewerEntries(disk, visible())!;
		expect(merged.logs.slice(-4).map((e) => e.id)).toEqual([
			'codex-msg-3435',
			'msg_external_progress',
			'call_external',
			'msg_external_final',
		]);
	});

	it('keeps two deliveries with identical words as two native turns', () => {
		const second = inbound({
			id: 'codex-msg-3440',
			timestamp: T + 500_000,
			nativeTranscript: { messageId: 'codex-msg-3440' },
		});
		const secondReply: LogEntry = {
			...externalReply,
			id: 'msg_external_final_2',
			timestamp: T + 508_000,
			nativeTranscript: { messageId: 'msg_external_final_2', channel: 'final' },
		};
		const disk = [...loaded(), second, secondReply];
		const merged = mergeNewerEntries(disk, visible())!;
		expect(merged.added).toBe(4);
		expect(merged.logs.slice(-4).map((e) => e.id)).toEqual([
			'codex-msg-3435',
			'msg_external_final',
			'codex-msg-3440',
			'msg_external_final_2',
		]);
	});
});

describe('tool output that only LOOKS like a delivery is not a boundary', () => {
	it('an exec whose output printed the envelope stays part of the live turn', () => {
		const printed: LogEntry = {
			...inbound(),
			id: 'call_printed',
			text: 'exec',
			metadata: {
				toolState: { status: 'completed', input: 'cat delegation.xml', output: envelope('hi') },
			},
			nativeTranscript: { messageId: 'call_printed' },
		};
		const merged = mergeNewerEntries(loaded(printed), visible())!;
		// Exactly the existing behavior: the live turn's stored content stays hidden.
		expect(merged.added).toBe(0);
	});

	it('an outbound send_message_to_thread call stays part of the live turn', () => {
		const outbound = inbound({
			id: 'call_outbound',
			metadata: {
				toolState: {
					status: 'completed',
					input: { thread_id: 'other-thread', message: 'ping' },
					output: envelope('ping'),
				},
			},
			nativeTranscript: { messageId: 'call_outbound' },
		});
		expect(mergeNewerEntries(loaded(outbound), visible())!.added).toBe(0);
	});
});

describe('the delayed-own-send binder respects the same boundary', () => {
	const PROMPT = 'Delayed check after a delivery.';
	const send: LogEntry = {
		id: 'local-send',
		timestamp: T + 300_000,
		source: 'user',
		text: PROMPT,
		images: [],
		delivered: true,
	};
	const liveAnswer: LogEntry = {
		id: 'live-answer',
		timestamp: T + 450_000,
		source: 'stdout',
		text: 'Delayed answer.',
	};

	it('does not pair a send across another thread’s message', () => {
		// Native order: the other thread's turn, THEN a user message with the
		// send's words. The binder refuses rather than guess across that turn.
		const disk: LogEntry[] = [
			sharedExec,
			inbound({ timestamp: T + 310_000 }),
			{ ...externalReply, timestamp: T + 320_000 },
			{
				id: 'msg_native_user',
				timestamp: T + 440_000,
				source: 'user',
				text: PROMPT,
				nativeTranscript: { messageId: 'msg_native_user' },
			},
			{
				id: 'msg_answer',
				timestamp: T + 450_000,
				source: 'stdout',
				text: 'Delayed answer.',
				nativeTranscript: { messageId: 'msg_answer', channel: 'final' },
			},
		];
		const shown = [sharedExec, send, liveAnswer];
		const own = bindDelayedOwnSends(disk, shown);
		expect(own.bound).toBe(0);
		expect(own.logs).toBe(shown);
	});

	it('binds an own send to its first native copy and keeps a later identical external turn', () => {
		// Identical prompt AND identical answer from the other app inside the
		// reply window: order decides, and the external turn keeps both entries.
		const disk: LogEntry[] = [
			sharedExec,
			{
				id: 'msg_own_user',
				timestamp: T + 432_000,
				source: 'user',
				text: PROMPT,
				nativeTranscript: { messageId: 'msg_own_user' },
			},
			{
				id: 'msg_own_answer',
				timestamp: T + 450_000,
				source: 'stdout',
				text: 'Delayed answer.',
				nativeTranscript: { messageId: 'msg_own_answer', channel: 'final' },
			},
			{
				id: 'msg_external_user',
				timestamp: T + 500_000,
				source: 'user',
				text: PROMPT,
				nativeTranscript: { messageId: 'msg_external_user' },
			},
			{
				id: 'msg_external_answer',
				timestamp: T + 510_000,
				source: 'stdout',
				text: 'Delayed answer.',
				nativeTranscript: { messageId: 'msg_external_answer', channel: 'final' },
			},
		];
		const own = bindDelayedOwnSends(disk, [sharedExec, send, liveAnswer]);
		expect(own.bound).toBe(1);
		expect(own.logs[1].nativeTranscript).toEqual({ messageId: 'msg_own_user' });
		const merged = mergeNewerEntries(disk, own.logs)!;
		expect(merged.logs.map((e) => e.id)).toEqual([
			'call_shared_exec',
			'local-send',
			'live-answer',
			'msg_external_user',
			'msg_external_answer',
		]);
	});
});
