/**
 * The conversation feed (sidebarNavigationMode 'conversations'): what the user
 * observes in the transcript, driven through the real TerminalOutput and
 * LogItem. Only the markdown parser is replaced (it renders its source text),
 * as in the other transcript suites.
 *
 * Legacy coverage stays in TerminalOutput.test.tsx (agents layout); the few
 * agents-layout cases here exist to show the two layouts diverge only where
 * the feed means them to.
 */

import React, { createRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { LogEntry, Session } from '../../../../renderer/types';
import type { TerminalOutputProps } from '../../../../renderer/components/TerminalOutput/types';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { LayerStackProvider } from '../../../../renderer/contexts/LayerStackContext';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';
import { mockTheme } from '../../../helpers/mockTheme';

vi.mock('react-markdown', () => ({
	default: ({ children }: { children: string }) => (
		<div data-testid="react-markdown">{children}</div>
	),
}));
vi.mock('remark-gfm', () => ({ default: [] }));
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }));

import { TerminalOutput } from '../../../../renderer/components/TerminalOutput/TerminalOutput';

const T0 = Date.UTC(2026, 9, 21, 12, 30);
const at = (minutes: number) => T0 + minutes * 60_000;

function sessionWith(logs: LogEntry[]): Session {
	return createMockSession({
		id: 'session-1',
		toolType: 'codex',
		activeTabId: 'tab-1',
		aiTabs: [createMockAITab({ id: 'tab-1', logs, showThinking: 'off' })],
	});
}

function makeProps(logs: LogEntry[], overrides: Partial<TerminalOutputProps> = {}) {
	return {
		session: sessionWith(logs),
		theme: mockTheme,
		fontFamily: 'monospace',
		activeFocus: 'main',
		outputSearchOpen: false,
		outputSearchQuery: '',
		outputSearchRegex: false,
		setOutputSearchOpen: vi.fn(),
		setOutputSearchQuery: vi.fn(),
		setOutputSearchRegex: vi.fn(),
		setActiveFocus: vi.fn(),
		setLightboxImage: vi.fn(),
		inputRef: createRef<HTMLTextAreaElement>(),
		logsEndRef: createRef<HTMLDivElement>(),
		maxOutputLines: 1000,
		markdownEditMode: false,
		setMarkdownEditMode: vi.fn(),
		...overrides,
	} as TerminalOutputProps;
}

function renderTranscript(logs: LogEntry[], overrides: Partial<TerminalOutputProps> = {}) {
	const utils = render(
		<LayerStackProvider>
			<TerminalOutput {...makeProps(logs, overrides)} />
		</LayerStackProvider>
	);
	const rerenderWith = (next: LogEntry[], nextOverrides: Partial<TerminalOutputProps> = {}) =>
		utils.rerender(
			<LayerStackProvider>
				<TerminalOutput {...makeProps(next, { ...overrides, ...nextOverrides })} />
			</LayerStackProvider>
		);
	return { ...utils, rerenderWith };
}

const row = (container: HTMLElement, id: string) =>
	container.querySelector(`[data-log-id="${id}"]`) as HTMLElement;

const infoToggle = (el: HTMLElement) =>
	el.querySelector('[data-message-info-toggle]') as HTMLButtonElement;

/** The clock the legacy gutter drew for a timestamp. */
const gutterClock = (ts: number) =>
	new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const user = (id: string, minutes: number, text: string, extra: Partial<LogEntry> = {}) =>
	({ id, timestamp: at(minutes), source: 'user', text, ...extra }) as LogEntry;
const reply = (id: string, minutes: number, text: string, extra: Partial<LogEntry> = {}) =>
	({ id, timestamp: at(minutes), source: 'stdout', text, ...extra }) as LogEntry;

beforeEach(() => {
	useSettingsStore.setState({
		uiLanguage: 'en',
		sidebarNavigationMode: 'conversations',
		showToolCalls: false,
		showProviderModePill: false,
	});
});

