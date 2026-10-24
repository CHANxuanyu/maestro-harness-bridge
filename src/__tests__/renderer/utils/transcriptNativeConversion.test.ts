/**
 * Native transcript fidelity: tool calls as real tool cards, provider channels,
 * Claude's mixed text + tool_use messages, internal app-shell envelopes, and
 * the in-place upgrade of tabs an older build cached with tool calls as text.
 */

import { describe, it, expect } from 'vitest';
import type { LogEntry } from '../../../renderer/types';
import {
	hasLegacyTranscriptEntries,
	isInternalDesktopEnvelope,
	isProgressNoteEntry,
	mergeNewerEntries,
	reconcileTranscriptEntries,
	selectOlderEntries,
	transcriptMessagesToLogEntries,
	type TranscriptMessage,
} from '../../../renderer/utils/transcriptMessages';
import { collapseAiResponseLogs } from '../../../renderer/components/TerminalOutput/utils/collapseAiResponseLogs';
import { computeTurnDurations } from '../../../renderer/components/TerminalOutput/utils/turnDurations';
import {
	foldNativeToolRuns,
	toolRunStatus,
} from '../../../renderer/components/TerminalOutput/utils/foldNativeToolRuns';
import { applyExitThinkingPolicy } from '../../../renderer/hooks/agent/internal/helpers/exitTabCleanup';
import { canAppendToLogEntry } from '../../../renderer/utils/logEntries';
import { setShowThinkingFields } from '../../../renderer/utils/tabHelpers/focusFields';

const T0 = '2026-10-19T09:00:00.000Z';
const T1 = '2026-10-19T09:00:05.000Z';
const T2 = '2026-10-19T09:00:10.000Z';
const T3 = '2026-10-19T09:00:20.000Z';
const T4 = '2026-10-19T09:00:30.000Z';

function m(
	uuid: string,
	type: string,
	content: string,
	timestamp: string,
	extra: Partial<TranscriptMessage> = {}
): TranscriptMessage {
	return { uuid, type, role: type === 'user' ? 'user' : 'assistant', content, timestamp, ...extra };
}

/** One Codex turn: question, progress note, a tool call with its result, the answer. */
const CODEX_TURN: TranscriptMessage[] = [
	m('u1', 'user', 'Find the OpenCode subscription docs', T0),
	m('c1', 'assistant', 'Looking through the provider docs first.', T1, { channel: 'commentary' }),
	m('call_1', 'assistant', 'Tool: exec_command', T2, {
		toolUse: [
			{
				tool: 'exec_command',
				args: '{"cmd":"rg subscription docs"}',
				state: { status: 'completed', output: 'docs/opencode.md:12: subscription' },
			},
		],
	}),
	m('f1', 'assistant', 'OpenCode supports subscriptions via its Zen plan.', T3, {
		channel: 'final',
	}),
];

