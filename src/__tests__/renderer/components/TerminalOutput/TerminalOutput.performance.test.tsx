import React, { createRef, memo, useRef } from 'react';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, onTestFinished, vi } from 'vitest';
import type { LogEntry } from '../../../../renderer/types';
import type { TerminalOutputProps } from '../../../../renderer/components/TerminalOutput/types';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';
import { mockTheme } from '../../../helpers/mockTheme';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { formatElapsedTickerCompact } from '../../../../shared/duration';
import { getClaudeTokenMode } from '../../../../shared/claudeTokenMode';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { useComposerInputStore } from '../../../../renderer/stores/composerInputStore';
import { useAgentDataListener } from '../../../../renderer/hooks/agent/internal/useAgentDataListener';
import { useBatchedSessionUpdates } from '../../../../renderer/hooks/session/useBatchedSessionUpdates';
import { useInputAreaTextChange } from '../../../../renderer/components/InputArea/hooks/useInputAreaTextChange';

vi.mock('../../../../shared/duration', async (original) => {
	const actual = await original<typeof import('../../../../shared/duration')>();
	return { ...actual, formatElapsedTickerCompact: vi.fn(actual.formatElapsedTickerCompact) };
});
vi.mock('../../../../shared/claudeTokenMode', async (original) => {
	const actual = await original<typeof import('../../../../shared/claudeTokenMode')>();
	return { ...actual, getClaudeTokenMode: vi.fn(actual.getClaudeTokenMode) };
});
vi.mock('../../../../renderer/components/TerminalOutput/components/LogItem', () => ({
	LogItem: memo(({ log, index }: { log: LogEntry; index: number }) => (
		<div data-log-id={log.id} data-log-index={index}>
			{log.text}
		</div>
	)),
}));
vi.mock('../../../../renderer/contexts/LayerStackContext', () => ({
	useLayerStack: () => ({
		registerLayer: vi.fn(),
		unregisterLayer: vi.fn(),
		updateLayerHandler: vi.fn(),
	}),
}));
vi.mock('../../../../renderer/hooks/agent/useTranscriptBackfill', () => ({
	useTranscriptBackfill: () => ({
		isLoading: false,
		reachedStart: true,
		error: null,
		loadEarlier: vi.fn(),
	}),
}));

import { TerminalOutput } from '../../../../renderer/components/TerminalOutput';

let idle: Map<number, () => void>;
let nextIdle: number;
beforeEach(() => {
	idle = new Map();
	nextIdle = 0;
	vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
		idle.set(++nextIdle, cb);
		return nextIdle;
	});
	vi.stubGlobal('cancelIdleCallback', (id: number) => idle.delete(id));
	useSettingsStore.setState({ newShell: true, sidebarNavigationMode: 'conversations' });
	vi.mocked(getClaudeTokenMode).mockClear();
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function outputProps(session: TerminalOutputProps['session']): TerminalOutputProps {
	return {
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
		inputRef: createRef<HTMLTextAreaElement>(),
		logsEndRef: createRef<HTMLDivElement>(),
		maxOutputLines: 1000,
		markdownEditMode: false,
		setMarkdownEditMode: vi.fn(),
	};
}

it('builds row elements once while hydrating every history entry in order', () => {
	const count = Number(process.env.PERF_ROW_COUNT ?? 1000);
	const logs: LogEntry[] = Array.from({ length: count }, (_, i) => ({
		id: `message-${i}`,
		source: i % 2 ? 'stdout' : 'user',
		text: `Message ${i}`,
		timestamp: i * 1000,
	}));
	const session = createMockSession({
		id: 'perf-session',
		activeTabId: 'perf-tab',
		aiTabs: [createMockAITab({ id: 'perf-tab', logs })],
	});
	const props = outputProps(session);
	const started = performance.now();
	const view = render(<TerminalOutput {...props} />);
	expect(view.container.querySelectorAll('[data-log-id]')).toHaveLength(25);
	expect(vi.mocked(getClaudeTokenMode).mock.calls.length).toBeLessThanOrEqual(25);
	let ticks = 0;
	while (idle.size && ticks++ < count) {
		const [id, callback] = idle.entries().next().value!;
		idle.delete(id);
		act(callback);
	}
	const ids = Array.from(view.container.querySelectorAll('[data-log-id]'), (el) =>
		el.getAttribute('data-log-id')
	);
	expect(ids).toEqual(logs.map((log) => log.id));
	const constructions = vi.mocked(getClaudeTokenMode).mock.calls.length;
	console.info(JSON.stringify({ count, ticks, constructions, ms: performance.now() - started }));
	// One call per row element, independent of how many idle chunks have committed.
	expect(constructions).toBeLessThanOrEqual(count * 2);
	const nextLogs = logs.map((log, i) =>
		i === 0 ? { ...log, text: 'Corrected earliest message' } : log
	);
	view.rerender(
		<TerminalOutput
			{...props}
			session={{ ...session, aiTabs: [{ ...session.aiTabs[0], logs: nextLogs }] }}
		/>
	);
	expect(view.container.querySelector('[data-log-id="message-0"]')).toHaveTextContent(
		'Corrected earliest message'
	);
	vi.mocked(getClaudeTokenMode).mockClear();
	view.rerender(<TerminalOutput {...props} session={{ ...session, id: 'next-session' }} />);
	expect(view.container.querySelectorAll('[data-log-id]')).toHaveLength(25);
	expect(vi.mocked(getClaudeTokenMode).mock.calls.length).toBeLessThanOrEqual(25);
}, 60_000);

