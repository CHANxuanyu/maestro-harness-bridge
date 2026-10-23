/**
 * Loading earlier history must keep the user on the rows they were reading.
 *
 * Regression for a real GUI failure: after scrolling to the top of a long Codex
 * conversation, "Loading earlier messages..." finished and the view jumped to
 * a much LATER point with a "99+ new messages" badge. Causes, all in
 * TerminalOutput: the render window was shifted by the backfill's RAW entry
 * count while it indexes RENDERED rows (tool runs fold dozens of entries into
 * one row, hidden reasoning renders none); the unread counter read history
 * prepended at the head as new messages arriving at the tail; and the scroll
 * position was kept by distance from the BOTTOM, which moves the reader as
 * soon as anything lands on the tail in the same commit, and by nothing at
 * all when the history status row appeared or went away.
 *
 * Drives the real TerminalOutput, its render window and useTerminalOutputScroll.
 * Only the disk read of the backfill hook is replaced, by a stub that hands
 * back its `onPrepend` and lets the test set its status. jsdom has no layout,
 * so the scroll container and its rows get a simulated one: every transcript
 * row is ROW_H tall (ROW_H per stored answer for a merged response row), every
 * other row of the content wrapper (the history status row) is STATUS_H tall,
 * stacked in DOM order and offset by scrollTop. Assertions are on the viewport
 * offset of the row the reader was on.
 *
 * The idle render window is stepped one scheduled chunk per act() (see
 * hydrateWindow): inside one act() React keeps a chunk's state update queued
 * until the scope exits, so the effect that schedules the NEXT chunk never
 * runs during a single long timer advance - one advance only ever mounts one
 * chunk. In the app every chunk commits as its own task, which is what the
 * stepping reproduces.
 */

import React, { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { render, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LogEntry, Session } from '../../../../renderer/types';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { mockTheme } from '../../../helpers/mockTheme';

vi.mock('react-markdown', () => ({
	default: ({ children }: { children: string }) => (
		<div data-testid="react-markdown">{children}</div>
	),
}));
vi.mock('remark-gfm', () => ({ default: [] }));
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }));
vi.mock('ansi-to-html', () => ({
	default: class Convert {
		toHtml(text: string) {
			return text;
		}
	},
}));
vi.mock('../../../../renderer/contexts/LayerStackContext', () => ({
	useLayerStack: () => ({
		registerLayer: vi.fn().mockReturnValue('layer-1'),
		unregisterLayer: vi.fn(),
		updateLayerHandler: vi.fn(),
	}),
}));
vi.mock('../../../../renderer/utils/tabHelpers', () => ({
	getActiveTab: (session: Session) =>
		session.aiTabs?.find((t) => t.id === session.activeTabId) || session.aiTabs?.[0],
}));

// Capture the transcript's onPrepend and drive its status; the disk read
// itself is not under test.
const backfill = vi.hoisted(() => ({
	onPrepend: undefined as undefined | ((n: number) => void),
	isLoading: false,
	reachedStart: false,
	error: null as string | null,
	loadEarlier: (() => {}) as () => void,
}));
vi.mock('../../../../renderer/hooks/agent/useTranscriptBackfill', () => ({
	useTranscriptBackfill: (_s: unknown, _t: unknown, opts: { onPrepend?: (n: number) => void }) => {
		backfill.onPrepend = opts.onPrepend;
		return {
			isLoading: backfill.isLoading,
			reachedStart: backfill.reachedStart,
			error: backfill.error,
			loadEarlier: backfill.loadEarlier,
		};
	},
}));

import { TerminalOutput } from '../../../../renderer/components/TerminalOutput';
import { requestTranscriptScrollToBottom } from '../../../../renderer/services/transcriptScroll';

// ----------------------------------------------------------------------------
// Simulated layout
// ----------------------------------------------------------------------------
const ROW_H = 100;
const STATUS_H = 40;
// The scroller's viewport height. Mutable because the busy strip appearing
// above the composer when a turn starts shrinks it (707 -> 670 in the GUI log).
let CLIENT_H = 500;

let scroller: HTMLElement | null = null;
let scrollTopValue = 0;
let roundScrollTopGetter = false;
let snapProgrammaticScroll = false;
let pendingScrollEcho = false;

/** Deliver the scroll event a programmatic scroll owes, at a frame boundary. */
function flushScrollEcho() {
	if (!pendingScrollEcho || !scroller) return;
	pendingScrollEcho = false;
	act(() => {
		fireEvent.scroll(scroller!);
	});
}

const contentOf = (el: HTMLElement) =>
	(el.querySelector('[data-log-id]')?.parentElement as HTMLElement | null) ?? null;
// A response row is ROW_H per stored answer it holds, so a row that two
// answers were merged into (collapse boundary) is taller, the way it is on
// screen; every other transcript row is ROW_H.
const heightOf = (el: Element) =>
	el.hasAttribute('data-log-id')
		? ROW_H * Math.max(1, (el.textContent?.match(/ answer\b/g) ?? []).length) +
			(extraHeight.get(el.getAttribute('data-log-id')!) ?? 0)
		: STATUS_H;
// Height a row gained after layout with no DOM change of ours: what a
// `content-visibility: auto` row does when it swaps its intrinsic-size estimate
// for its real height as it comes into range.
const extraHeight = new Map<string, number>();

// ResizeObservers the transcript creates, so a test can deliver a content-box
// change the way the browser would after such a layout shift. Built on the
// setup mock, so its one initial notification still happens.
const resizeObservers: Array<{ callback: ResizeObserverCallback; targets: Element[] }> = [];
const BaseResizeObserver = globalThis.ResizeObserver;
class CapturingResizeObserver extends BaseResizeObserver {
	constructor(callback: ResizeObserverCallback) {
		super(callback);
		const record = { callback, targets: [] as Element[] };
		resizeObservers.push(record);
		const observe = this.observe.bind(this);
		this.observe = (target: Element, options?: ResizeObserverOptions) => {
			record.targets.push(target);
			observe(target, options);
		};
	}
}
/** Notify every observer watching the transcript's content wrapper. */
function fireContentResize() {
	const content = contentOf(scroller!)!;
	act(() => {
		for (const o of resizeObservers) {
			if (o.targets.includes(content)) o.callback([], {} as ResizeObserver);
		}
	});
}
const contentHeight = () => {
	const content = scroller ? contentOf(scroller) : null;
	return content ? Array.from(content.children).reduce((sum, el) => sum + heightOf(el), 0) : 0;
};
const maxScrollTop = () => Math.max(0, contentHeight() - CLIENT_H);
const setScrollTop = (value: number) => {
	scrollTopValue = Math.min(Math.max(0, value), maxScrollTop());
};
const rect = (top: number, height: number) =>
	({ top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top }) as DOMRect;