describe('transcriptMessagesToLogEntries: native fidelity', () => {
	it('turns a Codex tool message into a tool card that keeps the message id', () => {
		const entries = transcriptMessagesToLogEntries(CODEX_TURN);
		const tool = entries.find((e) => e.id === 'call_1')!;
		expect(tool.source).toBe('tool');
		expect(tool.text).toBe('exec_command');
		expect(tool.metadata?.toolState).toEqual({
			status: 'completed',
			input: { cmd: 'rg subscription docs' },
			output: 'docs/opencode.md:12: subscription',
		});
		// No `Tool: exec_command` text survives anywhere.
		expect(entries.some((e) => e.source !== 'tool' && e.text.includes('Tool: exec_command'))).toBe(
			false
		);
	});

	it('keeps progress, tool and final as separate entries in order, with their channels', () => {
		const entries = transcriptMessagesToLogEntries(CODEX_TURN);
		expect(entries.map((e) => [e.id, e.source, e.nativeTranscript?.channel])).toEqual([
			['u1', 'user', undefined],
			['c1', 'stdout', 'commentary'],
			['call_1', 'tool', undefined],
			['f1', 'stdout', 'final'],
		]);
		expect(isProgressNoteEntry(entries[1])).toBe(true);
		expect(isProgressNoteEntry(entries[3])).toBe(false);
	});

	it('never draws a history tool call as still running', () => {
		const [entry] = transcriptMessagesToLogEntries([
			m('call_2', 'assistant', 'Tool: shell', T0, {
				toolUse: [{ tool: 'shell', state: { status: 'running', input: { cmd: 'ls' } } }],
			}),
		]);
		expect(entry.source).toBe('tool');
		expect(entry.metadata?.toolState?.status).toBeUndefined();
		expect(entry.metadata?.toolState?.input).toEqual({ cmd: 'ls' });
	});

	it('keeps both the prose and the tool cards of a Claude mixed message', () => {
		const entries = transcriptMessagesToLogEntries([
			m('a1', 'assistant', 'Let me check the config.', T0, {
				toolUse: [
					{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/x/cfg.ts' } },
					{ type: 'tool_use', id: 'toolu_2', name: 'Grep', input: { pattern: 'model' } },
				],
			}),
			m('r1', 'user', '', T1, {
				toolUse: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'export const cfg = 1' }],
			}),
		]);
		expect(entries.map((e) => [e.id, e.source, e.text])).toEqual([
			['a1', 'stdout', 'Let me check the config.'],
			['a1:tool:0', 'tool', 'Read'],
			['a1:tool:1', 'tool', 'Grep'],
		]);
		expect(entries[1].metadata?.toolState).toMatchObject({
			status: 'completed',
			input: { file_path: '/x/cfg.ts' },
			output: 'export const cfg = 1',
		});
		// The empty tool_result carrier is not a user turn.
		expect(entries.some((e) => e.source === 'user')).toBe(false);
	});

	it('reads a stopped call back as canceled, not as a failure or success', () => {
		const [entry] = transcriptMessagesToLogEntries([
			m('call_s', 'assistant', 'Tool: exec_command', T0, {
				toolUse: [
					{
						tool: 'exec_command',
						args: '{"cmd":"sleep 40"}',
						state: { status: 'canceled', output: 'aborted by user after 15.1s' },
					},
				],
			}),
		]);
		expect(entry.metadata?.toolState).toMatchObject({
			status: 'canceled',
			input: { cmd: 'sleep 40' },
			output: 'aborted by user after 15.1s',
		});
		for (const status of ['cancelled', 'interrupted']) {
			const [other] = transcriptMessagesToLogEntries([
				m('c', 'assistant', 'Tool: x', T0, { toolUse: [{ tool: 'x', state: { status } }] }),
			]);
			expect(other.metadata?.toolState?.status).toBe('canceled');
		}
		const [failed] = transcriptMessagesToLogEntries([
			m('f', 'assistant', 'Tool: x', T0, { toolUse: [{ tool: 'x', state: { status: 'failed' } }] }),
		]);
		expect(failed.metadata?.toolState?.status).toBe('error');
	});

	it('maps a public reasoning summary to a thinking entry', () => {
		const [entry] = transcriptMessagesToLogEntries([
			m('r1', 'thinking', 'Comparing the two plans.', T0, { channel: 'analysis' }),
		]);
		expect(entry).toMatchObject({ id: 'r1', source: 'thinking', text: 'Comparing the two plans.' });
	});

	it('drops a user turn that is only a Codex Desktop app-shell envelope', () => {
		const envelope =
			'<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>';
		const entries = transcriptMessagesToLogEntries([
			m('e1', 'user', envelope, T0),
			m('u2', 'user', `What does ${envelope} mean?`, T1),
		]);
		expect(entries.map((e) => e.id)).toEqual(['u2']);
		expect(isInternalDesktopEnvelope(envelope)).toBe(true);
		expect(isInternalDesktopEnvelope(`What does ${envelope} mean?`)).toBe(false);
	});

	it('keeps an answer that merely contains "Tool:" text', () => {
		const [entry] = transcriptMessagesToLogEntries([
			m('a1', 'assistant', 'Tool: exec_command is how Codex runs a shell.', T0),
		]);
		expect(entry).toMatchObject({
			source: 'stdout',
			text: 'Tool: exec_command is how Codex runs a shell.',
		});
	});

	it('keeps images on a user turn', () => {
		const [entry] = transcriptMessagesToLogEntries([
			m('u1', 'user', 'see this', T0, { images: ['data:image/png;base64,AAA'] }),
		]);
		expect(entry.images).toEqual(['data:image/png;base64,AAA']);
	});

	it('lets backfill splice on a tool card id', () => {
		const loaded = transcriptMessagesToLogEntries(CODEX_TURN);
		const visible = loaded.slice(2);
		expect(selectOlderEntries(loaded, visible).map((e) => e.id)).toEqual(['u1', 'c1']);
	});
});

