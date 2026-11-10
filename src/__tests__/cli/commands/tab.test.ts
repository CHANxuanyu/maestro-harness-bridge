/**
 * @file tab.test.ts
 * @description Tests for the tab CLI command group
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';

vi.mock('../../../cli/services/maestro-client', () => ({ withMaestroClient: vi.fn() }));
vi.mock('../../../cli/services/storage', () => ({
	resolveAgentId: vi.fn((id: string) => id),
	readActiveAgentId: vi.fn(() => null),
}));
vi.mock('../../../cli/output/formatter', () => ({
	formatError: vi.fn((msg) => `Error: ${msg}`),
	formatSuccess: vi.fn((msg) => `Success: ${msg}`),
}));

import {
	tabNew,
	tabCompact,
	tabPanel,
	tabSplit,
	tabStop,
	tabUnsplit,
	tabClose,
	tabRename,
	tabStar,
	tabMove,
	tabUnread,
	tabSaveToHistory,
	tabThinking,
	tabReadOnly,
	tabPermission,
	tabModel,
	tabEffort,
	tabEnterToSend,
	tabShow,
	tabChildren,
	tabSelect,
	tabCommands,
} from '../../../cli/commands/tab';
import { withMaestroClient } from '../../../cli/services/maestro-client';
import { resolveAgentId, readActiveAgentId } from '../../../cli/services/storage';
import { formatError } from '../../../cli/output/formatter';

// agent-1 owns three tabs in tab-bar order so reordering has something to move
// against; agent-2's single tab guards against cross-agent index leakage.
function entry(tabId: string, agentId: string, over: Record<string, unknown> = {}) {
	return {
		tabId,
		sessionId: tabId,
		agentId,
		agentName: agentId,
		toolType: 'claude-code',
		name: null,
		agentSessionId: null,
		state: 'idle' as const,
		createdAt: 0,
		starred: false,
		active: false,
		hasUnread: false,
		saveToHistory: true,
		readOnly: false,
		thinking: 'off' as const,
		model: null,
		origin: {
			kind: 'review',
			sourceSessionId: 'source',
			sourceTabId: 'source-tab',
			sourceProvider: 'codex',
			createdAt: 1,
		},
		effort: null,
		enterToSend: null,
		...over,
	};
}

const SESSIONS = [
	entry('tab-aaaa', 'agent-1', { active: true, thinking: 'on' }),
	entry('tab-cccc', 'agent-1'),
	entry('tab-dddd', 'agent-1'),
	entry('tab-bbbb', 'agent-2', { active: true, model: 'opus', effort: 'high' }),
];

/**
 * Mock that answers list_desktop_sessions with SESSIONS and captures any other
 * command payload. Works across the two separate connections tab verbs open
 * (resolve owner, then send the command).
 */
function mockTab(result: Record<string, unknown>) {
	let captured: Record<string, unknown> = {};
	vi.mocked(withMaestroClient).mockImplementation(async (action) =>
		action({
			sendCommand: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
				if (payload.type === 'list_desktop_sessions') {
					return Promise.resolve({ sessions: SESSIONS });
				}
				captured = payload;
				return Promise.resolve(result);
			}),
		} as never)
	);
	return () => captured;
}