describe('conversation feed: reading without repeated metadata', () => {
	const logs = [
		user('u1', 0, 'Is the build still working?'),
		reply('a1', 1, 'Yes, it finished in 41 seconds.', { turnModel: 'opus', turnEffort: 'high' }),
		user('u2', 2, 'And the tests?'),
		reply('a2', 3, 'All green.', { turnModel: 'opus', turnEffort: 'high' }),
	];

	it('does not print model, effort or the clock on every message', () => {
		const { container } = renderTranscript(logs);
		expect(screen.queryAllByTestId('turn-model-pill')).toHaveLength(0);
		expect(screen.queryAllByTestId('turn-effort-pill')).toHaveLength(0);
		for (const log of logs) {
			expect(row(container, log.id).textContent).not.toContain(gutterClock(log.timestamp));
		}
		// The rows are feed rows, not bubbles with a gutter.
		expect(row(container, 'a1').getAttribute('data-feed-row')).toBe('reply');
		expect(row(container, 'u1').getAttribute('data-feed-row')).toBe('user');
	});

	it('still prints them in the agents layout (legacy unchanged)', () => {
		useSettingsStore.setState({ sidebarNavigationMode: 'agents' });
		const { container } = renderTranscript(logs);
		expect(screen.getAllByTestId('turn-model-pill')).toHaveLength(2);
		expect(row(container, 'a1').textContent).toContain(gutterClock(logs[1].timestamp));
		expect(container.querySelector('[data-message-info-toggle]')).toBeNull();
		expect(container.querySelector('[data-feed-row]')).toBeNull();
	});

	it('names the speaker for a screen reader now that there is no bubble', () => {
		const { container } = renderTranscript(logs);
		expect(within(row(container, 'u1')).getByText('You')).toHaveClass('sr-only');
		expect(within(row(container, 'a1')).getByText('Assistant')).toHaveClass('sr-only');
	});
});

describe('conversation feed: message info on demand', () => {
	it('opens from a focusable, named toggle and shows the stored record', () => {
		const { container } = renderTranscript([
			user('u1', 0, 'Question'),
			reply('a1', 2, 'Answer', { turnModel: 'opus', turnEffort: 'high' }),
		]);
		const toggle = infoToggle(row(container, 'a1'));
		expect(toggle.tagName).toBe('BUTTON');
		expect(toggle).toHaveAccessibleName('Message info');
		toggle.focus();
		expect(document.activeElement).toBe(toggle);
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		expect(container.querySelector('[data-message-info]')).toBeNull();

		// A native button: Enter and Space activate it as a click.
		fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-expanded', 'true');
		expect(toggle).toHaveAccessibleName('Hide message info');
		const panel = container.querySelector('[data-message-info]') as HTMLElement;
		expect(panel.id).toBe(toggle.getAttribute('aria-controls'));
		expect(panel).toHaveTextContent('Model');
		expect(panel).toHaveTextContent('opus');
		expect(panel).toHaveTextContent('Effort');
		expect(panel).toHaveTextContent('high');
		expect(panel).toHaveTextContent('2026');
		// The turn took two minutes (user message to the reply).
		expect(panel).toHaveTextContent('Took');

		fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		expect(container.querySelector('[data-message-info]')).toBeNull();
	});

	it('says "Not recorded" for an unstamped reply instead of naming a model', () => {
		const { container } = renderTranscript([user('u1', 0, 'Q'), reply('a1', 1, 'A')]);
		fireEvent.click(infoToggle(row(container, 'a1')));
		const panel = container.querySelector('[data-message-info]') as HTMLElement;
		expect(panel).toHaveTextContent('Not recorded');
	});

	it('reports a user message’s send states', () => {
		const { container } = renderTranscript([
			user('u1', 0, 'Q', { delivered: true, readOnly: true }),
		]);
		fireEvent.click(infoToggle(row(container, 'u1')));
		const panel = container.querySelector('[data-message-info]') as HTMLElement;
		expect(panel).toHaveTextContent('Delivered');
		expect(panel).toHaveTextContent('Sent in read-only mode');
	});

	it('repaints an open panel when the same entry’s stored metadata is corrected', () => {
		const first = [user('u1', 0, 'Q'), reply('a1', 1, 'Answer')];
		const { container, rerenderWith } = renderTranscript(first);
		fireEvent.click(infoToggle(row(container, 'a1')));
		expect(container.querySelector('[data-message-info]')).toHaveTextContent('Not recorded');

		// Same id and text: a stored conversion upgraded in place.
		const corrected = new Date(Date.UTC(2027, 0, 5, 9, 0)).getTime();
		rerenderWith([
			first[0],
			{ ...first[1], turnModel: 'opus', turnEffort: 'high', timestamp: corrected },
		]);
		const panel = container.querySelector('[data-message-info]') as HTMLElement;
		expect(panel).not.toBeNull();
		expect(panel).toHaveTextContent('opus');
		expect(panel).toHaveTextContent('2027');
	});

	it('repaints an open panel when ONLY the entry’s timestamp is corrected', () => {
		// A reply paged in with no user message before it: computeTurnDurations
		// only starts a turn at a user entry, so this reply has no duration before
		// or after the correction. Model, effort, text, id and every other compared
		// prop stay identical, so the timestamp comparison alone must repaint it.
		const stamped = { turnModel: 'opus', turnEffort: 'high' };
		const original = reply('a1', 0, 'Paged-in answer', stamped);
		const { container, rerenderWith } = renderTranscript([original]);
		fireEvent.click(infoToggle(row(container, 'a1')));
		const before = container.querySelector('[data-message-info]') as HTMLElement;
		expect(before).toHaveTextContent('2026');
		expect(before).not.toHaveTextContent('Took');

		const corrected = Date.UTC(2027, 0, 5, 9, 0);
		rerenderWith([{ ...original, timestamp: corrected }]);
		const after = container.querySelector('[data-message-info]') as HTMLElement;
		expect(after).not.toBeNull();
		expect(after).toHaveTextContent('2027');
		expect(after).not.toHaveTextContent('2026');
		// Still no duration, and the stored settings read the same.
		expect(after).not.toHaveTextContent('Took');
		expect(after).toHaveTextContent('opus');
		expect(after).toHaveTextContent('high');
	});
});