describe('transcript rendering groups', () => {
	it('joins consecutive stored answers with a paragraph break, never end to end', () => {
		const entries = transcriptMessagesToLogEntries([
			m('u1', 'user', 'q', T0),
			m('a1', 'assistant', 'First message.', T1),
			m('a2', 'assistant', 'Second message.', T2),
		]);
		const collapsed = collapseAiResponseLogs(entries);
		expect(collapsed.map((e) => e.text)).toEqual(['q', 'First message.\n\nSecond message.']);
	});

	it('keeps a progress note as its own row and gives the turn time to the answer', () => {
		const entries = transcriptMessagesToLogEntries(CODEX_TURN);
		const collapsed = collapseAiResponseLogs(entries);
		expect(collapsed.map((e) => e.id)).toEqual(['u1', 'c1', 'call_1', 'f1']);
		const durations = computeTurnDurations(entries);
		expect([...durations.keys()]).toEqual(['f1']);
	});

	it('folds a run of history tool calls into one row while tool calls are switched off', () => {
		const entries = transcriptMessagesToLogEntries([
			...CODEX_TURN.slice(0, 2),
			m('call_a', 'assistant', 'Tool: exec_command', T2, { toolUse: [{ tool: 'exec_command' }] }),
			m('call_b', 'assistant', 'Tool: apply_patch', T2, { toolUse: [{ tool: 'apply_patch' }] }),
			CODEX_TURN[3],
		]);
		const live: LogEntry = { id: 'live-tool', timestamp: 9, source: 'tool', text: 'Bash' };
		const hidden = foldNativeToolRuns([...entries, live], false);
		expect(hidden.logs.map((e) => e.id)).toEqual(['u1', 'c1', 'call_a', 'f1']);
		expect(hidden.runByHostId.get('call_a')?.map((e) => e.id)).toEqual(['call_a', 'call_b']);
		const shown = foldNativeToolRuns([...entries, live], true);
		expect(shown.logs.map((e) => e.id)).toEqual([...entries.map((e) => e.id), 'live-tool']);
		expect(shown.runByHostId.size).toBe(0);
	});

	it("folds the running turn's live calls too in the conversation layout, with their state", () => {
		const running: LogEntry = {
			id: 'tool-1',
			timestamp: 1,
			source: 'tool',
			text: 'exec_command',
			metadata: { toolState: { status: 'completed' } },
		};
		const executing: LogEntry = {
			id: 'tool-2',
			timestamp: 2,
			source: 'tool',
			text: 'apply_patch',
			metadata: { toolState: { status: 'running' } },
		};
		const user: LogEntry = { id: 'q', timestamp: 0, source: 'user', text: 'go' };
		const folded = foldNativeToolRuns([user, running, executing], false, true);
		expect(folded.logs.map((e) => e.id)).toEqual(['q', 'tool-1']);
		const run = folded.runByHostId.get('tool-1')!;
		expect(run.map((e) => e.id)).toEqual(['tool-1', 'tool-2']);
		expect(toolRunStatus(run)).toBe('running');
		expect(toolRunStatus([running])).toBe('completed');
		// Outside the conversation layout live calls stay hidden, as before.
		expect(foldNativeToolRuns([user, running, executing], false).logs.map((e) => e.id)).toEqual([
			'q',
		]);
	});
});

describe('history survives the live clear points', () => {
	const history = transcriptMessagesToLogEntries([
		...CODEX_TURN,
		m('r1', 'thinking', 'Reasoning summary', T4, { channel: 'analysis' }),
	]);
	const scratch: LogEntry[] = [
		{ id: 'live-think', timestamp: 1, source: 'thinking', text: 'hmm' },
		{ id: 'live-tool', timestamp: 2, source: 'tool', text: 'Bash' },
	];

	it('exit cleanup drops only the live turn scratch entries', () => {
		const kept = applyExitThinkingPolicy([...history, ...scratch], { showThinking: 'on' });
		expect(kept.map((e) => e.id)).toEqual(history.map((e) => e.id));
	});

	it('turning thinking off hides stored reasoning instead of deleting it', () => {
		const { logs } = setShowThinkingFields({ logs: [...history, ...scratch] }, 'off');
		expect(logs.some((e) => e.id === 'r1')).toBe(true);
		expect(logs.some((e) => e.id === 'live-think')).toBe(false);
	});

	it('live output never coalesces into a stored answer', () => {
		const answer = history.find((e) => e.id === 'f1')!;
		expect(canAppendToLogEntry(answer, 'stdout')).toBe(false);
	});
});

