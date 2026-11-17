import fs from 'fs/promises';
import path from 'path';
import {
	resolveFollowDefault,
	type CatalogModel,
	type ModelCatalogProvider,
	type ModelCatalogRequest,
	type ModelEffort,
	type ProviderModelCatalog,
} from '../../shared/modelCatalog';
import { parseJsonWithBom } from '../../shared/jsonUtils';
import { resolveAgentAccountDir, type AgentAccountDirLayers } from '../../shared/agentAccountDir';
import { effectiveAgentCustomEnvVars } from '../../shared/providerProfiles';
import { DEEPSEEK_PRESET, isDeepSeekAgent } from '../../shared/agentPresets';
import { AGENT_DEFINITIONS, CLAUDE_MODEL_ALIASES } from './definitions';
import { parseCodexConfig } from './codex-config';
import { cachedModelCatalogQuota } from './model-catalog-quota';

interface CodexCache {
	fetched_at?: string;
	client_version?: string;
	models?: Array<{
		slug: string;
		display_name?: string;
		description?: string;
		priority?: number;
		visibility?: string;
		default_reasoning_level?: string;
		supported_reasoning_levels?: Array<{ effort: string; description?: string }>;
	}>;
}

interface ClaudeSelector {
	models?: Array<{
		id: string;
		name?: string;
		description?: string;
		tooltip?: { content?: string };
		section?: string;
		hidden?: boolean;
		runtime?: { family?: string; effort_levels?: string[]; default_effort?: string };
		thinking?: {
			effort_options?: Array<{ id: string; name?: string; tooltip?: { content?: string } }>;
		};
	}>;
	provider_alias_targets?: Record<string, { default?: string }>;
}

interface ClaudeCache {
	fetchedAt?: number;
	staleAt?: number;
	catalog?: {
		surface?: string;
		config?: ClaudeSelector | ClaudeSelector[];
		state?: { model?: string };
	};
	document?: {
		surfaces?: Record<string, { model_selector_config?: ClaudeSelector | ClaudeSelector[] }>;
	};
}

interface ParsedCatalog {
	models: CatalogModel[];
	aliases?: Record<string, string>;
	nativeDefault?: ProviderModelCatalog['followDefault'];
	fetchedAt?: string;
	clientVersion?: string;
	staleAt?: number;
}

/** Preserve vendor order and descriptions; never union efforts across models. */
export function parseCodexModelCatalog(value: unknown): ParsedCatalog {
	const cache = value as CodexCache;
	if (!Array.isArray(cache?.models) || !cache.models.length)
		throw new Error('Invalid Codex catalog');
	const models = [...cache.models]
		.sort(
			(a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER)
		)
		.map((model): CatalogModel => {
			if (typeof model?.slug !== 'string' || !model.slug) throw new Error('Invalid model ID');
			const efforts = (model.supported_reasoning_levels ?? []).map((level): ModelEffort => {
				if (typeof level?.effort !== 'string') throw new Error('Invalid reasoning level');
				return {
					id: level.effort,
					description: typeof level.description === 'string' ? level.description : '',
				};
			});
			return {
				id: model.slug,
				displayName: typeof model.display_name === 'string' ? model.display_name : model.slug,
				description: typeof model.description === 'string' ? model.description : '',
				group: 'current',
				efforts,
				defaultEffort: efforts.some((level) => level.id === model.default_reasoning_level)
					? model.default_reasoning_level
					: undefined,
				hidden: model.visibility !== undefined && model.visibility !== 'list',
			};
		});
	return {
		models,
		fetchedAt: typeof cache.fetched_at === 'string' ? cache.fetched_at : undefined,
		clientVersion: typeof cache.client_version === 'string' ? cache.client_version : undefined,
		// Explicit provenance: this is the cache's default ordering, not a
		// hardcoded model or a claim that an arbitrary custom binary was probed.
		nativeDefault: {
			modelId: (models.find((model) => !model.hidden) ?? models[0])?.id ?? null,
			source: 'catalog-priority',
		},
	};
}

