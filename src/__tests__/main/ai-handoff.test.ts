import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiHandoffService } from '../../main/ai-handoff';
import type { StoredSession } from '../../main/stores/types';
import type { HandoffProvider, HandoffRunnerConfig } from '../../shared/aiHandoff';
import { DEEPSEEK_PRESET } from '../../shared/agentPresets';

const deepseekEnv = {
	ANTHROPIC_BASE_URL: DEEPSEEK_PRESET.baseUrl,
	ANTHROPIC_AUTH_TOKEN: 'synthetic-secret',
	CLAUDE_CONFIG_DIR: '/accounts/deepseek',
};
const draft = {
	text: 'handoff',
	estimatedTokens: 2,
	budgetTokens: 8000,
	omittedEntries: 0,
	omittedCharacters: 0,
};
const providers: HandoffProvider[] = ['claude-code', 'codex', 'deepseek'];
const pairs = providers.flatMap((from) =>
	providers.filter((to) => to !== from).map((to) => [from, to] as const)
);

function runner(provider: HandoffProvider, changes: Partial<StoredSession> = {}): StoredSession {
	return {
		id: provider,
		name: provider,
		toolType: provider === 'deepseek' ? 'claude-code' : provider,
		cwd: '/project',
		projectRoot: '/project',
		customPath: `/bin/${provider}`,
		customEnvVars: provider === 'deepseek' ? deepseekEnv : {},
		...changes,
	};
}