/** What an older build cached for CODEX_TURN: tool call as stdout text, no channels. */
function legacyCache(): LogEntry[] {
	return [
		{
			id: 'u1',
			timestamp: Date.parse(T0),
			source: 'user',
			text: 'Find the OpenCode subscription docs',
		},
		{
			id: 'c1',
			timestamp: Date.parse(T1),
			source: 'stdout',
			text: 'Looking through the provider docs first.',
		},
		{ id: 'call_1', timestamp: Date.parse(T2), source: 'stdout', text: 'Tool: exec_command' },
		{ id: 'local-error', timestamp: Date.parse(T2) + 1, source: 'error', text: 'Rate limited' },
		{
			id: 'f1',
			timestamp: Date.parse(T3),
			source: 'stdout',
			text: 'OpenCode supports subscriptions via its Zen plan.',
		},
		{
			id: 'local-send',
			timestamp: Date.parse(T4),
			source: 'user',
			text: 'thanks',
			delivered: true,
		},
	];
}

describe('mergeNewerEntries: a turn the tab already showed live', () => {
	it("does not append the disk copy's progress, tool calls and answer under the live reply", () => {
		const hydrated: LogEntry = {
			id: 'h1',
			timestamp: Date.parse(T0) - 60_000,
			source: 'stdout',
			text: 'earlier answer',
			nativeTranscript: { messageId: 'h1' },
		};
		const visible: LogEntry[] = [
			hydrated,
			{
				id: 'live-q',
				timestamp: Date.parse(T0) + 200,
				source: 'user',
				text: 'Find the OpenCode subscription docs',
			},
			// Streamed live: progress and answer arrived as one stdout entry.
			{
				id: 'live-a',
				timestamp: Date.parse(T1) + 100,
				source: 'stdout',
				text: 'Looking through the provider docs first.OpenCode supports subscriptions via its Zen plan.',
			},
		];
		const loaded = transcriptMessagesToLogEntries([
			m('h1', 'assistant', 'earlier answer', new Date(Date.parse(T0) - 60_000).toISOString()),
			...CODEX_TURN,
			m('u9', 'user', 'a question asked in the other app', T4),
			m('a9', 'assistant', 'its answer', T4, { channel: 'final' }),
		]);
		const merged = mergeNewerEntries(loaded, visible)!;
		// The live copy kept no tool card for that turn (agent layout or an older
		// build cleared it), so the stored call and its result are added back;
		// its progress note and answer are not repeated.
		expect(merged.logs.map((e) => e.id)).toEqual(['h1', 'live-q', 'live-a', 'call_1', 'u9', 'a9']);
		expect(merged.added).toBe(3);
		expect(merged.logs[3].metadata?.toolState?.output).toBe('docs/opencode.md:12: subscription');
		expect(mergeNewerEntries(loaded, merged.logs)?.added).toBe(0);
	});

	it('adds nothing for a live turn that kept its progress, tool card and answer', () => {
		const hydrated: LogEntry = {
			id: 'h1',
			timestamp: Date.parse(T0) - 60_000,
			source: 'stdout',
			text: 'earlier answer',
			nativeTranscript: { messageId: 'h1' },
		};
		const visible: LogEntry[] = [
			hydrated,
			{
				id: 'live-q',
				timestamp: Date.parse(T0) + 200,
				source: 'user',
				text: 'Find the OpenCode subscription docs',
			},
			{
				id: 'live-p',
				timestamp: Date.parse(T1) + 100,
				source: 'stdout',
				text: 'Looking through the provider docs first.',
				purpose: 'commentary',
			},
			{
				id: 'tool-call_1',
				timestamp: Date.parse(T2) + 100,
				source: 'tool',
				text: 'exec_command',
				metadata: { toolState: { status: 'completed', output: 'docs/opencode.md:12' } },
			},
			{
				id: 'live-a',
				timestamp: Date.parse(T3) + 100,
				source: 'stdout',
				text: 'OpenCode supports subscriptions via its Zen plan.',
			},
		];
		const loaded = transcriptMessagesToLogEntries([
			m('h1', 'assistant', 'earlier answer', new Date(Date.parse(T0) - 60_000).toISOString()),
			...CODEX_TURN,
		]);
		const merged = mergeNewerEntries(loaded, visible)!;
		expect(merged.added).toBe(0);
		expect(merged.logs).toBe(visible);
	});
});

