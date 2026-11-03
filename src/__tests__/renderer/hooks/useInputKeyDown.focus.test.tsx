/**
 * Real-DOM proof that Escape leaves the caret in the composer.
 *
 * The unit test alongside this one asserts against a MOCK inputRef, so it can
 * see that `focus()` was called but not that something blurred the composer a
 * moment later. That blind spot is exactly where this bug lived: the exit
 * branch did call focus(), and the composer still ended up blurred, because
 * `useKeyboardNavigation.handleEscapeInMain` is a WINDOW-level keydown listener
 * that blurs the composer on any Escape pressed while it has focus.
 *
 * Element handlers run before window handlers, so the fix is stopPropagation,
 * not focus(). This file wires BOTH handlers against a real textarea and a real
 * Escape event, and asserts on `document.activeElement` - the only thing that
 * actually answers "does the next keystroke go where the user expects".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useEffect, useRef } from 'react';

const mockInputContext = {
	slashCommandOpen: false,
	setSlashCommandOpen: vi.fn(),
	selectedSlashCommandIndex: 0,
	setSelectedSlashCommandIndex: vi.fn(),
	tabCompletionOpen: false,
	setTabCompletionOpen: vi.fn(),
	selectedTabCompletionIndex: 0,
	setSelectedTabCompletionIndex: vi.fn(),
	tabCompletionFilter: 'all' as string,
	setTabCompletionFilter: vi.fn(),
	atMentionOpen: false,
	setAtMentionOpen: vi.fn(),
	atMentionFilter: '',
	setAtMentionFilter: vi.fn(),
	atMentionStartIndex: -1,
	setAtMentionStartIndex: vi.fn(),
	selectedAtMentionIndex: 0,
	setSelectedAtMentionIndex: vi.fn(),
	commandHistoryOpen: false,
	setCommandHistoryOpen: vi.fn(),
	commandHistoryFilter: '',
	setCommandHistoryFilter: vi.fn(),
	commandHistorySelectedIndex: 0,
	setCommandHistorySelectedIndex: vi.fn(),
};

vi.mock('../../../renderer/contexts/InputContext', () => ({
	useInputContext: () => mockInputContext,
}));

const mockTrackShortcutUsage = vi.fn();
vi.mock('../../../renderer/utils/shortcutTracking', () => ({
	trackShortcutUsage: (id: string) => mockTrackShortcutUsage(id),
}));

import { useInputKeyDown } from '../../../renderer/hooks/input/useInputKeyDown';
import { useSessionStore } from '../../../renderer/stores/sessionStore';

/**
 * Mirrors `useKeyboardNavigation.handleEscapeInMain`: a window listener that
 * blurs the composer and moves focus to the transcript whenever Escape is
 * pressed while the composer is focused.
 */
function useWindowEscapeBlur(
	inputRef: React.RefObject<HTMLTextAreaElement | null>,
	transcriptRef: React.RefObject<HTMLDivElement | null>
) {
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			if (document.activeElement !== inputRef.current) return;
			e.preventDefault();
			inputRef.current?.blur();
			transcriptRef.current?.focus();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [inputRef, transcriptRef]);
}

