import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentToolExecutionListener } from '../../../../../renderer/hooks/agent/internal/useAgentToolExecutionListener';
import { useSessionStore } from '../../../../../renderer/stores/sessionStore';
import { createMockSession } from '../../../../helpers/mockSession';
import { createMockAITab } from '../../../../helpers/mockTab';
import { noteRetryProgress } from '../../../../../renderer/stores/retryStore';

vi.mock('../../../../../renderer/stores/retryStore', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../../../renderer/stores/retryStore')>()),
	noteRetryProgress: vi.fn(),
}));

let handler: ((sessionId: string, toolEvent: any) => void) | undefined;
const mockUnsubscribe = vi.fn();

const mockProcess = {
	onToolExecution: vi.fn((h: any) => {
		handler = h;
		return mockUnsubscribe;
	}),
};

beforeEach(() => {
	vi.clearAllMocks();
	handler = undefined;
	useSessionStore.setState({
		sessions: [],
		groups: [],
		activeSessionId: '',
		initialLoadComplete: false,
		removedWorktreePaths: new Set(),
	});
	(window as any).maestro = { ...((window as any).maestro || {}), process: mockProcess };
});

describe('useAgentToolExecutionListener', () => {
	it('reports a tool call to the retry engine', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'off' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', {
			toolName: 'Read',
			state: { status: 'running' },
			timestamp: 1,
			toolCallId: 'c1',
		});

		expect(noteRetryProgress).toHaveBeenCalledWith('sess-1', 'tab-1');
	});

	it('appends a tool log when targetTab has thinking enabled', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'on' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', {
			toolName: 'Read',
			state: { status: 'running' },
			timestamp: 1700000000000,
			toolCallId: 'call-1',
		});

		const updated = useSessionStore.getState().sessions[0].aiTabs[0];
		expect(updated.logs).toHaveLength(1);
		expect(updated.logs[0].source).toBe('tool');
		expect(updated.logs[0].text).toBe('Read');
	});

	it('merges completed event into a previously-running entry by toolCallId', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'on' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', {
			toolName: 'Read',
			state: { status: 'running' },
			timestamp: 1,
			toolCallId: 'c1',
		});
		handler!('sess-1-ai-tab-1', {
			toolName: 'Read',
			state: { status: 'completed', output: 'ok' },
			timestamp: 2,
			toolCallId: 'c1',
		});

		const tabAfter = useSessionStore.getState().sessions[0].aiTabs[0];
		expect(tabAfter.logs).toHaveLength(1);
		expect(tabAfter.logs[0].metadata?.toolState?.status).toBe('completed');
		expect(tabAfter.logs[0].metadata?.toolState?.output).toBe('ok');
	});

	it('records tool events even when showThinking is off (hidden at render)', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'off' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', {
			toolName: 'Read',
			state: { status: 'running' },
			timestamp: 1,
			toolCallId: 'c1',
		});

		expect(useSessionStore.getState().sessions[0].aiTabs[0].logs).toHaveLength(1);
	});

	it('records tool events when showThinking is not set', () => {
		const tab = createMockAITab({ id: 'tab-1' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', {
			toolName: 'Read',
			state: { status: 'running' },
			timestamp: 1,
			toolCallId: 'c1',
		});

		expect(useSessionStore.getState().sessions[0].aiTabs[0].logs).toHaveLength(1);
	});

	it('attributes finalising event to most recent running entry without toolCallId', () => {
		const tab = createMockAITab({
			id: 'tab-1',
			showThinking: 'on',
			logs: [
				{
					id: 'tool-prev',
					timestamp: 1,
					source: 'tool',
					text: 'Bash',
					metadata: { toolState: { status: 'running' } },
				},
			],
		});
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', {
			toolName: 'Bash',
			state: { status: 'completed' },
			timestamp: 2,
		});

		const updated = useSessionStore.getState().sessions[0].aiTabs[0];
		expect(updated.logs).toHaveLength(1);
		expect(updated.logs[0].metadata?.toolState?.status).toBe('completed');
	});

	it('skips no-op render when session is missing (orphan event)', () => {
		const setSessionsSpy = vi.spyOn(useSessionStore.getState(), 'setSessions');
		renderHook(() => useAgentToolExecutionListener());
		handler!('missing-session-ai-tab-1', { toolName: 'Read', timestamp: 1 });
		expect(setSessionsSpy).not.toHaveBeenCalled();
	});

	it('ignores non-AI session ids', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'on' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-terminal', { toolName: 'Read', timestamp: 1 });

		expect(useSessionStore.getState().sessions[0].aiTabs[0].logs).toHaveLength(0);
	});

	it('tags new tool logs with renderStyle:text-stream when session is in interactive mode', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'on' });
		const session = createMockSession({
			id: 'sess-1',
			aiTabs: [tab],
			claudeInteractive: { mode: 'interactive', modeReason: 'auto' },
		});
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', {
			toolName: 'Bash',
			state: { status: 'running' },
			timestamp: 1,
			toolCallId: 'c1',
		});

		const log = useSessionStore.getState().sessions[0].aiTabs[0].logs[0];
		expect(log.renderStyle).toBe('text-stream');
	});

	it('stores parentToolUseId in metadata for subagent tool events', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'on' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', {
			toolName: 'Grep',
			state: { status: 'running' },
			timestamp: 1,
			toolCallId: 'child-1',
			parentToolUseId: 'toolu_task_1',
		});

		const log = useSessionStore.getState().sessions[0].aiTabs[0].logs[0];
		expect(log.metadata?.parentToolUseId).toBe('toolu_task_1');
	});

	it('preserves parentToolUseId when a later event omits it', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'on' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', {
			toolName: 'Grep',
			state: { status: 'running' },
			timestamp: 1,
			toolCallId: 'child-1',
			parentToolUseId: 'toolu_task_1',
		});
		handler!('sess-1-ai-tab-1', {
			toolName: 'Grep',
			state: { status: 'completed', output: 'done' },
			timestamp: 2,
			toolCallId: 'child-1',
		});

		const logs = useSessionStore.getState().sessions[0].aiTabs[0].logs;
		expect(logs).toHaveLength(1);
		expect(logs[0].metadata?.parentToolUseId).toBe('toolu_task_1');
		expect(logs[0].metadata?.toolState?.status).toBe('completed');
	});

	it('omits parentToolUseId for main-transcript tool events', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'on' });
		const session = createMockSession({ id: 'sess-1', aiTabs: [tab] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', {
			toolName: 'Read',
			state: { status: 'running' },
			timestamp: 1,
			toolCallId: 'c1',
		});

		const log = useSessionStore.getState().sessions[0].aiTabs[0].logs[0];
		expect(log.metadata?.parentToolUseId).toBeUndefined();
	});

	it('omits renderStyle on tool logs when session is in api mode', () => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'on' });
		const session = createMockSession({
			id: 'sess-1',
			aiTabs: [tab],
			claudeInteractive: { mode: 'api', modeReason: 'auto' },
		});
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', {
			toolName: 'Bash',
			state: { status: 'running' },
			timestamp: 1,
			toolCallId: 'c1',
		});

		const log = useSessionStore.getState().sessions[0].aiTabs[0].logs[0];
		expect(log.renderStyle).toBeUndefined();
	});
});

