/**
 * A prompt Maestro sent whose native copy the provider wrote LATE (a pre-turn
 * context compaction delayed it 132s in the observed case) must be shown once,
 * keep its local identity, and gain native provenance - without a wider clock
 * window or a global text dedup, so genuinely repeated prompts survive.
 *
 * Shape follows the observed transcript; texts are synthetic.
 */

import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../../renderer/types';
import { bindDelayedOwnSends, mergeNewerEntries } from '../../../renderer/utils/transcriptMessages';

const T0 = 1_792_710_208_331; // previous native reply
const SENT = 1_792_710_273_207; // Maestro sent the prompt
const COMPACTION_DELAY = 132_165; // native user message written this much later
const PROMPT = 'Shared continuation check: say progress, run one command, then recall the token.';

const nativeReplyBefore: LogEntry = {
	id: 'msg_prev_final',
	timestamp: T0,
	source: 'stdout',
	text: 'Other app continued; token is ginkgo-862.',
	nativeTranscript: { messageId: 'msg_prev_final', channel: 'final' },
};

const ownSend = (overrides: Partial<LogEntry> = {}): LogEntry => ({
	id: 'local-send',
	timestamp: SENT,
	source: 'user',
	text: PROMPT,
	images: [],
	delivered: true,
	...overrides,
});

/** What the tab streamed live for that turn. */
const liveTurn: LogEntry[] = [
	{
		id: 'live-progress',
		timestamp: SENT + 139_924,
		source: 'stdout',
		purpose: 'commentary',
		text: 'Starting shared continuation',
	},
	{
		id: 'tool-exec-inner',
		timestamp: SENT + 140_674,
		source: 'tool',
		text: 'shell',
		metadata: {
			toolState: {
				status: 'completed',
				input: { command: "/bin/zsh -lc 'printf TOOL_OK'" },
				output: 'TOOL_OK',
			},
		},
	},
	{
		id: 'live-reply',
		timestamp: SENT + 146_030,
		source: 'stdout',
		text: 'Continued here; token ginkgo-862.',
		turnModel: 'model-x',
		turnEffort: 'max',
	},
];

const nativeUser = (overrides: Partial<LogEntry> = {}): LogEntry => ({
	id: 'msg_native_user',
	timestamp: SENT + COMPACTION_DELAY,
	source: 'user',
	text: PROMPT,
	nativeTranscript: { messageId: 'msg_native_user' },
	...overrides,
});

/** What the native transcript holds for the same turn. */
const nativeTurn: LogEntry[] = [
	{
		id: 'msg_progress',
		timestamp: SENT + 139_924,
		source: 'stdout',
		text: 'Starting shared continuation',
		nativeTranscript: { messageId: 'msg_progress', channel: 'commentary' },
	},
	{
		// Code mode: the OUTER exec call that wrapped the inner shell command.
		id: 'call_outer_exec',
		timestamp: SENT + 140_589,
		source: 'tool',
		text: 'exec',
		metadata: {
			toolState: {
				status: 'completed',
				input: 'const r = await tools.exec_command({cmd:"printf TOOL_OK"}); text(r.output);',
				output: 'TOOL_OK',
			},
		},
		nativeTranscript: { messageId: 'call_outer_exec' },
	},
	{
		id: 'msg_final',
		timestamp: SENT + 146_030,
		source: 'stdout',
		text: 'Continued here; token ginkgo-862.',
		nativeTranscript: { messageId: 'msg_final', channel: 'final' },
	},
];

const loaded = (user: LogEntry = nativeUser()): LogEntry[] => [
	nativeReplyBefore,
	user,
	...nativeTurn,
];
const visibleLive = (send: LogEntry = ownSend()): LogEntry[] => [
	nativeReplyBefore,
	send,
	...liveTurn,
];

const users = (logs: LogEntry[]) => logs.filter((entry) => entry.source === 'user');

/** The refresh pipeline's order: bind, then merge. */
function refreshMerge(disk: LogEntry[], visible: LogEntry[]) {
	const own = bindDelayedOwnSends(disk, visible);
	const merged = mergeNewerEntries(disk, own.logs);
	return { own, merged };
}

