/**
 * Catching an already-open native conversation up with its transcript after
 * it continued outside Maestro (another app, a CLI run). The refresh is
 * read-only and must never cost the user anything already on screen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	nativeConversationLooksNewer,
	refreshNativeConversation,
	resetNativeConversationRefreshes,
} from '../../../renderer/services/refreshNativeConversation';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useRetryStore } from '../../../renderer/stores/retryStore';
import type { AITab, LogEntry, QueuedItem, Session } from '../../../renderer/types';
import type { ProjectHistoryConversation } from '../../../shared/projectHistory';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';

const NATIVE = '00000000-0000-7000-a000-000000000001';

function msg(uuid: string, type: 'user' | 'assistant', content: string, iso: string) {
	return { uuid, type, role: type, content, timestamp: iso };
}

/** What the tab cached this afternoon: hydrated from disk, then two local errors. */
function cachedLogs(): LogEntry[] {
	return [
		{ id: 'backfilled', timestamp: 1, source: 'user', text: 'much older question' },
		{
			id: 'm1',
			timestamp: Date.parse('2026-10-16T13:00:00Z'),
			source: 'user',
			text: 'afternoon question',
		},
		{
			id: 'm2',
			timestamp: Date.parse('2026-10-16T13:01:00Z'),
			source: 'stdout',
			text: 'afternoon answer',
		},
		{ id: 'err', timestamp: Date.parse('2026-10-16T14:00:00Z'), source: 'error', text: 'Busy' },
	];
}

/** The native file now: the afternoon turns plus what was written tonight. */
const DISK = [
	msg('m1', 'user', 'afternoon question', '2026-10-16T13:00:00Z'),
	msg('m2', 'assistant', 'afternoon answer', '2026-10-16T13:01:00Z'),
	msg('m3', 'user', 'tonight question', '2026-10-16T15:57:51Z'),
	msg('m4', 'assistant', 'tonight answer', '2026-10-16T15:58:30Z'),
];

function tab(overrides: Partial<AITab> = {}): AITab {
	return createMockAITab({
		id: 'tab-native',
		agentSessionId: NATIVE,
		name: 'Example Conversation',
		inputValue: 'half-typed draft',
		logs: cachedLogs(),
		...overrides,
	});
}

function owner(overrides: Partial<Session> = {}): Session {
	return createMockSession({
		id: 'maestro-owner',
		toolType: 'codex',
		projectRoot: '/Users/u/maestro-harness-bridge',
		customEnvVars: { CODEX_HOME: '/Users/u/.codex' },
		activeTabId: 'other-tab',
		aiTabs: [createMockAITab({ id: 'other-tab' }), tab()],
		...overrides,
	});
}

/**
 * The scanned native record: its cwd is where the conversation was started,
 * not where the Maestro runner lives now.
 */
const RECORD: ProjectHistoryConversation = {
	key: `codex:local:/Users/u/.codex:${NATIVE}`,
	projectKey: 'group:maestro',
	projectPath: '/Users/u/sample-project',
	provider: 'codex',
	nativeSessionId: NATIVE,
	title: 'Example Conversation',
	nativeTitle: '原生会话刷新示例',
	preview: '',
	createdAt: 1,
	modifiedAt: Date.parse('2026-10-16T15:58:30Z'),
	messageCount: 4,
	starred: false,
	ownerId: 'maestro-owner',
	accountEnvVar: 'CODEX_HOME',
	accountDir: '/Users/u/.codex',
};

function storedTab(): AITab | undefined {
	return useSessionStore
		.getState()
		.sessions.find((s) => s.id === 'maestro-owner')
		?.aiTabs.find((t) => t.id === 'tab-native');
}

function patchStoredTab(patch: Partial<AITab>): void {
	useSessionStore.getState().setSessions((prev) =>
		prev.map((s) => ({
			...s,
			aiTabs: s.aiTabs.map((t) => (t.id === 'tab-native' ? { ...t, ...patch } : t)),
		}))
	);
}

const read = vi.fn();

