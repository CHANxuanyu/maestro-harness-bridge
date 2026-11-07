import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../cli/services/agent-sessions', () => ({ invokeNativeHistory: vi.fn() }));
vi.mock('../../../cli/services/session-command', () => ({
	failCommand: vi.fn((message: string) => {
		throw new Error(message);
	}),
}));
import { invokeNativeHistory } from '../../../cli/services/agent-sessions';
import {
	codexTurnSteer,
	codexTurnStop,
	permissionRespond,
	codexPermissions,
} from '../../../cli/commands/codex-turn';

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

it('steers via the same process IPC and reports only the acknowledged turn', async () => {
	vi.mocked(invokeNativeHistory).mockResolvedValue({ success: true, turnId: 'turn-1' });
	await codexTurnSteer('owner-ai-tab', 'new instruction', { json: true });
	expect(invokeNativeHistory).toHaveBeenCalledExactlyOnceWith('process:steer', [
		'owner-ai-tab',
		'new instruction',
	]);
	expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual({
		success: true,
		turnId: 'turn-1',
	});
});

it('does not retry or queue a rejected steer', async () => {
	vi.mocked(invokeNativeHistory).mockResolvedValue({ success: false, error: 'Turn ended' });
	await expect(codexTurnSteer('owner-ai-tab', 'text', { json: true })).rejects.toThrow(
		'Turn ended'
	);
	expect(invokeNativeHistory).toHaveBeenCalledTimes(1);
});

it('stops via the gated prototype IPC', async () => {
	vi.mocked(invokeNativeHistory).mockResolvedValue(true);
	await codexTurnStop('owner-ai-tab', { json: true });
	expect(invokeNativeHistory).toHaveBeenCalledExactlyOnceWith('process:codex-stop', [
		'owner-ai-tab',
	]);
});

it.each(['allow', 'deny'])('answers %s via the existing permission handler', async (behavior) => {
	vi.mocked(invokeNativeHistory).mockResolvedValue(true);
	await permissionRespond('request-1', behavior, { json: true });
	expect(invokeNativeHistory).toHaveBeenCalledExactlyOnceWith('permission:respond', [
		'request-1',
		behavior === 'allow' ? { behavior } : { behavior, message: 'Denied by user.' },
	]);
});

it('reports an expired approval as failure', async () => {
	vi.mocked(invokeNativeHistory).mockResolvedValue(false);
	await expect(permissionRespond('request-1', 'allow', { json: true })).rejects.toThrow(
		'no longer pending'
	);
});

it('lists discoverable approval IDs through the same main-process registry', async () => {
	vi.mocked(invokeNativeHistory).mockResolvedValue([{ requestId: 'approval-1' }]);
	await codexPermissions({ json: true });
	expect(invokeNativeHistory).toHaveBeenCalledExactlyOnceWith('process:codex-permissions', []);
	expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual([
		{ requestId: 'approval-1' },
	]);
});
