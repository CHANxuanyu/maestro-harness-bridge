import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileTeamTurn, createTeamRuntime } from '../../../main/team/runtime';
import { getSessionStorage } from '../../../main/agents';
import { createTeamStore } from '../../../main/team/team-store';
import type { SeatTurnRequest } from '../../../main/team/turn-dispatcher';
import type { TranscriptMessage } from '../../../shared/transcriptEntries';

vi.mock('electron', () => ({ app: { getPath: () => '/data', once: vi.fn() } }));
vi.mock('../../../main/agents', () => ({ getSessionStorage: vi.fn() }));
vi.mock('../../../main/agents/provider-account-dirs', () => ({
	getAgentAccountDirLayers: () => [],
}));
vi.mock('../../../main/team/team-store', () => ({ createTeamStore: vi.fn() }));
vi.mock('../../../main/team/scheduler', () => ({
	createTeamScheduler: () => ({ dispose: vi.fn() }),
}));
vi.mock('../../../main/team/turn-dispatcher', () => ({ createTurnDispatcher: vi.fn() }));
vi.mock('../../../main/team/workspaces', () => ({ createTeamWorkspaces: vi.fn() }));
vi.mock('../../../main/check-runner', () => ({ createCheckRunner: vi.fn() }));
vi.mock('../../../main/follow-ups', () => ({ createFollowUpStore: vi.fn() }));
vi.mock('../../../main/utils/remote-git', () => ({ execGitReadOnly: vi.fn() }));
vi.mock('../../../main/utils/logger', () => ({ logger: { error: vi.fn() } }));

describe('team production runtime', () => {
	const request: SeatTurnRequest = {
		teamId: 'team',
		dispatchId: 'dispatch',
		seat: 'dev',
		tool: 'codex',
		cwd: '/work/dev',
		prompt: 'work',
		permissionMode: 'full',
		turn: 'work',
		customEnv: { CODEX_HOME: '/accounts/dev' },
		nativeSessionId: 'native',
	};
	const message = (type: string, content: string, channel?: string): TranscriptMessage => ({
		type,
		content,
		channel,
		timestamp: '2026-11-17T00:00:00.000Z',
		uuid: `${type}:${content}`,
	});
	const storage = { listSessions: vi.fn(), readSessionMessages: vi.fn() };
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getSessionStorage).mockReturnValue(storage as never);
	});

	it('reconciles the exact marked turn across pages, ignoring tools and commentary', async () => {
		storage.readSessionMessages
			.mockResolvedValueOnce({
				messages: [
					message('user', 'Do work [team-dispatch:dispatch]'),
					message('assistant', 'Still working', 'commentary'),
				],
				hasMore: true,
			})
			.mockResolvedValueOnce({
				messages: [
					message('assistant', 'Visible result\n```team-report\n{}\n```', 'final'),
					message('user', 'Unrelated next turn'),
					message('assistant', 'Wrong reply', 'final'),
				],
				hasMore: false,
			});
		const result = await reconcileTeamTurn(request);
		expect(result?.text).toBe('Visible result\n```team-report\n{}\n```');
		expect(result?.nativeSessionId).toBe('native');
		expect(storage.readSessionMessages).toHaveBeenNthCalledWith(2, '/work/dev', 'native', {
			configDir: '/accounts/dev',
			readOnly: true,
			offset: 2,
			limit: 500,
		});
		expect(storage.listSessions).not.toHaveBeenCalled();
	});

	it('discovers a not-yet-bound session in its own account and refuses another dispatch', async () => {
		storage.listSessions.mockResolvedValue([{ sessionId: 'other' }, { sessionId: 'ours' }]);
		storage.readSessionMessages
			.mockResolvedValueOnce({
				messages: [message('user', '[team-dispatch:another]'), message('assistant', 'Unrelated')],
				hasMore: false,
			})
			.mockResolvedValueOnce({
				messages: [message('user', '[team-dispatch:dispatch]'), message('assistant', 'Recovered')],
				hasMore: false,
			});
		expect(
			(await reconcileTeamTurn({ ...request, nativeSessionId: undefined }))?.nativeSessionId
		).toBe('ours');
		expect(storage.listSessions).toHaveBeenCalledWith('/work/dev', undefined, '/accounts/dev');
	});

	it('leaves a marked turn with only a progress note unfinished', async () => {
		storage.readSessionMessages.mockResolvedValue({
			messages: [
				message('user', '[team-dispatch:dispatch]'),
				message('assistant', 'Checking', 'commentary'),
			],
			hasMore: false,
		});
		expect(await reconcileTeamTurn(request)).toBeNull();
	});

	it('broadcasts each durable append using the fixed changed payload', () => {
		const subscribe = vi.fn();
		vi.mocked(createTeamStore).mockReturnValue({ subscribe } as never);
		const safeSend = vi.fn();
		createTeamRuntime({ safeSend } as never);
		const event = { id: 'event', seq: 1, kind: 'paused', actor: 'owner' };
		subscribe.mock.calls[0][0]('team', event);
		expect(safeSend).toHaveBeenCalledWith('team:changed', { teamId: 'team', event });
	});
});
