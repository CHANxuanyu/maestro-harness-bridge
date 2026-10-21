/**
 * Live public progress (`onThinkingChunk(..., 'commentary')`) and live tool
 * calls through a whole turn: arrival order, Thinking off, window ownership,
 * background tabs, exit and Stop retention in the conversation layout, and a
 * refresh/restart against the stored transcript of the same turn.
 *
 * Drives the REAL listeners (thinking + tool execution) and the real exit and
 * merge helpers; only the IPC subscription and the window context are faked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentThinkingListener } from '../../../../../renderer/hooks/agent/internal/useAgentThinkingListener';
import { useAgentToolExecutionListener } from '../../../../../renderer/hooks/agent/internal/useAgentToolExecutionListener';
import { cleanupExitedTabLogs } from '../../../../../renderer/hooks/agent/internal/helpers/exitTabCleanup';
import { useSessionStore } from '../../../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../../../renderer/stores/settingsStore';
import { currentActivityRetention } from '../../../../../renderer/utils/activityRetention';
import { canAppendToLogEntry } from '../../../../../renderer/utils/logEntries';
import {
	isProgressNoteEntry,
	mergeNewerEntries,
	transcriptMessagesToLogEntries,
	type TranscriptMessage,
} from '../../../../../renderer/utils/transcriptMessages';
import { collapseAiResponseLogs } from '../../../../../renderer/components/TerminalOutput/utils/collapseAiResponseLogs';
import { createMockSession } from '../../../../helpers/mockSession';
import { createMockAITab } from '../../../../helpers/mockTab';
import type { LogEntry } from '../../../../../renderer/types';

vi.mock('../../../../../renderer/stores/retryStore', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../../../renderer/stores/retryStore')>()),
	noteRetryProgress: vi.fn(),
}));

// Window ownership: permit-all unless a test narrows it.
const ownership = vi.hoisted(() => ({ owns: null as null | ((id: string) => boolean) }));
vi.mock('../../../../../renderer/contexts/WindowContext', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../../../renderer/contexts/WindowContext')>()),
	useWindowContextOptional: () => (ownership.owns ? { ownsSession: ownership.owns } : null),
}));

type ThinkingHandler = (sessionId: string, content: string, purpose?: 'commentary') => void;
type ToolHandler = (
	sessionId: string,
	event: { toolName: string; state?: unknown; timestamp: number; toolCallId?: string }
) => void;

let thinking: ThinkingHandler | undefined;
let tool: ToolHandler | undefined;
let scheduled: Array<() => void> = [];
let originalRaf: typeof requestAnimationFrame;
let originalCancelRaf: typeof cancelAnimationFrame;

function flushRaf() {
	const queued = scheduled;
	scheduled = [];
	queued.forEach((cb) => cb());
}

function tabLogs(tabId = 'tab-1'): LogEntry[] {
	return useSessionStore.getState().sessions[0].aiTabs.find((t) => t.id === tabId)!.logs;
}

function seed(showThinking: 'off' | 'on' = 'off') {
	const user: LogEntry = {
		id: 'live-q',
		timestamp: Date.parse('2026-10-19T09:00:00.200Z'),
		source: 'user',
		text: 'Find the docs',
	};
	useSessionStore.setState({
		sessions: [
			createMockSession({
				id: 'sess-1',
				aiTabs: [
					createMockAITab({ id: 'tab-1', showThinking, logs: [user] }),
					createMockAITab({ id: 'tab-2', showThinking: 'off', logs: [], inputValue: 'draft' }),
				],
				activeTabId: 'tab-1',
			}),
		],
	} as never);
}

/** The final answer arriving over stdout, as the batched updater appends it. */
function appendFinalAnswer(text: string, at = Date.now()) {
	useSessionStore.getState().setSessions((prev) =>
		prev.map((s) => ({
			...s,
			aiTabs: s.aiTabs.map((t) => {
				if (t.id !== 'tab-1') return t;
				const last = t.logs[t.logs.length - 1];
				// The real flush coalesces only into an open stdout stream.
				if (canAppendToLogEntry(last, 'stdout')) {
					return { ...t, logs: [...t.logs.slice(0, -1), { ...last, text: last.text + text }] };
				}
				return {
					...t,
					logs: [...t.logs, { id: 'live-a', timestamp: at, source: 'stdout' as const, text }],
				};
			}),
		}))
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	thinking = undefined;
	tool = undefined;
	scheduled = [];
	ownership.owns = null;
	originalRaf = global.requestAnimationFrame;
	originalCancelRaf = global.cancelAnimationFrame;
	global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
		scheduled.push(() => cb(performance.now()));
		return scheduled.length;
	}) as typeof requestAnimationFrame;
	global.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
	(window as any).maestro = {
		...((window as any).maestro || {}),
		process: {
			...((window as any).maestro?.process || {}),
			onThinkingChunk: vi.fn((h: ThinkingHandler) => {
				thinking = h;
				return vi.fn();
			}),
			onToolExecution: vi.fn((h: ToolHandler) => {
				tool = h;
				return vi.fn();
			}),
		},
	};
	useSettingsStore.setState({ sidebarNavigationMode: 'conversations' });
	seed();
});

