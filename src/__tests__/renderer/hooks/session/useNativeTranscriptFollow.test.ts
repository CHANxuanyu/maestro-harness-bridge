/**
 * Following the visible local Codex or Claude conversation while the same native session
 * is continued from another app: a stat-only revision check every ~2s, and the
 * canonical read-only catch-up only when that revision moved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AITab, Session } from '../../../../renderer/types';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { useGroupChatStore } from '../../../../renderer/stores/groupChatStore';
import { useRetryStore } from '../../../../renderer/stores/retryStore';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('../../../../renderer/services/refreshNativeConversation', async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import('../../../../renderer/services/refreshNativeConversation')
		>();
	return { ...actual, refreshNativeConversation: (...args: unknown[]) => refresh(...args) };
});

import {
	NATIVE_FOLLOW_FAILED_RETRY_MS,
	NATIVE_FOLLOW_MAX_REMEMBERED,
	NATIVE_FOLLOW_POLL_MS,
	rememberBounded,
	resolveNativeFollowTarget,
	useNativeTranscriptFollow,
} from '../../../../renderer/hooks/session/useNativeTranscriptFollow';

const NATIVE = '00000000-0000-7000-a000-0000000000f1';
const OTHER_NATIVE = '00000000-0000-7000-a000-0000000000f2';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function codexTab(overrides: Partial<AITab> = {}): AITab {
	return createMockAITab({
		id: 'tab-native',
		agentSessionId: NATIVE,
		inputValue: 'half-typed draft',
		logs: [{ id: 'm1', timestamp: 1, source: 'user', text: 'cached question' }],
		...overrides,
	});
}

function owner(overrides: Partial<Session> = {}): Session {
	return createMockSession({
		id: 'owner',
		toolType: 'codex',
		projectRoot: '/Users/u/project',
		activeTabId: 'tab-native',
		aiTabs: [codexTab(), codexTab({ id: 'tab-other', agentSessionId: OTHER_NATIVE })],
		...overrides,
	});
}

function setSession(session: Session, activeSessionId = session.id): void {
	useSessionStore.setState({ sessions: [session], activeSessionId } as never);
}

function patchSession(patch: Partial<Session>): void {
	useSessionStore.setState((state) => ({
		sessions: state.sessions.map((s) => ({ ...s, ...patch })),
	}));
}

const getTranscriptRevision = vi.fn();
let visibility: DocumentVisibilityState = 'visible';

/** Let the check's awaits settle without advancing to the next poll. */
async function settle(): Promise<void> {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
}

async function nextTick(): Promise<void> {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(NATIVE_FOLLOW_POLL_MS);
	});
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: false });
	refresh.mockReset();
	refresh.mockResolvedValue({ status: 'unchanged' });
	getTranscriptRevision.mockReset();
	getTranscriptRevision.mockResolvedValue('rev-1');
	(window.maestro as any).agentSessions = {
		...(window.maestro as any).agentSessions,
		getTranscriptRevision,
	};
	visibility = 'visible';
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => visibility,
	});
	useRetryStore.setState({ retries: {} } as never);
	useGroupChatStore.setState({ activeGroupChatId: null } as never);
	setSession(owner());
});

afterEach(() => {
	vi.useRealTimers();
});

describe('resolveNativeFollowTarget', () => {
	it('names the visible local Codex tab with its canonical identity', () => {
		const target = resolveNativeFollowTarget();
		expect(target).toMatchObject({
			sessionId: 'owner',
			tabId: 'tab-native',
			agentId: 'codex',
			projectPath: '/Users/u/project',
			nativeId: NATIVE,
		});
	});

	it('follows nothing that Maestro is writing to, or that is not a visible supported local tab', () => {
		const cases: Array<[string, () => void]> = [
			['busy turn', () => setSession(owner({ aiTabs: [codexTab({ state: 'busy' })] }))],
			[
				'queued item',
				() =>
					setSession(
						owner({
							executionQueue: [
								{ id: 'q', tabId: 'tab-native', type: 'message', text: 'x' } as never,
							],
						})
					),
			],
			['other provider', () => setSession(owner({ toolType: 'opencode' }))],
			[
				'SSH remote',
				() =>
					setSession(
						owner({ sessionSshRemoteConfig: { enabled: true, remoteId: 'remote-1' } } as never)
					),
			],
			['no native id', () => setSession(owner({ aiTabs: [codexTab({ agentSessionId: null })] }))],
			['file tab on screen', () => setSession(owner({ activeFileTabId: 'file-1' }))],
			['terminal mode', () => setSession(owner({ inputMode: 'terminal' }))],
			[
				'group chat on screen',
				() => useGroupChatStore.setState({ activeGroupChatId: 'chat-1' } as never),
			],
			['window hidden', () => (visibility = 'hidden')],
		];
		for (const [name, arrange] of cases) {
			setSession(owner());
			useGroupChatStore.setState({ activeGroupChatId: null } as never);
			visibility = 'visible';
			arrange();
			expect(resolveNativeFollowTarget(), name).toBeNull();
		}
	});
});

