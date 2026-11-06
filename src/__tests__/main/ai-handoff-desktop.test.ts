import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createDesktopAiHandoff } from '../../main/ai-handoff-desktop';
import { requestFromRenderer } from '../../main/web-server/callbacks/remoteRequest';
import { checkBinaryExists, checkCustomPath } from '../../main/agents/path-prober';

vi.mock('../../main/agents/deepseek-preset', () => ({ prepareDeepSeekPreset: vi.fn() }));
vi.mock('../../main/stores', () => ({ getSshRemoteById: vi.fn() }));
vi.mock('../../main/utils/ssh-command-builder', () => ({ buildSshCommand: vi.fn() }));
vi.mock('../../main/utils/execFile', () => ({ execFileNoThrow: vi.fn() }));
import { getSshRemoteById } from '../../main/stores';
import { buildSshCommand } from '../../main/utils/ssh-command-builder';
import { execFileNoThrow } from '../../main/utils/execFile';
import { prepareDeepSeekPreset } from '../../main/agents/deepseek-preset';
import { DEEPSEEK_PRESET } from '../../shared/agentPresets';

vi.mock('../../main/web-server/callbacks/remoteRequest', () => ({ requestFromRenderer: vi.fn() }));
vi.mock('../../main/agents/path-prober', () => ({
	checkCustomPath: vi.fn(),
	checkBinaryExists: vi.fn(),
}));

const draft = {
	text: 'prepared',
	estimatedTokens: 2,
	budgetTokens: 8000,
	omittedEntries: 0,
	omittedCharacters: 0,
};
function windowAt(id: number) {
	return {
		id,
		isDestroyed: () => false,
		webContents: { isDestroyed: () => false, send: vi.fn() },
	} as unknown as BrowserWindow;
}