beforeEach(() => {
	resetNativeConversationRefreshes();
	read.mockReset();
	read.mockResolvedValue({ messages: DISK, total: DISK.length, hasMore: false });
	(window.maestro as any).agentSessions = { ...(window.maestro as any).agentSessions, read };
	useRetryStore.setState({ retries: {} } as never);
	useSessionStore.setState({ sessions: [owner()], activeSessionId: 'elsewhere' } as never);
});

afterEach(() => {
	useRetryStore.setState({ retries: {} } as never);
});

describe('refreshNativeConversation', () => {
	it('appends what was written outside Maestro to a non-empty open tab, and keeps everything local', async () => {
		const result = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: RECORD,
		});

		expect(result).toEqual({ status: 'updated', added: 2 });
		const after = storedTab()!;
		expect(after.logs.map((e) => e.id)).toEqual(['backfilled', 'm1', 'm2', 'err', 'm3', 'm4']);
		// Same tab, same native id, user's name and draft untouched.
		expect(after.agentSessionId).toBe(NATIVE);
		expect(after.name).toBe('Example Conversation');
		expect(after.inputValue).toBe('half-typed draft');
		// No focus moved: not the agent, not the tab inside it.
		expect(useSessionStore.getState().activeSessionId).toBe('elsewhere');
		expect(useSessionStore.getState().sessions[0].activeTabId).toBe('other-tab');
		expect(useSessionStore.getState().sessions[0].aiTabs).toHaveLength(2);
	});

	it("reads the record's own path and account pool, pinned to the owning runner", async () => {
		await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: RECORD,
		});
		expect(read).toHaveBeenCalledTimes(1);
		const [provider, path, id, options] = read.mock.calls[0];
		expect([provider, path, id]).toEqual(['codex', '/Users/u/sample-project', NATIVE]);
		expect(options).toMatchObject({
			offset: 0,
			ownerAgentId: 'maestro-owner',
			configDir: '/Users/u/.codex',
		});
	});

	it('shows an own send once when its native copy was written 132s late, and stays stable', async () => {
		// Pre-turn context compaction: the provider persisted the user message
		// long after Maestro sent it, which the live send window cannot pair.
		const sentAt = Date.parse('2026-10-16T16:00:00Z');
		const prompt = 'Delayed continuation check: reply and recall the token.';
		const answer = 'Continued; the token is synthetic-token-17.';
		const disk = [
			msg('m1', 'user', 'afternoon question', '2026-10-16T13:00:00Z'),
			msg('m2', 'assistant', 'afternoon answer', '2026-10-16T13:01:00Z'),
			msg('m5', 'user', prompt, new Date(sentAt + 132_165).toISOString()),
			msg('m6', 'assistant', answer, new Date(sentAt + 146_030).toISOString()),
		];
		read.mockResolvedValue({ messages: disk, total: disk.length, hasMore: false });
		const logs: LogEntry[] = [
			cachedLogs()[1],
			cachedLogs()[2],
			{
				id: 'local-send',
				timestamp: sentAt,
				source: 'user',
				text: prompt,
				images: [],
				delivered: true,
			},
			{ id: 'live-reply', timestamp: sentAt + 146_000, source: 'stdout', text: answer },
		];
		useSessionStore.setState({
			sessions: [owner({ aiTabs: [createMockAITab({ id: 'other-tab' }), tab({ logs })] })],
			activeSessionId: 'elsewhere',
		} as never);

		const first = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
		});
		expect(first).toEqual({ status: 'updated', added: 0, upgraded: 1 });
		const after = storedTab()!;
		const users = after.logs.filter((e) => e.source === 'user');
		expect(users.map((e) => e.id)).toEqual(['m1', 'local-send']);
		expect(users[1]).toMatchObject({
			timestamp: sentAt,
			delivered: true,
			nativeTranscript: { messageId: 'm5' },
		});
		// The draft and the tab's identity are untouched.
		expect(after.inputValue).toBe('half-typed draft');
		expect(after.agentSessionId).toBe(NATIVE);

		resetNativeConversationRefreshes();
		const second = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
		});
		expect(second).toEqual({ status: 'unchanged' });
	});

	it('shows another thread’s continuation that arrived after a stopped live turn', async () => {
		// Maestro ran a turn and the user stopped it; then the official app
		// continued the SAME thread with send_message_to_thread. Native records
		// that as an output-only tool call, with no user message before it.
		const sentAt = Date.parse('2026-10-16T16:10:04Z');
		const prompt = 'Shared stop check: run sleep 45 once; I will stop it.';
		const iso = (offset: number) => new Date(sentAt + offset).toISOString();
		const disk = [
			msg('m1', 'user', 'afternoon question', '2026-10-16T13:00:00Z'),
			msg('m2', 'assistant', 'afternoon answer', '2026-10-16T13:01:00Z'),
			msg('m7', 'user', prompt, iso(330)),
			{ ...msg('m8', 'assistant', 'Shared stop wait starts', iso(3_930)), channel: 'commentary' },
			{
				...msg('m9', 'assistant', 'Tool: exec', iso(4_540)),
				toolUse: [
					{
						tool: 'exec',
						args: 'const r = await tools.exec_command({cmd:"sleep 45"}); text(r);',
						state: { status: 'canceled', output: 'aborted by user after 27.5s' },
					},
				],
			},
			{
				...msg('m10', 'assistant', 'Tool: send_message_to_thread', iso(211_930)),
				toolUse: [
					{
						tool: 'send_message_to_thread',
						state: {
							status: 'completed',
							output:
								'<codex_delegation>\n  <source_thread_id>22222222-3333-4444-8555-666666666666</source_thread_id>\n  <input>Recovery check after the stop.</input>\n</codex_delegation>',
						},
					},
				],
			},
			{
				...msg(
					'm11',
					'assistant',
					'Recovered after the stop; the turn was stopped by the user.',
					iso(219_580)
				),
				channel: 'final',
			},
		];
		read.mockResolvedValue({ messages: disk, total: disk.length, hasMore: false });
		const logs: LogEntry[] = [
			cachedLogs()[1],
			cachedLogs()[2],
			{ id: 'local-stop', timestamp: sentAt, source: 'user', text: prompt, images: [] },
			{
				id: 'live-progress',
				timestamp: sentAt + 3_940,
				source: 'stdout',
				purpose: 'commentary',
				text: 'Shared stop wait starts',
			},
			{
				id: 'live-sleep',
				timestamp: sentAt + 4_715,
				source: 'tool',
				text: 'shell',
				metadata: { toolState: { status: 'canceled', input: { command: 'sleep 45' } } },
			},
			{
				id: 'local-stopped',
				timestamp: sentAt + 37_958,
				source: 'system',
				text: 'Canceled by user',
			},
		];
		useSessionStore.setState({
			sessions: [owner({ aiTabs: [createMockAITab({ id: 'other-tab' }), tab({ logs })] })],
			activeSessionId: 'elsewhere',
		} as never);

		const first = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
		});
		expect(first).toEqual({ status: 'updated', added: 2 });
		const after = storedTab()!;
		expect(after.logs.slice(-2).map((e) => e.id)).toEqual(['m10', 'm11']);
		// The stopped turn's stored exec stays behind its own live card, the
		// prompt is not duplicated, and nothing else about the tab moved.
		expect(after.logs.some((e) => e.id === 'm9')).toBe(false);
		expect(after.logs.filter((e) => e.source === 'user').map((e) => e.id)).toEqual([
			'm1',
			'local-stop',
		]);
		expect(after.inputValue).toBe('half-typed draft');
		expect(useSessionStore.getState().sessions[0].activeTabId).toBe('other-tab');

		resetNativeConversationRefreshes();
		const second = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
		});
		expect(second).toEqual({ status: 'unchanged' });
	});

	it('asks main for a strictly read-only read, with or without a record', async () => {
		// A catch-up runs in the background (also automatically, see
		// useNativeTranscriptFollow): it must never restore a starred transcript.
		await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: RECORD,
		});
		expect(read.mock.calls[0][3]).toMatchObject({ readOnly: true });

		resetNativeConversationRefreshes();
		read.mockClear();
		await refreshNativeConversation({ sessionId: 'maestro-owner', tabId: 'tab-native' });
		expect(read).toHaveBeenCalled();
		for (const call of read.mock.calls) expect(call[3]).toMatchObject({ readOnly: true });
	});

	it('never reads a record scanned on another account into a runner switched to a new one', async () => {
		// The row was scanned while the runner read pool A; it is now on pool B.
		useSessionStore.setState({
			sessions: [owner({ customEnvVars: { CODEX_HOME: '/Users/u/.codex-work' } })],
		} as never);
		const result = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: RECORD,
		});
		expect(result).toEqual({ status: 'skipped', reason: 'mismatch' });
		expect(read).not.toHaveBeenCalled();
		expect(storedTab()!.logs).toHaveLength(4);
	});

	it('never reads a record from another host or provider', async () => {
		const remote = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: { ...RECORD, sshRemoteId: 'build-box' },
		});
		const claude = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: { ...RECORD, provider: 'claude-code', accountEnvVar: 'CLAUDE_CONFIG_DIR' },
		});
		expect(remote).toEqual({ status: 'skipped', reason: 'mismatch' });
		expect(claude).toEqual({ status: 'skipped', reason: 'mismatch' });
		expect(read).not.toHaveBeenCalled();
	});

	it("accepts the record's pool for a default-account runner, reading from the conversation's own cwd", async () => {
		useSessionStore.setState({ sessions: [owner({ customEnvVars: undefined })] } as never);
		const result = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: RECORD,
		});
		expect(result).toEqual({ status: 'updated', added: 2 });
		expect(read.mock.calls[0][1]).toBe('/Users/u/sample-project');
		expect(read.mock.calls[0][3]).toMatchObject({ configDir: '/Users/u/.codex' });
	});

	it('drops a record-pinned result when the runner switches account while the read is out', async () => {
		let release!: () => void;
		read.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = () => resolve({ messages: DISK, total: DISK.length, hasMore: false });
				})
		);
		const pending = refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: RECORD,
		});
		await vi.waitFor(() => expect(read).toHaveBeenCalled());
		useSessionStore
			.getState()
			.setSessions((prev) =>
				prev.map((s) => ({ ...s, customEnvVars: { CODEX_HOME: '/Users/u/.codex-work' } }))
			);
		release();
		expect(await pending).toEqual({ status: 'skipped', reason: 'changed' });
		expect(storedTab()!.logs.map((e) => e.id)).toEqual(['backfilled', 'm1', 'm2', 'err']);
	});

	it('changes nothing when the transcript has nothing new', async () => {
		read.mockResolvedValue({ messages: DISK.slice(0, 2), total: 2, hasMore: false });
		const before = storedTab()!.logs;
		expect(
			await refreshNativeConversation({ sessionId: 'maestro-owner', tabId: 'tab-native' })
		).toEqual({ status: 'unchanged' });
		expect(storedTab()!.logs).toBe(before);
	});

	it('keeps the cached transcript when the read fails or comes back empty', async () => {
		const before = storedTab()!.logs;
		read.mockRejectedValueOnce(new Error('EACCES'));
		const failed = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
		});
		expect(failed.status).toBe('failed');
		expect(storedTab()!.logs).toBe(before);

		read.mockResolvedValueOnce({ messages: [], total: 0, hasMore: false });
		const empty = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
		});
		expect(empty.status).toBe('failed');
		expect(storedTab()!.logs).toBe(before);

		// A retry after the cause clears works.
		const retried = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
		});
		expect(retried.status).toBe('updated');
	});

	it('does not read at all while a turn runs, an item is queued, or an auto-retry is pending', async () => {
		patchStoredTab({ state: 'busy' });
		expect(
			await refreshNativeConversation({ sessionId: 'maestro-owner', tabId: 'tab-native' })
		).toEqual({ status: 'skipped', reason: 'busy' });

		patchStoredTab({ state: 'idle' });
		const queued = { id: 'q', tabId: 'tab-native', type: 'message', text: 'next' } as QueuedItem;
		useSessionStore
			.getState()
			.setSessions((prev) => prev.map((s) => ({ ...s, executionQueue: [queued] })));
		expect(
			await refreshNativeConversation({ sessionId: 'maestro-owner', tabId: 'tab-native' })
		).toEqual({ status: 'skipped', reason: 'queued' });

		useSessionStore
			.getState()
			.setSessions((prev) => prev.map((s) => ({ ...s, executionQueue: [] })));
		useRetryStore.setState({
			retries: { 'maestro-owner:tab-native': { status: 'scheduled' } },
		} as never);
		expect(
			await refreshNativeConversation({ sessionId: 'maestro-owner', tabId: 'tab-native' })
		).toEqual({ status: 'skipped', reason: 'retrying' });

		expect(read).not.toHaveBeenCalled();
		expect(storedTab()!.logs.map((e) => e.id)).toEqual(['backfilled', 'm1', 'm2', 'err']);
	});

	it('drops the result when a turn starts while the read is out', async () => {
		let release!: () => void;
		read.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = () => resolve({ messages: DISK, total: DISK.length, hasMore: false });
				})
		);
		const pending = refreshNativeConversation({ sessionId: 'maestro-owner', tabId: 'tab-native' });
		await vi.waitFor(() => expect(read).toHaveBeenCalled());
		const live: LogEntry = { id: 'live', timestamp: Date.now(), source: 'user', text: 'sent now' };
		patchStoredTab({ state: 'busy', logs: [...storedTab()!.logs, live] });
		release();

		expect(await pending).toEqual({ status: 'skipped', reason: 'busy' });
		expect(storedTab()!.logs.map((e) => e.id)).toEqual(['backfilled', 'm1', 'm2', 'err', 'live']);
	});

	it('drops the result when the tab now points at another conversation or account', async () => {
		let release!: () => void;
		read.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = () => resolve({ messages: DISK, total: DISK.length, hasMore: false });
				})
		);
		const pending = refreshNativeConversation({ sessionId: 'maestro-owner', tabId: 'tab-native' });
		await vi.waitFor(() => expect(read).toHaveBeenCalled());
		useSessionStore
			.getState()
			.setSessions((prev) =>
				prev.map((s) => ({ ...s, customEnvVars: { CODEX_HOME: '/Users/u/.codex-work' } }))
			);
		release();
		expect(await pending).toEqual({ status: 'skipped', reason: 'changed' });
		expect(storedTab()!.logs).toHaveLength(4);
	});

	it('keeps a draft typed and history backfilled during the read', async () => {
		let release!: () => void;
		read.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = () => resolve({ messages: DISK, total: DISK.length, hasMore: false });
				})
		);
		const pending = refreshNativeConversation({ sessionId: 'maestro-owner', tabId: 'tab-native' });
		await vi.waitFor(() => expect(read).toHaveBeenCalled());
		const older: LogEntry = { id: 'even-older', timestamp: 0, source: 'user', text: 'first ever' };
		patchStoredTab({ inputValue: 'typed while loading', logs: [older, ...storedTab()!.logs] });
		release();

		expect(await pending).toEqual({ status: 'updated', added: 2 });
		const after = storedTab()!;
		expect(after.inputValue).toBe('typed while loading');
		expect(after.logs.map((e) => e.id)).toEqual([
			'even-older',
			'backfilled',
			'm1',
			'm2',
			'err',
			'm3',
			'm4',
		]);
	});

	it('joins a second request for the same tab instead of reading twice', async () => {
		const a = refreshNativeConversation({ sessionId: 'maestro-owner', tabId: 'tab-native' });
		const b = refreshNativeConversation({ sessionId: 'maestro-owner', tabId: 'tab-native' });
		expect(await a).toEqual(await b);
		expect(read).toHaveBeenCalledTimes(1);
		expect(storedTab()!.logs.filter((e) => e.id === 'm3')).toHaveLength(1);
	});

	it('widens the window instead of leaving a gap when more than one window was written elsewhere', async () => {
		const tail = [
			msg('m3', 'user', 'tonight question', '2026-10-16T15:57:51Z'),
			msg('m4', 'assistant', 'tonight answer', '2026-10-16T15:58:30Z'),
		];
		read
			.mockResolvedValueOnce({ messages: tail, total: 4, hasMore: true })
			.mockResolvedValueOnce({ messages: DISK, total: 4, hasMore: false });

		const result = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
		});

		expect(result).toEqual({ status: 'updated', added: 2 });
		expect(read).toHaveBeenCalledTimes(2);
		expect(read.mock.calls[1][3].limit).toBeGreaterThan(read.mock.calls[0][3].limit);
	});

	it("widens past a later repetition of a live tab's last turn instead of skipping the history between", async () => {
		// A tab that ran live: renderer ids, ending in "continue" / "OK" at 13:00.
		const liveLogs: LogEntry[] = [
			{
				id: 'local-q',
				timestamp: Date.parse('2026-10-16T13:00:00Z'),
				source: 'user',
				text: 'continue',
			},
			{
				id: 'local-a',
				timestamp: Date.parse('2026-10-16T13:01:00Z'),
				source: 'stdout',
				text: 'OK',
			},
		];
		useSessionStore.setState({
			sessions: [owner({ aiTabs: [tab({ logs: liveLogs })] })],
		} as never);
		const newest = [
			msg('d5', 'user', 'continue', '2026-10-16T16:00:00Z'),
			msg('d6', 'assistant', 'OK', '2026-10-16T16:01:00Z'),
			msg('d7', 'user', 'newest', '2026-10-16T16:02:00Z'),
		];
		const full = [
			msg('d1', 'user', 'continue', '2026-10-16T13:00:02Z'),
			msg('d2', 'assistant', 'OK', '2026-10-16T13:01:40Z'),
			msg('d3', 'user', 'external question', '2026-10-16T14:00:00Z'),
			msg('d4', 'assistant', 'external answer', '2026-10-16T14:01:00Z'),
			...newest,
		];
		read
			.mockResolvedValueOnce({ messages: newest, total: full.length, hasMore: true })
			.mockResolvedValueOnce({ messages: full, total: full.length, hasMore: false });

		const result = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
		});

		expect(read).toHaveBeenCalledTimes(2);
		expect(result).toEqual({ status: 'updated', added: 5 });
		expect(storedTab()!.logs.map((e) => e.id)).toEqual([
			'local-q',
			'local-a',
			'd3',
			'd4',
			'd5',
			'd6',
			'd7',
		]);
	});

	it('changes nothing when the transcript cannot be lined up with the tab', async () => {
		read.mockResolvedValue({
			messages: [msg('x', 'user', 'unrelated', '2026-10-16T16:00:00Z')],
			total: 1,
			hasMore: false,
		});
		const result = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
		});
		expect(result.status).toBe('failed');
		expect(storedTab()!.logs).toHaveLength(4);
	});
});

