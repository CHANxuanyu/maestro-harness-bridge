import { describe, expect, it } from 'vitest';
import {
	appendReadOnlyPrompt,
	READ_ONLY_PROMPT_SUFFIX,
	stripReadOnlyPrompt,
} from '../../shared/readOnlyPrompt';
import { embedSystemPromptInPrompt } from '../../shared/embeddedSystemPrompt';
import { transcriptMessagesToLogEntries } from '../../renderer/utils/transcriptMessages';

describe('read-only prompt wire format', () => {
	it('pins the suffix already persisted in native transcripts', () => {
		expect(READ_ONLY_PROMPT_SUFFIX).toBe(
			'\n\n---\n\nIMPORTANT: You are in read-only/plan mode. Do NOT write a plan file. Instead, return your plan directly to the user in beautiful markdown formatting.'
		);
	});

	it.each(['', '  Keep my whitespace.\n', `A quoted suffix${READ_ONLY_PROMPT_SUFFIX}`])(
		'round trips the user text exactly: %j',
		(prompt) => {
			expect(stripReadOnlyPrompt(appendReadOnlyPrompt(prompt))).toBe(prompt);
		}
	);

	it('unwraps system content and the suffix at the same transcript boundary', () => {
		const text = embedSystemPromptInPrompt(
			'Synthetic system prompt',
			appendReadOnlyPrompt('User request.')
		);
		const [entry] = transcriptMessagesToLogEntries([
			{ uuid: 'u1', timestamp: '2026-11-06T12:00:00Z', type: 'user', content: text },
		]);
		expect(entry.text).toBe('User request.');
	});
});