const originalRect = Element.prototype.getBoundingClientRect;
function simulatedRect(this: Element): DOMRect {
	// After a remount the old scroller is detached; follow the new one, so the
	// geometry is live during the remount's own layout effects.
	if (scroller && !scroller.isConnected && document.querySelector('.overflow-y-auto')) {
		installLayout(document.body);
	}
	if (!scroller) return originalRect.call(this);
	if (this === scroller) return rect(0, CLIENT_H);
	const content = contentOf(scroller);
	if (content && this.parentElement === content) {
		let top = 0;
		for (const sibling of Array.from(content.children)) {
			if (sibling === this) break;
			top += heightOf(sibling);
		}
		return rect(top - scrollTopValue, heightOf(this));
	}
	return originalRect.call(this);
}

function installLayout(container: HTMLElement) {
	scroller = container.querySelector('.overflow-y-auto') as HTMLElement;
	Object.defineProperty(scroller, 'scrollTop', {
		configurable: true,
		// Under display scaling the real offset is fractional while the getter
		// may report it rounded; `roundScrollTopGetter` models that.
		get: () => (roundScrollTopGetter ? Math.round(scrollTopValue) : scrollTopValue),
		set: (v: number) => setScrollTop(v),
	});
	// Relative scrolling acts on the real offset, never on the rounded readout.
	// With `snapProgrammaticScroll` it behaves like a real scroller given a
	// fractional delta: the offset lands on a device pixel (2x) and the write
	// owes a scroll event. Like a browser, the event is NOT dispatched inside
	// the write (which here runs inside React's commit) but later, coalesced to
	// one per frame: `flushScrollEcho()` delivers it.
	(scroller as any).scrollBy = (opts: { top?: number }) => {
		const next = scrollTopValue + (opts?.top ?? 0);
		setScrollTop(snapProgrammaticScroll ? Math.floor(next * 2) / 2 : next);
		if (snapProgrammaticScroll) pendingScrollEcho = true;
	};
	Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: contentHeight });
	Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => CLIENT_H });
	(scroller as any).scrollTo = (opts: { top?: number }) => setScrollTop(opts?.top ?? 0);
}

/** The row at the top of the viewport and its edges' offsets from the viewport top. */
function readingRow(): { id: string; top: number; bottom: number } {
	const content = contentOf(scroller!)!;
	const row = Array.from(content.querySelectorAll(':scope > [data-log-id]')).find(
		(el) => el.getBoundingClientRect().bottom > 0
	)!;
	const { top, bottom } = row.getBoundingClientRect();
	return { id: row.getAttribute('data-log-id')!, top, bottom };
}

/** A real user scroll: input first (what tells it apart from our own writes), then the scroll. */
async function userScrollTo(top: number) {
	act(() => {
		setScrollTop(top);
		fireEvent.wheel(scroller!, { deltaY: -400 });
		fireEvent.scroll(scroller!);
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(50);
	});
}

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------
const native = (id: string) => ({ nativeTranscript: { messageId: id } });

/**
 * A live provider progress note (Codex commentary), as the thinking-chunk
 * listener writes it: stdout with the `purpose: 'commentary'` marker.
 */
const liveProgressNote = (id: string): LogEntry => ({
	id,
	timestamp: 99_000,
	source: 'stdout',
	purpose: 'commentary',
	text: 'Checking the build logs',
});

/** One stored turn: question, a run of `tools` tool calls, hidden reasoning, an answer. */
function turn(prefix: string, ts: number, tools: number): LogEntry[] {
	return [
		{
			id: `${prefix}-q`,
			timestamp: ts,
			source: 'user',
			text: `${prefix} question`,
			...native(`${prefix}-q`),
		},
		...Array.from({ length: tools }, (_, i) => ({
			id: `${prefix}-t${i}`,
			timestamp: ts + 1 + i,
			source: 'tool' as const,
			text: 'exec_command',
			metadata: { toolState: { status: 'completed' as const, output: `out ${i}` } },
			...native(`${prefix}-t${i}`),
		})),
		{
			id: `${prefix}-r`,
			timestamp: ts + 50,
			source: 'thinking',
			text: `${prefix} reasoning`,
			...native(`${prefix}-r`),
		},
		{
			id: `${prefix}-a`,
			timestamp: ts + 100,
			source: 'stdout',
			text: `${prefix} answer`,
			...native(`${prefix}-a`),
		},
	];
}

function sessionWith(logs: LogEntry[], { busy = false }: { busy?: boolean } = {}): Session {
	return {
		id: 'session-1',
		name: 'Test',
		toolType: 'codex',
		state: busy ? 'busy' : 'idle',
		inputMode: 'ai',
		cwd: '/p',
		projectRoot: '/p',
		aiLogs: [],
		shellLogs: [],
		isGitRepo: false,
		fileTree: [],
		fileExplorerExpanded: [],
		messageQueue: [],
		aiTabs: [
			{
				id: 'tab-1',
				agentSessionId: 'native-1',
				logs,
				isUnread: false,
				showThinking: 'off',
				state: busy ? 'busy' : 'idle',
			},
		],
		activeTabId: 'tab-1',
		terminalTabs: [],
		activeTerminalTabId: null,
	} as unknown as Session;
}

function props(session: Session, saved?: { initialScrollTop: number; initialIsAtBottom: boolean }) {
	return {
		...saved,
		session,
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
		inputRef: { current: null } as React.RefObject<HTMLTextAreaElement>,
		logsEndRef: { current: null } as React.RefObject<HTMLDivElement>,
		maxOutputLines: 50,
		markdownEditMode: false,
		setMarkdownEditMode: vi.fn(),
	} as unknown as React.ComponentProps<typeof TerminalOutput>;
}

const renderedIds = (container: HTMLElement) =>
	Array.from(
		contentOf(scroller ?? container)?.querySelectorAll(':scope > [data-log-id]') ?? []
	).map((el) => el.getAttribute('data-log-id'));
