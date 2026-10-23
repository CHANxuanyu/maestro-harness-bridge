import React, { createRef } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { TerminalOutput } from '../../../../renderer/components/TerminalOutput/TerminalOutput';
import type { TerminalOutputProps } from '../../../../renderer/components/TerminalOutput/types';
import type { LogEntry, Session } from '../../../../renderer/types';
import { LayerStackProvider } from '../../../../renderer/contexts/LayerStackContext';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';
import { mockTheme } from '../../../helpers/mockTheme';

/**
 * Regression coverage for the Alt+J "Jump to Bottom" contract.
 *
 * useMainKeyboardHandler resolves the transcript scroll target via
 * `logsEndRef.current.parentElement` (one level up from the end marker). That
 * only works while the marker is a DIRECT child of the `overflow-y-auto` scroll
 * container. The content-resize re-pin work added a `contentRef` wrapper around
 * the log entries; if the end marker gets pulled inside that wrapper,
 * `parentElement` lands on an unscrollable block and Alt+J silently no-ops.
 *
 * Also the row contract the reading anchor, cross-tab search and delete-scroll
 * rely on: every rendered log is ONE direct child of the content wrapper that
 * carries `data-log-id` and `data-log-index`. The conversation feed changes how
 * rows look and must not wrap them (no turn containers).
 *
 * Both navigation layouts render the transcript, so both are checked.
 */
function makeProps(
	logsEndRef: React.RefObject<HTMLDivElement>,
	session: Session = createMockSession()
): TerminalOutputProps {
	const noop = () => {};
	return {
		session,
		theme: mockTheme,
		fontFamily: 'monospace',
		activeFocus: 'main',
		outputSearchOpen: false,
		outputSearchQuery: '',
		outputSearchRegex: false,
		setOutputSearchOpen: noop,
		setOutputSearchQuery: noop,
		setOutputSearchRegex: noop,
		setActiveFocus: noop,
		setLightboxImage: noop,
		inputRef: createRef<HTMLTextAreaElement>(),
		logsEndRef,
		maxOutputLines: 1000,
		markdownEditMode: false,
		setMarkdownEditMode: noop,
	};
}

// Three turns: an answer; progress, a stored tool call and the Stop notice
// (a system entry right after the tools, as a real Stop writes it); a
// recovered answer.
const logs: LogEntry[] = [
	{ id: 'u1', timestamp: 1_000, source: 'user', text: 'Question one' },
	{ id: 'a1', timestamp: 1_100, source: 'stdout', text: 'Answer one', turnModel: 'opus' },
	{ id: 'u2', timestamp: 2_000, source: 'user', text: 'Question two' },
	{ id: 'p2', timestamp: 2_100, source: 'stdout', purpose: 'commentary', text: 'Reading files' },
	{
		id: 't2',
		timestamp: 2_200,
		source: 'tool',
		text: 'read_file',
		nativeTranscript: { messageId: 't2' },
		metadata: { toolState: { status: 'canceled', input: { path: 'a.md' } } },
	},
	{ id: 's2', timestamp: 2_300, source: 'system', text: 'Canceled by user' },
	{ id: 'u3', timestamp: 3_000, source: 'user', text: 'Question three' },
	{ id: 'a3', timestamp: 3_100, source: 'stdout', text: 'Answer three', turnModel: 'sonnet' },
];

function sessionWithLogs(): Session {
	return createMockSession({
		activeTabId: 'tab-1',
		aiTabs: [createMockAITab({ id: 'tab-1', logs, showThinking: 'off' })],
	});
}

describe.each(['agents', 'conversations'] as const)(
	'TerminalOutput (%s layout) scroll-container / row contract',
	(navigationMode) => {
		beforeEach(() => {
			useSettingsStore.setState({ sidebarNavigationMode: navigationMode, showToolCalls: false });
		});

		it('renders logsEndRef as a direct child of the overflow-y-auto scroll container', () => {
			const logsEndRef = createRef<HTMLDivElement>();
			render(
				<LayerStackProvider>
					<TerminalOutput {...makeProps(logsEndRef, sessionWithLogs())} />
				</LayerStackProvider>
			);

			const marker = logsEndRef.current;
			expect(marker).not.toBeNull();

			// Alt+J resolves the scroll target as the marker's parentElement, so the
			// parent MUST be the scroll container (the overflow-y-auto element), not the
			// unstyled contentRef wrapper that holds the log entries.
			const parent = marker!.parentElement;
			expect(parent).not.toBeNull();
			expect(parent!.className).toContain('overflow-y-auto');
		});

		it('keeps every rendered log a direct child of the content wrapper, in order, with its index', () => {
			const logsEndRef = createRef<HTMLDivElement>();
			render(
				<LayerStackProvider>
					<TerminalOutput {...makeProps(logsEndRef, sessionWithLogs())} />
				</LayerStackProvider>
			);
			const scroller = logsEndRef.current!.parentElement!;
			const rows = Array.from(scroller.querySelectorAll('[data-log-id]'));
			expect(rows.length).toBeGreaterThan(0);
			const content = rows[0].parentElement!;
			// The content wrapper is the scroller's child, beside the end marker.
			expect(content.parentElement).toBe(scroller);
			// No row sits inside another row or inside a turn wrapper.
			for (const row of rows) expect(row.parentElement).toBe(content);
			// Raw ids and their order survive. The conversation layout folds the
			// stopped turn's work behind one row, which keeps its first step's id.
			expect(rows.map((row) => row.getAttribute('data-log-id'))).toEqual(
				navigationMode === 'conversations'
					? ['u1', 'a1', 'u2', 'p2', 's2', 'u3', 'a3']
					: ['u1', 'a1', 'u2', 'p2', 't2', 's2', 'u3', 'a3']
			);
			const indexes = rows.map((row) => Number(row.getAttribute('data-log-index')));
			expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
			expect(new Set(indexes).size).toBe(indexes.length);
		});
	}
);