describe('conversation feed: real setting changes and the newest reply', () => {
	it('attributes a real model change to the first reply under it, and only there', () => {
		const { container } = renderTranscript([
			user('u1', 0, 'Q1'),
			reply('a1', 1, 'A1', { turnModel: 'opus', turnEffort: 'high' }),
			user('u2', 2, 'Q2'),
			reply('a2', 3, 'A2', { turnModel: 'sonnet', turnEffort: 'high' }),
			user('u3', 4, 'Q3'),
			reply('a3', 5, 'A3', { turnModel: 'sonnet', turnEffort: 'high' }),
		]);
		expect(row(container, 'a1').querySelector('[data-turn-setting-change]')).toBeNull();
		const chip = row(container, 'a2').querySelector('[data-turn-setting-change]') as HTMLElement;
		expect(chip).toHaveTextContent('Model changed from opus to sonnet');
		expect(within(chip).getByTestId('turn-model-pill')).toHaveTextContent('sonnet');
		expect(within(chip).queryByTestId('turn-effort-pill')).toBeNull();
		expect(row(container, 'a3').querySelector('[data-turn-setting-change]')).toBeNull();
	});

	it('keeps the newest reply’s actions shown and moves that when a new reply lands', () => {
		const logs = [user('u1', 0, 'Q1'), reply('a1', 1, 'A1')];
		const { container, rerenderWith } = renderTranscript(logs);
		const revealed = (id: string) =>
			infoToggle(row(container, id)).className.split(/\s+/).includes('opacity-100');
		expect(revealed('a1')).toBe(true);

		rerenderWith([...logs, user('u2', 2, 'Q2'), reply('a2', 3, 'A2')]);
		expect(revealed('a2')).toBe(true);
		// The memoized earlier row repainted when it stopped being the newest.
		expect(revealed('a1')).toBe(false);
	});

	it('does not treat a Stop notice as the newest reply', () => {
		const { container } = renderTranscript([
			user('u1', 0, 'Q1'),
			reply('a1', 1, 'A1'),
			user('u2', 2, 'Q2'),
			{
				id: 't2',
				timestamp: at(3),
				source: 'tool',
				text: 'shell',
				nativeTranscript: { messageId: 't2' },
				metadata: { toolState: { status: 'canceled', input: 'npm test' } },
			},
			{ id: 's2', timestamp: at(4), source: 'system', text: 'Canceled by user' },
		]);
		const revealed = (id: string) =>
			infoToggle(row(container, id)).className.split(/\s+/).includes('opacity-100');
		expect(revealed('a1')).toBe(true);
		expect(revealed('s2')).toBe(false);
	});
});