describe('reconcileTranscriptEntries: upgrading a legacy cache in place', () => {
	it('rewrites same-id entries, keeps local entries where they were', () => {
		const loaded = transcriptMessagesToLogEntries(CODEX_TURN);
		const { logs, upgraded } = reconcileTranscriptEntries(loaded, legacyCache());
		expect(upgraded).toBe(2); // commentary channel + tool card
		expect(logs.map((e) => [e.id, e.source])).toEqual([
			['u1', 'user'],
			['c1', 'stdout'],
			['call_1', 'tool'],
			['local-error', 'error'],
			['f1', 'stdout'],
			['local-send', 'user'],
		]);
		expect(isProgressNoteEntry(logs[1])).toBe(true);
		expect(logs[2].metadata?.toolState?.status).toBe('completed');
		expect(logs[5]).toEqual(legacyCache()[5]);
	});

	it('is idempotent', () => {
		const loaded = transcriptMessagesToLogEntries(CODEX_TURN);
		const once = reconcileTranscriptEntries(loaded, legacyCache()).logs;
		const twice = reconcileTranscriptEntries(loaded, once);
		expect(twice.upgraded).toBe(0);
		expect(twice.logs).toBe(once);
		// And the newer-messages merge finds nothing to add on top.
		expect(mergeNewerEntries(loaded, once)).toEqual({ logs: once, added: 0 });
	});

	it('reports no change for a cache that already draws the same', () => {
		const loaded = transcriptMessagesToLogEntries([
			m('u1', 'user', 'q', T0),
			m('a1', 'assistant', 'a', T1),
		]);
		const cache: LogEntry[] = [
			{ id: 'u1', timestamp: Date.parse(T0), source: 'user', text: 'q' },
			{ id: 'a1', timestamp: Date.parse(T1), source: 'stdout', text: 'a' },
		];
		const result = reconcileTranscriptEntries(loaded, cache);
		expect(result.upgraded).toBe(0);
		expect(result.logs).toBe(cache);
	});

	it('refuses a same-id entry written at another moment (shifted positional ids)', () => {
		const loaded = transcriptMessagesToLogEntries([
			m('codex-msg-2', 'assistant', 'Tool: exec_command', T3, {
				toolUse: [{ tool: 'exec_command' }],
			}),
		]);
		const cache: LogEntry[] = [
			{
				id: 'codex-msg-2',
				timestamp: Date.parse(T1),
				source: 'stdout',
				text: 'Tool: exec_command',
			},
		];
		expect(reconcileTranscriptEntries(loaded, cache).logs).toEqual(cache);
	});

	it('refuses a same-id agent entry whose words differ', () => {
		const loaded = transcriptMessagesToLogEntries([m('a1', 'assistant', 'new words', T0)]);
		const cache: LogEntry[] = [
			{ id: 'a1', timestamp: Date.parse(T0), source: 'stdout', text: 'old words' },
		];
		expect(reconcileTranscriptEntries(loaded, cache).upgraded).toBe(0);
	});

	it("fills in Claude tool calls the old conversion dropped, between two of the tab's own messages", () => {
		const loaded = transcriptMessagesToLogEntries([
			m('u1', 'user', 'fix it', T0),
			m('a1', 'assistant', 'Reading the file.', T1),
			m('a2', 'assistant', '', T2, {
				toolUse: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a' } }],
			}),
			m('a3', 'assistant', 'Fixed.', T3),
		]);
		const cache: LogEntry[] = [
			{ id: 'u1', timestamp: Date.parse(T0), source: 'user', text: 'fix it' },
			{ id: 'a1', timestamp: Date.parse(T1), source: 'stdout', text: 'Reading the file.' },
			{ id: 'a3', timestamp: Date.parse(T3), source: 'stdout', text: 'Fixed.' },
		];
		const { logs, upgraded } = reconcileTranscriptEntries(loaded, cache);
		expect(upgraded).toBe(1);
		expect(logs.map((e) => [e.id, e.source])).toEqual([
			['u1', 'user'],
			['a1', 'stdout'],
			['a2', 'tool'],
			['a3', 'stdout'],
		]);
	});

	it('does not fill a gap that holds a live entry (it may be the disk copy of it)', () => {
		const loaded = transcriptMessagesToLogEntries([
			m('a1', 'assistant', 'one', T1),
			m('u2', 'user', 'live question', T2),
			m('a3', 'assistant', 'three', T3),
		]);
		const cache: LogEntry[] = [
			{ id: 'a1', timestamp: Date.parse(T1), source: 'stdout', text: 'one' },
			{ id: 'local-u', timestamp: Date.parse(T2) + 40, source: 'user', text: 'live question' },
			{ id: 'a3', timestamp: Date.parse(T3), source: 'stdout', text: 'three' },
		];
		const result = reconcileTranscriptEntries(loaded, cache);
		expect(result.logs.map((e) => e.id)).toEqual(['a1', 'local-u', 'a3']);
	});

	it('removes a cached app-shell envelope the native read no longer returns', () => {
		const loaded = transcriptMessagesToLogEntries([m('u1', 'user', 'q', T0)]);
		const cache: LogEntry[] = [
			{ id: 'u1', timestamp: Date.parse(T0), source: 'user', text: 'q' },
			{
				id: 'env',
				timestamp: Date.parse(T1),
				source: 'user',
				text: '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>',
			},
		];
		expect(hasLegacyTranscriptEntries(cache)).toBe(true);
		const result = reconcileTranscriptEntries(loaded, cache);
		expect(result.logs.map((e) => e.id)).toEqual(['u1']);
	});

	it('completes a converted tool card whose result was written after it was read', () => {
		const before = transcriptMessagesToLogEntries([
			m('u1', 'user', 'q', T0),
			m('call_9', 'assistant', 'Tool: exec_command', T1, {
				toolUse: [{ tool: 'exec_command', state: { status: 'running', input: { cmd: 'ls' } } }],
			}),
		]);
		expect(before[1].metadata?.toolState?.status).toBeUndefined();
		const after = transcriptMessagesToLogEntries([
			m('u1', 'user', 'q', T0),
			m('call_9', 'assistant', 'Tool: exec_command', T1, {
				toolUse: [
					{
						tool: 'exec_command',
						state: { status: 'completed', input: { cmd: 'ls' }, output: 'a.txt' },
					},
				],
			}),
		]);
		const once = reconcileTranscriptEntries(after, before);
		expect(once.upgraded).toBe(1);
		expect(once.logs[1].metadata?.toolState).toMatchObject({
			status: 'completed',
			output: 'a.txt',
		});
		expect(mergeNewerEntries(after, once.logs)?.added).toBe(0);
		const twice = reconcileTranscriptEntries(after, once.logs);
		expect(twice.upgraded).toBe(0);
		expect(twice.logs).toBe(once.logs);
	});

	it('does not restore a converted entry the user deleted next to one it updates', () => {
		const loaded = transcriptMessagesToLogEntries([
			m('u1', 'user', 'q', T0),
			m('a1', 'assistant', 'kept', T1),
			m('a2', 'assistant', 'deleted by the user', T2),
		]);
		const visible = [loaded[0], loaded[1]];
		const result = reconcileTranscriptEntries(loaded, visible);
		expect(result.logs.map((e) => e.id)).toEqual(['u1', 'a1']);
		expect(result.upgraded).toBe(0);
	});

	it('removes a cached automation heartbeat, but keeps a person typing the tag', () => {
		const heartbeat =
			'<heartbeat><automation_id>daily-review</automation_id><instructions>Check the inbox</instructions></heartbeat>';
		expect(isInternalDesktopEnvelope(heartbeat)).toBe(true);
		expect(isInternalDesktopEnvelope('<heartbeat>hello</heartbeat>')).toBe(false);
		expect(
			isInternalDesktopEnvelope('<heartbeat>quoted example</heartbeat>\nPlease explain this tag.')
		).toBe(false);
		expect(isInternalDesktopEnvelope(`Please explain ${heartbeat}`)).toBe(false);

		const loaded = transcriptMessagesToLogEntries([
			m('u1', 'user', 'q', T0),
			m('u2', 'user', '<heartbeat>hello</heartbeat>', T2),
		]);
		const cache: LogEntry[] = [
			{ id: 'u1', timestamp: Date.parse(T0), source: 'user', text: 'q' },
			{ id: 'hb', timestamp: Date.parse(T1), source: 'user', text: heartbeat },
			{ id: 'u2', timestamp: Date.parse(T2), source: 'user', text: '<heartbeat>hello</heartbeat>' },
		];
		expect(hasLegacyTranscriptEntries(cache)).toBe(true);
		expect(reconcileTranscriptEntries(loaded, cache).logs.map((e) => e.id)).toEqual(['u1', 'u2']);
	});

	it('turns an orphan tool output an older build showed as text into its tool card', () => {
		const output = 'docs/opencode.md:12: subscription';
		const loaded = transcriptMessagesToLogEntries([
			m('call_7', 'assistant', 'Tool: unknown', T1, {
				toolUse: [{ tool: 'unknown', state: { status: 'completed', output } }],
			}),
		]);
		const cache: LogEntry[] = [
			{ id: 'call_7', timestamp: Date.parse(T1), source: 'stdout', text: output },
		];
		const result = reconcileTranscriptEntries(loaded, cache);
		expect(result.upgraded).toBe(1);
		expect(result.logs[0]).toMatchObject({ id: 'call_7', source: 'tool' });
		expect(result.logs[0].metadata?.toolState?.output).toBe(output);
	});

	it('matches a capped orphan output against the full cached text', () => {
		const long = 'x'.repeat(6000);
		const loaded = transcriptMessagesToLogEntries([
			m('call_8', 'assistant', 'Tool: unknown', T1, {
				toolUse: [{ tool: 'unknown', state: { status: 'completed', output: long } }],
			}),
		]);
		const cache: LogEntry[] = [
			{ id: 'call_8', timestamp: Date.parse(T1), source: 'stdout', text: long },
		];
		expect(reconcileTranscriptEntries(loaded, cache).logs[0].source).toBe('tool');
	});

	it('keeps same-id assistant prose that is not the tool result', () => {
		const loaded = transcriptMessagesToLogEntries([
			m('call_7', 'assistant', 'Tool: unknown', T1, {
				toolUse: [{ tool: 'unknown', state: { status: 'completed', output: 'raw output' } }],
			}),
		]);
		const cache: LogEntry[] = [
			{ id: 'call_7', timestamp: Date.parse(T1), source: 'stdout', text: 'A real answer.' },
		];
		expect(reconcileTranscriptEntries(loaded, cache).logs).toEqual(cache);
	});

	it('upgrades a stopped call an older build stored as failed to canceled on refresh', () => {
		const disk = [
			m('call_s', 'assistant', 'Tool: exec_command', T1, {
				toolUse: [
					{
						tool: 'exec_command',
						state: { status: 'canceled', output: 'aborted by user after 15.1s' },
					},
				],
			}),
		];
		const loaded = transcriptMessagesToLogEntries(disk);
		// What a tab cached when history still read `canceled` as a failure.
		const cached: LogEntry[] = [
			{
				...loaded[0],
				metadata: { toolState: { status: 'error', output: 'aborted by user after 15.1s' } },
			},
		];
		const once = reconcileTranscriptEntries(loaded, cached);
		expect(once.upgraded).toBe(1);
		expect(once.logs[0].metadata?.toolState?.status).toBe('canceled');
		// Restart: the tab comes back from persistence and re-reads the same file.
		const restored = JSON.parse(JSON.stringify(once.logs)) as LogEntry[];
		const again = reconcileTranscriptEntries(transcriptMessagesToLogEntries(disk), restored);
		expect(again.upgraded).toBe(0);
		expect(again.logs[0].metadata?.toolState?.status).toBe('canceled');
	});

	it('flags legacy tool stand-ins, and not a converted tab', () => {
		expect(hasLegacyTranscriptEntries(legacyCache())).toBe(true);
		expect(hasLegacyTranscriptEntries(transcriptMessagesToLogEntries(CODEX_TURN))).toBe(false);
	});
});

