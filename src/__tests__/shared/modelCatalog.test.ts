import { describe, expect, it } from 'vitest';
import {
	effortsForModel,
	isEffortSupported,
	rememberEffortPerModel,
	rememberedEffortForModel,
	resolveFollowDefault,
	teamSeatEfforts,
	type CatalogModel,
	type ProviderModelCatalog,
} from '../../shared/modelCatalog';

const astra: CatalogModel = {
	id: 'astra',
	displayName: 'Astra',
	description: '',
	group: 'current',
	hidden: false,
	defaultEffort: 'high',
	efforts: ['low', 'high', 'ultra'].map((id) => ({ id, description: '' })),
};
const sol: CatalogModel = { ...astra, id: 'sol' };

describe('model catalog selection state', () => {
	it('remembers each model separately across round trips and validates outdated choices', () => {
		const state = rememberEffortPerModel(rememberEffortPerModel({}, astra, 'ultra'), sol, 'low');
		expect(rememberedEffortForModel(state, astra)).toBe('ultra');
		expect(rememberedEffortForModel(state, sol)).toBe('low');
		expect(rememberEffortPerModel(state, sol, 'unsupported')).toBe(state);
		expect(rememberedEffortForModel(state, { ...astra, efforts: astra.efforts.slice(0, 2) })).toBe(
			'high'
		);
		expect(rememberedEffortForModel(rememberEffortPerModel(state, astra, undefined), astra)).toBe(
			'high'
		);
		expect(state.astra).toBe('ultra');
	});
	it('exposes only the selected model levels and no control for a model without effort', () => {
		const haiku = { ...astra, id: 'haiku', efforts: [], defaultEffort: undefined };
		const catalog = { models: [astra, haiku] } as ProviderModelCatalog;
		expect(effortsForModel(catalog, 'astra')).toEqual(astra.efforts);
		expect(effortsForModel(catalog, 'haiku')).toEqual([]);
		expect(effortsForModel(catalog, 'unknown')).toEqual([]);
		expect(isEffortSupported(haiku, 'high')).toBe(false);
		expect(rememberedEffortForModel({}, haiku)).toBeUndefined();
	});
	it('applies Codex team seat policy without mutating the vendor catalog', () => {
		expect(teamSeatEfforts('codex', astra).map((effort) => effort.id)).toEqual(['low', 'high']);
		expect(teamSeatEfforts('claude-code', astra)).toEqual(astra.efforts);
		expect(isEffortSupported(astra, 'ultra')).toBe(true);
	});
	it('resolves explicit, aliased and native defaults without inventing missing models', () => {
		expect(resolveFollowDefault('sol', { modelId: 'astra', source: 'catalog-priority' })).toEqual({
			modelId: 'sol',
			source: 'config',
		});
		expect(resolveFollowDefault('opus', undefined, { opus: 'claude-opus-current' }).modelId).toBe(
			'claude-opus-current'
		);
		expect(
			resolveFollowDefault(undefined, { modelId: 'astra', source: 'catalog-priority' }).modelId
		).toBe('astra');
		expect(resolveFollowDefault()).toEqual({ modelId: null, source: 'unresolved' });
		expect(resolveFollowDefault('custom-private-model').modelId).toBe('custom-private-model');
		expect(resolveFollowDefault('constructor').modelId).toBe('constructor');
	});
});