describe('local AI handoff routing', () => {
	let runners: StoredSession[];
	let configs: Record<string, HandoffRunnerConfig>;
	let globalEnv: Record<string, string>;
	let serial: number;
	const available = vi.fn();
	const readSource = vi.fn();
	const openTarget = vi.fn();
	const service = () =>
		createAiHandoffService({
			getSessions: () => runners,
			getAgentConfig: (id) => configs[id] ?? {},
			getGlobalEnv: () => globalEnv,
			env: {},
			isAvailable: available,
			readSource,
			openTarget,
		});
	beforeEach(() => {
		vi.clearAllMocks();
		runners = providers.map((provider) => runner(provider));
		configs = {};
		globalEnv = {};
		serial = 0;
		available.mockImplementation(async (config) => config.customPath !== 'missing');
		readSource.mockImplementation(async (request) => ({
			sourceAgentId: request.sourceAgentId,
			sourceTabId: request.sourceTabId,
			projectPath: runners.find((item) => item.id === request.sourceAgentId)!.projectRoot,
			draft,
		}));
		openTarget.mockImplementation(async (request) => {
			const createdAgent = !request.runnerId;
			const agentId = request.runnerId ?? `created-${++serial}`;
			if (createdAgent)
				runners.push({
					...request.config,
					id: agentId,
					name: request.provider,
					cwd: request.projectPath,
					projectRoot: request.projectPath,
				});
			return {
				success: true,
				agentId,
				tabId: `tab-${serial++}`,
				createdAgent,
				state: request.send ? 'queued' : 'draft',
				draft,
			};
		});
	});

	it.each(pairs)('reuses the same-project %s -> %s runner without sending', async (from, to) => {
		const before = JSON.stringify(runners);
		const result = await service().prepare({
			sourceAgentId: from,
			sourceTabId: 'source-tab',
			targetProvider: to,
		});
		expect(result).toMatchObject({
			success: true,
			agentId: to,
			createdAgent: false,
			state: 'draft',
		});
		expect(openTarget).toHaveBeenCalledWith(expect.objectContaining({ runnerId: to, send: false }));
		expect(JSON.stringify(runners)).toBe(before);
		expect(JSON.stringify(result)).not.toContain('synthetic-secret');
	});

	it('creates at most one runner for concurrent handoffs when this project has none', async () => {
		runners = [
			runner('claude-code'),
			runner('codex', { projectRoot: '/other', cwd: '/other', customModel: 'target-model' }),
		];
		const api = service();
		const request = {
			sourceAgentId: 'claude-code',
			sourceTabId: 'source-tab',
			targetProvider: 'codex' as const,
		};
		const [first, second] = await Promise.all([api.prepare(request), api.prepare(request)]);
		expect(first).toMatchObject({ success: true, createdAgent: true });
		expect(second).toMatchObject({ success: true, createdAgent: false });
		expect(first.agentId).toBe(second.agentId);
		expect(
			runners.filter((item) => item.projectRoot === '/project' && item.toolType === 'codex')
		).toHaveLength(1);
		expect(openTarget.mock.calls[0][0].config.customModel).toBe('target-model');
	});

	it('copies the target account and model, never the source configuration', async () => {
		runners = [
			runner('codex', {
				customEnvVars: { CODEX_HOME: '/source-account' },
				customModel: 'source-model',
			}),
			runner('deepseek', {
				projectRoot: '/other',
				cwd: '/other',
				customModel: 'deepseek-flash[1m]',
				enableMaestroP: false,
			}),
		];
		await service().prepare({
			sourceAgentId: 'codex',
			sourceTabId: 't',
			targetProvider: 'deepseek',
			send: true,
		});
		const request = openTarget.mock.calls[0][0];
		expect(request).toMatchObject({
			send: true,
			config: {
				toolType: 'claude-code',
				customModel: 'deepseek-flash[1m]',
				customEnvVars: deepseekEnv,
				enableMaestroP: false,
			},
		});
		expect(JSON.stringify(request.config)).not.toContain('/source-account');
	});

	it('offers only the other available local providers, never SSH or an unconfigured DeepSeek', async () => {
		runners = [
			runner('claude-code'),
			runner('codex', { customPath: 'missing' }),
			runner('deepseek', { sessionSshRemoteConfig: { enabled: true, remoteId: 'remote' } }),
		];
		const result = await service().targets('claude-code');
		expect(result).toEqual({ success: true, targets: [] });
		expect(readSource).not.toHaveBeenCalled();
		expect(openTarget).not.toHaveBeenCalled();
	});

	it('identifies the actual inherited gateway without layering the provider record over a session override', async () => {
		configs['claude-code'] = { customEnvVars: deepseekEnv };
		runners = [
			runner('claude-code', { customEnvVars: undefined }),
			runner('codex'),
			runner('deepseek', { id: 'real-claude', customEnvVars: {} }),
		];
		const api = service();
		const targets = await api.targets('claude-code');
		expect(targets).toMatchObject({
			success: true,
			targets: expect.arrayContaining([
				expect.objectContaining({ provider: 'claude-code', runnerId: 'real-claude' }),
			]),
		});
		const result = await api.prepare({
			sourceAgentId: 'claude-code',
			sourceTabId: 't',
			targetProvider: 'deepseek',
		});
		expect(result.success).toBe(false);
		expect(openTarget).not.toHaveBeenCalled();
	});

	it('uses global gateway routing when the session does not override it', async () => {
		globalEnv = deepseekEnv;
		runners = [runner('claude-code'), runner('codex')];
		const result = await service().prepare({
			sourceAgentId: 'claude-code',
			sourceTabId: 't',
			targetProvider: 'deepseek',
		});
		expect(result.success).toBe(false);
		expect(openTarget).not.toHaveBeenCalled();
	});

	it('does not create anything when the source disappeared before its transcript could be read', async () => {
		readSource.mockResolvedValue(null);
		const result = await service().prepare({
			sourceAgentId: 'claude-code',
			sourceTabId: 'gone',
			targetProvider: 'codex',
		});
		expect(result.success).toBe(false);
		expect(openTarget).not.toHaveBeenCalled();
	});

	it('rejects a remote source before reading or opening a local target', async () => {
		runners[0].sessionSshRemoteConfig = { enabled: true, remoteId: 'remote' };
		const result = await service().prepare({
			sourceAgentId: 'claude-code',
			sourceTabId: 't',
			targetProvider: 'codex',
		});
		expect(result.success).toBe(false);
		expect(readSource).not.toHaveBeenCalled();
		expect(openTarget).not.toHaveBeenCalled();
	});
});