afterEach(() => {
	global.requestAnimationFrame = originalRaf;
	global.cancelAnimationFrame = originalCancelRaf;
});

function mountListeners() {
	return renderHook(() => {
		useAgentThinkingListener();
		useAgentToolExecutionListener();
	});
}

describe('live public progress', () => {
	it('shows two separate progress messages with Thinking off, never merged', () => {
		mountListeners();
		thinking!('sess-1-ai-tab-1', 'Looking through the docs.', 'commentary');
		thinking!('sess-1-ai-tab-1', 'Found the pricing page.', 'commentary');

		const progress = tabLogs().filter(isProgressNoteEntry);
		expect(progress.map((e) => e.text)).toEqual([
			'Looking through the docs.',
			'Found the pricing page.',
		]);
		expect(progress[0].id).not.toBe(progress[1].id);
		// Live entries carry the purpose marker, never a fake native identity.
		expect(progress.every((e) => e.purpose === 'commentary' && !e.nativeTranscript)).toBe(true);
	});

	it('keeps reasoning, progress and the following tool call in arrival order', () => {
		seed('on');
		mountListeners();
		// Reasoning is still buffered for the next frame when progress arrives.
		thinking!('sess-1-ai-tab-1', 'Considering where docs live.');
		thinking!('sess-1-ai-tab-1', 'Checking the docs folder.', 'commentary');
		tool!('sess-1-ai-tab-1', {
			toolName: 'exec_command',
			toolCallId: 'call_1',
			timestamp: Date.now(),
			state: { status: 'running', input: { cmd: 'ls docs' } },
		});
		flushRaf();

		expect(tabLogs().map((e) => e.source)).toEqual(['user', 'thinking', 'stdout', 'tool']);
		expect(isProgressNoteEntry(tabLogs()[2])).toBe(true);
	});

	it('does not drop progress that arrives after an earlier stdout message', () => {
		mountListeners();
		appendFinalAnswer('An intermediate message.', Date.now() + 1000);
		thinking!('sess-1-ai-tab-1', 'Now checking one more file.', 'commentary');
		expect(tabLogs().filter(isProgressNoteEntry)).toHaveLength(1);
	});

	it('routes to a background tab without touching its draft or the active tab', () => {
		mountListeners();
		thinking!('sess-1-ai-tab-2', 'Working in the background.', 'commentary');
		const tab2 = useSessionStore.getState().sessions[0].aiTabs.find((t) => t.id === 'tab-2')!;
		expect(tab2.logs.map((e) => e.text)).toEqual(['Working in the background.']);
		expect(tab2.inputValue).toBe('draft');
		expect(tabLogs('tab-1')).toHaveLength(1);
		expect(useSessionStore.getState().sessions[0].activeTabId).toBe('tab-1');
	});

	it('ignores progress for an agent this window does not own', () => {
		ownership.owns = (id) => id !== 'sess-1';
		mountListeners();
		thinking!('sess-1-ai-tab-1', 'Not ours.', 'commentary');
		expect(tabLogs()).toHaveLength(1);
	});

	it('never appends the final answer to a progress row', () => {
		mountListeners();
		thinking!('sess-1-ai-tab-1', 'Checking the docs folder.', 'commentary');
		appendFinalAnswer('Zen plan supports it.');
		const logs = tabLogs();
		expect(logs[logs.length - 2].text).toBe('Checking the docs folder.');
		expect(logs[logs.length - 1]).toMatchObject({
			source: 'stdout',
			text: 'Zen plan supports it.',
		});
		expect(collapseAiResponseLogs(logs).map((e) => e.text)).toEqual([
			'Find the docs',
			'Checking the docs folder.',
			'Zen plan supports it.',
		]);
	});
});