describe('refreshNativeConversation: upgrading a tab an older build cached', () => {
	/** The tab as an older build hydrated it: the tool call stored as text. */
	function legacyLogs(): LogEntry[] {
		return [
			...cachedLogs(),
			{
				id: 'call_1',
				timestamp: Date.parse('2026-10-16T13:02:00Z'),
				source: 'stdout',
				text: 'Tool: exec_command',
			},
		];
	}
	const DISK_WITH_TOOL = [
		...DISK.slice(0, 2),
		{
			...msg('call_1', 'assistant', 'Tool: exec_command', '2026-10-16T13:02:00Z'),
			toolUse: [
				{ tool: 'exec_command', args: '{"cmd":"ls"}', state: { status: 'completed', output: 'a' } },
			],
		},
	];

	beforeEach(() => {
		read.mockResolvedValue({ messages: DISK_WITH_TOOL, total: 3, hasMore: false });
		useSessionStore.setState({
			sessions: [
				owner({ aiTabs: [createMockAITab({ id: 'other-tab' }), tab({ logs: legacyLogs() })] }),
			],
			activeSessionId: 'elsewhere',
		} as never);
	});

	it('rewrites the cached tool call into a tool card even though nothing new was written', async () => {
		const result = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: RECORD,
		});
		expect(result).toEqual({ status: 'updated', added: 0, upgraded: 1 });
		const after = storedTab()!;
		expect(after.logs.map((e) => [e.id, e.source])).toEqual([
			['backfilled', 'user'],
			['m1', 'user'],
			['m2', 'stdout'],
			['err', 'error'],
			['call_1', 'tool'],
		]);
		expect(after.logs[4].metadata?.toolState).toMatchObject({
			status: 'completed',
			input: { cmd: 'ls' },
		});
		// Same conversation, same draft, no focus moved.
		expect(after.agentSessionId).toBe(NATIVE);
		expect(after.inputValue).toBe('half-typed draft');
		expect(useSessionStore.getState().activeSessionId).toBe('elsewhere');
		expect(useSessionStore.getState().sessions[0].activeTabId).toBe('other-tab');

		// A second refresh finds nothing left to do.
		expect(
			await refreshNativeConversation({
				sessionId: 'maestro-owner',
				tabId: 'tab-native',
				record: RECORD,
			})
		).toEqual({ status: 'unchanged' });
	});

	it('completes a converted tool card whose result was written after it was read', async () => {
		const ts = Date.parse('2026-10-16T13:02:00Z');
		patchStoredTab({
			logs: [
				...cachedLogs(),
				{
					id: 'call_1',
					timestamp: ts,
					source: 'tool',
					text: 'exec_command',
					metadata: { toolState: { input: { cmd: 'ls' } } },
					nativeTranscript: { messageId: 'call_1' },
				},
			],
		});
		const target = { sessionId: 'maestro-owner', tabId: 'tab-native', record: RECORD };
		expect(await refreshNativeConversation(target)).toEqual({
			status: 'updated',
			added: 0,
			upgraded: 1,
		});
		expect(storedTab()!.logs[4].metadata?.toolState).toMatchObject({
			status: 'completed',
			output: 'a',
		});
		expect(await refreshNativeConversation(target)).toEqual({ status: 'unchanged' });
	});

	it('does not upgrade while a turn runs', async () => {
		patchStoredTab({ state: 'busy' });
		const result = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: RECORD,
		});
		expect(result).toEqual({ status: 'skipped', reason: 'busy' });
		expect(storedTab()!.logs[4].source).toBe('stdout');
	});

	it('never upgrades from a record on another account pool', async () => {
		useSessionStore
			.getState()
			.setSessions((prev) =>
				prev.map((s) => ({ ...s, customEnvVars: { CODEX_HOME: '/Users/u/.codex-work' } }))
			);
		const result = await refreshNativeConversation({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: RECORD,
		});
		expect(result).toEqual({ status: 'skipped', reason: 'mismatch' });
		expect(read).not.toHaveBeenCalled();
		expect(storedTab()!.logs[4]).toMatchObject({ source: 'stdout', text: 'Tool: exec_command' });
	});
});

describe('nativeConversationLooksNewer', () => {
	const cached = { logs: cachedLogs(), createdAt: 0 };
	const tonight = Date.parse('2026-10-16T15:58:30Z');

	it('says yes only when the native file moved past the tab, once per change', () => {
		expect(nativeConversationLooksNewer(cached, tonight)).toBe(true);
		expect(nativeConversationLooksNewer(cached, tonight, tonight)).toBe(false);
		expect(nativeConversationLooksNewer(cached, Date.parse('2026-10-16T14:00:00Z'))).toBe(false);
	});
});
