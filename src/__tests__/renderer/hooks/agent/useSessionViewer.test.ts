import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
	useSessionViewer,
	type AgentSession,
} from '../../../../renderer/hooks/agent/useSessionViewer';

const read = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	window.maestro.agentSessions.read = read;
});

it('uses the owning agent account for the preview and older pages', async () => {
	const message = { type: 'user', role: 'user', content: 'selected', timestamp: '', uuid: 'm1' };
	read.mockResolvedValue({ messages: [message], total: 2, hasMore: true });
	const { result } = renderHook(() =>
		useSessionViewer({
			cwd: '/project',
			agentId: 'codex',
			ownerAgentId: 'selected-agent',
			sshRemoteId: 'remote',
		})
	);
	const session = { sessionId: 'native-id' } as AgentSession;
	await act(async () => result.current.handleViewSession(session));
	expect(read).toHaveBeenLastCalledWith(
		'codex',
		'/project',
		'native-id',
		{ offset: 0, limit: 20, ownerAgentId: 'selected-agent' },
		'remote'
	);
	read.mockResolvedValue({ messages: [{ ...message, uuid: 'older' }], total: 2, hasMore: false });
	await act(async () => result.current.handleLoadMore());
	expect(read).toHaveBeenLastCalledWith(
		'codex',
		'/project',
		'native-id',
		{ offset: 1, limit: 20, ownerAgentId: 'selected-agent' },
		'remote'
	);
	expect(result.current.messages.map((entry) => entry.uuid)).toEqual(['older', 'm1']);
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const msg = (uuid: string) => ({ type: 'user', role: 'user', content: uuid, timestamp: '', uuid });

it('closes the preview when the agent (and so the account) changes', async () => {
	read.mockResolvedValue({ messages: [msg('from-a')], total: 1, hasMore: false });
	const { result, rerender } = renderHook(
		(owner: string) => useSessionViewer({ cwd: '/project', agentId: 'codex', ownerAgentId: owner }),
		{
			initialProps: 'agent-a',
		}
	);
	await act(async () => result.current.handleViewSession({ sessionId: 'a-id' } as AgentSession));
	expect(result.current.viewingSession?.sessionId).toBe('a-id');

	rerender('agent-b');
	expect(result.current.viewingSession).toBeNull();
	expect(result.current.messages).toEqual([]);
	expect(result.current.messagesLoading).toBe(false);
});

it('drops a read that lands after the account changed', async () => {
	const late = deferred<{ messages: unknown[]; total: number; hasMore: boolean }>();
	read.mockReturnValueOnce(late.promise);
	const { result, rerender } = renderHook(
		(owner: string) => useSessionViewer({ cwd: '/project', agentId: 'codex', ownerAgentId: owner }),
		{
			initialProps: 'agent-a',
		}
	);
	act(() => result.current.handleViewSession({ sessionId: 'a-id' } as AgentSession));

	rerender('agent-b');
	read.mockResolvedValueOnce({ messages: [msg('from-b')], total: 1, hasMore: false });
	await act(async () => result.current.handleViewSession({ sessionId: 'b-id' } as AgentSession));
	expect(result.current.messages.map((m) => m.uuid)).toEqual(['from-b']);

	await act(async () => late.resolve({ messages: [msg('from-a')], total: 9, hasMore: true }));
	expect(result.current.viewingSession?.sessionId).toBe('b-id');
	expect(result.current.messages.map((m) => m.uuid)).toEqual(['from-b']);
	expect(result.current.totalMessages).toBe(1);
	expect(result.current.hasMoreMessages).toBe(false);
});

it('drops an older preview read once another session was opened', async () => {
	const slow = deferred<{ messages: unknown[]; total: number; hasMore: boolean }>();
	read.mockReturnValueOnce(slow.promise);
	const { result } = renderHook(() =>
		useSessionViewer({ cwd: '/project', agentId: 'codex', ownerAgentId: 'agent-a' })
	);
	act(() => result.current.handleViewSession({ sessionId: 'first' } as AgentSession));
	read.mockResolvedValueOnce({ messages: [msg('second')], total: 1, hasMore: false });
	await act(async () => result.current.handleViewSession({ sessionId: 'second' } as AgentSession));
	await act(async () => slow.resolve({ messages: [msg('first')], total: 1, hasMore: false }));
	expect(result.current.messages.map((m) => m.uuid)).toEqual(['second']);
	expect(result.current.messagesLoading).toBe(false);
});
