import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../cli/services/agent-sessions', () => ({ invokeNativeHistory: vi.fn() }));
vi.mock('../../../cli/services/storage', () => ({
	getSessionById: vi.fn(),
	readSessions: vi.fn(),
	resolveAgentId: vi.fn(),
}));
vi.mock('../../../cli/services/session-command', () => ({
	resolveTabEntry: vi.fn(),
	listDesktopTabs: vi.fn(),
	failCommand: vi.fn((message: string) => {
		throw new Error(message);
	}),
}));
import { nativeHistory } from '../../../cli/commands/native-history';
import { invokeNativeHistory } from '../../../cli/services/agent-sessions';
import { getSessionById } from '../../../cli/services/storage';
import { resolveTabEntry, listDesktopTabs } from '../../../cli/services/session-command';

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.mocked(resolveTabEntry).mockResolvedValue({
		agentId: 'owner',
		agentSessionId: 'native-id',
		tabId: 'tab',
	} as never);
	vi.mocked(getSessionById).mockReturnValue({
		id: 'owner',
		toolType: 'codex',
		projectRoot: '/project',
		cwd: '/project',
	} as never);
	vi.mocked(invokeNativeHistory).mockResolvedValue({
		status: 'found',
		text: 'TAIL',
		totalBytes: 4,
		omittedBytes: 0,
	});
});

it('reads a tool result through the same desktop IPC used by the card', async () => {
	await nativeHistory('tool-output', 'tab', 'call-1', { json: true });
	expect(invokeNativeHistory).toHaveBeenCalledWith(
		'agentSessions:toolOutput',
		[
			{
				provider: 'codex',
				projectPath: '/project',
				nativeSessionId: 'native-id',
				ownerAgentId: 'owner',
				sshRemoteId: undefined,
			},
			'call-1',
		],
		45000
	);
	expect(console.log).toHaveBeenCalledWith(
		JSON.stringify({
			success: true,
			result: { status: 'found', text: 'TAIL', totalBytes: 4, omittedBytes: 0 },
		})
	);
});

it('also resolves an exact native conversation ID without guessing an account', async () => {
	vi.mocked(resolveTabEntry).mockRejectedValue(new Error('Tab not found'));
	vi.mocked(listDesktopTabs).mockResolvedValue([
		{ agentId: 'owner', agentSessionId: 'native-id', tabId: 'tab' },
	] as never);
	await nativeHistory('tool-output', 'native-id', 'call-1', { json: true });
	expect(invokeNativeHistory).toHaveBeenCalled();
});

it('reports a missing result as a failed command', async () => {
	vi.mocked(invokeNativeHistory).mockResolvedValue({ status: 'not-found' });
	await expect(nativeHistory('tool-output', 'tab', 'call-1', { json: true })).rejects.toThrow(
		'not-found'
	);
});

it('copies only the bounded returned text through the desktop clipboard handler', async () => {
	await nativeHistory('tool-output', 'tab', 'call-1', { json: true, copy: true });
	expect(invokeNativeHistory).toHaveBeenLastCalledWith('clipboard:writeText', ['TAIL']);
});
