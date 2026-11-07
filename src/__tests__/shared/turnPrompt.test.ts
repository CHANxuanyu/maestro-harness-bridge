import { describe, expect, it } from 'vitest';
import { appendTurnNote, stripTurnPrompt } from '../../shared/turnPrompt';
import { appendReadOnlyPrompt, READ_ONLY_PROMPT_SUFFIX } from '../../shared/readOnlyPrompt';
import { transcriptMessagesToLogEntries } from '../../renderer/utils/transcriptMessages';

describe('internal turn note wire format', () => {
	it('pins the reversible envelope without changing the note body', () => {
		expect(appendTurnNote('Question', 'Note')).toBe(
			'Question\n\n---\n\n<!-- maestro-internal-note -->\nNote\n<!-- /maestro-internal-note:4 -->'
		);
	});

	it.each(['', '  原话🙂\n', `Explain this suffix${READ_ONLY_PROMPT_SUFFIX}`])(
		'recovers exact user text with two editable notes: %j',
		(prompt) => {
			const notes = appendTurnNote(
				appendTurnNote(appendReadOnlyPrompt(prompt), '并行协作🙂'),
				'转交结果'
			);
			expect(stripTurnPrompt(notes)).toBe(prompt);
		}
	);

	it('preserves delimiters quoted inside a note', () => {
		const note = appendTurnNote('Quote this envelope', 'Quoted note');
		expect(stripTurnPrompt(appendTurnNote(appendReadOnlyPrompt('Question'), note))).toBe(
			'Question'
		);
	});

	it('keeps partial, modified, and unknown legacy prose intact', () => {
		const wire = appendTurnNote(appendReadOnlyPrompt('Question'), 'Note');
		const values = [
			wire.slice(0, -1),
			wire.replace(':4 -->', ':999999999999999999999 -->'),
			wire + '\nUser commentary',
			appendReadOnlyPrompt('Question') + '\n\n---\n\n[Maestro] Custom old note.',
		];
		for (const value of values) expect(stripTurnPrompt(value)).toBe(value);
	});

	it('never decodes an assistant explanation of the wire format', () => {
		const content = appendTurnNote(appendReadOnlyPrompt('Example'), 'Note');
		expect(
			transcriptMessagesToLogEntries([
				{ uuid: 'answer', type: 'assistant', timestamp: '2026-11-06T12:00:00Z', content },
			])[0].text
		).toBe(content);
	});
});
