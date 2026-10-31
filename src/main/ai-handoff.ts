import path from 'node:path';
import { createKeyedWriteQueue } from '../shared/keyedWriteQueue';
import { normalizeWorktreePath } from '../shared/worktreePaths';
import { effectiveAgentCustomEnvVars } from '../shared/providerProfiles';
import { getClaudeTokenSourceFields } from '../shared/claudeTokenMode';
import { isDeepSeekAgent } from '../shared/agentPresets';
import {
	HANDOFF_PROVIDERS,
	handoffRequestError,
	type HandoffProvider,
	type HandoffRunner,
	type HandoffRunnerConfig,
	type HandoffRequest,
	type HandoffReadRequest,
	type HandoffReadResult,
	type HandoffOpenRequest,
	type HandoffResult,
	type HandoffTargetsResult,
	type HandoffCommand,
	type HandoffCommandResult,
} from '../shared/aiHandoff';

interface HandoffDependencies {
	getSessions: () => HandoffRunner[];
	getAgentConfig: (toolType: string) => HandoffRunnerConfig;
	getGlobalEnv: () => Record<string, string>;
	env: Record<string, string | undefined>;
	isAvailable: (config: HandoffOpenRequest['config']) => Promise<boolean>;
	readSource: (request: HandoffReadRequest) => Promise<HandoffReadResult>;
	openTarget: (request: HandoffOpenRequest) => Promise<HandoffResult>;
}