it.each([
	{ newShell: true, interim: false },
	{ newShell: true, interim: true },
	{ newShell: false, interim: true },
])(
	'bounds activity redraws with newShell=$newShell, interim=$interim',
	({ newShell, interim }) => {
		useSettingsStore.setState({ newShell });
		const logs: LogEntry[] = Array.from({ length: 1000 }, (_, turn) => [
			{
				id: `user-${turn}`,
				source: 'user' as const,
				text: `Question ${turn}`,
				timestamp: turn * 4000,
			},
			...(interim
				? [
						{
							id: `interim-${turn}`,
							source: 'stdout' as const,
							text: 'Before the tool',
							timestamp: turn * 4000 + 500,
						},
					]
				: []),
			{ id: `tool-${turn}`, source: 'tool' as const, text: 'Read', timestamp: turn * 4000 + 1000 },
			{
				id: `reply-${turn}`,
				source: 'stdout' as const,
				text: `Reply ${turn}`,
				timestamp: turn * 4000 + 2000,
			},
		]).flat();
		const session = createMockSession({
			id: 'stream-session',
			activeTabId: 'stream-tab',
			aiTabs: [createMockAITab({ id: 'stream-tab', logs })],
		});
		const props = outputProps(session);
		const view = render(<TerminalOutput {...props} />);
		let ticks = 0;
		while (idle.size && ticks++ < logs.length) {
			const [id, callback] = idle.entries().next().value!;
			idle.delete(id);
			act(callback);
		}
		expect(view.container.querySelectorAll('[data-feed-row="turn-activity"]')).toHaveLength(1000);
		vi.mocked(formatElapsedTickerCompact).mockClear();
		for (let batch = 0; batch < 15; batch++) {
			const nextLogs = [...logs.slice(0, -1), { ...logs.at(-1)!, text: `stream-${batch}` }];
			view.rerender(
				<TerminalOutput
					{...props}
					session={{ ...session, aiTabs: [{ ...session.aiTabs[0], logs: nextLogs }] }}
				/>
			);
		}
		expect(view.container.querySelector('[data-log-id="reply-999"]')).toHaveTextContent(
			'stream-14'
		);
		expect(vi.mocked(formatElapsedTickerCompact).mock.calls.length).toBe(newShell ? 0 : 15_000);
		const corrected = logs.map((log) =>
			log.id === 'tool-0'
				? { ...log, text: 'Corrected tool', metadata: { toolState: { status: 'error' as const } } }
				: log
		);
		view.rerender(
			<TerminalOutput
				{...props}
				session={{ ...session, aiTabs: [{ ...session.aiTabs[0], logs: corrected }] }}
			/>
		);
		const fold = view.container.querySelector(
			`[data-feed-row="turn-activity"][data-log-id="${interim ? 'interim-0' : 'tool-0'}"]`
		)!;
		expect(fold.querySelector('[data-tool-status="error"]')).not.toBeNull();
		fireEvent.click(fold.querySelector('button')!);
		expect(fold).toHaveTextContent('Corrected tool');
		const changedAgain = corrected.map((log) =>
			log.id === 'tool-0' ? { ...log, text: 'Updated while open' } : log
		);
		view.rerender(
			<TerminalOutput
				{...props}
				session={{ ...session, aiTabs: [{ ...session.aiTabs[0], logs: changedAgain }] }}
			/>
		);
		expect(fold).toHaveTextContent('Updated while open');
		fireEvent.click(fold.querySelector('button')!);
		expect(fold.querySelector('[data-turn-activity-steps]')).toBeNull();
	},
	60_000
);

