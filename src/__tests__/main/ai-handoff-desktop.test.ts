import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createDesktopAiHandoff } from '../../main/ai-handoff-desktop';
import { requestFromRenderer } from '../../main/web-server/callbacks/remoteRequest';
import { checkCustomPath } from '../../main/agents/path-prober';

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
	function api(runners = [source, target], targetOwner: BrowserWindow | null = targetWindow) {
		return createDesktopAiHandoff({
			getWindowForSession: (id) => (id === 'source' ? sourceWindow : targetOwner),
			sessionsStore: { get: () => runners } as never,
			agentConfigsStore: { get: () => ({}) } as never,
			settingsStore: { get: () => ({}) } as never,
			env: {},
		});
	}
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(checkCustomPath).mockResolvedValue({ exists: true, path: '/configured-cli' });
		vi.mocked(requestFromRenderer).mockImplementation(async (_win, channel) => {
			if (channel === 'context:readHandoffSource')
				return {
					sourceAgentId: 'source',
					sourceTabId: 'source-tab',
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
