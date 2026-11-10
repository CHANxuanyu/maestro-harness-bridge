import { isValidAgentId, type AgentId } from '../shared/agentIds';
import { createKeyedWriteQueue } from '../shared/keyedWriteQueue';
import { effectiveAgentCustomEnvVars } from '../shared/providerProfiles';
import { getClaudeTokenSourceFields } from '../shared/claudeTokenMode';
import { agentProviderId } from '../shared/agentPresets';
import {
	HANDOFF_PROVIDERS,
	isHandoffProvider,
	handoffLocation,
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
	getNewShell: () => boolean;
	env: Record<string, string | undefined>;
	isAvailable: (
		config: HandoffOpenRequest['config'],
		location: Pick<HandoffRunner, 'cwd' | 'sessionSshRemoteConfig'>
	) => Promise<boolean>;
	preparePreset?: (config: HandoffOpenRequest['config']) => Promise<HandoffOpenRequest['config']>;
	readSource: (request: HandoffReadRequest) => Promise<HandoffReadResult>;
	openTarget: (request: HandoffOpenRequest) => Promise<HandoffResult>;
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
	const providerOf = (runner: Pick<HandoffRunner, 'toolType' | 'customEnvVars'>): string | null =>
		runner.toolType === 'terminal'
			? null
			: agentProviderId(runner.toolType, effectiveEnv(runner) as Record<string, string>);

	function sourceFor(id: string) {
		return deps
			.getSessions()
			.find((runner) => runner.id === id && isHandoffProvider(providerOf(runner)));
	}
	function configFor(
		runner: Pick<HandoffRunner, 'toolType'> & HandoffRunnerConfig
	): HandoffOpenRequest['config'] {
		const defaults = deps.getAgentConfig(runner.toolType);
		const config: HandoffOpenRequest['config'] = {
			toolType: runner.toolType as AgentId,
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
	async function selectTarget(
		source: HandoffRunner,
		provider: string,
		create = false,
		preferSource = false
	) {
		const location = handoffLocation(source);
		const sameProject = deps
			.getSessions()
			.filter(
				(runner) => providerOf(runner) === provider && handoffLocation(runner).key === location.key
			);
		// An unavailable runner already in this project is not permission to add
		// another one. The user can repair its configured CLI path.
		const pool =
			preferSource && sameProject.some((runner) => runner.id === source.id)
				? [source, ...sameProject.filter((runner) => runner.id !== source.id)]
				: sameProject;
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
			if (await deps.isAvailable(config, source))
				return { config, runnerId: sameProject.length ? runner.id : undefined };
		}
		if (sameProject.length) return null;
		const toolType = provider === 'deepseek' ? 'claude-code' : provider;
		const defaults = { toolType, ...deps.getAgentConfig(toolType) };
		if (providerOf(defaults) !== provider) return null;
		if (provider === 'deepseek') {
			const env = effectiveEnv(defaults);
			if (!(env.ANTHROPIC_AUTH_TOKEN?.trim() || env.ANTHROPIC_API_KEY?.trim())) return null;
		}
		let config = configFor(defaults);
		// The existing DeepSeek preset creates a local isolated account only.
		// A remote target must already have a host-specific preset runner.
		if (provider === 'deepseek' && source.sessionSshRemoteConfig?.enabled) return null;
		if (!(await deps.isAvailable(config, source))) return null;
		if (create && provider === 'deepseek' && deps.preparePreset)
			config = await deps.preparePreset(config);
		return { config, runnerId: undefined };
	}
	async function targets(
		sourceAgentId: string,
		includeCurrent = false,
		localOnly = false
	): Promise<HandoffTargetsResult> {
		const source = sourceFor(sourceAgentId);
		if (!source) return failed('A Claude Code, Codex or DeepSeek source agent is required');
		const targets: NonNullable<HandoffTargetsResult['targets']> = [];
		for (const provider of HANDOFF_PROVIDERS) {
			if (!includeCurrent && provider === providerOf(source)) continue;
			if (localOnly && source.sessionSshRemoteConfig?.enabled) continue;
			const target = await selectTarget(source, provider);
			if (target) targets.push({ provider, runnerId: target.runnerId });
		}
		return { success: true, targets };
	}
	async function prepare(request: HandoffRequest): Promise<HandoffResult> {
		const invalid = handoffRequestError(request);
		if (invalid) return failed(invalid, 'invalid-request');
		const source = sourceFor(request.sourceAgentId);
		if (!source) return failed('A Claude Code, Codex or DeepSeek source agent is required');
		if (source.sessionSshRemoteConfig?.enabled && !source.sessionSshRemoteConfig.remoteId)
			return failed('SSH is enabled but no remote is configured');
		const location = handoffLocation(source);
		const mode = request.mode ?? 'handoff';
		return queue.enqueue(`${location.key}:${request.targetProvider}`, async () => {
			let current = sourceFor(request.sourceAgentId);
			if (!current || handoffLocation(current).key !== location.key)
				return failed('The source agent changed while preparing the handoff');
			const provider = providerOf(current) as HandoffProvider;
			if (provider === request.targetProvider)
				return failed('Choose a different target provider', 'invalid-request');
			const snapshot = await deps.readSource({
				sourceAgentId: request.sourceAgentId,
				sourceTabId: request.sourceTabId,
				provider,
				mode,
				budgetTokens: request.budgetTokens,
				instruction: request.instruction,
			});
			if (!snapshot) return failed('The source tab is no longer available');
			if ('success' in snapshot) return snapshot;
			if (handoffLocation(snapshot).key !== location.key)
				return failed('The source project changed while preparing the handoff');
			current = sourceFor(request.sourceAgentId);
			if (
				!current ||
				handoffLocation(current).key !== location.key ||
				providerOf(current) !== provider
			)
				return failed('The source agent changed while reading the conversation');
			const target = await selectTarget(current, request.targetProvider, true);
			if (!target)
				return failed(
					'The target provider cannot run in the source directory on the same host. Check its global settings and account; an SSH DeepSeek target needs an existing preset runner on that host.'
				);
			const result = await deps.openTarget({
				sourceAgentId: current.id,
				sourcePermission: snapshot.sourcePermission,
				cwd: location.cwd,
				sessionSshRemoteConfig: current.sessionSshRemoteConfig,
				mode,
				origin: {
					kind: mode,
					sourceSessionId: current.id,
					sourceTabId: request.sourceTabId,
					sourceProvider: provider,
					sourceNativeSessionId: snapshot.sourceNativeSessionId,
					sourceTitle: snapshot.sourceTitle,
					createdAt: Date.now(),
				},
				provider: request.targetProvider,
				...target,
				projectPath: snapshot.projectPath,
				groupId: snapshot.groupId ?? current.groupId,
				draft: snapshot.draft,
				send: request.send === true,
				background: request.background === true,
			});
			return { ...result, mode };
		});
	}
	async function command(request: HandoffCommand): Promise<HandoffCommandResult> {
		if (request.action === 'targets')
			return targets(request.sourceAgentId, request.includeCurrent, request.localOnly);
		if (request.action === 'new-conversation') {
			if (!deps.getNewShell())
				return failed('Only an empty conversation in the new shell can change tools');
			if (
				(request.targetProvider !== undefined &&
					!isHandoffProvider(request.targetProvider) &&
					(!isValidAgentId(request.targetProvider) || request.targetProvider === 'terminal')) ||
				(request.prompt !== undefined &&
					(typeof request.prompt !== 'string' || !!request.replaceTabId)) ||
				(request.replaceTabId !== undefined &&
					(typeof request.replaceTabId !== 'string' || !request.replaceTabId))
			)
				return failed('Invalid conversation target', 'invalid-request');
			const source = deps
				.getSessions()
				.find((runner) => runner.id === request.sourceAgentId && providerOf(runner));
			if (!source) return failed('Source project not found');
			const targetProvider = request.targetProvider ?? providerOf(source)!;
			if (request.replaceTabId && providerOf(source) === targetProvider)
				return failed('Choose a different tool', 'invalid-request');
			const location = handoffLocation(source);
			return queue.enqueue(
				`new:${source.id}:${request.replaceTabId ?? targetProvider}`,
				async () => {
					if (!deps.getNewShell())
						return failed('Only an empty conversation in the new shell can change tools');
					const target = await selectTarget(source, targetProvider, true, !!request.sourceTabId);
					if (!target) return failed('The selected tool is unavailable');
					return deps.openTarget({
						newConversation: {
							...(request.origin ? { origin: request.origin } : {}),
							replaceTabId: request.replaceTabId,
							...(request.sourceTabId ? { sourceTabId: request.sourceTabId } : {}),
							...(request.prompt ? { prompt: request.prompt } : {}),
						},
						permissionCeiling: request.sourcePermission,
						sessionSshRemoteConfig: source.sessionSshRemoteConfig,
						sourceAgentId: source.id,
						cwd: location.cwd,
						projectPath: source.projectRoot,
						groupId: source.groupId,
						provider: targetProvider,
						...target,
						mode: 'handoff',
						origin: {
							kind: 'handoff',
							sourceSessionId: source.id,
							sourceTabId: '',
							sourceProvider: providerOf(source)!,
							createdAt: Date.now(),
						},
						draft: {
							text: '',
							estimatedTokens: 0,
							budgetTokens: 8000,
							omittedEntries: 0,
							omittedCharacters: 0,
						},
						send: false,
						background: request.background === true,
					});
				}
			);
		}
		if (request.action === 'prepare') return prepare(request);
		return failed('Unknown handoff action', 'invalid-request');
	}
	return { prepare, targets, command };
}

export type AiHandoffService = ReturnType<typeof createAiHandoffService>;