describe('native turn settings', () => {
	it('stamps the model and effort a reply was recorded with onto its answer only', () => {
		const entries = transcriptMessagesToLogEntries([
			m('u1', 'user', 'q', T0),
			m('r1', 'assistant', 'thinking it over', T1, {
				channel: 'analysis',
				model: 'gpt-5.5-codex',
				effort: 'high',
			}),
			m('call_1', 'assistant', 'Tool: exec_command', T2, {
				model: 'gpt-5.5-codex',
				effort: 'high',
				toolUse: [{ tool: 'exec_command', state: { status: 'completed' } }],
			}),
			m('a1', 'assistant', 'done', T3, { model: 'gpt-5.5-codex', effort: 'high' }),
		]);
		const byId = new Map(entries.map((e) => [e.id, e]));
		expect(byId.get('a1')).toMatchObject({
			turnModel: 'gpt-5.5-codex',
			turnEffort: 'high',
			turnSettingsSource: 'native',
		});
		// Only the answer carries the pair, as a live turn stamps only its output.
		for (const id of ['u1', 'r1', 'call_1']) {
			expect(byId.get(id)?.turnModel).toBeUndefined();
			expect(byId.get(id)?.turnSettingsSource).toBeUndefined();
		}
	});

	it('leaves an axis the native record did not write unset', () => {
		const [answer] = transcriptMessagesToLogEntries([
			m('a1', 'assistant', 'done', T1, { model: 'claude-opus-5-5' }),
		]);
		expect(answer.turnModel).toBe('claude-opus-5-5');
		expect(answer.turnEffort).toBeUndefined();
		const [bare] = transcriptMessagesToLogEntries([m('a2', 'assistant', 'done', T1)]);
		expect(bare.turnModel).toBeUndefined();
		expect(bare.turnSettingsSource).toBeUndefined();
	});

	it('fills a cached reply that has no stamp, and keeps a send-time stamp over the native one', () => {
		const loaded = transcriptMessagesToLogEntries([
			m('u1', 'user', 'q', T0),
			m('a1', 'assistant', 'first', T1, { model: 'claude-opus-5-5' }),
			m('u2', 'user', 'q2', T2),
			m('a2', 'assistant', 'second', T3, { model: 'claude-opus-5-5' }),
		]);
		const cache: LogEntry[] = [
			{ id: 'u1', timestamp: Date.parse(T0), source: 'user', text: 'q' },
			{ id: 'a1', timestamp: Date.parse(T1), source: 'stdout', text: 'first' },
			{ id: 'u2', timestamp: Date.parse(T2), source: 'user', text: 'q2' },
			{
				id: 'a2',
				timestamp: Date.parse(T3),
				source: 'stdout',
				text: 'second',
				turnModel: 'opus',
			},
		];
		const { logs, upgraded } = reconcileTranscriptEntries(loaded, cache);
		expect(upgraded).toBe(1);
		expect(logs[1]).toMatchObject({
			turnModel: 'claude-opus-5-5',
			turnSettingsSource: 'native',
		});
		expect(logs[3].turnModel).toBe('opus');
		expect(logs[3].turnSettingsSource).toBeUndefined();
		// Once filled, a second pass changes nothing.
		expect(reconcileTranscriptEntries(loaded, logs).upgraded).toBe(0);
	});

	it('keeps the source when a response group is collapsed into one row', () => {
		const [row] = collapseAiResponseLogs([
			{
				id: 'n1',
				timestamp: 1,
				source: 'stdout',
				text: 'a',
				nativeTranscript: { messageId: 'n1' },
			},
			{
				id: 'n2',
				timestamp: 2,
				source: 'stdout',
				text: 'b',
				nativeTranscript: { messageId: 'n2' },
				turnModel: 'gpt-5.5-codex',
				turnSettingsSource: 'native',
			},
		]);
		expect(row).toMatchObject({ turnModel: 'gpt-5.5-codex', turnSettingsSource: 'native' });
	});
});