describe('conversation feed: rows that keep a boundary', () => {
	it('aligns the user message by the setting', () => {
		const logs = [user('u1', 0, 'Right by default')];
		const { container, rerenderWith } = renderTranscript(logs);
		expect(row(container, 'u1').className).toContain('items-end');
		rerenderWith(logs, { userMessageAlignment: 'left' });
		expect(row(container, 'u1').className).toContain('items-start');
	});

	it('shows the Stop notice compactly, in full, with an accessible marker', () => {
		const { container } = renderTranscript([
			user('u1', 0, 'Run the tests'),
			{
				id: 't1',
				timestamp: at(1),
				source: 'tool',
				text: 'shell',
				nativeTranscript: { messageId: 't1' },
				metadata: { toolState: { status: 'canceled', input: 'npm test' } },
			},
			{ id: 's1', timestamp: at(2), source: 'system', text: 'Canceled by user' },
		]);
		const notice = row(container, 's1');
		expect(notice.getAttribute('data-feed-row')).toBe('notice');
		expect(notice).toHaveTextContent('Canceled by user');
		expect(within(notice).getByRole('img', { name: 'Notice' })).toBeInTheDocument();
		// Not drawn as the legacy full-size bubble.
		expect(notice.querySelector('.pb-10')).toBeNull();
	});

	it('lays the notice icon out as its own column, not a float the fit width ignores', () => {
		// Structure only: jsdom has no layout, so whether a short notice really
		// stays on one line is checked in the installed app.
		const { container } = renderTranscript([
			user('u1', 0, 'Stop it'),
			{ id: 's1', timestamp: at(1), source: 'system', text: '已由用户停止' },
		]);
		const icon = row(container, 's1').querySelector('[data-notice-icon]') as Element;
		const body = icon.parentElement as HTMLElement;
		// The icon is the body's first child; the text follows it in the grid.
		expect(body.firstElementChild).toBe(icon);
		expect(body.className.split(/\s+/)).toEqual(
			expect.arrayContaining(['grid', 'w-fit', 'max-w-full'])
		);
		expect(icon.getAttribute('class') ?? '').not.toContain('float');
		expect(body.querySelector('.float-left')).toBeNull();
		// The text is still the notice's full text, not truncated or forced nowrap.
		expect(body).toHaveTextContent('已由用户停止');
		expect(body.className).not.toContain('whitespace-nowrap');
	});

	it('keeps an error in an error block with its text', () => {
		const { container } = renderTranscript([
			user('u1', 0, 'Q'),
			{ id: 'e1', timestamp: at(1), source: 'error', text: 'Rate limited by provider' },
		]);
		const error = row(container, 'e1');
		expect(error.getAttribute('data-feed-row')).toBe('error');
		expect(error).toHaveTextContent('Rate limited by provider');
	});

	it('keeps cross-agent attribution and shows no setting change for it', () => {
		const { container } = renderTranscript([
			user('u1', 0, '@Reviewer check this'),
			reply('x1', 1, 'Covered both line endings.', {
				turnModel: 'other-model',
				metadata: {
					crossAgent: {
						requestId: 'req-1',
						fromSessionId: 'reviewer-session',
						fromAgentName: 'Reviewer',
						fromToolType: 'codex',
					},
				},
			}),
		]);
		const cross = row(container, 'x1');
		expect(cross.getAttribute('data-feed-row')).toBe('cross');
		expect(cross).toHaveTextContent('Reviewer');
		expect(cross).toHaveTextContent('Covered both line endings.');
		expect(cross.querySelector('[data-turn-setting-change]')).toBeNull();
	});
});

describe('conversation feed: the same actions, the same callbacks', () => {
	it('replays, forks and deletes (after confirming) through the props it always used', () => {
		const onReplayMessage = vi.fn();
		const onForkConversation = vi.fn();
		const onDeleteLog = vi.fn().mockReturnValue(null);
		const { container } = renderTranscript([user('u1', 0, 'Please redo this')], {
			onReplayMessage,
			onForkConversation,
			onDeleteLog,
		});
		const u1 = within(row(container, 'u1'));

		fireEvent.click(u1.getByRole('button', { name: 'Send again' }));
		expect(onReplayMessage).toHaveBeenCalledWith('Please redo this', undefined);

		fireEvent.click(u1.getByRole('button', { name: 'Fork conversation from here' }));
		expect(onForkConversation).toHaveBeenCalledWith('u1');

		fireEvent.click(u1.getByRole('button', { name: 'Delete message and response' }));
		// Nothing is deleted until the confirmation.
		expect(onDeleteLog).not.toHaveBeenCalled();
		fireEvent.click(u1.getByRole('button', { name: 'Yes' }));
		expect(onDeleteLog).toHaveBeenCalledWith('u1');
	});

	it('names every action control', () => {
		const { container } = renderTranscript([user('u1', 0, 'Q'), reply('a1', 1, 'A')]);
		for (const id of ['u1', 'a1']) {
			const meta = row(container, id).querySelector('[data-feed-meta]') as HTMLElement;
			for (const button of Array.from(meta.querySelectorAll('button'))) {
				// Hidden-until-needed controls (the long-message jump) are display:none.
				if ((button as HTMLElement).style.display === 'none') continue;
				expect(button).toHaveAccessibleName();
			}
		}
	});

	it('keeps the legacy titles and callbacks in the agents layout', () => {
		useSettingsStore.setState({ sidebarNavigationMode: 'agents' });
		const onReplayMessage = vi.fn();
		renderTranscript([user('u1', 0, 'Legacy', { delivered: true })], { onReplayMessage });
		fireEvent.click(screen.getByTitle('Replay message'));
		expect(onReplayMessage).toHaveBeenCalledWith('Legacy', undefined);
		expect(screen.getByTitle('Message delivered')).toBeInTheDocument();
		expect(screen.getByTitle('Copy to clipboard')).toBeInTheDocument();
	});
});

