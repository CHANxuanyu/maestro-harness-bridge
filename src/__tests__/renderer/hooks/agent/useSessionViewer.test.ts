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
