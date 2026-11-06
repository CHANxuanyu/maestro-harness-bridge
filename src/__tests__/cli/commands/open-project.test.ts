import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { openProjectCommand } from '../../../cli/commands/open-project';
import { nativeHistory } from '../../../cli/commands/native-history';
import { invokeNativeHistory } from '../../../cli/services/agent-sessions';
import { failCommand } from '../../../cli/services/session-command';
import { readSessions, resolveAgentId } from '../../../cli/services/storage';

vi.mock('../../../cli/services/agent-sessions', () => ({ invokeNativeHistory: vi.fn() }));
vi.mock('../../../cli/services/session-command', () => ({ failCommand: vi.fn() }));
vi.mock('../../../cli/services/storage', () => ({
	readSessions: vi.fn(),
	resolveAgentId: vi.fn(),
	getSessionById: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());

it('lists projects through the desktop adapter without reading local account or session stores', async () => {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.mocked(invokeNativeHistory).mockResolvedValue([
		{ path: '/project', tools: ['codex'], lastActivity: 1, sessionCount: 2 },
	]);
	await nativeHistory('projects', undefined, undefined, { json: true });
	expect(invokeNativeHistory).toHaveBeenCalledWith('agentSessions:projects', []);
	expect(readSessions).not.toHaveBeenCalled();
	expect(resolveAgentId).not.toHaveBeenCalled();
	expect(JSON.parse(log.mock.calls[0][0])).toEqual({
		success: true,
		result: [{ path: '/project', tools: ['codex'], lastActivity: 1, sessionCount: 2 }],
	});
});

it('opens a resolved directory using the same UI command', async () => {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.mocked(invokeNativeHistory).mockResolvedValue({ success: true, sessionId: 'opened' });
	await openProjectCommand('relative-project', { json: true });
	expect(invokeNativeHistory).toHaveBeenCalledWith(
		'agentSessions:openProject',
		[path.resolve('relative-project')],
		45000
	);
	expect(JSON.parse(log.mock.calls[0][0])).toEqual({ success: true, sessionId: 'opened' });
});

it.each(['Install a tool', 'Open Project requires the new shell'])(
	'reports the shared failure: %s',
	async (error) => {
		vi.mocked(invokeNativeHistory).mockResolvedValue({
			success: false,
			code: 'unavailable',
			error,
		});
		await openProjectCommand('/project', { json: true });
		expect(failCommand).toHaveBeenCalledWith(error, true);
	}
);