const unreadButton = (container: HTMLElement) =>
	container.querySelector('button[title^="New messages"]');

const current = Array.from({ length: 12 }, (_, i) => turn(`now${i}`, 10_000 + i * 1_000, 6)).flat();
// 10 older turns with long tool runs and hidden reasoning: 110 raw entries,
// but only 3 rows per turn (question, folded tool run, answer).
const older = Array.from({ length: 10 }, (_, i) => turn(`old${i}`, 1_000 + i * 200, 8)).flat();

/**
 * Step the idle render window one scheduled chunk per act() until it stops
 * growing (see the file header for why one long advance is not enough).
 * `onStep` runs after every chunk's commit, so a test can hold the reading
 * position to account at each one rather than only at the end.
 */
async function hydrateWindow(container: HTMLElement, onStep?: () => void) {
	let unchanged = 0;
	for (let step = 0; step < 60 && unchanged < 3; step++) {
		const rowsBefore = renderedIds(container).length;
		await act(async () => {
			// Just past one tick of the window's 16ms idle fallback.
			await vi.advanceTimersByTimeAsync(20);
		});
		onStep?.();
		unchanged = renderedIds(container).length === rowsBefore ? unchanged + 1 : 0;
	}
	expect(unchanged).toBe(3);
}

/** Collects every transcript row mounted while `fn` runs (for no-eager-mount checks). */
function rowsMountedDuring(fn: () => void): string[] {
	const content = contentOf(scroller!)!;
	const observer = new MutationObserver(() => {});
	observer.observe(content, { childList: true });
	fn();
	const records = observer.takeRecords();
	observer.disconnect();
	return records.flatMap((r) =>
		Array.from(r.addedNodes)
			.filter((n): n is Element => n instanceof Element && n.hasAttribute('data-log-id'))
			.map((el) => el.getAttribute('data-log-id')!)
	);
}

async function mountScrolledIntoHistory(logs: LogEntry[] = current, scrollTop = 5 * ROW_H + 37) {
	const utils = render(<TerminalOutput {...props(sessionWith(logs))} />);
	installLayout(utils.container);
	// Let the idle window mount the whole local list, as after reading up to it.
	await hydrateWindow(utils.container);
	expect(renderedIds(utils.container)[0]).toBe(logs[0].id);
	// The reader is partway up, mid-row, well away from the tail.
	await userScrollTo(scrollTop);
	const before = readingRow();
	expect(before.top).toBe(-37);
	return { ...utils, before };
}