describe('conversation feed: tools', () => {
	const call = (id: string, minutes: number, path: string, output: string): LogEntry => ({
		id,
		timestamp: at(minutes),
		source: 'tool',
		text: 'read_file',
		nativeTranscript: { messageId: id },
		metadata: { toolState: { status: 'completed', input: { path }, output } },
	});

	it("folds a finished turn's work behind one row above its answer", () => {
		const { container } = renderTranscript([
			user('u1', 0, 'Read both files'),
			call('t1', 1, 'first.md', 'FIRST FILE BODY'),
			call('t2', 2, 'second.md', 'SECOND FILE BODY'),
			reply('a1', 3, 'Done'),
		]);
		// The fold stands in for the turn's first step and keeps its id.
		const fold = row(container, 't1');
		expect(fold.getAttribute('data-feed-row')).toBe('turn-activity');
		const toggle = within(fold).getByRole('button', { name: 'Worked for 3m 0s' });
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		// Folded means absent, not hidden by a style; the answer stays on the page.
		expect(row(container, 't2')).toBeNull();
		expect(fold.querySelector('[data-turn-activity-steps]')).toBeNull();
		expect(screen.getByText('Done')).toBeInTheDocument();
		expect(fold.compareDocumentPosition(row(container, 'a1'))).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);

		fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-expanded', 'true');
		// One line per call, saying what it did.
		const lines = Array.from(fold.querySelectorAll('[data-tool-activity="read"]'));
		expect(lines.map((line) => line.textContent)).toEqual(['Readfirst.md', 'Readsecond.md']);
		const calls = within(fold).getAllByRole('button', { name: 'Show details for read_file' });
		expect(calls).toHaveLength(2);
		// The turn is open, the calls are not.
		expect(screen.queryByText('FIRST FILE BODY')).toBeNull();
		expect(screen.queryByText('SECOND FILE BODY')).toBeNull();

		fireEvent.click(calls[0]);
		expect(screen.getByText('FIRST FILE BODY')).toBeInTheDocument();
		expect(screen.queryByText('SECOND FILE BODY')).toBeNull();

		fireEvent.click(calls[1]);
		expect(screen.getByText('SECOND FILE BODY')).toBeInTheDocument();

		fireEvent.click(calls[0]);
		expect(screen.queryByText('FIRST FILE BODY')).toBeNull();
		// Closing one call left the other open.
		expect(screen.getByText('SECOND FILE BODY')).toBeInTheDocument();

		fireEvent.click(toggle);
		expect(fold.querySelector('[data-turn-activity-steps]')).toBeNull();
	});

	it('names a failed step on the folded row', () => {
		const { container } = renderTranscript([
			user('u1', 0, 'Lint it'),
			{
				id: 't1',
				timestamp: at(1),
				source: 'tool',
				text: 'exec_command',
				nativeTranscript: { messageId: 't1' },
				metadata: { toolState: { status: 'failed', input: { cmd: 'npx eslint src' } } },
			},
			reply('a1', 2, 'Lint reported one error.'),
		]);
		const status = row(container, 't1').querySelector('[data-tool-status]') as HTMLElement;
		expect(status.getAttribute('data-tool-status')).toBe('error');
		expect(status).toHaveTextContent('Failed');
	});

	it('keeps the turn still working unfolded, and folds it once it answers', () => {
		const logs = [
			user('u1', 0, 'Read it'),
			reply('p1', 1, 'Opening the file.', {
				nativeTranscript: { messageId: 'p1', channel: 'commentary' },
			}),
			call('t1', 1, 'first.md', 'FIRST FILE BODY'),
		];
		const { container, rerenderWith } = renderTranscript(logs);
		expect(row(container, 'p1').getAttribute('data-progress-note')).not.toBeNull();
		expect(row(container, 't1').querySelector('[data-tool-activity="read"]')).not.toBeNull();

		rerenderWith([...logs, reply('a1', 2, 'It says hello.')]);
		expect(row(container, 'p1').getAttribute('data-feed-row')).toBe('turn-activity');
		expect(row(container, 't1')).toBeNull();
		expect(screen.getByText('It says hello.')).toBeInTheDocument();
	});

	it('shows every step while searching, so each match is on the page', () => {
		const { container } = renderTranscript(
			[
				user('u1', 0, 'Read both files'),
				call('t1', 1, 'first.md', 'FIRST FILE BODY'),
				reply('a1', 3, 'Done'),
			],
			{ outputSearchQuery: 'first' }
		);
		// The search query is debounced; the fold lifts once it settles.
		return vi.waitFor(() =>
			expect(row(container, 't1').querySelector('[data-tool-activity="read"]')).not.toBeNull()
		);
	});

	it('states a stopped run in words, not only a glyph', () => {
		const { container } = renderTranscript([
			user('u1', 0, 'Run tests'),
			{
				id: 't1',
				timestamp: at(1),
				source: 'tool',
				text: 'shell',
				nativeTranscript: { messageId: 't1' },
				metadata: { toolState: { status: 'canceled', input: 'npm test' } },
			},
		]);
		const status = row(container, 't1').querySelector('[data-tool-status]') as HTMLElement;
		expect(status.getAttribute('data-tool-status')).toBe('canceled');
		expect(status).toHaveTextContent('Stopped');
		expect(status).toHaveAttribute('title', 'Stopped before it finished');
	});

	it('keeps the verb and status words whole; only the command gives way', () => {
		// Structure only (no layout in jsdom). In a narrow window a shrinkable
		// wrapper let "运行中" / "已停止" break between characters.
		const { container } = renderTranscript([
			user('u1', 0, 'Wait'),
			{
				id: 't1',
				timestamp: at(1),
				source: 'tool',
				text: 'shell',
				nativeTranscript: { messageId: 't1' },
				metadata: {
					toolState: { status: 'canceled', input: { command: '/bin/zsh -c "python3 -u ..."' } },
				},
			},
		]);
		const classesOf = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);
		const callLine = within(row(container, 't1')).getByRole('button', {
			name: 'Show details for shell',
		});
		const status = callLine.querySelector('[data-tool-status]') as Element;
		expect(classesOf(status)).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap']));
		expect(status).toHaveTextContent('Stopped');
		expect(classesOf(within(callLine).getByText('Ran'))).toEqual(
			expect.arrayContaining(['shrink-0', 'whitespace-nowrap'])
		);
		// The shell wrapper says nothing, so the line shows the command itself.
		const command = within(callLine).getByText('python3 -u ...');
		expect(classesOf(command)).toEqual(expect.arrayContaining(['truncate', 'min-w-0']));
	});

	it('shows a live call running, then done, with its output intact', () => {
		const running: LogEntry = {
			id: 'live-1',
			timestamp: at(1),
			source: 'tool',
			text: 'shell',
			metadata: { toolState: { status: 'running', input: 'npx eslint src/renderer' } },
		};
		const logs = [user('u1', 0, 'Lint it'), running];
		const { container, rerenderWith } = renderTranscript(logs);
		const live = () => row(container, 'live-1');
		// The turn still running stays open: the call is one line with its state.
		expect(within(live()).getByRole('status')).toHaveTextContent('Running');
		expect(live()).toHaveTextContent('npx eslint src/renderer');

		rerenderWith([
			logs[0],
			{
				...running,
				metadata: {
					toolState: {
						status: 'completed',
						input: 'npx eslint src/renderer',
						output: 'ESLINT CLEAN OUTPUT',
					},
				},
			},
		]);
		// Done is the expected outcome: no status word.
		expect(within(live()).queryByRole('status')).toBeNull();
		expect(live().querySelector('[data-tool-status]')).toBeNull();
		fireEvent.click(within(live()).getByRole('button', { name: 'Show details for shell' }));
		expect(screen.getByText('ESLINT CLEAN OUTPUT')).toBeInTheDocument();
	});
});