describe('rememberBounded (backs both the consumed and the failed-revision maps)', () => {
	it('keeps at most the bound, dropping the least recently used conversation', () => {
		const map = new Map<string, { revision: string; at: number }>();
		for (let i = 0; i < NATIVE_FOLLOW_MAX_REMEMBERED + 5; i++) {
			rememberBounded(map, `target-${i}`, { revision: `rev-${i}`, at: i });
		}
		expect(map.size).toBe(NATIVE_FOLLOW_MAX_REMEMBERED);
		// The five oldest went, the newest stayed.
		for (let i = 0; i < 5; i++) expect(map.has(`target-${i}`)).toBe(false);
		expect(map.get(`target-${NATIVE_FOLLOW_MAX_REMEMBERED + 4}`)).toEqual({
			revision: `rev-${NATIVE_FOLLOW_MAX_REMEMBERED + 4}`,
			at: NATIVE_FOLLOW_MAX_REMEMBERED + 4,
		});
	});

	it('refreshes recency when an existing conversation is written again', () => {
		const map = new Map<string, string>();
		rememberBounded(map, 'a', '1', 2);
		rememberBounded(map, 'b', '1', 2);
		// Touch `a` again: `b` is now the least recently used.
		rememberBounded(map, 'a', '2', 2);
		rememberBounded(map, 'c', '1', 2);
		expect([...map.keys()]).toEqual(['a', 'c']);
		expect(map.get('a')).toBe('2');
	});
});

