import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import codex from '../../fixtures/model-catalog/codex.json';
import claude from '../../fixtures/model-catalog/claude.json';
import {
	createModelCatalogService,
	parseClaudeModelCatalog,
	parseCodexModelCatalog,
} from '../../../main/agents/model-catalog';
import { visibleCatalogModels } from '../../../shared/modelCatalog';
import type { AgentAccountDirLayers } from '../../../shared/agentAccountDir';

vi.mock('../../../main/agents/model-catalog-quota', () => ({ cachedModelCatalogQuota: vi.fn() }));

describe('vendor catalog parsing', () => {
	it('discovers added models, keeps metadata, sorts priority, and preserves per-model levels', () => {
		const fixture = structuredClone(codex);
		fixture.models.push({
			...fixture.models[0],
			slug: 'future',
			display_name: 'Future',
			description: 'New vendor description',
			priority: 15,
		});
		const parsed = parseCodexModelCatalog(fixture);
		expect(parsed.models.map((model) => model.id)).toEqual([
			'hidden',
			'astra',
			'future',
			'gpt-6-luna',
			'sol',
		]);
		expect(parsed.models.find((model) => model.id === 'future')).toMatchObject({
			displayName: 'Future',
			description: 'New vendor description',
		});
		expect(
			parsed.models.find((model) => model.id === 'gpt-6-luna')?.efforts.map((effort) => effort.id)
		).not.toContain('ultra');
		expect(parsed.models[1].defaultEffort).toBe('high');
		expect(parsed.models[1].efforts[0].description).toBe('Synthetic low reasoning');
		expect(parsed.nativeDefault).toEqual({ modelId: 'astra', source: 'catalog-priority' });
	});
	it('reads Claude names, descriptions, family, legacy groups and per-model effort defaults', () => {
		const { models } = parseClaudeModelCatalog(claude);
		expect(models.map((model) => model.displayName)).toEqual([
			'Current Opus',
			'Opus 4.6',
			'Haiku 4.5',
		]);
		expect(models[0]).toMatchObject({ family: 'opus', group: 'current', defaultEffort: 'high' });
		expect(models[0].efforts.find((effort) => effort.id === 'xhigh')).toMatchObject({
			displayName: 'Extra',
			description: 'Synthetic xhigh effort',
		});
		expect(models[1]).toMatchObject({
			group: 'more',
			description: 'Synthetic Opus 4.6 description',
		});
		expect(models[1].efforts.map((effort) => effort.id)).not.toContain('xhigh');
		expect(models[2].efforts).toEqual([]);
		expect(models[2].defaultEffort).toBeUndefined();
	});
	it('supports the published envelope and excludes unrelated surfaces', () => {
		expect(
			parseClaudeModelCatalog({
				document: { surfaces: { cc: { model_selector_config: [claude.catalog.config] } } },
			}).models
		).toHaveLength(3);
		expect(
			parseClaudeModelCatalog({ catalog: { ...claude.catalog, surface: 'chat' } }).models
		).toEqual([]);
	});
	it('does not accept a default effort outside the model capability list', () => {
		const fixture = structuredClone(codex);
		fixture.models[0].default_reasoning_level = 'unknown';
		expect(
			parseCodexModelCatalog(fixture).models.find((model) => model.id === 'sol')?.defaultEffort
		).toBeUndefined();
	});
});

