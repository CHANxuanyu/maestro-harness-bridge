import { expect, it, vi } from 'vitest';
const { sendSimpleCommand } = vi.hoisted(() => ({ sendSimpleCommand: vi.fn() }));
vi.mock('../../../cli/services/maestro-client', () => ({
	withMaestroClient: (fn: (client: unknown) => unknown) => fn({ sendCommand: sendSimpleCommand }),
}));
import { invokeNativeHistory } from '../../../cli/services/agent-sessions';
it('uses the desktop native reader and propagates compressed conversation errors', async () => {
	vi.mocked(sendSimpleCommand).mockResolvedValueOnce({
		ok: true,
		result: [{ nativeSessionId: 'compressed' }],
	});
	expect(await invokeNativeHistory('agentSessions:listProjectHistory', [[]])).toEqual([
		{ nativeSessionId: 'compressed' },
	]);
	expect(sendSimpleCommand).toHaveBeenCalledWith(
		{ type: 'bridge.invoke', channel: 'agentSessions:listProjectHistory', args: [[]] },
		'bridge.response'
	);
	vi.mocked(sendSimpleCommand).mockResolvedValueOnce({
		ok: false,
		error: 'Cannot transfer compressed Codex conversation',
	});
	await expect(invokeNativeHistory('agentSessions:read', [])).rejects.toThrow(
		'Cannot transfer compressed Codex conversation'
	);
});