describe('useNativeTranscriptFollow', () => {
	it('follows Claude through the canonical refresh while preserving reading state and other queues', async () => {
		const actual = await vi.importActual<
			typeof import('../../../../renderer/services/refreshNativeConversation')
		>('../../../../renderer/services/refreshNativeConversation');
		refresh.mockImplementation(actual.refreshNativeConversation);
		const read = vi.fn().mockResolvedValue({
			messages: [
				{
					uuid: 'm1',
					type: 'user',
					role: 'user',
					timestamp: new Date(1).toISOString(),
					content: 'cached question',
				},
				{
					uuid: 'm2',
					type: 'assistant',
					role: 'assistant',
					timestamp: new Date(2).toISOString(),
					content: 'external answer',
					model: 'claude-test',
				},
			],
			total: 2,
			hasMore: false,
		});
		window.maestro.agentSessions = { ...window.maestro.agentSessions, read };
		const queue = [
			{
				id: 'other-queued',
				tabId: 'tab-other',
				type: 'message',
				text: 'queued elsewhere',
			} as never,
		];
		setSession(
			owner({
				toolType: 'claude-code',
				executionQueue: queue,
				aiTabs: [codexTab({ scrollTop: 147, isAtBottom: false, hasUnread: true })],
			})
		);
		renderHook(() => useNativeTranscriptFollow());
		await settle();
		expect(getTranscriptRevision).toHaveBeenCalledWith('claude-code', '/Users/u/project', NATIVE, {
			ownerAgentId: 'owner',
		});
		expect(read).toHaveBeenCalledWith(
			'claude-code',
			'/Users/u/project',
			NATIVE,
			expect.objectContaining({ readOnly: true, ownerAgentId: 'owner' }),
			undefined
		);
		const session = useSessionStore.getState().sessions[0];
		expect(session.aiTabs[0]).toMatchObject({
			inputValue: 'half-typed draft',
			scrollTop: 147,
			isAtBottom: false,
			hasUnread: true,
			agentSessionId: NATIVE,
		});
		expect(session.aiTabs[0].logs.map((entry) => entry.text)).toEqual([
			'cached question',
			'external answer',
		]);
		expect(session.executionQueue).toEqual(queue);
		expect(session.activeTabId).toBe('tab-native');
		await nextTick();
		expect(read).toHaveBeenCalledTimes(1);
	});

	it('catches a cached tab up on first activation, then reads only when the revision moves', async () => {
		renderHook(() => useNativeTranscriptFollow());
		await settle();
		// First activation: no revision consumed yet, so the cached history is
		// caught up even though nothing changes later.
		expect(getTranscriptRevision).toHaveBeenCalledWith('codex', '/Users/u/project', NATIVE, {
			ownerAgentId: 'owner',
		});
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledWith({ sessionId: 'owner', tabId: 'tab-native' });

		// Same opaque revision: stat only, no transcript read.
		await nextTick();
		await nextTick();
		expect(getTranscriptRevision).toHaveBeenCalledTimes(3);
		expect(refresh).toHaveBeenCalledTimes(1);

		// The other app wrote: the revision moved, so one catch-up runs.
		getTranscriptRevision.mockResolvedValue('rev-2');
		await nextTick();
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it('reads the revision BEFORE the transcript, and consumes it only once the catch-up finished', async () => {
		const order: string[] = [];
		getTranscriptRevision.mockImplementation(async () => {
			order.push('revision');
			return 'rev-1';
		});
		const read = deferred<{ status: 'updated'; added: number }>();
		refresh.mockImplementation(() => {
			order.push('refresh');
			return read.promise;
		});
		renderHook(() => useNativeTranscriptFollow());
		await settle();
		expect(order).toEqual(['revision', 'refresh']);

		// While the read is out, ticks do not overlap it.
		await nextTick();
		await nextTick();
		expect(order).toEqual(['revision', 'refresh']);

		read.resolve({ status: 'updated', added: 2 });
		await settle();
		refresh.mockResolvedValue({ status: 'unchanged' });
		await nextTick();
		// rev-1 is now consumed: the next check is stat only.
		expect(order).toEqual(['revision', 'refresh', 'revision']);
	});

	it('keeps the retry after a failed read: backs off on the same revision, retries a new one at once', async () => {
		refresh.mockResolvedValue({ status: 'failed', error: 'EACCES' });
		renderHook(() => useNativeTranscriptFollow());
		await settle();
		expect(refresh).toHaveBeenCalledTimes(1);

		// Same revision within the back-off: no full re-read every two seconds.
		await nextTick();
		expect(refresh).toHaveBeenCalledTimes(1);

		// A new revision retries immediately (t = 2 polls; its failure is stamped then).
		getTranscriptRevision.mockResolvedValue('rev-2');
		await nextTick();
		expect(refresh).toHaveBeenCalledTimes(2);
		const failedAt = Date.now();

		// Polls land on whole multiples of the interval. Every poll that is still
		// inside the back-off after rev-2 failed re-reads nothing...
		const pollsInsideBackOff = Math.ceil(NATIVE_FOLLOW_FAILED_RETRY_MS / NATIVE_FOLLOW_POLL_MS) - 1;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(pollsInsideBackOff * NATIVE_FOLLOW_POLL_MS);
		});
		expect(Date.now() - failedAt).toBeLessThan(NATIVE_FOLLOW_FAILED_RETRY_MS);
		expect(refresh).toHaveBeenCalledTimes(2);

		// ...and the first poll at or past it retries the failed revision, once.
		await nextTick();
		expect(Date.now() - failedAt).toBeGreaterThanOrEqual(NATIVE_FOLLOW_FAILED_RETRY_MS);
		expect(refresh).toHaveBeenCalledTimes(3);
	});

	it('does not consume a revision whose catch-up was skipped', async () => {
		refresh.mockResolvedValueOnce({ status: 'skipped', reason: 'changed' });
		renderHook(() => useNativeTranscriptFollow());
		await settle();
		expect(refresh).toHaveBeenCalledTimes(1);
		await nextTick();
		// Same revision, read again because nothing was consumed.
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it('treats a null revision (unavailable, missing, remote) as no change', async () => {
		getTranscriptRevision.mockResolvedValue(null);
		renderHook(() => useNativeTranscriptFollow());
		await settle();
		await nextTick();
		expect(getTranscriptRevision).toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});

	it('does nothing on a build whose preload lacks the revision method', async () => {
		(window.maestro as any).agentSessions = {
			...(window.maestro as any).agentSessions,
			getTranscriptRevision: undefined,
		};
		renderHook(() => useNativeTranscriptFollow());
		await settle();
		await nextTick();
		expect(refresh).not.toHaveBeenCalled();
	});

	it.each(['codex', 'claude-code'] as const)(
		'never checks a busy or queued %s tab',
		async (toolType) => {
			setSession(owner({ toolType, aiTabs: [codexTab({ state: 'busy' })] }));
			renderHook(() => useNativeTranscriptFollow());
			await settle();
			await nextTick();
			expect(getTranscriptRevision).not.toHaveBeenCalled();

			act(() => {
				setSession(
					owner({
						toolType,
						executionQueue: [{ id: 'q', tabId: 'tab-native', type: 'message', text: 'x' } as never],
					})
				);
			});
			await nextTick();
			expect(getTranscriptRevision).not.toHaveBeenCalled();
			expect(refresh).not.toHaveBeenCalled();

			// The queue drained: checked promptly, without waiting for the next tick.
			act(() => {
				setSession(owner({ toolType }));
			});
			await settle();
			expect(refresh).toHaveBeenCalledTimes(1);
		}
	);

	it('drops a revision answered after the selection moved, and reads nothing for it', async () => {
		const answer = deferred<string>();
		getTranscriptRevision.mockReturnValueOnce(answer.promise);
		renderHook(() => useNativeTranscriptFollow());
		await settle();
		// The user switches tabs while main is still answering for the first one.
		act(() => {
			patchSession({ activeTabId: 'tab-other' });
		});
		answer.resolve('rev-1');
		await settle();
		expect(refresh).not.toHaveBeenCalledWith({ sessionId: 'owner', tabId: 'tab-native' });
	});

	it.each([
		['codex', 'CODEX_HOME'],
		['claude-code', 'CLAUDE_CONFIG_DIR'],
	] as const)(
		'does not consume a revision after the %s account changes',
		async (toolType, accountEnv) => {
			setSession(owner({ toolType }));
			const read = deferred<{ status: 'unchanged' }>();
			refresh.mockReturnValueOnce(read.promise);
			renderHook(() => useNativeTranscriptFollow());
			await settle();
			expect(refresh).toHaveBeenCalledTimes(1);

			// The account the runner reads changed while the read was out.
			act(() => {
				patchSession({ customEnvVars: { [accountEnv]: '/Users/u/other-account' } });
			});
			read.resolve({ status: 'unchanged' });
			await settle();

			// Back on the original identity, the same revision is still unconsumed.
			act(() => {
				patchSession({ customEnvVars: {} });
			});
			await nextTick();
			const forOriginal = refresh.mock.calls.filter(
				([target]) => (target as { tabId: string }).tabId === 'tab-native'
			);
			expect(forOriginal.length).toBeGreaterThanOrEqual(2);
		}
	);

	it('checks promptly on a tab switch and keeps each tab’s consumed revision', async () => {
		renderHook(() => useNativeTranscriptFollow());
		await settle();
		expect(refresh).toHaveBeenCalledTimes(1);

		act(() => {
			patchSession({ activeTabId: 'tab-other' });
		});
		await settle();
		expect(refresh).toHaveBeenLastCalledWith({ sessionId: 'owner', tabId: 'tab-other' });

		// Back to the first tab, revision unchanged: no second read of it.
		act(() => {
			patchSession({ activeTabId: 'tab-native' });
		});
		await settle();
		const forFirst = refresh.mock.calls.filter(
			([target]) => (target as { tabId: string }).tabId === 'tab-native'
		);
		expect(forFirst).toHaveLength(1);
	});

	it('stops while the window is hidden and checks as soon as it is visible again', async () => {
		visibility = 'hidden';
		renderHook(() => useNativeTranscriptFollow());
		await settle();
		await nextTick();
		expect(getTranscriptRevision).not.toHaveBeenCalled();

		visibility = 'visible';
		act(() => {
			document.dispatchEvent(new Event('visibilitychange'));
		});
		await settle();
		expect(getTranscriptRevision).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it('stops polling and ignores late answers after unmount', async () => {
		const answer = deferred<string>();
		getTranscriptRevision.mockReturnValueOnce(answer.promise);
		const { unmount } = renderHook(() => useNativeTranscriptFollow());
		await settle();
		unmount();
		answer.resolve('rev-1');
		await settle();
		await nextTick();
		await nextTick();
		expect(getTranscriptRevision).toHaveBeenCalledTimes(1);
		expect(refresh).not.toHaveBeenCalled();
	});

	it('never touches the draft, the queue, the focus or the tab itself', async () => {
		renderHook(() => useNativeTranscriptFollow());
		await settle();
		await nextTick();
		const state = useSessionStore.getState();
		expect(state.activeSessionId).toBe('owner');
		const session = state.sessions[0];
		expect(session.activeTabId).toBe('tab-native');
		expect(session.aiTabs.find((t) => t.id === 'tab-native')?.inputValue).toBe('half-typed draft');
		expect(session.executionQueue ?? []).toHaveLength(0);
	});
});