it.each([true, false])(
	'keeps ordinary typing independent of 100 Hz stream batches (newShell=%s)',
	(newShell) => {
		vi.useFakeTimers({
			toFake: [
				'setInterval',
				'clearInterval',
				'setTimeout',
				'clearTimeout',
				'Date',
				'requestAnimationFrame',
				'cancelAnimationFrame',
			],
		});
		useSettingsStore.setState({ newShell });
		const historyTurns = 100;
		const history: LogEntry[] = Array.from({ length: historyTurns }, (_, turn) => [
			{
				id: `user-${turn}`,
				source: 'user' as const,
				text: `Question ${turn}`,
				timestamp: turn * 4000,
				delivered: true,
			},
			{ id: `tool-${turn}`, source: 'tool' as const, text: 'Read', timestamp: turn * 4000 + 1000 },
			{
				id: `reply-${turn}`,
				source: 'stdout' as const,
				text: `Reply ${turn}`,
				timestamp: turn * 4000 + 2000,
			},
		]).flat();
		const session = createMockSession({
			id: 'typing-session',
			activeTabId: 'typing-tab',
			aiTabs: [
				createMockAITab({
					id: 'typing-tab',
					state: 'busy',
					logs: [
						...history,
						{
							id: 'current-user',
							source: 'user',
							text: 'Continue',
							timestamp: historyTurns * 4000,
							delivered: true,
						},
					],
				}),
			],
		});
		useSessionStore.setState({ sessions: [session], activeSessionId: session.id });
		useComposerInputStore.getState().loadAiDraft('typing-tab', '', 'off');
		let onData!: (sessionId: string, data: string) => void;
		const previousOnData = window.maestro.process.onData;
		onTestFinished(() => {
			window.maestro.process.onData = previousOnData;
		});
		window.maestro.process.onData = vi.fn((callback) => {
			onData = callback;
			return vi.fn();
		});
		const props = outputProps(session);
		const transcriptRenders = vi.fn();
		const setPickerOpen = vi.fn();
		const setPickerIndex = vi.fn();
		function Transcript() {
			const current = useSessionStore((state) => state.sessions[0]);
			// Count subscription renders, not Profiler commits that include React bailouts.
			transcriptRenders();
			return <TerminalOutput {...props} session={current} />;
		}
		function Composer() {
			const value = useComposerInputStore((state) => state.aiValue);
			const keystrokeResizeScheduledRef = useRef(false);
			const onChange = useInputAreaTextChange({
				isTerminalMode: false,
				slashCommandOpen: false,
				commandMode: 'off',
				setCommandMode: useComposerInputStore.getState().setAiCommandMode,
				getPreviousValue: () => useComposerInputStore.getState().aiValue,
				keystrokeResizeScheduledRef,
				setInputValue: useComposerInputStore.getState().setAiValue,
				setSlashCommandOpen: setPickerOpen,
				setSelectedSlashCommandIndex: setPickerIndex,
			});
			return <textarea aria-label="Draft" value={value} onChange={onChange} />;
		}
		function Harness() {
			const batchedUpdater = useBatchedSessionUpdates();
			const activeHiddenToolRef = useRef(new Map());
			useAgentDataListener({ batchedUpdater, activeHiddenToolRef });
			return (
				<>
					<Transcript />
					<Composer />
				</>
			);
		}
		const view = render(<Harness />);
		let ticks = 0;
		while (idle.size && ticks++ < history.length) {
			const [id, callback] = idle.entries().next().value!;
			idle.delete(id);
			act(callback);
		}
		act(() => vi.advanceTimersByTime(0));
		expect(view.container.querySelectorAll('[data-feed-row="turn-activity"]')).toHaveLength(
			historyTurns
		);
		transcriptRenders.mockClear();
		vi.mocked(formatElapsedTickerCompact).mockClear();
		const storeUpdates = vi.fn();
		const unsubscribe = useSessionStore.subscribe((state, previous) => {
			if (state.sessions !== previous.sessions) storeUpdates();
		});
		onTestFinished(unsubscribe);
		const input = view.getByRole('textbox', { name: 'Draft' });
		let draft = '';
		const type = () => {
			draft += 'x';
			fireEvent.change(input, { target: { value: draft } });
		};
		for (let batch = 0; batch < 15; batch++) {
			for (let chunk = 0; chunk < 20; chunk++) {
				act(() => {
					if (chunk > 0) vi.advanceTimersByTime(10);
					onData('typing-session-ai-typing-tab', ` chunk-${batch * 20 + chunk}`);
				});
			}
			act(() => vi.advanceTimersByTime(9));
			expect(storeUpdates).toHaveBeenCalledTimes(batch);
			const before = transcriptRenders.mock.calls.length;
			// Cycle through input just before a flush, in the same React batch,
			// and immediately after it. This checks ordering, not browser latency.
			if (batch % 3 === 0) {
				act(type);
				expect(transcriptRenders).toHaveBeenCalledTimes(before);
				act(() => vi.advanceTimersByTime(1));
			} else if (batch % 3 === 1) {
				act(() => {
					vi.advanceTimersByTime(1);
					type();
				});
			} else {
				act(() => vi.advanceTimersByTime(1));
				const afterFlush = transcriptRenders.mock.calls.length;
				act(type);
				expect(transcriptRenders).toHaveBeenCalledTimes(afterFlush);
			}
			expect(storeUpdates).toHaveBeenCalledTimes(batch + 1);
			expect(transcriptRenders).toHaveBeenCalledTimes(before + 1);
			expect(input).toHaveValue(draft);
			expect(useComposerInputStore.getState().aiValue).toBe(draft);
		}
		const finalLogs = useSessionStore.getState().sessions[0].aiTabs[0].logs;
		expect(finalLogs.slice(0, history.length)).toEqual(history);
		expect(
			finalLogs
				.slice(history.length + 1)
				.map((log) => log.text)
				.join('')
		).toBe(Array.from({ length: 300 }, (_, i) => ` chunk-${i}`).join(''));
		expect(transcriptRenders).toHaveBeenCalledTimes(15);
		expect(vi.mocked(formatElapsedTickerCompact)).toHaveBeenCalledTimes(
			newShell ? 0 : historyTurns * 15
		);
	}
);