/** Both published multi-surface and current per-surface Claude cache envelopes. */
export function parseClaudeModelCatalog(value: unknown): ParsedCatalog {
	const cache = value as ClaudeCache;
	const selector =
		cache?.catalog?.surface === 'cc'
			? cache.catalog.config
			: cache?.document?.surfaces?.cc?.model_selector_config;
	const configs = selector ? (Array.isArray(selector) ? selector : [selector]) : [];
	const models = new Map<string, CatalogModel>();
	const aliases: Record<string, string> = {};
	for (const config of configs) {
		for (const [alias, target] of Object.entries(config.provider_alias_targets ?? {})) {
			if (typeof target.default === 'string') aliases[alias] = target.default;
		}
		for (const model of config.models ?? []) {
			if (typeof model?.id !== 'string' || !model.id) throw new Error('Invalid model ID');
			const options = model.thinking?.effort_options ?? [];
			const ids = model.runtime?.effort_levels ?? options.map((option) => option.id);
			const efforts = ids.map((id): ModelEffort => {
				if (typeof id !== 'string') throw new Error('Invalid effort level');
				const option = options.find((entry) => entry.id === id);
				return {
					id,
					displayName: typeof option?.name === 'string' ? option.name : undefined,
					description: typeof option?.tooltip?.content === 'string' ? option.tooltip.content : '',
				};
			});
			if (!models.has(model.id))
				models.set(model.id, {
					id: model.id,
					displayName: typeof model.name === 'string' ? model.name : model.id,
					description:
						typeof model.description === 'string'
							? model.description
							: typeof model.tooltip?.content === 'string'
								? model.tooltip.content
								: '',
					group: model.section === 'overflow' ? 'more' : 'current',
					family: typeof model.runtime?.family === 'string' ? model.runtime.family : undefined,
					efforts,
					defaultEffort: ids.includes(model.runtime?.default_effort ?? '')
						? model.runtime?.default_effort
						: undefined,
					hidden: model.hidden === true,
				});
		}
	}
	return {
		models: [...models.values()],
		aliases,
		nativeDefault:
			cache?.catalog?.surface === 'cc' && typeof cache.catalog.state?.model === 'string'
				? { modelId: cache.catalog.state.model, source: 'catalog-state' }
				: undefined,
		fetchedAt:
			typeof cache?.fetchedAt === 'number' ? new Date(cache.fetchedAt).toISOString() : undefined,
		staleAt:
			typeof cache?.staleAt === 'number' && Number.isFinite(cache.staleAt)
				? cache.staleAt
				: undefined,
	};
}

function fallbackCatalog(
	provider: ModelCatalogProvider,
	error: ProviderModelCatalog['error']
): ProviderModelCatalog {
	const option = AGENT_DEFINITIONS.find((agent) => agent.id === provider)?.configOptions?.find(
		(entry) => entry.key === (provider === 'codex' ? 'reasoningEffort' : 'effort')
	);
	const efforts =
		option?.type === 'select'
			? (option.options ?? []).filter(Boolean).map((id) => ({ id, description: '' }))
			: [];
	return {
		provider,
		effortLabel: provider === 'codex' ? 'Reasoning' : 'Effort',
		// Codex's existing discovery fallback is empty. Do not invent a static catalog.
		models: (provider === 'claude-code' ? CLAUDE_MODEL_ALIASES : []).map((id) => ({
			id,
			displayName: id,
			description: '',
			group: 'current',
			hidden: false,
			efforts: [...efforts],
		})),
		followDefault: resolveFollowDefault(),
		source: { kind: 'fallback', files: [] },
		stale: true,
		error,
		fallbackEfforts: efforts,
	};
}

interface CatalogSession {
	toolType: string;
	customEnvVars?: Record<string, string>;
	sessionSshRemoteConfig?: { enabled?: boolean; remoteId?: string };
	sshRemoteId?: string;
}

interface ModelCatalogDependencies {
	layers: (provider: ModelCatalogProvider) => AgentAccountDirLayers;
	session: (sessionId: string) => CatalogSession | undefined;
	quota?: typeof cachedModelCatalogQuota;
}

