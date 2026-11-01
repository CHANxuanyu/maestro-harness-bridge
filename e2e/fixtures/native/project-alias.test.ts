import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createNativeTempDir } from './temp-root.cjs';
import { createTurn } from './protocol.cjs';
import { createCopilotTurn } from './copilot-protocol.cjs';
import { createGrokTurn } from './grok-protocol.cjs';
import { createOpenCodeTurn } from './opencode-protocol.cjs';

const scope = vi.hoisted(() => ({ root: '' }));
vi.mock('os', async (original) => {
	const actual = await original<typeof import('node:os')>();
	return {
		...actual,
		default: { ...actual, homedir: () => scope.root },
		homedir: () => scope.root,
	};
});
vi.mock('electron', () => ({ app: { getPath: () => scope.root } }));
vi.mock('electron-store', () => ({
	default: class {
		get() {
			return {};
		}
		set() {}
	},
}));
vi.mock('../../../src/main/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../src/main/utils/sentry', () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
}));
vi.mock('../../../src/main/agents/provider-account-dirs', () => ({
	getProviderAccountDirs: async () => [],
}));
vi.mock('better-sqlite3', async () => {
	const { nodeSqliteBetterSqlite3Mock } = await import('../../../src/__tests__/helpers/nodeSqlite');
	return nodeSqliteBetterSqlite3Mock();
});

afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(scope.root, { recursive: true, force: true });
});

for (const provider of ['claude', 'copilot', 'grok', 'opencode'] as const) {
	it(`${provider} reads physical native history through a project symlink without changing it`, async () => {
		scope.root = createNativeTempDir('maestro-project-alias-');
		const physical = path.join(scope.root, 'physical');
		const alias = path.join(scope.root, 'alias');
		fs.mkdirSync(physical);
		fs.symlinkSync(physical, alias, 'junction');
		vi.stubEnv('GROK_HOME', path.join(scope.root, '.grok'));
		vi.stubEnv('XDG_DATA_HOME', path.join(scope.root, 'data'));
		const configDir =
			provider === 'opencode'
				? path.join(scope.root, 'data', 'opencode')
				: path.join(scope.root, `.${provider}`);
		fs.mkdirSync(configDir, { recursive: true });
		vi.resetModules();
		const storage =
			provider === 'claude'
				? new (
						await import('../../../src/main/storage/claude-session-storage')
					).ClaudeSessionStorage()
				: provider === 'copilot'
					? new (
							await import('../../../src/main/storage/copilot-session-storage')
						).CopilotSessionStorage()
					: provider === 'grok'
						? new (
								await import('../../../src/main/storage/grok-session-storage')
							).GrokSessionStorage()
						: new (
								await import('../../../src/main/storage/opencode-session-storage')
							).OpenCodeSessionStorage();
		const create =
			provider === 'claude'
				? createTurn
				: provider === 'copilot'
					? createCopilotTurn
					: provider === 'grok'
						? createGrokTurn
						: createOpenCodeTurn;
		const turn = create({ provider, configDir, cwd: physical, prompt: 'Symlink history' });
		turn.finish('Physical answer');
		const before = fs.readFileSync(turn.file);
		const options = { configDir, readOnly: true };
		expect(
			(await storage.listSessions(alias, undefined, configDir)).map((s) => s.sessionId)
		).toEqual([turn.id]);
		const page = await storage.listSessionsPaginated(alias, { configDir, limit: 1 });
		expect(page.sessions.map((s) => s.sessionId)).toEqual([turn.id]);
		expect(
			(await storage.readSessionMessages(alias, turn.id, options)).messages.at(-1)?.content
		).toBe('Physical answer');
		expect(
			(
				await storage.searchSessions(alias, 'Physical answer', 'assistant', undefined, configDir)
			).map((s) => s.sessionId)
		).toEqual([turn.id]);
		const revision = await storage.getTranscriptRevision(alias, turn.id, options);
		expect(revision).toBeTypeOf('string');
		expect(fs.readFileSync(turn.file)).toEqual(before);
		const next = create({
			provider,
			configDir,
			cwd: physical,
			id: turn.id,
			prompt: 'External append',
		});
		next.finish('External answer');
		expect(await storage.getTranscriptRevision(alias, turn.id, options)).not.toBe(revision);
		expect(
			(await storage.readSessionMessages(alias, turn.id, options)).messages.at(-1)?.content
		).toBe('External answer');
		if (provider === 'claude' || provider === 'grok')
			expect(storage.getSessionPath(alias, turn.id)).toBe(turn.file);
		const sibling = path.join(scope.root, 'physical-sibling');
		fs.mkdirSync(sibling);
		expect(await storage.listSessions(sibling, undefined, configDir)).toEqual([]);
		const legacy = create({ provider, configDir, cwd: alias, prompt: 'Saved path history' });
		legacy.finish('Saved path answer');
		expect(
			(await storage.listSessions(alias, undefined, configDir)).map((s) => s.sessionId).sort()
		).toEqual([turn.id, legacy.id].sort());
		fs.unlinkSync(alias);
		expect(
			(await storage.listSessions(alias, undefined, configDir)).map((s) => s.sessionId)
		).toEqual([legacy.id]);
		if (provider === 'claude' || provider === 'copilot') {
			const otherAccount = path.join(scope.root, 'other-account');
			fs.mkdirSync(otherAccount);
			expect(await storage.listSessions(physical, undefined, otherAccount)).toEqual([]);
		}
	});
}