describe('delayed native copy of an own send', () => {
	it('control: the merge alone shows the prompt twice when its native copy is 132s late', () => {
		const merged = mergeNewerEntries(loaded(), visibleLive())!;
		expect(users(merged.logs)).toHaveLength(2);
	});

	it('shows it once, keeping the local entry and gaining native provenance', () => {
		const { own, merged } = refreshMerge(loaded(), visibleLive());
		expect(own.bound).toBe(1);
		const prompt = users(merged!.logs);
		expect(prompt).toHaveLength(1);
		expect(prompt[0]).toMatchObject({
			id: 'local-send',
			timestamp: SENT,
			delivered: true,
			images: [],
			text: PROMPT,
			nativeTranscript: { messageId: 'msg_native_user' },
		});
	});

	it('leaves the turn’s tools and order exactly as the merge already showed them', () => {
		const before = mergeNewerEntries(loaded(), visibleLive())!.logs;
		const after = refreshMerge(loaded(), visibleLive()).merged!.logs;
		// Only the native duplicate of the prompt is gone.
		expect(after.map((e) => e.id)).toEqual(
			before.map((e) => e.id).filter((id) => id !== 'msg_native_user')
		);
		expect(after.map((e) => e.id)).toEqual([
			'msg_prev_final',
			'local-send',
			'live-progress',
			'call_outer_exec',
			'tool-exec-inner',
			'live-reply',
		]);
		// The outer exec and the inner shell are distinct calls; both keep input and output.
		const outer = after.find((e) => e.id === 'call_outer_exec')!;
		const inner = after.find((e) => e.id === 'tool-exec-inner')!;
		expect(outer.metadata?.toolState?.output).toBe('TOOL_OK');
		expect(inner.metadata?.toolState?.input).toEqual({
			command: "/bin/zsh -lc 'printf TOOL_OK'",
		});
		// The live reply keeps its turn settings.
		expect(after.find((e) => e.id === 'live-reply')).toMatchObject({
			turnModel: 'model-x',
			turnEffort: 'max',
		});
	});

	it('is idempotent: a second refresh changes nothing', () => {
		const first = refreshMerge(loaded(), visibleLive()).merged!.logs;
		const second = refreshMerge(loaded(), first);
		expect(second.own.bound).toBe(0);
		expect(second.own.logs).toBe(first);
		expect(second.merged).toEqual({ logs: first, added: 0 });
	});

	it('keeps the user’s images and send flags on the bound entry', () => {
		const send = ownSend({ images: ['maestro-image://store/abc.png'], readOnly: true });
		const prompt = users(refreshMerge(loaded(), visibleLive(send)).merged!.logs);
		expect(prompt).toHaveLength(1);
		expect(prompt[0]).toMatchObject({
			id: 'local-send',
			images: ['maestro-image://store/abc.png'],
			readOnly: true,
			delivered: true,
		});
	});
});

describe('repairing a duplicate an earlier refresh already cached', () => {
	/** The tab as the observed build left it: local + native copy of one prompt. */
	const cached = (): LogEntry[] => [
		nativeReplyBefore,
		ownSend(),
		nativeUser(),
		liveTurn[0],
		nativeTurn[1],
		liveTurn[1],
		liveTurn[2],
	];

	it('removes the cached native copy and binds the local send', () => {
		const { own, merged } = refreshMerge(loaded(), cached());
		expect(own.bound).toBe(1);
		expect(own.logs.map((e) => e.id)).toEqual([
			'msg_prev_final',
			'local-send',
			'live-progress',
			'call_outer_exec',
			'tool-exec-inner',
			'live-reply',
		]);
		expect(users(own.logs)[0].nativeTranscript).toEqual({ messageId: 'msg_native_user' });
		// Nothing is appended back.
		expect(merged!.added).toBe(0);
		expect(users(merged!.logs)).toHaveLength(1);
	});

	it('does not repair when another user message sits between the two copies', () => {
		const other: LogEntry = {
			id: 'local-other',
			timestamp: SENT + 60_000,
			source: 'user',
			text: 'Something else entirely',
			delivered: true,
		};
		const logs = [nativeReplyBefore, ownSend(), other, nativeUser(), ...liveTurn];
		const own = bindDelayedOwnSends(loaded(), logs);
		expect(own.bound).toBe(0);
		expect(own.logs).toBe(logs);
	});
});