describe('handoff desktop ownership routing', () => {
	const sourceWindow = windowAt(2);
	const targetWindow = windowAt(3);
	const source = {
		id: 'source',
		name: 'Source',
		toolType: 'claude-code',
		cwd: '/project',
		projectRoot: '/project',
		customPath: '/claude',
		customEnvVars: {},
	};
	const target = {
		id: 'target',
		name: 'Target',
		toolType: 'codex',
		cwd: '/project',
		projectRoot: '/project',
		customPath: '/codex',
		customEnvVars: {},
	};
	function api(
		runners = [source, target],
		targetOwner: BrowserWindow | null = targetWindow,
		newShell = true
	) {
		return createDesktopAiHandoff({
			getWindowForSession: (id) => (id === 'source' ? sourceWindow : targetOwner),
			sessionsStore: { get: () => runners } as never,
			agentConfigsStore: { get: () => ({}) } as never,
			settingsStore: { get: (key: string) => (key === 'newShell' ? newShell : {}) } as never,
			env: {},
		});
	}
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(checkBinaryExists).mockResolvedValue({ exists: true, path: '/global-cli' });
		vi.mocked(checkCustomPath).mockResolvedValue({ exists: true, path: '/configured-cli' });
		vi.mocked(requestFromRenderer).mockImplementation(async (_win, channel) => {
			if (channel === 'context:readHandoffSource')
				return {
					sourceAgentId: 'source',
					sourceTabId: 'source-tab',
					sourcePermission: { permissionMode: 'readonly', readOnlyMode: true },
					cwd: '/project',
					projectPath: '/project',
					draft,
				} as never;
			return {
				success: true,
				agentId: 'target',
				tabId: 'new-tab',
				createdAgent: false,
				state: 'draft',
				draft,
			} as never;
		});
	});

	it.each([false, undefined])(
		'rejects provider tab creation before preparing DeepSeek when newShell is %s',
		async (newShell) => {
			vi.mocked(prepareDeepSeekPreset).mockResolvedValue({
				customEnvVars: { CLAUDE_CONFIG_DIR: '/synthetic/deepseek' },
			} as never);
			const settingsGet = vi.fn((key: string, fallback: unknown) =>
				key === 'newShell' ? (newShell ?? fallback) : fallback
			);
			const service = createDesktopAiHandoff({
				getWindowForSession: () => sourceWindow,
				sessionsStore: { get: () => [source] } as never,
				agentConfigsStore: {
					get: () => ({
						'claude-code': {
							customEnvVars: {
								ANTHROPIC_BASE_URL: DEEPSEEK_PRESET.baseUrl,
								ANTHROPIC_AUTH_TOKEN: 'synthetic-secret',
							},
						},
					}),
				} as never,
				settingsStore: { get: settingsGet } as never,
				env: {},
			});
			for (const replaceTabId of [undefined, 'empty']) {
				expect(
					await service.command({
						action: 'new-conversation',
						sourceAgentId: 'source',
						targetProvider: 'deepseek',
						replaceTabId,
					})
				).toEqual({
					success: false,
					code: 'unavailable',
					error: 'Only an empty conversation in the new shell can change tools',
				});
			}
			expect(settingsGet).toHaveBeenCalledWith('newShell', false);
			expect(checkBinaryExists).not.toHaveBeenCalled();
			expect(checkCustomPath).not.toHaveBeenCalled();
			expect(prepareDeepSeekPreset).not.toHaveBeenCalled();
			expect(requestFromRenderer).not.toHaveBeenCalled();
		}
	);

	it.each(['handoff', 'review'] as const)(
		'still prepares ordinary %s with the classic shell',
		async (mode) => {
			const result = await api([source, target], targetWindow, false).prepare({
				sourceAgentId: 'source',
				sourceTabId: 'source-tab',
				targetProvider: 'codex',
				mode,
			});
			expect(result).toMatchObject({ success: true, mode });
			expect(requestFromRenderer).toHaveBeenCalledWith(
				targetWindow,
				'context:openHandoffTarget',
				expect.objectContaining({ args: [expect.objectContaining({ mode, provider: 'codex' })] })
			);
		}
	);

	it('reads from the source owner and inserts into the target owner, not the primary window', async () => {
		const result = await api().prepare({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			targetProvider: 'codex',
		});
		expect(result.success).toBe(true);
		expect(
			vi.mocked(requestFromRenderer).mock.calls.map(([win, channel]) => [win, channel])
		).toEqual([
			[sourceWindow, 'context:readHandoffSource'],
			[targetWindow, 'context:openHandoffTarget'],
		]);
		expect(checkCustomPath).toHaveBeenCalledWith('/codex');
	});

	it('gets a cross-window replacement snapshot from its owner before opening the target', async () => {
		vi.mocked(requestFromRenderer).mockResolvedValueOnce({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			cwd: '/project',
			projectPath: '/project',
			draft: { ...draft, text: 'latest draft' },
			emptyConversation: { stagedImages: ['live-image'], commandMode: 'off' },
		});
		const result = await api().command({
			action: 'new-conversation',
			sourceAgentId: 'source',
			targetProvider: 'codex',
			replaceTabId: 'source-tab',
		});
		expect(result.success).toBe(true);
		expect(
			vi.mocked(requestFromRenderer).mock.calls.map(([win, channel]) => [win, channel])
		).toEqual([
			[sourceWindow, 'context:readHandoffSource'],
			[targetWindow, 'context:openHandoffTarget'],
		]);
		expect(vi.mocked(requestFromRenderer).mock.calls[1][2].args?.[0]).toMatchObject({
			draft: { text: 'latest draft' },
			newConversation: { source: { stagedImages: ['live-image'] } },
		});
	});

	it('reads project permission metadata from the source owner for CLI provider creation', async () => {
		const result = await api().command({
			action: 'new-conversation',
			sourceAgentId: 'source',
			targetProvider: 'codex',
		});
		expect(result.success).toBe(true);
		expect(vi.mocked(requestFromRenderer).mock.calls[0][0]).toBe(sourceWindow);
		expect(vi.mocked(requestFromRenderer).mock.calls[0][2].args?.[0]).toMatchObject({
			permissionOnly: true,
			sourceTabId: '',
		});
		expect(vi.mocked(requestFromRenderer).mock.calls[1][2].args?.[0]).toMatchObject({
			sourcePermission: { permissionMode: 'readonly', readOnlyMode: true },
		});
	});

	it.each(['handoff', 'review'] as const)(
		'carries the source permission through %s routing',
		async (mode) => {
			await api().prepare({
				sourceAgentId: 'source',
				sourceTabId: 'source-tab',
				targetProvider: 'codex',
				mode,
			});
			expect(vi.mocked(requestFromRenderer).mock.calls[1][2].args?.[0]).toMatchObject({
				sourcePermission: { permissionMode: 'readonly', readOnlyMode: true },
			});
		}
	);

	it('creates a missing project runner in the source window', async () => {
		const otherProject = { ...target, projectRoot: '/other', cwd: '/other' };
		await api([source, otherProject]).prepare({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			targetProvider: 'codex',
		});
		expect(vi.mocked(requestFromRenderer).mock.calls[1][0]).toBe(sourceWindow);
		expect(vi.mocked(requestFromRenderer).mock.calls[1][2].args?.[0]).toMatchObject({
			projectPath: '/project',
			config: { toolType: 'codex' },
		});
	});

	it('classifies an inherited DeepSeek gateway from the same shellEnvVars setting as spawn', async () => {
		const service = createDesktopAiHandoff({
			getWindowForSession: () => sourceWindow,
			sessionsStore: { get: () => [source, target] } as never,
			agentConfigsStore: { get: () => ({}) } as never,
			settingsStore: {
				get: (key: string) =>
					key === 'shellEnvVars'
						? {
								ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
								ANTHROPIC_AUTH_TOKEN: 'synthetic-key',
								CLAUDE_CONFIG_DIR: '/deepseek-account',
							}
						: {},
			} as never,
			env: {},
		});
		expect(await service.targets('target')).toEqual({
			success: true,
			targets: [{ provider: 'deepseek', runnerId: 'source' }],
		});
	});

	it('checks a remote target on its own host through the SSH builder', async () => {
		const ssh = { enabled: true, remoteId: 'remote', workingDirOverride: '/remote/tree' };
		vi.mocked(getSshRemoteById).mockReturnValue({ id: 'remote', enabled: true } as never);
		vi.mocked(buildSshCommand).mockResolvedValue({
			command: 'ssh',
			args: ['remote', 'probe'],
		} as never);
		vi.mocked(execFileNoThrow).mockResolvedValue({ exitCode: 0, stdout: '/bin/codex', stderr: '' });
		vi.mocked(requestFromRenderer).mockResolvedValueOnce({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			projectPath: '/project',
			cwd: '/remote/tree',
			sessionSshRemoteConfig: ssh,
			draft,
		} as never);
		const result = await api([{ ...source, sessionSshRemoteConfig: ssh } as typeof source]).prepare(
			{ sourceAgentId: 'source', sourceTabId: 'source-tab', targetProvider: 'codex' }
		);
		expect(result.success).toBe(true);
		expect(buildSshCommand).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'remote' }),
			expect.objectContaining({ command: 'command', args: ['-v', 'codex'], cwd: '/remote/tree' })
		);
		expect(execFileNoThrow).toHaveBeenCalledWith('ssh', ['remote', 'probe'], undefined, {
			timeout: 10000,
		});
		expect(checkBinaryExists).not.toHaveBeenCalled();
	});

	it('uses the existing DeepSeek preset only when creating from global gateway settings', async () => {
		const env = {
			ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
			ANTHROPIC_AUTH_TOKEN: 'synthetic-key',
			CLAUDE_CONFIG_DIR: '/global-account',
		};
		vi.mocked(prepareDeepSeekPreset).mockResolvedValue({
			toolType: 'claude-code',
			customModel: 'deepseek-flash[1m]',
			customEnvVars: { ...env, CLAUDE_CONFIG_DIR: '/isolated-preset' },
		});
		const service = createDesktopAiHandoff({
			getWindowForSession: () => sourceWindow,
			sessionsStore: { get: () => [target] } as never,
			agentConfigsStore: { get: () => ({ 'claude-code': { customEnvVars: env } }) } as never,
			settingsStore: { get: () => ({}) } as never,
			env: {},
		});
		await service.targets('target');
		expect(prepareDeepSeekPreset).not.toHaveBeenCalled();
		await service.prepare({
			sourceAgentId: 'target',
			sourceTabId: 'source-tab',
			targetProvider: 'deepseek',
		});
		expect(prepareDeepSeekPreset).toHaveBeenCalledWith({
			apiKey: 'synthetic-key',
			model: undefined,
		});
		expect(vi.mocked(requestFromRenderer).mock.calls.at(-1)?.[2].args?.[0]).toMatchObject({
			config: { customEnvVars: { CLAUDE_CONFIG_DIR: '/isolated-preset' } },
		});
	});

	it('reports an unavailable owner instead of writing to a different window', async () => {
		const result = await api([source, target], null).prepare({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			targetProvider: 'codex',
		});
		expect(result.success).toBe(false);
		expect(requestFromRenderer).toHaveBeenCalledTimes(1);
	});
});