function projectKey(project: string): string {
	const normalized = normalizeWorktreePath(path.resolve(project), process.platform !== 'win32');
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** One instance serves both IPC and CLI so concurrent creation shares a queue. */
export function createAiHandoffService(deps: HandoffDependencies) {
	const queue = createKeyedWriteQueue();
	const failed = (error: string, code: HandoffResult['code'] = 'unavailable'): HandoffResult => ({
		success: false,
		error,
		code,
	});
	const effectiveEnv = (runner: Pick<HandoffRunner, 'toolType' | 'customEnvVars'>) => ({
		...deps.env,
		...deps.getGlobalEnv(),
		...effectiveAgentCustomEnvVars(
			runner.customEnvVars,
			deps.getAgentConfig(runner.toolType).customEnvVars
		),
	});
	const providerOf = (
		runner: Pick<HandoffRunner, 'toolType' | 'customEnvVars'>
	): HandoffProvider | null => {
		if (runner.toolType === 'codex') return 'codex';
		if (runner.toolType !== 'claude-code') return null;
		return isDeepSeekAgent(runner.toolType, effectiveEnv(runner) as Record<string, string>)
			? 'deepseek'
			: 'claude-code';
	};
	const local = (runner: HandoffRunner) => !runner.sessionSshRemoteConfig?.enabled;
	function sourceFor(id: string) {
		return deps
			.getSessions()
			.find((runner) => runner.id === id && local(runner) && providerOf(runner));
	}
	function configFor(
		runner: Pick<HandoffRunner, 'toolType'> & HandoffRunnerConfig
	): HandoffOpenRequest['config'] {
		const defaults = deps.getAgentConfig(runner.toolType);
		const config: HandoffOpenRequest['config'] = {
			toolType: runner.toolType as 'claude-code' | 'codex',
			...getClaudeTokenSourceFields(runner),
		};
		// Copy configuration only, never tabs, native IDs, queue, paths or source
		// account data. Env records replace the provider record, just as at spawn.
		for (const key of [
			'customPath',
			'customArgs',
			'customModel',
			'customEffort',
			'customContextWindow',
			'contextWindowSource',
			'customProviderPath',
			'nudgeMessage',
			'newSessionMessage',
		] as const) {
			const value = runner[key] ?? defaults[key];
			if (value !== undefined) Object.assign(config, { [key]: value });
		}
		const env = runner.customEnvVars ?? defaults.customEnvVars;
		if (env) config.customEnvVars = { ...env };
		if (runner.customEnvVarsDisabled)
			config.customEnvVarsDisabled = { ...runner.customEnvVarsDisabled };
		return config;
	}
	async function selectTarget(source: HandoffRunner, provider: HandoffProvider) {
		const candidates = deps
			.getSessions()
			.filter((runner) => local(runner) && providerOf(runner) === provider);
		const sameProject = candidates.filter(
			(runner) =>
				projectKey(runner.projectRoot || runner.cwd) ===
				projectKey(source.projectRoot || source.cwd)
		);
		// An unavailable runner already in this project is not permission to add
		// another one. The user can repair its configured CLI path.
		const pool = sameProject.length ? sameProject : candidates;
		for (const runner of pool) {
			const config = configFor(runner);
			if (provider === 'deepseek') {
				const env = effectiveEnv(runner);
				if (
					!(env.ANTHROPIC_AUTH_TOKEN?.trim() || env.ANTHROPIC_API_KEY?.trim()) ||
					!env.CLAUDE_CONFIG_DIR?.trim()
				)
					continue;
			}
			if (await deps.isAvailable(config))
				return { config, runnerId: sameProject.length ? runner.id : undefined };
		}
		if (sameProject.length) return null;
		const toolType = provider === 'codex' ? 'codex' : 'claude-code';
		const defaults = { toolType, ...deps.getAgentConfig(toolType) };
		if (providerOf(defaults) !== provider) return null;
		if (provider === 'deepseek') {
			const env = effectiveEnv(defaults);
			if (
				!(env.ANTHROPIC_AUTH_TOKEN?.trim() || env.ANTHROPIC_API_KEY?.trim()) ||
				!env.CLAUDE_CONFIG_DIR?.trim()
			)
				return null;
		}
		const config = configFor(defaults);
		return (await deps.isAvailable(config)) ? { config, runnerId: undefined } : null;
	}
	async function targets(sourceAgentId: string): Promise<HandoffTargetsResult> {
		const source = sourceFor(sourceAgentId);
		if (!source) return failed('A local Claude Code, Codex or DeepSeek source agent is required');
		const targets: NonNullable<HandoffTargetsResult['targets']> = [];
		for (const provider of HANDOFF_PROVIDERS) {
			if (provider === providerOf(source)) continue;
			const target = await selectTarget(source, provider);
			if (target) targets.push({ provider, runnerId: target.runnerId });
		}
		return { success: true, targets };
	}
	async function prepare(request: HandoffRequest): Promise<HandoffResult> {
		const invalid = handoffRequestError(request);
		if (invalid) return failed(invalid, 'invalid-request');
		const source = sourceFor(request.sourceAgentId);
		if (!source) return failed('A local Claude Code, Codex or DeepSeek source agent is required');
		const project = projectKey(source.projectRoot || source.cwd);
		return queue.enqueue(`${project}:${request.targetProvider}`, async () => {
			const current = sourceFor(request.sourceAgentId);
			if (!current || projectKey(current.projectRoot || current.cwd) !== project)
				return failed('The source agent changed while preparing the handoff');
			const provider = providerOf(current)!;
			if (provider === request.targetProvider)
				return failed('Choose a different target provider', 'invalid-request');
			const snapshot = await deps.readSource({
				sourceAgentId: request.sourceAgentId,
				sourceTabId: request.sourceTabId,
				provider,
				budgetTokens: request.budgetTokens,
				instruction: request.instruction,
			});
			if (!snapshot) return failed('The source tab is no longer available');
			if ('success' in snapshot) return snapshot;
			if (projectKey(snapshot.projectPath) !== project)
				return failed('The source project changed while preparing the handoff');
			const target = await selectTarget(current, request.targetProvider);
			if (!target)
				return failed('The target provider is unavailable or has no configured local account');
			return deps.openTarget({
				sourceAgentId: current.id,
				provider: request.targetProvider,
				...target,
				projectPath: snapshot.projectPath,
				groupId: snapshot.groupId ?? current.groupId,
				draft: snapshot.draft,
				send: request.send === true,
				background: request.background === true,
			});
		});
	}
	async function command(request: HandoffCommand): Promise<HandoffCommandResult> {
		if (request.action === 'targets') return targets(request.sourceAgentId);
		if (request.action === 'prepare') return prepare(request);
		return failed('Unknown handoff action', 'invalid-request');
	}
	return { prepare, targets, command };
}

export type AiHandoffService = ReturnType<typeof createAiHandoffService>;
