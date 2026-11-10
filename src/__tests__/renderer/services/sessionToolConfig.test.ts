import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { saveSessionToolConfig } from '../../../renderer/services/sessionToolConfig';

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(true);
	vi.mocked(window.maestro.process.getActiveProcesses).mockResolvedValue([]);
});

describe('saveSessionToolConfig', () => {
	it('updates only allowed fields and retains all current conversation state', async () => {
		const owner = createMockSession({
			id: 'owner',
			enableMaestroP: true,
			maestroPMode: 'interactive',
			customPath: '/fixture/old',
			customArgs: '--old',
			customEnvVarsDisabled: { PARKED: 'kept' },
			customContextWindow: 200000,
			contextWindowSource: 'user-edited',
			aiTabs: [
				createMockAITab({ id: 'a', inputValue: 'draft' }),
				createMockAITab({ id: 'b', state: 'busy' }),
			],
		});
		const sibling = createMockSession({ ...owner, id: 'sibling' });
		useSessionStore.setState({ sessions: [owner, sibling] });
		await saveSessionToolConfig(owner.id, {
			customPath: null,
			customArgs: '--new',
			customEnvVars: { CLAUDE_CONFIG_DIR: '~/remote-account' },
			enableMaestroP: false,
			maestroPMode: 'dynamic',
			customContextWindow: null,
			aiTabs: [],
			toolType: 'codex',
		});
		const updated = useSessionStore.getState().sessions[0];
		expect(updated).toMatchObject({
			customArgs: '--new',
			customEnvVars: { CLAUDE_CONFIG_DIR: '~/remote-account' },
			enableMaestroP: false,
			maestroPMode: 'dynamic',
			customEnvVarsDisabled: { PARKED: 'kept' },
			toolType: owner.toolType,
		});
		expect(updated.customPath).toBeUndefined();
		expect(updated.customContextWindow).toBeUndefined();
		expect(updated.contextWindowSource).toBeUndefined();
		expect(updated.aiTabs).toEqual(owner.aiTabs);
		expect(window.maestro.sessions.setMany).toHaveBeenCalledWith([updated], []);
		expect(useSessionStore.getState().sessions[1]).toBe(sibling);
		expect(sibling.enableMaestroP).toBe(true);
		expect(sibling.maestroPMode).toBe('interactive');
		expect(window.maestro.agents.setConfig).not.toHaveBeenCalled();
	});

	it('preserves remote path bytes and history flags when changing the host', async () => {
		const owner = createMockSession({
			id: 'owner',
			sessionSshRemoteConfig: {
				enabled: true,
				remoteId: 'a',
				workingDirOverride: '~/project',
				syncHistory: true,
				shareHistoryToProjectDir: true,
			},
		});
		useSessionStore.setState({ sessions: [owner] });
		await saveSessionToolConfig(owner.id, {}, { remoteId: 'b' });
		expect(useSessionStore.getState().sessions[0].sessionSshRemoteConfig).toEqual({
			...owner.sessionSshRemoteConfig,
			remoteId: 'b',
		});
		expect(window.maestro.process.getActiveProcesses).toHaveBeenCalled();
	});

	it('refuses SSH changes even if the persisted owner is idle while a tab process runs', async () => {
		const owner = createMockSession({ id: 'owner', state: 'idle', aiPid: 0 });
		useSessionStore.setState({ sessions: [owner] });
		vi.mocked(window.maestro.process.getActiveProcesses).mockResolvedValue([
			{ sessionId: 'owner-ai-b', isTerminal: false },
		] as never);
		await expect(
			saveSessionToolConfig(
				owner.id,
				{ customPath: '/fixture/new' },
				{ enabled: true, remoteId: 'b' }
			)
		).rejects.toThrow('Stop all conversations');
		expect(window.maestro.sessions.setMany).not.toHaveBeenCalled();
		expect(useSessionStore.getState().sessions[0]).toBe(owner);
	});

	it('leaves the in-memory configuration unchanged on a rejected disk write', async () => {
		const owner = createMockSession({ id: 'owner', customPath: '/fixture/old' });
		useSessionStore.setState({ sessions: [owner] });
		vi.mocked(window.maestro.sessions.setMany).mockRejectedValueOnce(new Error('disk failure'));
		await expect(saveSessionToolConfig(owner.id, { customPath: '/fixture/new' })).rejects.toThrow(
			'disk failure'
		);
		expect(useSessionStore.getState().sessions[0]).toBe(owner);
	});

	it('serializes tool edits and retains conversation updates made while saving', async () => {
		const owner = createMockSession({ id: 'owner', customPath: '/fixture/old' });
		useSessionStore.setState({ sessions: [owner] });
		let release!: (value: boolean) => void;
		vi.mocked(window.maestro.sessions.setMany).mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					release = resolve;
				})
		);
		const first = saveSessionToolConfig(owner.id, { customPath: '/fixture/new' });
		await vi.waitFor(() => expect(window.maestro.sessions.setMany).toHaveBeenCalledTimes(1));
		const second = saveSessionToolConfig(owner.id, { customArgs: '--second' });
		useSessionStore.getState().setSessions((sessions) =>
			sessions.map((session) => ({
				...session,
				aiTabs: [createMockAITab({ id: 'live', inputValue: 'keep me' })],
			}))
		);
		release(true);
		await Promise.all([first, second]);
		const updated = useSessionStore.getState().sessions[0];
		expect(updated).toMatchObject({
			customPath: '/fixture/new',
			customArgs: '--second',
			aiTabs: [{ id: 'live', inputValue: 'keep me' }],
		});
		expect(window.maestro.sessions.setMany).toHaveBeenLastCalledWith([updated], []);
	});
});
