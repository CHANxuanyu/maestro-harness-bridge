import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HandoffDraftBar } from '../../../renderer/components/InputArea/components/HandoffDraftBar';
import { handoffDraftNoteFor } from '../../../renderer/services/aiHandoffEntry';
import { createMockAITab } from '../../helpers';
import { mockTheme } from '../../helpers/mockTheme';
import type { HandoffDraftNote } from '../../../shared/aiHandoff';

const note: HandoffDraftNote = {
	sourceAgentId: 'claude-agent',
	sourceName: 'Claude',
	sourceProvider: 'claude-code',
	estimatedTokens: 2340,
	budgetTokens: 8000,
	omittedEntries: 3,
	omittedCharacters: 0,
};

describe('HandoffDraftBar', () => {
	it('says where the draft came from, how big it is and what was left out', () => {
		render(<HandoffDraftBar theme={mockTheme} note={note} onDismiss={vi.fn()} />);
		const bar = screen.getByTestId('handoff-draft-bar');
		expect(bar).toHaveTextContent('Handoff draft');
		expect(bar).toHaveTextContent('from Claude (Claude Code)');
		expect(bar).toHaveTextContent('~2.3K tokens');
		expect(bar).toHaveTextContent('3 earlier entries left out');
		expect(bar).not.toHaveTextContent('characters');
		expect(bar).toHaveTextContent('Nothing is sent until you press Send');
	});

	it('names a cut in the oldest kept entry and omits an unknown source', () => {
		render(
			<HandoffDraftBar
				theme={mockTheme}
				note={{
					...note,
					sourceName: undefined,
					sourceProvider: undefined,
					omittedEntries: 0,
					omittedCharacters: 1200,
				}}
				onDismiss={vi.fn()}
			/>
		);
		const bar = screen.getByTestId('handoff-draft-bar');
		expect(bar).not.toHaveTextContent('Claude');
		expect(bar).not.toHaveTextContent('entries left out');
		expect(bar).toHaveTextContent('1,200 characters cut from the oldest entry');
	});

	it('can be dismissed', () => {
		const onDismiss = vi.fn();
		render(<HandoffDraftBar theme={mockTheme} note={note} onDismiss={onDismiss} />);
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss handoff note' }));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});

describe('handoffDraftNoteFor', () => {
	it('shows the note only while the draft tab has no conversation yet', () => {
		expect(handoffDraftNoteFor(createMockAITab({ handoffDraft: note, logs: [] }))).toBe(note);
		// Sending the draft writes the first entry, which retires the note.
		expect(
			handoffDraftNoteFor(
				createMockAITab({
					handoffDraft: note,
					logs: [{ id: 'u', timestamp: 1, source: 'user', text: '# Handoff' }],
				})
			)
		).toBeNull();
		expect(handoffDraftNoteFor(createMockAITab({ logs: [] }))).toBeNull();
		expect(handoffDraftNoteFor(undefined)).toBeNull();
	});
});