/** One reader per host service. Fingerprints include catalog AND native config files. */
export function createModelCatalogService(deps: ModelCatalogDependencies) {
	const cache = new Map<
		string,
		{
			revision: string;
			catalog: ProviderModelCatalog;
			staleAt?: number;
			aliases?: Record<string, string>;
		}
	>();
	return async (request: ModelCatalogRequest): Promise<ProviderModelCatalog> => {
		if (!request || !['claude-code', 'codex'].includes(request.provider))
			throw new Error('Unsupported catalog provider');
		const { provider } = request;
		const session = request.sessionId ? deps.session(request.sessionId) : undefined;
		if (request.sessionId && (!session || session.toolType !== provider))
			throw new Error('Agent does not match catalog provider');
		const remote =
			request.sshRemoteId ||
			session?.sshRemoteId ||
			(session?.sessionSshRemoteConfig?.enabled
				? session.sessionSshRemoteConfig.remoteId || 'unresolved'
				: undefined);
		// Typed remote catalogs are not implemented yet. Existing getModels SSH discovery remains available.
		if (remote) return fallbackCatalog(provider, 'unsupported-remote');
		const layers = deps.layers(provider);
		const customEnvVars = session ? session.customEnvVars : request.account?.customEnvVars;
		const env = {
			...layers.env,
			...layers.globalShellEnvVars,
			...effectiveAgentCustomEnvVars(customEnvVars, layers.agentLevelEnvVars),
		};
		if (isDeepSeekAgent(provider, env as Record<string, string>))
			return {
				provider,
				effortLabel: 'Effort',
				models: DEEPSEEK_PRESET.models.map((id) => ({
					id,
					displayName: id,
					description: '',
					group: 'current',
					efforts: [],
					hidden: false,
				})),
				followDefault: resolveFollowDefault(DEEPSEEK_PRESET.defaultModel),
				source: { kind: 'preset', files: [] },
				stale: false,
			};
		const accountDir = resolveAgentAccountDir({ toolType: provider, customEnvVars }, layers)!;
		const key = JSON.stringify([provider, accountDir, 'local']);
		const configFile = provider === 'codex' ? 'config.toml' : 'settings.json';
		let files: string[] = [];
		let catalog: ProviderModelCatalog;
		let aliases: Record<string, string> | undefined;
		try {
			files =
				provider === 'codex'
					? ['models_cache.json']
					: (
							await fs
								.readdir(path.join(accountDir, 'cache', 'model-catalog'))
								.catch((error: NodeJS.ErrnoException) => {
									if (error.code === 'ENOENT') return [];
									throw error;
								})
						)
							.filter((name) => name.endsWith('.json') && name !== 'published-floor.json')
							.map((name) => path.join('cache', 'model-catalog', name));
			const stats = await Promise.all(
				[...files, configFile].map(async (file) => {
					try {
						const stat = await fs.stat(path.join(accountDir, file));
						return {
							file,
							mtime: stat.mtimeMs,
							signature: `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`,
						};
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
						return { file, mtime: 0, signature: 'missing' };
					}
				})
			);
			const revision = JSON.stringify(stats);
			const cached = cache.get(key);
			if (cached?.revision === revision) {
				aliases = cached.aliases;
				catalog = {
					...cached.catalog,
					stale:
						cached.catalog.stale || (cached.staleAt !== undefined && Date.now() >= cached.staleAt),
				};
			} else {
				let parsed: ParsedCatalog | undefined;
				let selectedFile: string | undefined;
				let readError: ProviderModelCatalog['error'];
				for (const entry of stats
					.filter((entry) => entry.file !== configFile)
					.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file))) {
					try {
						const raw = parseJsonWithBom(
							await fs.readFile(path.join(accountDir, entry.file), 'utf8')
						);
						const candidate =
							provider === 'codex' ? parseCodexModelCatalog(raw) : parseClaudeModelCatalog(raw);
						if (!candidate.models.length) continue;
						parsed = candidate;
						selectedFile = entry.file;
						break;
					} catch (error) {
						const code = (error as NodeJS.ErrnoException).code;
						readError = code === 'ENOENT' ? 'missing' : code ? 'unreadable' : 'invalid';
					}
				}
				catalog = parsed
					? {
							provider,
							effortLabel: provider === 'codex' ? 'Reasoning' : 'Effort',
							models: parsed.models,
							followDefault: resolveFollowDefault(undefined, parsed.nativeDefault, parsed.aliases),
							source: {
								kind: provider === 'codex' ? 'codex-cache' : 'claude-catalog',
								files: [selectedFile!],
								fetchedAt: parsed.fetchedAt,
								clientVersion: parsed.clientVersion,
							},
							stale: !!readError,
							error: readError,
						}
					: fallbackCatalog(provider, readError ?? 'missing');
				try {
					const text = await fs.readFile(path.join(accountDir, configFile), 'utf8');
					const configured =
						provider === 'codex'
							? parseCodexConfig(text).model
							: parseJsonWithBom<{ model?: string }>(text).model;
					if (configured)
						catalog.followDefault = resolveFollowDefault(configured, undefined, parsed?.aliases);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
						catalog.followDefault = resolveFollowDefault();
						catalog.stale = true;
						catalog.error = 'unreadable';
					}
				}
				// Bound account churn without a time-based freshness policy.
				if (cache.size >= 64) cache.delete(cache.keys().next().value!);
				aliases = parsed?.aliases;
				cache.set(key, { revision, catalog, staleAt: parsed?.staleAt, aliases });
				catalog = {
					...catalog,
					stale: catalog.stale || (parsed?.staleAt !== undefined && Date.now() >= parsed.staleAt),
				};
			}
		} catch (error) {
			catalog = fallbackCatalog(
				provider,
				(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable'
			);
			cache.delete(key);
		}
		// Environment is live, not part of the file cache. It can change without touching disk.
		if (provider === 'claude-code' && env.ANTHROPIC_MODEL?.trim())
			catalog = {
				...catalog,
				followDefault: {
					...resolveFollowDefault(env.ANTHROPIC_MODEL, undefined, aliases),
					source: 'environment',
				},
			};
		return { ...catalog, quota: (deps.quota ?? cachedModelCatalogQuota)(provider, accountDir) };
	};
}