describe('tab commands', () => {
	it('reads account scoped native commands through the shared IPC handler', async () => {
		const result = {
			commands: [{ command: '/review', description: 'Project review', source: 'project' }],
			warning: 'remote-unavailable',
		};
		const captured = mockTab({ ok: true, result });
		await tabCommands('tab-aaaa', { json: true });
		expect(captured()).toEqual({
			type: 'bridge.invoke',
			channel: 'agents:getNativeCommands',
			args: [{ sessionId: 'agent-1', tabId: 'tab-aaaa' }],
		});
		expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(result));
	});

	let consoleSpy: MockInstance;
	let processExitSpy: MockInstance;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(resolveAgentId).mockImplementation((id: string) => id);
		vi.mocked(readActiveAgentId).mockReturnValue(null);
		consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('__exit__');
		});
	});

	it('stops the resolved conversation through the acknowledged renderer action', async () => {
		const captured = mockTab({ success: true });
		await tabStop('tab-bb', { agent: 'agent-2', json: true });
		expect(captured()).toEqual({
			type: 'update_session_config',
			sessionId: 'agent-2',
			configPatch: { tabId: 'tab-bbbb', stopTurn: true },
		});
		expect(JSON.parse(consoleSpy.mock.calls[0][0])).toMatchObject({
			success: true,
			tabId: 'tab-bbbb',
		});
	});

	it('reports an idle or failed stop as failure instead of claiming success', async () => {
		mockTab({ success: false, error: 'This conversation is not running.' });
		await expect(tabStop('tab-aaaa', { json: true })).rejects.toThrow('__exit__');
		expect(processExitSpy).toHaveBeenCalledWith(1);
		expect(JSON.parse(consoleSpy.mock.calls[0][0])).toMatchObject({
			success: false,
			error: 'This conversation is not running.',
		});
	});

	it('lists hidden child conversations through the same scoped parent identity', async () => {
		const source = entry('reopened', 'source', { agentSessionId: 'native', toolType: 'codex' });
		const childOrigin = {
			kind: 'subtask',
			sourceSessionId: 'source',
			sourceTabId: 'closed',
			sourceProvider: 'codex',
			sourceNativeSessionId: 'native',
			createdAt: 1,
		};
		const child = entry('hidden-child', 'worker', {
			origin: childOrigin,
			hidden: true,
			name: 'Check the first case.',
			state: 'busy',
		});
		const unrelated = entry('unrelated', 'worker', {
			origin: { ...childOrigin, sourceSessionId: 'another-account' },
		});
		vi.mocked(withMaestroClient).mockImplementation(async (action) =>
			action({
				sendCommand: vi.fn().mockResolvedValue({ sessions: [source, child, unrelated] }),
			} as never)
		);
		await tabChildren('reopened', { json: true });
		expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual({
			success: true,
			tabId: 'reopened',
			agentId: 'source',
			children: [child],
		});
	});

	it('selects a child through the existing tab navigation transport', async () => {
		const payload = mockTab({ success: true });
		await tabSelect('tab-bbbb', { json: true });
		expect(payload()).toEqual({ type: 'select_tab', sessionId: 'agent-2', tabId: 'tab-bbbb' });
	});

	it('lists an older consult with a live source without inventing a native identity', async () => {
		const source = entry('source-tab', 'source');
		const child = entry('old-consult', 'worker', {
			origin: undefined,
			consultOrigin: { sourceSessionId: 'source', sourceTabId: 'source-tab' },
			hidden: true,
		});
		vi.mocked(withMaestroClient).mockImplementation(async (action) =>
			action({ sendCommand: vi.fn().mockResolvedValue({ sessions: [source, child] }) } as never)
		);
		await tabChildren('source-tab', { json: true });
		expect(JSON.parse(consoleSpy.mock.calls[0][0]).children).toEqual([child]);
	});

	it('compacts the named tab in the background through summarize_context', async () => {
		const payload = mockTab({ success: true });
		await tabCompact('tab-cccc', { background: true });
		expect(payload()).toMatchObject({
			type: 'summarize_context',
			sessionId: 'agent-1',
			tabId: 'tab-cccc',
			background: true,
		});
	});

	it('splits the exact conversation resolved from a unique prefix', async () => {
		const payload = mockTab({ success: true });
		await tabSplit('tab-bb', { json: true });
		expect(payload()).toMatchObject({
			type: 'update_session_config',
			sessionId: 'agent-2',
			configPatch: { tabId: 'tab-bbbb', newShellSplitAction: 'split' },
		});
		expect(JSON.parse(consoleSpy.mock.calls[0][0])).toMatchObject({ success: true });
	});

	it('unsplits the focused conversation without requiring a tab argument', async () => {
		vi.mocked(readActiveAgentId).mockReturnValue('agent-1');
		const payload = mockTab({ success: true });
		await tabUnsplit({});
		expect(payload()).toMatchObject({
			type: 'update_session_config',
			sessionId: 'agent-1',
			configPatch: { tabId: 'tab-aaaa', newShellSplitAction: 'unsplit' },
		});
	});

	it('split forwards a numeric left pane ratio through the shared action', async () => {
		const payload = mockTab({ success: true });
		await tabSplit('tab-bbbb', { ratio: '0.6' });
		expect(payload()).toMatchObject({
			configPatch: {
				tabId: 'tab-bbbb',
				newShellSplitAction: 'split',
				newShellSplitRatio: 0.6,
			},
		});
	});

	it('rejects a nonnumeric split ratio before requesting a mutation', async () => {
		const payload = mockTab({ success: true });
		await expect(tabSplit('tab-bbbb', { ratio: 'wide' })).rejects.toThrow('__exit__');
		expect(payload()).toEqual({});
	});

	it('unsplit can address a particular conversation window with --agent', async () => {
		const payload = mockTab({ success: true });
		await tabUnsplit({ agent: 'agent-2' });
		expect(payload()).toMatchObject({
			sessionId: 'agent-2',
			configPatch: { tabId: 'tab-bbbb', newShellSplitAction: 'unsplit' },
		});
	});

	it('reports a refused split instead of printing success', async () => {
		mockTab({ success: false, error: 'Window too narrow' });
		await expect(tabSplit('tab-bbbb', { json: true })).rejects.toThrow('__exit__');
		expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('"success":true'));
	});

	it('tab new --provider --replace-empty prepares without sending', async () => {
		const payload = mockTab({ success: true, tabId: 'new-tool', agentId: 'target' });
		await tabNew({ agent: 'agent-1', provider: 'codex', replaceEmpty: 'tab-aaaa' });
		expect(payload()).toMatchObject({
			type: 'ai_handoff',
			action: 'new-conversation',
			sourceAgentId: 'agent-1',
			targetProvider: 'codex',
			replaceTabId: 'tab-aaaa',
		});
		expect(payload()).not.toHaveProperty('send');
	});
	it.each([
		'files',
		'changes',
		'changes-files',
		'changes-turns',
		'terminal',
		'tasks',
		'back',
		'open',
		'close',
		'edit',
		'preview',
		'save',
	])('tab panel writes %s through the acknowledged tab patch', async (action) => {
		const payload = mockTab({ success: true });
		await tabPanel('tab-aaaa', action, {});
		expect(payload()).toMatchObject({
			type: 'update_session_config',
			configPatch: { tabId: 'tab-aaaa', newShellPanelAction: action },
		});
	});

	it.each(['terminal-select', 'terminal-close', 'terminal-restart'])(
		'%s targets the requested terminal',
		async (action) => {
			const payload = mockTab({ success: true });
			await tabPanel('tab-aaaa', action, { terminal: 'term-id' });
			expect(payload()).toMatchObject({
				configPatch: {
					tabId: 'tab-aaaa',
					newShellPanelAction: action,
					newShellTerminalId: 'term-id',
				},
			});
		}
	);

	it('tab new (no prompt) sends new_tab and prints the tab id', async () => {
		const getPayload = mockTab({ success: true, tabId: 'tab-new' });
		await tabNew({ agent: 'agent-1' });
		const p = getPayload();
		expect(p.type).toBe('new_tab');
		expect(p.sessionId).toBe('agent-1');
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('tab-new'));
	});

	it('tab new --prompt sends new_ai_tab_with_prompt', async () => {
		const getPayload = mockTab({ success: true, tabId: 't' });
		await tabNew({ agent: 'agent-1', prompt: 'hello' });
		const p = getPayload();
		expect(p.type).toBe('new_ai_tab_with_prompt');
		expect(p.prompt).toBe('hello');
	});

	describe('tab new placement', () => {
		// `tab new --prompt` and `dispatch --new-tab` send the SAME
		// new_ai_tab_with_prompt message and disagree about the default: tab new
		// has always focused, dispatch has always been background. That is why the
		// default is keyed by verb rather than by message, and it is what these
		// assertions pin down.
		it('stays foreground by default, on both message shapes', async () => {
			const getNoPrompt = mockTab({ success: true, tabId: 'tab-new' });
			await tabNew({ agent: 'agent-1' });
			expect(getNoPrompt().background).toBe(false);

			const getWithPrompt = mockTab({ success: true, tabId: 'tab-new' });
			await tabNew({ agent: 'agent-1', prompt: 'hello' });
			expect(getWithPrompt().type).toBe('new_ai_tab_with_prompt');
			expect(getWithPrompt().background).toBe(false);
		});

		it('puts background:true on the wire for --background', async () => {
			const getPayload = mockTab({ success: true, tabId: 'tab-new' });
			await tabNew({ agent: 'agent-1', background: true });
			expect(getPayload().background).toBe(true);
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('background'));
		});

		it('lets --focus name the default explicitly', async () => {
			const getPayload = mockTab({ success: true, tabId: 'tab-new' });
			await tabNew({ agent: 'agent-1', background: true, focus: true });
			expect(getPayload().background).toBe(false);
		});
	});

	it('tab close resolves the owning agent from the tab id', async () => {
		const getPayload = mockTab({ success: true });
		await tabClose('tab-bbbb', {});
		const p = getPayload();
		expect(p.type).toBe('close_tab');
		expect(p.sessionId).toBe('agent-2');
		expect(p.tabId).toBe('tab-bbbb');
	});

	it('tab close accepts a unique prefix', async () => {
		const getPayload = mockTab({ success: true });
		await tabClose('tab-aa', {});
		expect(getPayload().tabId).toBe('tab-aaaa');
	});

	it('tab close fails on an unknown tab id', async () => {
		mockTab({ success: true });
		await expect(tabClose('does-not-exist', {})).rejects.toThrow('__exit__');
		expect(formatError).toHaveBeenCalledWith(expect.stringContaining('Tab not found'));
		expect(processExitSpy).toHaveBeenCalledWith(1);
	});

	it('tab rename sends newName', async () => {
		const getPayload = mockTab({ success: true });
		await tabRename('tab-aaaa', 'Docs', {});
		const p = getPayload();
		expect(p.type).toBe('rename_tab');
		expect(p.newName).toBe('Docs');
	});

	it('tab star sends starred:true; unstar sends false', async () => {
		const getStar = mockTab({ success: true });
		await tabStar('tab-aaaa', true, {});
		expect(getStar().starred).toBe(true);

		const getUnstar = mockTab({ success: true });
		await tabStar('tab-aaaa', false, {});
		expect(getUnstar().starred).toBe(false);
	});

	it('tab move derives fromIndex from live tab order, scoped to the owning agent', async () => {
		const getPayload = mockTab({ success: true });
		await tabMove('tab-dddd', '0', {});
		const p = getPayload();
		expect(p.type).toBe('reorder_tab');
		expect(p.sessionId).toBe('agent-1');
		// agent-2's tab sits after agent-1's in the flat list; it must not shift
		// the index that agent-1's own tab bar sees.
		expect(p.fromIndex).toBe(2);
		expect(p.toIndex).toBe(0);
	});

	it('tab move accepts "first" and "last"', async () => {
		const getFirst = mockTab({ success: true });
		await tabMove('tab-dddd', 'first', {});
		expect(getFirst().toIndex).toBe(0);

		const getLast = mockTab({ success: true });
		await tabMove('tab-aaaa', 'last', {});
		expect(getLast().toIndex).toBe(2);
	});

	it('tab move clamps an out-of-range index to the last position', async () => {
		const getPayload = mockTab({ success: true });
		await tabMove('tab-aaaa', '99', {});
		expect(getPayload().toIndex).toBe(2);
	});

	it('tab move is a no-op when the tab is already at the target position', async () => {
		const getPayload = mockTab({ success: true });
		await tabMove('tab-aaaa', '0', {});
		// No reorder_tab message is sent, so nothing is captured.
		expect(getPayload()).toEqual({});
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('already at position 0'));
	});

	it('tab move rejects a non-numeric position', async () => {
		mockTab({ success: true });
		await expect(tabMove('tab-aaaa', 'middle', {})).rejects.toThrow('__exit__');
		expect(formatError).toHaveBeenCalledWith(expect.stringContaining('Invalid position'));
	});

	it('tab unread/read ride the allowlisted, flushed config path with a tabId', async () => {
		const getUnread = mockTab({ success: true });
		await tabUnread('tab-aaaa', true, {});
		const p = getUnread();
		expect(p.type).toBe('update_session_config');
		expect(p.sessionId).toBe('agent-1');
		expect(p.configPatch).toEqual({ tabId: 'tab-aaaa', hasUnread: true });

		const getRead = mockTab({ success: true });
		await tabUnread('tab-aaaa', false, {});
		expect(getRead().configPatch).toEqual({ tabId: 'tab-aaaa', hasUnread: false });
	});

	it('tab save-to-history sends an explicit boolean', async () => {
		const getOff = mockTab({ success: true });
		await tabSaveToHistory('tab-bbbb', false, {});
		const p = getOff();
		expect(p.sessionId).toBe('agent-2');
		expect(p.configPatch).toEqual({ tabId: 'tab-bbbb', saveToHistory: false });
	});

	it('tab flag verbs fail on an unknown tab id before contacting the desktop', async () => {
		mockTab({ success: true });
		await expect(tabUnread('nope', true, {})).rejects.toThrow('__exit__');
		expect(formatError).toHaveBeenCalledWith(expect.stringContaining('Tab not found'));
	});

	it('tab thinking sets an explicit mode', async () => {
		const getPayload = mockTab({ success: true });
		await tabThinking('tab-cccc', 'sticky', {});
		expect(getPayload().configPatch).toEqual({ tabId: 'tab-cccc', showThinking: 'sticky' });
	});

	it("tab thinking cycle advances from the tab's live mode, not from off", async () => {
		// tab-aaaa is already on 'on', so one cycle must land on 'sticky'.
		const getPayload = mockTab({ success: true });
		await tabThinking('tab-aaaa', 'cycle', {});
		expect(getPayload().configPatch).toEqual({ tabId: 'tab-aaaa', showThinking: 'sticky' });
	});

	it.each(['full', 'standard', 'readonly'] as const)(
		'tab permission writes %s through the shared config channel',
		async (mode) => {
			const getPayload = mockTab({ success: true });
			await tabPermission('tab-cccc', mode, {});
			expect(getPayload().configPatch).toEqual({ tabId: 'tab-cccc', permissionMode: mode });
		}
	);

	it('tab read-only, model, effort and enter-to-send write their own field', async () => {
		const getReadOnly = mockTab({ success: true });
		await tabReadOnly('tab-cccc', true, {});
		expect(getReadOnly().configPatch).toEqual({ tabId: 'tab-cccc', readOnlyMode: true });

		const getModel = mockTab({ success: true });
		await tabModel('tab-cccc', 'opus', {});
		expect(getModel().configPatch).toEqual({ tabId: 'tab-cccc', customModel: 'opus' });

		const getEffort = mockTab({ success: true });
		await tabEffort('tab-cccc', 'high', {});
		expect(getEffort().configPatch).toEqual({ tabId: 'tab-cccc', customEffort: 'high' });

		const getEnter = mockTab({ success: true });
		await tabEnterToSend('tab-cccc', false, {});
		expect(getEnter().configPatch).toEqual({ tabId: 'tab-cccc', enterToSend: false });
	});

	it('clearing an override sends null so the renderer drops the field', async () => {
		const getModel = mockTab({ success: true });
		await tabModel('tab-bbbb', null, {});
		expect(getModel().configPatch).toEqual({ tabId: 'tab-bbbb', customModel: null });

		const getEnter = mockTab({ success: true });
		await tabEnterToSend('tab-bbbb', null, {});
		expect(getEnter().configPatch).toEqual({ tabId: 'tab-bbbb', enterToSend: null });
	});

	it('"active" targets the agent named by --agent', async () => {
		const getPayload = mockTab({ success: true });
		await tabThinking('active', 'off', { agent: 'agent-2' });
		const p = getPayload();
		expect(p.sessionId).toBe('agent-2');
		expect(p.configPatch).toEqual({ tabId: 'tab-bbbb', showThinking: 'off' });
	});

	it('"active" falls back to the desktop\'s focused agent', async () => {
		vi.mocked(readActiveAgentId).mockReturnValue('agent-1');
		const getPayload = mockTab({ success: true });
		await tabReadOnly('active', true, {});
		expect(getPayload().configPatch).toEqual({ tabId: 'tab-aaaa', readOnlyMode: true });
	});

	it('"active" fails loudly when no agent is focused and none was named', async () => {
		mockTab({ success: true });
		await expect(tabShow('active', {})).rejects.toThrow('__exit__');
		expect(formatError).toHaveBeenCalledWith(expect.stringContaining('No active agent'));
	});

	it('tab show --json returns the whole entry without writing anything', async () => {
		const getPayload = mockTab({ success: true });
		await tabShow('tab-bbbb', { json: true });
		// No mutation was sent: the list call is the only traffic.
		expect(getPayload()).toEqual({});
		const printed = JSON.parse(consoleSpy.mock.calls.at(-1)?.[0] as string);
		expect(printed.tab.tabId).toBe('tab-bbbb');
		expect(printed.tab.model).toBe('opus');
		expect(printed.tab.origin).toMatchObject({
			kind: 'review',
			sourceSessionId: 'source',
			sourceTabId: 'source-tab',
		});
	});
});
