import type { QuotaSummary } from './usageQuota';

/** Explicit native inheritance, distinct from an absent Maestro override. */
export const NATIVE_MODEL_DEFAULT = '__maestro_native_default__';

export interface ModelPickerSelection {
	/** Empty selects the native default, not the owner/provider override. */
	model: string;
	effort?: string;
	remembered: RememberedModelEfforts;
}

export type ModelCatalogProvider = 'claude-code' | 'codex';

/** IDs stay open-ended so new vendor levels require no Maestro release. */
export interface ModelEffort {
	id: string;
	displayName?: string;
	description: string;
}

export interface CatalogModel {
	id: string;
	displayName: string;
	description: string;
	group: 'current' | 'more';
	family?: string;
	efforts: ModelEffort[];
	defaultEffort?: string;
	hidden: boolean;
}

export interface FollowDefault {
	/** null means the native default could not be established, never a guessed model. */
	modelId: string | null;
	source: 'config' | 'environment' | 'catalog-state' | 'catalog-priority' | 'unresolved';
}

export interface ProviderModelCatalog {
	/** Opaque effective account identity for per-conversation effort memory. */
	accountKey?: string;
	provider: ModelCatalogProvider;
	effortLabel: 'Effort' | 'Reasoning';
	/** Includes hidden entries for resolving existing selections. Use visibleCatalogModels for pickers. */
	models: CatalogModel[];
	followDefault: FollowDefault;
	source: {
		kind: 'codex-cache' | 'claude-catalog' | 'fallback' | 'preset';
		/** Paths relative to the effective account root; never expose credentials or absolute paths. */
		files: string[];
		fetchedAt?: string;
		clientVersion?: string;
	};
	stale: boolean;
	error?: 'missing' | 'unreadable' | 'invalid' | 'unsupported-remote';
	/** Built-in provider-wide levels, only populated for the explicitly marked fallback. */
	fallbackEfforts?: ModelEffort[];
	quota?: QuotaSummary;
}

/** A stored agent OR a live, unsaved account context. Stored identity wins when supplied. */
export interface ModelCatalogRequest {
	provider: ModelCatalogProvider;
	sessionId?: string;
	account?: { customEnvVars?: Record<string, string> };
	sshRemoteId?: string;
}

export function visibleCatalogModels(catalog: ProviderModelCatalog): CatalogModel[] {
	return catalog.models.filter((model) => !model.hidden);
}

export function effortsForModel(
	catalog: ProviderModelCatalog,
	modelId: string
): readonly ModelEffort[] {
	return catalog.models.find((model) => model.id === modelId)?.efforts ?? [];
}

export function isEffortSupported(
	model: CatalogModel | undefined,
	effort: string | undefined
): boolean {
	return !!effort && !!model?.efforts.some((level) => level.id === effort);
}

export function resolveFollowDefault(
	configuredModel?: string,
	nativeDefault?: FollowDefault,
	aliases: Readonly<Record<string, string>> = {}
): FollowDefault {
	if (configuredModel?.trim()) {
		const id = configuredModel.trim();
		return {
			modelId: Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : id,
			source: 'config',
		};
	}
	if (nativeDefault?.modelId) {
		const id = nativeDefault.modelId;
		return {
			...nativeDefault,
			modelId: Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : id,
		};
	}
	// Ordering alone is not proof of a native default. The reader must explicitly
	// opt into Codex's priority policy; Claude's first row is not its default.
	return { modelId: null, source: 'unresolved' };
}

/** Keep one map per provider/account/conversation in the UI's owning state. */
export type RememberedModelEfforts = Readonly<Record<string, string | undefined>>;

export function rememberEffortPerModel(
	state: RememberedModelEfforts,
	model: CatalogModel,
	effort: string | undefined
): RememberedModelEfforts {
	if (effort !== undefined && !isEffortSupported(model, effort)) return state;
	if (effort !== undefined) return { ...state, [model.id]: effort };
	const next = { ...state };
	delete next[model.id];
	return next;
}

export function rememberedEffortForModel(
	state: RememberedModelEfforts,
	model: CatalogModel
): string | undefined {
	const effort = Object.prototype.hasOwnProperty.call(state, model.id)
		? state[model.id]
		: undefined;
	return isEffortSupported(model, effort)
		? effort
		: isEffortSupported(model, model.defaultEffort)
			? model.defaultEffort
			: undefined;
}

/** Product policy for team seats, not a mutation of vendor capabilities. */
export function teamSeatEfforts(
	provider: ModelCatalogProvider,
	model: CatalogModel
): ModelEffort[] {
	return model.efforts.filter((effort) => provider !== 'codex' || effort.id !== 'ultra');
}
