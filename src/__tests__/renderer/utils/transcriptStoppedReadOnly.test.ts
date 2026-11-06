import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../../renderer/types';
import {
	bindDelayedOwnSends,
	hasLegacyTranscriptEntries,
	mergeNewerEntries,
	reconcileTranscriptEntries,
	transcriptMessagesToLogEntries,
	type TranscriptMessage,
} from '../../../renderer/utils/transcriptMessages';

// Sanitized QA shape: a local read-only send, a native send with the historical
// suffix, a tool interrupted before any final answer, then a restart and send.
// Keep the literal here to pin compatibility with transcripts already on disk.
const SUFFIX =
	'\n\n---\n\nIMPORTANT: You are in read-only/plan mode. Do NOT write a plan file. Instead, return your plan directly to the user in beautiful markdown formatting.';
const PROMPT = 'Wait 30 seconds, then reply WAIT_DONE. Do not read or change files.';
const T = Date.parse('2026-11-06T12:00:00Z');
const own: LogEntry = {
	id: 'local-user',
	timestamp: T,
	source: 'user',
	text: PROMPT,
	readOnly: true,
};
const stopped: LogEntry = {
	id: 'local-stop',
	timestamp: T + 4000,
	source: 'system',
	text: 'Stopped by user',
};
const prior: TranscriptMessage = {
	uuid: 'prior',
	type: 'assistant',
	timestamp: new Date(T - 60000).toISOString(),
	content: 'Previous result.',
};
const user: TranscriptMessage = {
	uuid: 'native-user',
	type: 'user',
	timestamp: new Date(T + 200).toISOString(),
	content: PROMPT + SUFFIX,
};

function native(provider: 'codex' | 'claude'): TranscriptMessage[] {
	return [
		prior,
		user,
		{
			uuid: 'native-tool',
			type: 'assistant',
			timestamp: new Date(T + 1000).toISOString(),
			content: '',
			toolUse:
				provider === 'codex'
					? [
							{
								id: 'wait-call',
								tool: 'exec_command',
								args: '{"cmd":"sleep 30"}',
								state: { status: 'canceled' },
							},
						]
					: [{ type: 'tool_use', id: 'wait-call', name: 'Bash', input: { command: 'sleep 30' } }],
		},
	];
}

for (const provider of ['codex', 'claude'] as const) {
	describe(`${provider} stopped read-only transcript`, () => {
		it('restores the user words without changing native messages', () => {
			const messages = native(provider);
			const before = JSON.stringify(messages);
			const entries = transcriptMessagesToLogEntries(messages);
			expect(entries.find((entry) => entry.source === 'user')?.text).toBe(PROMPT);
			expect(JSON.stringify(messages)).toBe(before);
		});

		it('merges the stopped turn once after restart and preserves a later identical send', () => {
			const loaded = transcriptMessagesToLogEntries(native(provider));
			const visible = [loaded[0], own, stopped];
			const first = mergeNewerEntries(loaded, reconcileTranscriptEntries(loaded, visible).logs)!;
			expect(
				first.logs.filter((entry) => entry.source === 'user').map((entry) => entry.text)
			).toEqual([PROMPT]);
			expect(first.logs).toContain(own);
			const next = transcriptMessagesToLogEntries([
				...native(provider),
				{ ...user, uuid: 'native-repeat', timestamp: new Date(T + 90000).toISOString() },
			]);
			const second = mergeNewerEntries(next, first.logs)!;
			expect(
				second.logs.filter((entry) => entry.source === 'user').map((entry) => entry.text)
			).toEqual([PROMPT, PROMPT]);
			expect(mergeNewerEntries(next, second.logs)?.added).toBe(0);
		});

		it.each([true, false])(
			'repairs an already cached duplicate without requiring a final answer (prior=%s)',
			(withPrior) => {
				const messages = native(provider);
				const loaded = transcriptMessagesToLogEntries(withPrior ? messages : messages.slice(1));
				const oldUser: LogEntry = {
					id: user.uuid,
					source: 'user',
					timestamp: T + 200,
					text: user.content,
					nativeTranscript: { messageId: user.uuid },
				};
				const cached = [...(withPrior ? [loaded[0]] : []), own, oldUser, stopped];
				expect(hasLegacyTranscriptEntries(cached)).toBe(true);
				const upgraded = reconcileTranscriptEntries(loaded, cached);
				const bound = bindDelayedOwnSends(loaded, upgraded.logs);
				expect(bound.logs.filter((entry) => entry.source === 'user')).toEqual([
					{ ...own, nativeTranscript: { messageId: user.uuid } },
				]);
				expect(bindDelayedOwnSends(loaded, bound.logs).bound).toBe(0);
				expect(hasLegacyTranscriptEntries(bound.logs)).toBe(false);
			}
		);
	});
}

it('only removes an exact terminal suffix from user messages', () => {
	const quoted = `Explain this text: ${SUFFIX}\nIt is quoted.`;
	const entries = transcriptMessagesToLogEntries([
		{ ...user, uuid: 'quote', content: quoted },
		{ ...user, uuid: 'assistant', type: 'assistant' },
		{
			...user,
			uuid: 'partial',
			content: PROMPT + '\n\n---\n\nIMPORTANT: You are in read-only/plan mode.',
		},
	]);
	expect(entries.map((entry) => entry.text)).toEqual([
		quoted,
		user.content,
		PROMPT + '\n\n---\n\nIMPORTANT: You are in read-only/plan mode.',
	]);
});