function Composer({
	commandMode,
	setCommandMode,
	inputValue,
	interruptTurn = vi.fn(),
	setInputValue = vi.fn(),
}: {
	commandMode: 'off' | 'shell' | 'ai';
	setCommandMode: (v: 'off' | 'shell' | 'ai') => void;
	inputValue: string;
	interruptTurn?: () => void;
	setInputValue?: (v: string) => void;
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const transcriptRef = useRef<HTMLDivElement>(null);

	useWindowEscapeBlur(inputRef, transcriptRef);

	const { handleInputKeyDown } = useInputKeyDown({
		getInputValue: () => inputValue,
		setInputValue,
		tabCompletionSuggestions: [],
		atMentionSuggestions: [],
		allSlashCommands: [],
		syncFileTreeToTabCompletion: vi.fn(),
		processInput: vi.fn(),
		getTabCompletionSuggestions: vi.fn().mockReturnValue([]),
		getCommandMode: () => commandMode,
		setCommandMode,
		inputRef,
		terminalOutputRef: transcriptRef,
		interruptTurn,
	} as never);

	return (
		<div>
			<div ref={transcriptRef} tabIndex={-1} data-testid="transcript" />
			<textarea ref={inputRef} aria-label="composer" onKeyDown={handleInputKeyDown} />
		</div>
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	useSessionStore.setState({
		sessions: [{ id: 's1', inputMode: 'ai', activeTabId: 't1', isGitRepo: false }],
		activeSessionId: 's1',
	} as never);
});

afterEach(() => {
	useSessionStore.setState({ sessions: [], activeSessionId: '' } as never);
});

describe('Escape out of command mode (real DOM)', () => {
	function setup(inputValue = '') {
		const setCommandMode = vi.fn();
		const utils = render(
			<Composer commandMode="shell" setCommandMode={setCommandMode} inputValue={inputValue} />
		);
		const composer = utils.getByLabelText('composer') as HTMLTextAreaElement;
		act(() => composer.focus());
		expect(document.activeElement).toBe(composer);
		return { ...utils, composer, setCommandMode };
	}

	it('leaves the caret in the composer', () => {
		const { composer, setCommandMode } = setup();

		fireEvent.keyDown(composer, { key: 'Escape', bubbles: true });

		expect(setCommandMode).toHaveBeenCalledWith('off');
		// The assertion that matters: the next keystroke goes to the composer.
		expect(document.activeElement).toBe(composer);
	});

	it('leaves the caret in the composer on a whitespace-only line', () => {
		// A line of spaces looks empty, so Escape has to mean "get me out" there
		// too - and must not hand focus to the transcript on the way.
		const { composer, setCommandMode } = setup('   ');

		fireEvent.keyDown(composer, { key: 'Escape', bubbles: true });

		expect(setCommandMode).toHaveBeenCalledWith('off');
		expect(document.activeElement).toBe(composer);
	});

	it('still lets Escape blur the composer when NOT in command mode', () => {
		// Guard against over-reach: the window handler is normal behaviour for an
		// ordinary chat draft, and this fix must not disable it.
		const setCommandMode = vi.fn();
		const { getByLabelText, getByTestId } = render(
			<Composer commandMode="off" setCommandMode={setCommandMode} inputValue="" />
		);
		const composer = getByLabelText('composer') as HTMLTextAreaElement;
		act(() => composer.focus());

		fireEvent.keyDown(composer, { key: 'Escape', bubbles: true });

		expect(setCommandMode).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(getByTestId('transcript'));
	});
});

/**
 * While the conversation on screen runs, Escape is its Stop (the send key is
 * the same control). It comes after everything that already answers Escape in
 * the composer, and it keeps the caret here so the next message can be typed.
 */
describe('Escape stops the conversation on screen (real DOM)', () => {
	function runningAgent(onScreenTabBusy: boolean, inputMode: 'ai' | 'terminal' = 'ai') {
		useSessionStore.setState({
			sessions: [
				{
					id: 's1',
					inputMode,
					activeTabId: 't1',
					isGitRepo: false,
					state: 'busy',
					busySource: 'ai',
					aiTabs: [
						{ id: 't1', logs: [], state: onScreenTabBusy ? 'busy' : 'idle' },
						{ id: 't2', logs: [], state: onScreenTabBusy ? 'idle' : 'busy' },
					],
				},
			],
			activeSessionId: 's1',
		} as never);
	}

	function setup(
		props: { commandMode?: 'off' | 'shell' | 'ai'; inputValue?: string } = {},
		setCommandMode = vi.fn()
	) {
		const interruptTurn = vi.fn();
		const setInputValue = vi.fn();
		const utils = render(
			<Composer
				commandMode={props.commandMode ?? 'off'}
				setCommandMode={setCommandMode}
				inputValue={props.inputValue ?? ''}
				interruptTurn={interruptTurn}
				setInputValue={setInputValue}
			/>
		);
		const composer = utils.getByLabelText('composer') as HTMLTextAreaElement;
		act(() => composer.focus());
		fireEvent.keyDown(composer, { key: 'Escape', bubbles: true });
		return { ...utils, composer, interruptTurn, setInputValue, setCommandMode };
	}

	afterEach(() => {
		mockInputContext.slashCommandOpen = false;
	});

	it('stops the running turn and keeps the caret in the composer', () => {
		runningAgent(true);
		const { composer, interruptTurn } = setup();

		expect(interruptTurn).toHaveBeenCalledTimes(1);
		expect(document.activeElement).toBe(composer);
		expect(mockTrackShortcutUsage).toHaveBeenCalledWith('stopTurn');
	});

	it('keeps a half-written draft when it stops', () => {
		runningAgent(true);
		const { interruptTurn, setInputValue } = setup({ inputValue: 'and then also' });

		expect(interruptTurn).toHaveBeenCalledTimes(1);
		expect(setInputValue).not.toHaveBeenCalled();
	});

	it('lets an open popover take Escape first', () => {
		runningAgent(true);
		mockInputContext.slashCommandOpen = true;
		const { interruptTurn } = setup({ inputValue: '/' });

		expect(mockInputContext.setSlashCommandOpen).toHaveBeenCalledWith(false);
		expect(interruptTurn).not.toHaveBeenCalled();
	});

	it('leaves command mode first on an empty command line', () => {
		runningAgent(true);
		const { interruptTurn, setCommandMode } = setup({ commandMode: 'shell' });

		expect(setCommandMode).toHaveBeenCalledWith('off');
		expect(interruptTurn).not.toHaveBeenCalled();
	});

	it('does not stop another conversation of the agent; the pill carries that Stop', () => {
		runningAgent(false);
		const { interruptTurn, getByTestId } = setup();

		expect(interruptTurn).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(getByTestId('transcript'));
	});

	it('does not stop an AI turn from the terminal composer', () => {
		runningAgent(true, 'terminal');
		const { interruptTurn } = setup();

		expect(interruptTurn).not.toHaveBeenCalled();
	});
});