describe('a whole live turn in the conversation layout', () => {
	const T = (s: string) => `2026-10-19T09:00:${s}.000Z`;
	/** The same turn as the provider stored it. */
	const DISK: TranscriptMessage[] = [
		{ uuid: 'u1', type: 'user', content: 'Find the docs', timestamp: T('00') },
		{
			uuid: 'c1',
			type: 'assistant',
			content: 'Checking the docs folder.',
			timestamp: T('02'),
			channel: 'commentary',
		},
		{
			uuid: 'call_1',
			type: 'assistant',
			content: 'Tool: exec_command',
			timestamp: T('03'),
			toolUse: [
				{
					tool: 'exec_command',
					args: '{"cmd":"ls docs"}',
					state: { status: 'completed', output: 'opencode.md' },
				},
			],
		},
		{
			uuid: 'f1',
			type: 'assistant',
			content: 'Zen plan supports it.',
			timestamp: T('05'),
			channel: 'final',
		},
	];

	function runTurn() {
		mountListeners();
		thinking!('sess-1-ai-tab-1', 'Checking the docs folder.', 'commentary');
		tool!('sess-1-ai-tab-1', {
			toolName: 'exec_command',
			toolCallId: 'call_1',
			timestamp: Date.parse(T('03')),
			state: { status: 'running', input: { cmd: 'ls docs' } },
		});
		tool!('sess-1-ai-tab-1', {
			toolName: 'exec_command',
			toolCallId: 'call_1',
			timestamp: Date.parse(T('04')),
			state: { status: 'completed', output: 'opencode.md' },
		});
		// Renderer clock, not the provider's: the refresh must line the turn up
		// by content, as it does for every live turn.
		appendFinalAnswer('Zen plan supports it.', Date.parse(T('05')) + 300);
	}

	function exitTurn() {
		useSessionStore.getState().setSessions((prev) =>
			prev.map((s) => ({
				...s,
				aiTabs: s.aiTabs.map((t) =>
					t.id === 'tab-1'
						? { ...t, logs: cleanupExitedTabLogs(t.logs, t.id, t, currentActivityRetention()) }
						: t
				),
			}))
		);
	}

	it('keeps the completed tool call and its result through exit, refresh and restart', () => {
		runTurn();
		exitTurn();
		const afterExit = tabLogs();
		const toolEntry = afterExit.find((e) => e.source === 'tool')!;
		expect(toolEntry.metadata?.toolState).toMatchObject({
			status: 'completed',
			output: 'opencode.md',
			input: { cmd: 'ls docs' },
		});

		// Refresh against the stored copy of the same turn: nothing doubled.
		const loaded = transcriptMessagesToLogEntries(DISK);
		const merged = mergeNewerEntries(loaded, afterExit)!;
		expect(merged.added).toBe(0);
		expect(merged.logs.filter((e) => e.source === 'tool')).toHaveLength(1);
		expect(merged.logs.filter((e) => e.text === 'Zen plan supports it.')).toHaveLength(1);
		expect(merged.logs.filter(isProgressNoteEntry)).toHaveLength(1);

		// Restart: the tab's logs come back from persistence as plain JSON.
		const restored = JSON.parse(JSON.stringify(merged.logs)) as LogEntry[];
		const again = mergeNewerEntries(loaded, restored)!;
		expect(again.added).toBe(0);
		expect(again.logs.find((e) => e.source === 'tool')?.metadata?.toolState?.output).toBe(
			'opencode.md'
		);
	});

	it('settles a call still running at exit without calling it a success', () => {
		mountListeners();
		tool!('sess-1-ai-tab-1', {
			toolName: 'exec_command',
			toolCallId: 'call_2',
			timestamp: Date.now(),
			state: { status: 'running', input: { cmd: 'sleep 60' } },
		});
		exitTurn();
		const entry = tabLogs().find((e) => e.source === 'tool')!;
		expect(entry.metadata?.toolState?.status).toBeUndefined();
		expect(entry.metadata?.toolState?.input).toEqual({ cmd: 'sleep 60' });
	});

	it('keeps the agent layout clearing tool calls at exit, as before', () => {
		useSettingsStore.setState({ sidebarNavigationMode: 'agents' });
		runTurn();
		exitTurn();
		expect(tabLogs().some((e) => e.source === 'tool')).toBe(false);
		// Progress is not scratch state in either layout.
		expect(tabLogs().filter(isProgressNoteEntry)).toHaveLength(1);

		// A refresh against the stored turn still doubles nothing.
		const loaded = transcriptMessagesToLogEntries(DISK);
		const merged = mergeNewerEntries(loaded, tabLogs())!;
		expect(merged.added).toBe(0);
		expect(merged.logs.filter((e) => e.text === 'Zen plan supports it.')).toHaveLength(1);
		expect(merged.logs.filter(isProgressNoteEntry)).toHaveLength(1);
	});

	it('lines a live turn up by its progress row when the streamed answer differs from the stored one', () => {
		runTurn();
		exitTurn();
		// The stored answer was reworded relative to what streamed.
		const disk = DISK.map((msg) =>
			msg.uuid === 'f1' ? { ...msg, content: 'Zen plan supports subscriptions.' } : msg
		);
		const merged = mergeNewerEntries(transcriptMessagesToLogEntries(disk), tabLogs())!;
		expect(merged.added).toBe(0);
		expect(merged.logs.filter((e) => e.source === 'tool')).toHaveLength(1);
	});
});