describe('what must NOT be bound', () => {
	it('leaves an in-window send to the ordinary merge, unchanged', () => {
		const prompt = nativeUser({ timestamp: SENT + 2_000 });
		const own = bindDelayedOwnSends(loaded(prompt), visibleLive());
		expect(own.bound).toBe(0);
		expect(own.logs).toEqual(visibleLive());
		// The merge pairs it as before (one prompt, live turn's tools stand for the stored ones).
		const merged = mergeNewerEntries(loaded(prompt), own.logs)!;
		expect(users(merged.logs)).toHaveLength(1);
		expect(merged.logs.some((e) => e.id === 'call_outer_exec')).toBe(false);
	});

	it('keeps a later identical prompt sent from another app as its own turn', () => {
		// Maestro's send paired normally; an hour later the same words came from
		// the other app with a different answer.
		const later = SENT + 3_600_000;
		const disk: LogEntry[] = [
			nativeReplyBefore,
			nativeUser({ timestamp: SENT + 1_500 }),
			nativeTurn[2],
			{
				...nativeUser(),
				id: 'msg_external_user',
				timestamp: later,
				nativeTranscript: { messageId: 'msg_external_user' },
			},
			{
				id: 'msg_external_final',
				timestamp: later + 20_000,
				source: 'stdout',
				text: 'A different answer from the other app.',
				nativeTranscript: { messageId: 'msg_external_final', channel: 'final' },
			},
		];
		const visible = [nativeReplyBefore, ownSend(), liveTurn[2]];
		const { own, merged } = refreshMerge(disk, visible);
		expect(own.bound).toBe(0);
		const prompts = users(merged!.logs);
		expect(prompts.map((e) => e.id)).toEqual(['local-send', 'msg_external_user']);
	});

	it('does not claim an external identical prompt when its turn is not the one shown live', () => {
		// The own send never reached disk; the other app later sent the same words.
		const disk: LogEntry[] = [
			nativeReplyBefore,
			{
				...nativeUser(),
				id: 'msg_external_user',
				nativeTranscript: { messageId: 'msg_external_user' },
			},
			{
				id: 'msg_external_final',
				timestamp: SENT + COMPACTION_DELAY + 9_000,
				source: 'stdout',
				text: 'A different answer from the other app.',
				nativeTranscript: { messageId: 'msg_external_final', channel: 'final' },
			},
		];
		const visible = [nativeReplyBefore, ownSend(), liveTurn[2]];
		const { own, merged } = refreshMerge(disk, visible);
		expect(own.bound).toBe(0);
		expect(users(merged!.logs)).toHaveLength(2);
	});

	it('does not bind a user entry that was never delivered', () => {
		const own = bindDelayedOwnSends(loaded(), visibleLive(ownSend({ delivered: undefined })));
		expect(own.bound).toBe(0);
	});

	it('does not bind a native copy written BEFORE the send', () => {
		const own = bindDelayedOwnSends(
			loaded(nativeUser({ timestamp: SENT - COMPACTION_DELAY })),
			visibleLive()
		);
		expect(own.bound).toBe(0);
	});
});

describe('repeated identical prompts', () => {
	it('binds two delayed identical sends one-to-one to two distinct native messages', () => {
		const second = SENT + 600_000;
		const firstAnswer: LogEntry = { ...liveTurn[2], id: 'live-reply-1', text: 'First answer.' };
		const secondAnswer: LogEntry = {
			...liveTurn[2],
			id: 'live-reply-2',
			timestamp: second + 146_030,
			text: 'Second answer.',
		};
		const visible: LogEntry[] = [
			nativeReplyBefore,
			ownSend({ id: 'local-send-1' }),
			firstAnswer,
			ownSend({ id: 'local-send-2', timestamp: second }),
			secondAnswer,
		];
		const disk: LogEntry[] = [
			nativeReplyBefore,
			nativeUser({ id: 'msg_user_1', nativeTranscript: { messageId: 'msg_user_1' } }),
			{
				...nativeTurn[2],
				id: 'msg_final_1',
				text: 'First answer.',
				nativeTranscript: { messageId: 'msg_final_1' },
			},
			nativeUser({
				id: 'msg_user_2',
				timestamp: second + COMPACTION_DELAY,
				nativeTranscript: { messageId: 'msg_user_2' },
			}),
			{
				...nativeTurn[2],
				id: 'msg_final_2',
				timestamp: second + 146_030,
				text: 'Second answer.',
				nativeTranscript: { messageId: 'msg_final_2' },
			},
		];
		const { own, merged } = refreshMerge(disk, visible);
		expect(own.bound).toBe(2);
		const prompts = users(merged!.logs);
		expect(prompts.map((e) => [e.id, e.nativeTranscript?.messageId])).toEqual([
			['local-send-1', 'msg_user_1'],
			['local-send-2', 'msg_user_2'],
		]);
	});

	it('binds a delayed send even when the previous turn was an ordinary in-window Maestro turn', () => {
		const second = SENT + 600_000;
		const visible: LogEntry[] = [
			nativeReplyBefore,
			ownSend({ id: 'local-send-1' }),
			{ ...liveTurn[2], id: 'live-reply-1', text: 'First answer.' },
			ownSend({ id: 'local-send-2', timestamp: second }),
			{ ...liveTurn[2], id: 'live-reply-2', timestamp: second + 146_030, text: 'Second answer.' },
		];
		const disk: LogEntry[] = [
			nativeReplyBefore,
			nativeUser({
				id: 'msg_user_1',
				timestamp: SENT + 1_200,
				nativeTranscript: { messageId: 'msg_user_1' },
			}),
			{
				...nativeTurn[2],
				id: 'msg_final_1',
				text: 'First answer.',
				nativeTranscript: { messageId: 'msg_final_1' },
			},
			nativeUser({
				id: 'msg_user_2',
				timestamp: second + COMPACTION_DELAY,
				nativeTranscript: { messageId: 'msg_user_2' },
			}),
			{
				...nativeTurn[2],
				id: 'msg_final_2',
				timestamp: second + 146_030,
				text: 'Second answer.',
				nativeTranscript: { messageId: 'msg_final_2' },
			},
		];
		const { own, merged } = refreshMerge(disk, visible);
		// Only the delayed one needs (and gets) a binding.
		expect(own.bound).toBe(1);
		expect(users(merged!.logs).map((e) => e.id)).toEqual(['local-send-1', 'local-send-2']);
	});
});