// The backend scopes per-run call ids (Codex's `item_N`) per process before
// IPC, so the renderer correlates by id alone: same id, same call, whichever
// turn its events arrive in. The scoped ids below are opaque to the renderer;
// only their distinctness matters.
describe('useAgentToolExecutionListener: stable scoped call ids', () => {
	const logs = () => useSessionStore.getState().sessions[0].aiTabs[0].logs;
	const tools = () => logs().filter((l) => l.source === 'tool');
	const user = (id: string, ts: number) => ({
		id,
		timestamp: ts,
		source: 'user' as const,
		text: id,
	});
	const sendUser = (id: string, ts: number) =>
		useSessionStore.getState().setSessions((prev) =>
			prev.map((s) => ({
				...s,
				aiTabs: s.aiTabs.map((t) => ({ ...t, logs: [...t.logs, user(id, ts)] })),
			}))
		);
	const event = (callId: string, status: string, extra: Record<string, unknown> = {}) => ({
		toolName: 'exec_command',
		toolCallId: callId,
		timestamp: Date.now(),
		state: { status, ...extra },
	});
	const TURN1 = 'run-a:item_1';
	const TURN2 = 'run-b:item_1';

	beforeEach(() => {
		const tab = createMockAITab({ id: 'tab-1', showThinking: 'off', logs: [user('q1', 1)] });
		useSessionStore.setState({
			sessions: [createMockSession({ id: 'sess-1', aiTabs: [tab] })],
		} as any);
	});

	it('gives distinct scoped ids across turns their own cards', () => {
		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', event(TURN1, 'running', { input: { cmd: 'print 12 lines' } }));
		handler!('sess-1-ai-tab-1', event(TURN1, 'completed', { output: 'QA_LINE_01..12' }));
		sendUser('q2', 2);
		handler!('sess-1-ai-tab-1', event(TURN2, 'running', { input: { cmd: 'sleep 20' } }));
		handler!('sess-1-ai-tab-1', event(TURN2, 'completed', { output: 'QA_STOP_END' }));

		expect(tools().map((t) => t.id)).toEqual([`tool-${TURN1}`, `tool-${TURN2}`]);
		expect(tools()[0].metadata?.toolState).toEqual({
			status: 'completed',
			input: { cmd: 'print 12 lines' },
			output: 'QA_LINE_01..12',
		});
		expect(tools()[1].metadata?.toolState).toEqual({
			status: 'completed',
			input: { cmd: 'sleep 20' },
			output: 'QA_STOP_END',
		});
		// No suffixed duplicates are minted.
		expect(logs().some((l) => l.id.includes('#'))).toBe(false);
	});

	it('merges a late duplicate completion after a new user turn into its own card', () => {
		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', event(TURN1, 'running', { input: { cmd: 'a' } }));
		handler!('sess-1-ai-tab-1', event(TURN1, 'completed', { output: 'A' }));
		sendUser('q2', 2);
		handler!('sess-1-ai-tab-1', event(TURN2, 'running', { input: { cmd: 'b' } }));
		// The first turn's completion is delivered again, late, and then a stray
		// running echo of it: neither may touch the new turn, add a card, or
		// reopen the settled call.
		handler!('sess-1-ai-tab-1', event(TURN1, 'completed', { output: 'A' }));
		handler!('sess-1-ai-tab-1', event(TURN1, 'running'));

		expect(tools()).toHaveLength(2);
		expect(tools()[0].metadata?.toolState).toEqual({
			status: 'completed',
			input: { cmd: 'a' },
			output: 'A',
		});
		expect(tools()[1].metadata?.toolState).toEqual({ status: 'running', input: { cmd: 'b' } });
		// The user message stays between the two turns' cards.
		expect(logs().map((l) => l.id)).toEqual(['q1', `tool-${TURN1}`, 'q2', `tool-${TURN2}`]);
	});

	it('lets a late completion finish an earlier turn call nothing settled', () => {
		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', event(TURN1, 'running', { input: { cmd: 'slow' } }));
		sendUser('q2', 2);
		handler!('sess-1-ai-tab-1', event(TURN1, 'completed', { output: 'done late' }));

		expect(tools()).toHaveLength(1);
		expect(tools()[0].metadata?.toolState).toEqual({
			status: 'completed',
			input: { cmd: 'slow' },
			output: 'done late',
		});
	});

	it('keeps parallel calls apart when their events interleave', () => {
		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', event('run-a:item_1', 'running', { input: { cmd: 'a' } }));
		handler!('sess-1-ai-tab-1', event('run-a:item_2', 'running', { input: { cmd: 'b' } }));
		handler!('sess-1-ai-tab-1', event('run-a:item_2', 'completed', { output: 'B' }));
		handler!('sess-1-ai-tab-1', event('run-a:item_1', 'failed', { output: 'A failed' }));

		expect(
			tools().map((t) => [t.id, t.metadata?.toolState?.status, t.metadata?.toolState?.output])
		).toEqual([
			['tool-run-a:item_1', 'failed', 'A failed'],
			['tool-run-a:item_2', 'completed', 'B'],
		]);
		expect(tools()[0].metadata?.toolState?.input).toEqual({ cmd: 'a' });
		expect(tools()[1].metadata?.toolState?.input).toEqual({ cmd: 'b' });
	});

	it('correlates nested subagent calls by their own ids and keeps the parent link', () => {
		renderHook(() => useAgentToolExecutionListener());
		handler!('sess-1-ai-tab-1', { ...event('task_1', 'running'), toolName: 'Task' });
		handler!('sess-1-ai-tab-1', {
			...event('child_1', 'running', { input: { path: 'a.ts' } }),
			toolName: 'Read',
			parentToolUseId: 'task_1',
		});
		handler!('sess-1-ai-tab-1', {
			...event('child_2', 'running', { input: { path: 'b.ts' } }),
			toolName: 'Read',
			parentToolUseId: 'task_1',
		});
		// Children finish out of order, the second without repeating its parent.
		handler!('sess-1-ai-tab-1', {
			...event('child_2', 'completed', { output: 'B' }),
			toolName: 'Read',
		});
		handler!('sess-1-ai-tab-1', {
			...event('child_1', 'completed', { output: 'A' }),
			toolName: 'Read',
			parentToolUseId: 'task_1',
		});
		handler!('sess-1-ai-tab-1', {
			...event('task_1', 'completed', { output: 'summary' }),
			toolName: 'Task',
		});

		expect(
			tools().map((t) => [t.id, t.metadata?.parentToolUseId, t.metadata?.toolState?.output])
		).toEqual([
			['tool-task_1', undefined, 'summary'],
			['tool-child_1', 'task_1', 'A'],
			['tool-child_2', 'task_1', 'B'],
		]);
	});
});