describe('account-scoped catalog reader', () => {
	let root: string;
	let layers: AgentAccountDirLayers;
	let read: ReturnType<typeof createModelCatalogService>;
	const quota = vi.fn();
	const session = vi.fn();
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-catalog-'));
		layers = {
			homeDir: root,
			env: {},
			agentLevelEnvVars: { CODEX_HOME: root, CLAUDE_CONFIG_DIR: root },
		};
		quota.mockReset();
		session.mockReset();
		read = createModelCatalogService({ layers: () => layers, session, quota });
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(root, { recursive: true, force: true });
	});

	it('invalidates on catalog mtime and config-only edits, without a TTL', async () => {
		const file = path.join(root, 'models_cache.json');
		await fs.writeFile(file, JSON.stringify(codex));
		const first = await read({ provider: 'codex' });
		expect(visibleCatalogModels(first).map((model) => model.id)).toEqual([
			'astra',
			'gpt-6-luna',
			'sol',
		]);
		expect(first.source).toMatchObject({
			kind: 'codex-cache',
			fetchedAt: codex.fetched_at,
			clientVersion: 'fixture',
		});
		const spy = vi.spyOn(fs, 'readFile');
		await read({ provider: 'codex' });
		expect(spy).not.toHaveBeenCalled();
		await fs.utimes(file, new Date(), new Date(Date.now() + 1000));
		await read({ provider: 'codex' });
		expect(spy).toHaveBeenCalled();
		await fs.writeFile(path.join(root, 'config.toml'), 'model = "sol"\n');
		expect((await read({ provider: 'codex' })).followDefault).toEqual({
			modelId: 'sol',
			source: 'config',
		});
		await fs.writeFile(
			path.join(root, 'config.toml'),
			"model = 'gpt-6-luna' # new default\n[mcp_servers.sample]\nmodel = 'wrong'\n"
		);
		expect((await read({ provider: 'codex' })).followDefault.modelId).toBe('gpt-6-luna');
		await fs.unlink(path.join(root, 'config.toml'));
		expect((await read({ provider: 'codex' })).followDefault.modelId).toBe('astra');
	});

	it('recovers missing/corrupt/deleted files and never invents Codex model IDs', async () => {
		const file = path.join(root, 'models_cache.json');
		expect(await read({ provider: 'codex' })).toMatchObject({
			models: [],
			source: { kind: 'fallback' },
			error: 'missing',
			stale: true,
		});
		await fs.writeFile(file, '{broken');
		expect((await read({ provider: 'codex' })).error).toBe('invalid');
		await fs.writeFile(file, JSON.stringify(codex));
		expect((await read({ provider: 'codex' })).models).toHaveLength(4);
		await fs.unlink(file);
		expect((await read({ provider: 'codex' })).source.kind).toBe('fallback');
	});

	it('retains a configured default even when its catalog is missing', async () => {
		await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ model: 'custom-model' }));
		expect(await read({ provider: 'claude-code' })).toMatchObject({
			followDefault: { modelId: 'custom-model', source: 'config' },
			source: { kind: 'fallback' },
		});
	});

	it('selects newest cc catalog, ignores floor and other surfaces, and observes added files', async () => {
		const dir = path.join(root, 'cache', 'model-catalog');
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, 'published-floor.json'), JSON.stringify(claude));
		expect((await read({ provider: 'claude-code' })).source.kind).toBe('fallback');
		await fs.writeFile(path.join(dir, 'old.json'), JSON.stringify(claude));
		await fs.utimes(path.join(dir, 'old.json'), new Date(0), new Date(0));
		const fixture = structuredClone(claude);
		fixture.catalog.config.models[0].name = 'Updated Opus';
		await fs.writeFile(path.join(dir, 'new.json'), JSON.stringify(fixture));
		await fs.writeFile(
			path.join(dir, 'chat.json'),
			JSON.stringify({ catalog: { ...fixture.catalog, surface: 'chat' } })
		);
		const result = await read({ provider: 'claude-code' });
		expect(result.models[0].displayName).toBe('Updated Opus');
		expect(result.followDefault.source).toBe('catalog-state');
		expect(result.source.files).toEqual([path.join('cache', 'model-catalog', 'new.json')]);
		await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ model: 'opus' }));
		expect((await read({ provider: 'claude-code' })).followDefault).toEqual({
			modelId: 'claude-opus-current',
			source: 'config',
		});
	});

	it('keeps provider, account and host identities separate and uses live quota', async () => {
		await fs.writeFile(path.join(root, 'models_cache.json'), JSON.stringify(codex));
		expect((await read({ provider: 'codex' })).models).toHaveLength(4);
		const other = path.join(root, 'other');
		expect(
			(await read({ provider: 'codex', account: { customEnvVars: { CODEX_HOME: other } } })).models
		).toEqual([]);
		expect((await read({ provider: 'claude-code' })).source.kind).toBe('fallback');
		quota.mockClear();
		expect(await read({ provider: 'codex', sshRemoteId: 'remote' })).toMatchObject({
			error: 'unsupported-remote',
			models: [],
		});
		expect(quota).not.toHaveBeenCalled();
		const summary = { sampledAt: 'fixture', stale: false, windows: [] };
		quota.mockReturnValue(summary);
		expect((await read({ provider: 'codex' })).quota).toEqual(summary);
	});

	it('uses stored agent environment and refuses a missing or mismatched agent', async () => {
		await expect(read({ provider: 'codex', sessionId: 'missing' })).rejects.toThrow(
			'Agent does not match'
		);
		session.mockReturnValue({ toolType: 'claude-code' });
		await expect(read({ provider: 'codex', sessionId: 'wrong' })).rejects.toThrow(
			'Agent does not match'
		);
		session.mockReturnValue({
			toolType: 'codex',
			customEnvVars: { CODEX_HOME: path.join(root, 'stored') },
		});
		await read({ provider: 'codex', sessionId: 'agent' });
		expect(quota).toHaveBeenLastCalledWith('codex', path.join(root, 'stored'));
		session.mockReturnValue({ toolType: 'codex', sessionSshRemoteConfig: { enabled: true } });
		expect((await read({ provider: 'codex', sessionId: 'agent' })).error).toBe(
			'unsupported-remote'
		);
	});

	it('honors global environment when the agent replaces provider overrides', async () => {
		layers.globalShellEnvVars = { CODEX_HOME: path.join(root, 'global') };
		await read({ provider: 'codex', account: { customEnvVars: { OTHER: 'value' } } });
		expect(quota).toHaveBeenLastCalledWith('codex', path.join(root, 'global'));
	});

	it('refreshes stale status and environment defaults even on file-cache hits', async () => {
		const dir = path.join(root, 'cache', 'model-catalog');
		await fs.mkdir(dir, { recursive: true });
		const fixture = structuredClone(claude);
		fixture.staleAt = Date.now() + 10000;
		await fs.writeFile(path.join(dir, 'cc.json'), JSON.stringify(fixture));
		expect((await read({ provider: 'claude-code' })).stale).toBe(false);
		vi.spyOn(Date, 'now').mockReturnValue(fixture.staleAt + 1);
		layers.globalShellEnvVars = { ANTHROPIC_MODEL: 'opus' };
		const result = await read({ provider: 'claude-code' });
		expect(result.stale).toBe(true);
		expect(result.followDefault).toEqual({ modelId: 'claude-opus-current', source: 'environment' });
		layers.globalShellEnvVars = { ANTHROPIC_MODEL: 'claude-haiku-4-5' };
		expect((await read({ provider: 'claude-code' })).followDefault.modelId).toBe(
			'claude-haiku-4-5'
		);
	});

	it('marks an older readable Claude catalog stale when a newer file is corrupt', async () => {
		const dir = path.join(root, 'cache', 'model-catalog');
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, 'older.json'), JSON.stringify(claude));
		await fs.utimes(path.join(dir, 'older.json'), new Date(0), new Date(0));
		await fs.writeFile(path.join(dir, 'newer.json'), '{broken');
		expect(await read({ provider: 'claude-code' })).toMatchObject({
			source: { kind: 'claude-catalog' },
			stale: true,
			error: 'invalid',
		});
	});

	it('reports unreadable files and keeps DeepSeek on its canonical preset', async () => {
		await fs.writeFile(path.join(root, 'models_cache.json'), JSON.stringify(codex));
		vi.spyOn(fs, 'readFile').mockRejectedValueOnce(
			Object.assign(new Error('denied'), { code: 'EACCES' })
		);
		expect((await read({ provider: 'codex' })).error).toBe('unreadable');
		const result = await read({
			provider: 'claude-code',
			account: { customEnvVars: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' } },
		});
		expect(result.source.kind).toBe('preset');
		expect(result.models.every((model) => model.efforts.length === 0)).toBe(true);
	});
});