// Both layouts: the agents layout is the baseline these cases were written
// against, and the conversation layout draws the same rows as a feed (no
// bubbles, a meta line under each message). The anchor must hold in both.
describe.each(['agents', 'conversations'] as const)(
	'TerminalOutput (%s layout): loading earlier history keeps the reading position',
	(navigationMode) => {
		beforeEach(() => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			// Tool calls folded into runs (the default).
			useSettingsStore.setState({ showToolCalls: false, sidebarNavigationMode: navigationMode });
			backfill.onPrepend = undefined;
			backfill.isLoading = false;
			backfill.reachedStart = false;
			backfill.error = null;
			backfill.loadEarlier = vi.fn();
			scroller = null;
			scrollTopValue = 0;
			Element.prototype.getBoundingClientRect = simulatedRect;
			extraHeight.clear();
			roundScrollTopGetter = false;
			CLIENT_H = 500;
			snapProgrammaticScroll = false;
			pendingScrollEcho = false;
			resizeObservers.length = 0;
			globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
		});
		afterEach(() => {
			Element.prototype.getBoundingClientRect = originalRect;
			globalThis.ResizeObserver = BaseResizeObserver;
			vi.useRealTimers();
		});

		it('keeps the reader on the same row at the same offset, and adds no unread, for a history prepend', async () => {
			const { container, rerender, before } = await mountScrolledIntoHistory();
			expect(unreadButton(container)).toBeNull();

			const mounted = rowsMountedDuring(() =>
				act(() => {
					backfill.onPrepend!(older.length);
					rerender(<TerminalOutput {...props(sessionWith([...older, ...current]))} />);
				})
			);
			// The page is not mounted in the commit that brings it in, not even
			// transiently: the window starts at the row the reader's window started at.
			expect(mounted.filter((id) => id.startsWith('old'))).toEqual([]);
			expect(renderedIds(container)[0]).toBe('now0-q');
			expect(readingRow()).toEqual(before);
			// History above is not "new messages", folded tools and hidden reasoning included.
			expect(unreadButton(container)).toBeNull();
			expect(container.textContent).not.toMatch(/99\+/);

			// The older rows arrive through the idle loop, a chunk at a time, above
			// the anchor - and every chunk leaves the reader where they were.
			let chunks = 0;
			await hydrateWindow(container, () => {
				chunks++;
				expect(readingRow()).toEqual(before);
				expect(unreadButton(container)).toBeNull();
			});
			const ids = renderedIds(container);
			expect(ids[0]).toBe('old0-q');
			expect(ids.indexOf('old9-a')).toBeGreaterThan(0);
			expect(ids.indexOf('old9-a')).toBeLessThan(ids.indexOf('now0-q'));
			// 30 history rows in chunks of 8: it took several commits, not one.
			expect(chunks).toBeGreaterThanOrEqual(4);
			expect(readingRow()).toEqual(before);
			expect(unreadButton(container)).toBeNull();
		});

		it('counts exactly one unread for a tail entry that lands in the same commit as the prepend', async () => {
			const { container, rerender, before } = await mountScrolledIntoHistory();
			// A live progress note, as the agent emits between tool calls: its own row
			// (collapseAiResponseLogs never folds it into the answer above it).
			const tail = liveProgressNote('live-p');

			act(() => {
				backfill.onPrepend!(older.length);
				rerender(<TerminalOutput {...props(sessionWith([...older, ...current, tail]))} />);
			});
			// It really is a distinct row, the last one.
			expect(renderedIds(container).slice(-1)[0]).toBe('live-p');
			// Bottom distance would have moved the reader by the tail's height.
			expect(readingRow()).toEqual(before);
			const jump = unreadButton(container);
			expect(jump).not.toBeNull();
			expect(jump!.textContent?.trim()).toBe('1');

			// Expanding the window over the history does not add to it.
			await hydrateWindow(container, () => {
				expect(readingRow()).toEqual(before);
				expect(unreadButton(container)!.textContent?.trim()).toBe('1');
			});
			expect(renderedIds(container)[0]).toBe('old0-q');
			expect(readingRow()).toEqual(before);
			expect(unreadButton(container)!.textContent?.trim()).toBe('1');
		});

		it('keeps the reader on a row the newest prepended answer merges into', async () => {
			// The tab's slice starts mid-turn, on an answer; the page read back from
			// disk ends with the same turn's earlier answer, so the two collapse into
			// one response row whose id is the OLDER entry's.
			const head: LogEntry = {
				id: 'head-a',
				timestamp: 9_000,
				source: 'stdout',
				text: 'head answer',
				...native('head-a'),
			};
			const local = [head, ...current];
			const { container, rerender, before } = await mountScrolledIntoHistory(local, 37);
			expect(before.id).toBe('head-a');

			act(() => {
				backfill.onPrepend!(older.length);
				rerender(<TerminalOutput {...props(sessionWith([...older, ...local]))} />);
			});
			// The reader's row is now the merged one. Its new content is older and sits
			// above what they were reading, so the part they were on - the row's
			// bottom edge - has not moved.
			const merged = readingRow();
			expect(merged.id).toBe('old9-a');
			expect(merged.bottom).toBe(before.bottom);
			// It really is the merged row: twice as tall as a single-answer row.
			const single = contentOf(scroller!)!.querySelector(':scope > [data-log-id="now0-a"]')!;
			const singleHeight = single.getBoundingClientRect().height;
			expect(merged.bottom - merged.top).toBe(2 * singleHeight);
			expect(renderedIds(container)[0]).toBe('old9-a');
			expect(unreadButton(container)).toBeNull();

			await hydrateWindow(container, () => {
				expect(readingRow()).toEqual(merged);
				expect(unreadButton(container)).toBeNull();
			});
			expect(renderedIds(container)[0]).toBe('old0-q');
			expect(readingRow()).toEqual(merged);
		});

		it('does not move the reader when the history status row appears or goes away', async () => {
			const { container, rerender, before } = await mountScrolledIntoHistory();
			const session = sessionWith(current);

			act(() => {
				backfill.isLoading = true;
				rerender(<TerminalOutput {...props(session)} />);
			});
			// The status row is mounted above the reader...
			const content = contentOf(scroller!)!;
			expect(content.firstElementChild?.hasAttribute('data-log-id')).toBe(false);
			expect(readingRow()).toEqual(before);

			act(() => {
				backfill.isLoading = false;
				rerender(<TerminalOutput {...props(session)} />);
			});
			// ...and its removal (the ~40px shift) is absorbed too.
			expect(content.firstElementChild?.hasAttribute('data-log-id')).toBe(true);
			expect(readingRow()).toEqual(before);
			expect(unreadButton(container)).toBeNull();
		});

		it('still counts a genuine new tail message after a history load', async () => {
			const { container, rerender, before } = await mountScrolledIntoHistory();
			act(() => {
				backfill.onPrepend!(older.length);
				rerender(<TerminalOutput {...props(sessionWith([...older, ...current]))} />);
			});
			expect(unreadButton(container)).toBeNull();

			// A new user turn arrives while the reader is up in history (a queued
			// message draining, or one dispatched from another client).
			const tail: LogEntry = {
				id: 'live-q',
				timestamp: 99_000,
				source: 'user',
				text: 'a queued follow-up',
			};
			const rowsBefore = renderedIds(container).length;
			act(() => {
				rerender(<TerminalOutput {...props(sessionWith([...older, ...current, tail]))} />);
			});
			expect(renderedIds(container).length).toBe(rowsBefore + 1);
			expect(renderedIds(container).slice(-1)[0]).toBe('live-q');
			const jump = unreadButton(container);
			expect(jump).not.toBeNull();
			expect(jump!.textContent?.trim()).toBe('1');
			expect(readingRow()).toEqual(before);
		});

		it('counts a streamed answer once, however many chunks extend it', async () => {
			const { container, rerender, before } = await mountScrolledIntoHistory();
			act(() => {
				backfill.onPrepend!(older.length);
				rerender(<TerminalOutput {...props(sessionWith([...older, ...current]))} />);
			});
			// A new turn arrives from elsewhere while the tab streams it (busy), so
			// the conversation layout keeps that turn unfolded.
			const show = (tail: LogEntry[]) =>
				act(() => {
					rerender(
						<TerminalOutput
							{...props(sessionWith([...older, ...current, ...tail], { busy: true }))}
						/>
					);
				});
			const count = () => unreadButton(container)?.textContent?.trim();

			// The live turn: its question, a progress note, then the answer starts
			// streaming. Three distinct rows, three unread.
			const ask: LogEntry = { id: 'live-q', timestamp: 98_900, source: 'user', text: 'Why?' };
			const note = liveProgressNote('live-p');
			const answer = (text: string): LogEntry => ({
				id: 'live-a',
				timestamp: 99_100,
				source: 'stdout',
				text,
			});
			show([ask, note]);
			expect(count()).toBe('2');
			show([ask, note, answer('The build')]);
			expect(renderedIds(container).slice(-2)).toEqual(['live-p', 'live-a']);
			expect(count()).toBe('3');
			const rows = renderedIds(container).length;

			// Further chunks coalesce into the same entry (the data listener appends
			// to an open stream) - the answer grows, it is not a new message.
			let text = 'The build';
			for (const chunk of [' failed', ' in the', ' linker', ' step.']) {
				text += chunk;
				show([ask, note, answer(text)]);
				expect(renderedIds(container).length).toBe(rows);
				expect(count()).toBe('3');
				expect(readingRow()).toEqual(before);
			}

			// A chunk that arrived as its own entry, with no boundary in between,
			// folds into the same response bubble: still the same message.
			show([
				ask,
				note,
				answer(text),
				{ id: 'live-a2', timestamp: 99_200, source: 'stdout', text: ' Retrying.' },
			]);
			expect(renderedIds(container).length).toBe(rows);
			expect(renderedIds(container)).not.toContain('live-a2');
			expect(count()).toBe('3');
			expect(readingRow()).toEqual(before);
		});

		it('holds the reader when rows above grow with no scroll, and through a later refresh', async () => {
			const { container, rerender, before } = await mountScrolledIntoHistory();
			// A row above the reader swaps its height estimate for its real height:
			// nothing scrolls and no scroll event fires; the content box changes.
			const above = renderedIds(container)[3]!;
			extraHeight.set(above, 250);
			// Without a correction this is what the screen would show.
			expect(readingRow()).not.toEqual(before);
			fireContentResize();
			expect(readingRow()).toEqual(before);

			// Seconds later a native refresh appends the controller's progress note:
			// no jump in either direction.
			act(() => {
				rerender(
					<TerminalOutput {...props(sessionWith([...current, liveProgressNote('live-p')]))} />
				);
			});
			expect(renderedIds(container).slice(-1)[0]).toBe('live-p');
			expect(readingRow()).toEqual(before);
			expect(unreadButton(container)!.textContent?.trim()).toBe('1');
		});

		it('brings the reader back to the same message when the transcript remounts', async () => {
			const { container, rerender, unmount } = await mountScrolledIntoHistory();
			const all = [...older, ...current];
			act(() => {
				backfill.onPrepend!(older.length);
				rerender(<TerminalOutput {...props(sessionWith(all))} />);
			});
			await hydrateWindow(container);
			expect(renderedIds(container)[0]).toBe('old0-q');
			const before = readingRow();
			const totalRows = renderedIds(container).length;
			// What the tab persisted: an absolute offset into the FULLY mounted list.
			const savedScrollTop = scrollTopValue;

			// Away to another agent or a file tab and back: the transcript is keyed
			// per agent and tab, so it unmounts and mounts fresh, newest rows first.
			unmount();
			scrollTopValue = 0;
			const back = render(
				<TerminalOutput
					{...props(sessionWith(all), {
						initialScrollTop: savedScrollTop,
						initialIsAtBottom: false,
					})}
				/>
			);
			installLayout(back.container);

			// Same message, same pixel offset, before any idle tick.
			expect(readingRow()).toEqual(before);
			// Only the rows from the reader's message down were mounted for it.
			const mounted = renderedIds(back.container);
			expect(mounted[0]).toBe(before.id);
			expect(mounted.length).toBeLessThan(totalRows);
			expect(unreadButton(back.container)).toBeNull();

			// The rest of the history mounts above it without moving the reader.
			await hydrateWindow(back.container, () => {
				expect(readingRow()).toEqual(before);
			});
			expect(renderedIds(back.container)[0]).toBe('old0-q');
			expect(readingRow()).toEqual(before);
			expect(unreadButton(back.container)).toBeNull();
		});

		describe('real row heights arriving after a remount', () => {
			const all = [...older, ...current];

			/** Scrolled into history after a prepend and full hydration, as in the GUI. */
			async function readingDeepHistory() {
				const utils = await mountScrolledIntoHistory();
				act(() => {
					backfill.onPrepend!(older.length);
					utils.rerender(<TerminalOutput {...props(sessionWith(all))} />);
				});
				await hydrateWindow(utils.container);
				return { ...utils, before: readingRow() };
			}

			/** Leave (unmount) and come back with what the tab persisted. */
			function leaveAndReturn(current: { unmount: () => void }) {
				const savedScrollTop = scrollTopValue;
				// An echo owed by the old scroller dies with it.
				pendingScrollEcho = false;
				current.unmount();
				// A fresh mount lays every row out at its estimate again.
				extraHeight.clear();
				scrollTopValue = 0;
				const back = render(
					<TerminalOutput
						{...props(sessionWith(all), {
							initialScrollTop: savedScrollTop,
							initialIsAtBottom: false,
						})}
					/>
				);
				installLayout(back.container);
				return back;
			}

			/**
			 * The `content-visibility: auto` step: rows that come into range just above
			 * the reader swap their estimate for a taller real height, after the
			 * commit that mounted them, and the content box reports the change.
			 */
			function settleRealHeightsAbove(container: HTMLElement, readerId: string, grow = 300) {
				const ids = renderedIds(container) as string[];
				const at = ids.indexOf(readerId);
				let grew = false;
				for (const id of ids.slice(Math.max(0, at - 3), Math.max(0, at))) {
					if (extraHeight.has(id)) continue;
					extraHeight.set(id, grow);
					grew = true;
				}
				if (grew) fireContentResize();
			}

			it('returns to the same message every time, not a screen earlier each time', async () => {
				let view = await readingDeepHistory();
				const { before } = view;
				for (let round = 0; round < 2; round++) {
					const back = leaveAndReturn(view);
					expect(readingRow()).toEqual(before);
					settleRealHeightsAbove(back.container, before.id);
					expect(readingRow()).toEqual(before);
					await hydrateWindow(back.container, () => {
						settleRealHeightsAbove(back.container, before.id);
						expect(readingRow()).toEqual(before);
					});
					expect(renderedIds(back.container)[0]).toBe('old0-q');
					expect(readingRow()).toEqual(before);
					expect(unreadButton(back.container)).toBeNull();
					view = { ...view, ...back };
				}
			});

			it('holds the position the user scrolled to, not the restored one', async () => {
				const view = await readingDeepHistory();
				const back = leaveAndReturn(view);
				expect(readingRow()).toEqual(view.before);
				await hydrateWindow(back.container);
				// The user takes over and reads further up.
				await userScrollTo(scrollTopValue - 450);
				const chosen = readingRow();
				expect(chosen.id).not.toBe(view.before.id);
				// Real heights then arrive above what they are now reading: the hold
				// keeps THEIR position, and nothing later pulls them back.
				settleRealHeightsAbove(back.container, chosen.id);
				expect(readingRow()).toEqual(chosen);
				await act(async () => {
					await vi.advanceTimersByTimeAsync(2_000);
				});
				expect(readingRow()).toEqual(chosen);
			});

			it('never lets its own corrections move the target, however many it runs', async () => {
				let view = await readingDeepHistory();
				const { before } = view;
				// Each correction now lands on a device pixel and echoes a scroll event,
				// as a real scroller does with a fractional delta; real heights arrive
				// fractional. A target that followed where each correction landed would
				// drift by those landing errors, one correction after another, and the
				// unmount would save the drifted value for the next return.
				snapProgrammaticScroll = true;
				const near = (got: { id: string; top: number }) => {
					expect(got.id).toBe(before.id);
					expect(Math.abs(got.top - before.top)).toBeLessThanOrEqual(0.5);
				};
				// Each step ends at a frame boundary: the echo owed by that frame's
				// corrections is delivered, then the reader is checked.
				const settle = (container: HTMLElement) => {
					flushScrollEcho();
					settleRealHeightsAbove(container, before.id, 300.3);
					flushScrollEcho();
					near(readingRow());
				};
				for (let round = 0; round < 3; round++) {
					const back = leaveAndReturn(view);
					flushScrollEcho();
					near(readingRow());
					settle(back.container);
					await hydrateWindow(back.container, () => settle(back.container));
					flushScrollEcho();
					near(readingRow());
					view = { ...view, ...back };
				}
			});

			it('keeps the target for a sub-pixel scroll and takes a real scroll as the new one', async () => {
				const { rerender, before } = await readingDeepHistory();
				// Within one device pixel of the target: what our own correction's echo
				// looks like, so the target stands and the next commit lands on it.
				await userScrollTo(scrollTopValue + 0.5);
				act(() => {
					rerender(
						<TerminalOutput {...props(sessionWith([...all, liveProgressNote('live-p1')]))} />
					);
				});
				expect(readingRow()).toEqual(before);

				// A real move is the reader's new target and survives the next commit.
				await userScrollTo(scrollTopValue + 40);
				const moved = readingRow();
				expect(moved.top).toBe(before.top - 40);
				act(() => {
					rerender(
						<TerminalOutput
							{...props(
								sessionWith([...all, liveProgressNote('live-p1'), liveProgressNote('live-p2')])
							)}
						/>
					);
				});
				expect(readingRow()).toEqual(moved);
			});

			it('does not creep a pixel per return when the offset is fractional', async () => {
				let view = await readingDeepHistory();
				// The reader scrolls on to a position that sits on a half pixel, as
				// display scaling produces (a real move, so it is the new target)...
				await userScrollTo(scrollTopValue + 300.5);
				const before = readingRow();
				expect(before.id).not.toBe(view.before.id);
				expect(before.top % 1).not.toBe(0);
				// ...while the scrollTop getter reports it rounded.
				roundScrollTopGetter = true;
				for (let round = 0; round < 2; round++) {
					const back = leaveAndReturn(view);
					expect(readingRow()).toEqual(before);
					// Rows mounting above and real heights arriving each correct the
					// offset; none of those corrections may pick up the rounding.
					await hydrateWindow(back.container, () => {
						settleRealHeightsAbove(back.container, before.id);
						expect(readingRow()).toEqual(before);
					});
					expect(readingRow()).toEqual(before);
					view = { ...view, ...back };
				}
			});
		});

		describe('a turn the user sends while reading history', () => {
			const atBottom = () => Math.abs(scrollTopValue - maxScrollTop()) < 1;
			const settleFrames = async () => {
				await act(async () => {
					await vi.advanceTimersByTimeAsync(50);
				});
			};

			it('takes the user to their own turn and follows it; other arrivals keep their place', async () => {
				const { container, rerender, before } = await mountScrolledIntoHistory();
				const show = (logs: LogEntry[]) =>
					rerender(<TerminalOutput {...props(sessionWith(logs))} />);

				// An external arrival (a refresh, another client's reply) is the agent's
				// output on its own schedule: the reader stays put and it is counted.
				const external = liveProgressNote('ext-1');
				act(() => show([...current, external]));
				await settleFrames();
				expect(readingRow()).toEqual(before);
				expect(unreadButton(container)!.textContent?.trim()).toBe('1');

				// A send into another conversation names that tab: nothing here moves.
				act(() => requestTranscriptScrollToBottom('session-1', 'some-other-tab'));
				await settleFrames();
				expect(readingRow()).toEqual(before);

				// The user sends from THIS composer: the message goes into the store, the
				// send asks for this tab, then the transcript renders it (the order
				// processInput uses).
				const sent: LogEntry = {
					id: 'sent-q',
					timestamp: 98_000,
					source: 'user',
					text: 'a new question',
				};
				act(() => {
					show([...current, external, sent]);
					requestTranscriptScrollToBottom('session-1', 'tab-1');
				});
				await settleFrames();
				expect(renderedIds(container).slice(-1)[0]).toBe('sent-q');
				expect(atBottom()).toBe(true);
				expect(unreadButton(container)).toBeNull();

				// Its public progress and reply stream in under it: still following.
				const progress = liveProgressNote('sent-p');
				const reply: LogEntry = {
					id: 'sent-a',
					timestamp: 99_500,
					source: 'stdout',
					text: 'the reply',
				};
				act(() => show([...current, external, sent, progress, reply]));
				await settleFrames();
				expect(renderedIds(container).slice(-1)[0]).toBe('sent-a');
				expect(atBottom()).toBe(true);
				expect(unreadButton(container)).toBeNull();

				// Scrolling up after sending pauses as usual: later output is counted and
				// the reader's place holds.
				await userScrollTo(scrollTopValue - 400);
				const reading = readingRow();
				act(() => show([...current, external, sent, progress, reply, liveProgressNote('late')]));
				await settleFrames();
				expect(readingRow()).toEqual(reading);
				expect(unreadButton(container)!.textContent?.trim()).toBe('1');
			});

			it('keeps the reader in place for a user row that arrives without their Send', async () => {
				// A deferred re-send (session recovery after grooming) or a turn sent from
				// another client lands in this very tab as a user row plus its reply. No
				// request accompanies it, so it is output like any other: place kept,
				// counted.
				const { container, rerender, before } = await mountScrolledIntoHistory();
				const resent: LogEntry = {
					id: 'resent-q',
					timestamp: 98_000,
					source: 'user',
					text: 'the failed prompt again',
				};
				act(() => rerender(<TerminalOutput {...props(sessionWith([...current, resent]))} />));
				await settleFrames();
				expect(renderedIds(container).slice(-1)[0]).toBe('resent-q');
				expect(readingRow()).toEqual(before);
				expect(atBottom()).toBe(false);
				expect(unreadButton(container)!.textContent?.trim()).toBe('1');
			});

			it('does not replay a request for this tab after the user comes back to it', async () => {
				const { unmount, before } = await mountScrolledIntoHistory();
				// Away to another tab (the transcript unmounts); a send for this tab
				// finishes its probe meanwhile and asks for it.
				unmount();
				requestTranscriptScrollToBottom('session-1', 'tab-1');
				// Back: the reader returns to their message, not to the bottom.
				scrollTopValue = 0;
				const back = render(
					<TerminalOutput
						{...props(sessionWith(current), { initialScrollTop: 537, initialIsAtBottom: false })}
					/>
				);
				installLayout(back.container);
				await settleFrames();
				expect(readingRow()).toEqual(before);
				expect(atBottom()).toBe(false);
			});

			describe('a saved offset whose first restore frame has not run yet', () => {
				// Restart-style mount: no in-memory reading anchor, so the scroll hook's
				// own restore applies the persisted absolute offset one frame after mount.
				function mountWithSavedOffset() {
					// Forget any reading anchor a previous mount of this tab left behind
					// (an unmount while following clears it), so the hook's restore runs.
					render(<TerminalOutput {...props(sessionWith(current))} />).unmount();
					scrollTopValue = 0;
					const utils = render(
						<TerminalOutput
							{...props(sessionWith(current), { initialScrollTop: 537, initialIsAtBottom: false })}
						/>
					);
					installLayout(utils.container);
					return utils;
				}

				it('follows a Send made before that frame, through the frame and later growth', async () => {
					const { container, rerender } = mountWithSavedOffset();
					// The user sends before the restore's first frame has run.
					const sent: LogEntry = {
						id: 'sent-q',
						timestamp: 98_000,
						source: 'user',
						text: 'sent right after opening',
					};
					act(() => {
						rerender(
							<TerminalOutput
								{...props(sessionWith([...current, sent]), {
									initialScrollTop: 537,
									initialIsAtBottom: false,
								})}
							/>
						);
						requestTranscriptScrollToBottom('session-1', 'tab-1');
					});
					// Now the frame (and the idle window's growth) arrive.
					await hydrateWindow(container);
					expect(renderedIds(container).slice(-1)[0]).toBe('sent-q');
					expect(atBottom()).toBe(true);
					expect(unreadButton(container)).toBeNull();
					// And the reply keeps following: no settle loop was armed behind it.
					const reply: LogEntry = {
						id: 'sent-a',
						timestamp: 99_000,
						source: 'stdout',
						text: 'the reply',
					};
					act(() =>
						rerender(
							<TerminalOutput
								{...props(sessionWith([...current, sent, reply]), {
									initialScrollTop: 537,
									initialIsAtBottom: false,
								})}
							/>
						)
					);
					await settleFrames();
					expect(renderedIds(container).slice(-1)[0]).toBe('sent-a');
					expect(atBottom()).toBe(true);
				});

				it('does not run the frame for a restore superseded before it (a tab change without remount)', async () => {
					const { container, rerender } = mountWithSavedOffset();
					// Before the frame, this instance is handed a conversation that is
					// following its tail (what a pane that is not remounted sees when its
					// tab changes): the old restore's cleanup must take its frame with it.
					const base = sessionWith(current);
					const otherTab = {
						...base,
						activeTabId: 'tab-2',
						aiTabs: [{ ...base.aiTabs[0], id: 'tab-2' }],
					} as Session;
					act(() =>
						rerender(
							<TerminalOutput
								{...props(otherTab, { initialScrollTop: 0, initialIsAtBottom: true })}
							/>
						)
					);
					await hydrateWindow(container);
					expect(scrollTopValue).not.toBe(537);
					expect(atBottom()).toBe(true);
				});
			});

			describe('when the store commits ahead of the reveal (the real GUI order)', () => {
				// The transcript is fed from an external store read with
				// useSyncExternalStore, as the session store is. Its writes - the user's
				// new row, and the saved at-bottom flag and offset the transcript reports
				// back - commit at SYNC priority, while the scroll hook's own state from
				// the reveal event waits at default priority. That is the order the GUI
				// log showed: the row's commit ran with the hook still saying "reading
				// history", re-applied the old reading position (-1416px), and the
				// jump's scroll echo then landed far from its target and paused.
				type Saved = { logs: LogEntry[]; savedAtBottom: boolean; savedTop: number };
				function createStore(initial: LogEntry[]) {
					let state: Saved = { logs: initial, savedAtBottom: true, savedTop: 0 };
					const listeners = new Set<() => void>();
					return {
						get: () => state,
						set: (patch: Partial<Saved>) => {
							state = { ...state, ...patch };
							listeners.forEach((listener) => listener());
						},
						subscribe: (listener: () => void) => {
							listeners.add(listener);
							return () => listeners.delete(listener);
						},
					};
				}
				function Harness({ store }: { store: ReturnType<typeof createStore> }) {
					const saved = useSyncExternalStore(store.subscribe, store.get);
					return (
						<TerminalOutput
							{...props(sessionWith(saved.logs), {
								initialScrollTop: saved.savedTop,
								initialIsAtBottom: saved.savedAtBottom,
							})}
							onAtBottomChange={(isAtBottom: boolean) => store.set({ savedAtBottom: isAtBottom })}
							onScrollPositionChange={(top: number) => store.set({ savedTop: top })}
						/>
					);
				}

				async function readingWithStore() {
					const store = createStore(current);
					const utils = render(<Harness store={store} />);
					installLayout(utils.container);
					await hydrateWindow(utils.container);
					await userScrollTo(5 * ROW_H + 37);
					const before = readingRow();
					expect(before.top).toBe(-37);
					// The transcript really reported the pause back through the store.
					expect(store.get().savedAtBottom).toBe(false);
					return { ...utils, store, before };
				}

				it("follows the user's own turn through the store commit, the busy strip and its reply", async () => {
					const { container, store, before } = await readingWithStore();

					// An external reply first: the reader stays put and it is counted.
					const external = liveProgressNote('ext-1');
					act(() => store.set({ logs: [...current, external] }));
					await settleFrames();
					expect(readingRow()).toEqual(before);
					expect(unreadButton(container)!.textContent?.trim()).toBe('1');
					// They read for a while, then type and press Return (no scroll input).
					await act(async () => {
						await vi.advanceTimersByTimeAsync(1_000);
					});

					// The user's Send: the reveal is accepted, and the store commit carrying
					// their new row (plus the at-bottom flag the reveal saved) lands BEFORE
					// the scroll hook's own state update is processed.
					const sent: LogEntry = {
						id: 'sent-q',
						timestamp: 98_000,
						source: 'user',
						text: 'a new question',
					};
					act(() => {
						requestTranscriptScrollToBottom('session-1', 'tab-1');
						flushSync(() => store.set({ logs: [...current, external, sent] }));
					});
					await settleFrames();
					expect(store.get().savedAtBottom).toBe(true);
					expect(renderedIds(container).slice(-1)[0]).toBe('sent-q');
					expect(atBottom()).toBe(true);
					expect(unreadButton(container)).toBeNull();

					// The turn starts: the busy strip shrinks the viewport, the jump's scroll
					// echo arrives, and public progress streams in. Still following.
					CLIENT_H = 463;
					act(() => {
						fireEvent.scroll(scroller!);
					});
					const progress = liveProgressNote('sent-p');
					act(() => store.set({ logs: [...current, external, sent, progress] }));
					await settleFrames();
					expect(atBottom()).toBe(true);
					const reply: LogEntry = {
						id: 'sent-a',
						timestamp: 99_500,
						source: 'stdout',
						text: 'the reply',
					};
					act(() => store.set({ logs: [...current, external, sent, progress, reply] }));
					await settleFrames();
					expect(renderedIds(container).slice(-1)[0]).toBe('sent-a');
					expect(atBottom()).toBe(true);
					expect(unreadButton(container)).toBeNull();

					// A real scroll up afterwards pauses as usual: the pause is saved, later
					// output holds the reader's place and is counted.
					await userScrollTo(scrollTopValue - 300);
					const reading = readingRow();
					expect(store.get().savedAtBottom).toBe(false);
					act(() =>
						store.set({
							logs: [...current, external, sent, progress, reply, liveProgressNote('late')],
						})
					);
					await settleFrames();
					expect(readingRow()).toEqual(reading);
					expect(unreadButton(container)!.textContent?.trim()).toBe('1');
				});

				it('keeps the reader in place when the same store commit carries another tab’s reveal', async () => {
					const { container, store, before } = await readingWithStore();
					const otherRow: LogEntry = {
						id: 'other-q',
						timestamp: 98_000,
						source: 'user',
						text: 'arrived without this tab’s Send',
					};
					act(() => {
						requestTranscriptScrollToBottom('session-1', 'some-other-tab');
						flushSync(() => store.set({ logs: [...current, otherRow] }));
					});
					await settleFrames();
					expect(readingRow()).toEqual(before);
					expect(atBottom()).toBe(false);
					expect(store.get().savedAtBottom).toBe(false);
					expect(unreadButton(container)!.textContent?.trim()).toBe('1');
				});
			});
		});

		describe('a transcript too short to scroll still reaches earlier history', () => {
			// One stored turn with its tools folded: three rows, less than one screen.
			const short = turn('only', 50_000, 4);

			async function mountShort(session = sessionWith(short)) {
				const utils = render(<TerminalOutput {...props(session)} />);
				installLayout(utils.container);
				// The next commit sees the real layout (the mount itself had none).
				act(() => utils.rerender(<TerminalOutput {...props(session)} />));
				return utils;
			}

			it('asks for one page when the whole transcript fits on screen, once per length', async () => {
				const { container, rerender } = await mountShort();
				expect(scroller!.scrollHeight).toBeLessThanOrEqual(scroller!.clientHeight);
				expect(backfill.loadEarlier).toHaveBeenCalledTimes(1);

				// Nothing new arrived: no second read for the same transcript.
				act(() => rerender(<TerminalOutput {...props(sessionWith(short))} />));
				expect(backfill.loadEarlier).toHaveBeenCalledTimes(1);

				// The page added rows but it still fits: ask for the next one.
				const earlier = turn('prev', 40_000, 0);
				act(() => {
					backfill.onPrepend!(earlier.length);
					rerender(<TerminalOutput {...props(sessionWith([...earlier, ...short]))} />);
				});
				// A list this short is inside the window's initial 25 rows, so the
				// prepend is mounted straight away (the window clamps its start to
				// `total - initial`) and the new length asks exactly once.
				expect(renderedIds(container)[0]).toBe('prev-q');
				expect(scroller!.scrollHeight).toBeLessThanOrEqual(scroller!.clientHeight);
				expect(backfill.loadEarlier).toHaveBeenCalledTimes(2);
				// Idle ticks and further commits at that length add nothing.
				await hydrateWindow(container);
				act(() => rerender(<TerminalOutput {...props(sessionWith([...earlier, ...short]))} />));
				expect(backfill.loadEarlier).toHaveBeenCalledTimes(2);

				// The start of the conversation: never again.
				backfill.reachedStart = true;
				const more = turn('more', 60_000, 0);
				act(() =>
					rerender(<TerminalOutput {...props(sessionWith([...earlier, ...short, ...more]))} />)
				);
				expect(backfill.loadEarlier).toHaveBeenCalledTimes(2);
			});

			it('does not ask on its own after a failure or while a turn is running', async () => {
				backfill.error = 'Could not load earlier messages';
				const failed = await mountShort();
				expect(backfill.loadEarlier).not.toHaveBeenCalled();
				failed.unmount();

				backfill.error = null;
				const busy = sessionWith(short);
				(busy.aiTabs[0] as { state?: string }).state = 'busy';
				await mountShort(busy);
				expect(backfill.loadEarlier).not.toHaveBeenCalled();
			});

			it('asks again when the user wheels up or presses a scroll key at the very top', async () => {
				await mountShort();
				expect(backfill.loadEarlier).toHaveBeenCalledTimes(1);
				expect(scroller!.scrollTop).toBe(0);
				// No scroll event can fire here; the input itself is the request.
				act(() => {
					fireEvent.wheel(scroller!, { deltaY: -300 });
				});
				expect(backfill.loadEarlier).toHaveBeenCalledTimes(2);
				act(() => {
					fireEvent.keyDown(scroller!, { key: 'PageUp' });
				});
				expect(backfill.loadEarlier).toHaveBeenCalledTimes(3);
				// Downward input is not a request for older history.
				act(() => {
					fireEvent.wheel(scroller!, { deltaY: 300 });
					fireEvent.keyDown(scroller!, { key: 'PageDown' });
				});
				expect(backfill.loadEarlier).toHaveBeenCalledTimes(3);
			});

			it('does not treat an upward wheel away from the top as a request', async () => {
				await mountScrolledIntoHistory();
				const calls = vi.mocked(backfill.loadEarlier).mock.calls.length;
				act(() => {
					fireEvent.wheel(scroller!, { deltaY: -300 });
				});
				expect(scroller!.scrollTop).toBeGreaterThan(0);
				expect(vi.mocked(backfill.loadEarlier).mock.calls.length).toBe(calls);
			});
		});
	}
);
