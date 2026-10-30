import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTurn } from '../../../../e2e/fixtures/native/protocol.cjs';
import { createCopilotTurn } from '../../../../e2e/fixtures/native/copilot-protocol.cjs';

const isolation = vi.hoisted(() => ({ home: '' }));
vi.mock('os', async (original) => {
	const actual = await original<typeof import('os')>();
	return { ...actual, default: { ...actual, homedir: () => isolation.home } };
});
vi.mock('electron', () => ({ app: { getPath: () => path.join(isolation.home, 'maestro') } }));
vi.mock('electron-store', () => ({
	default: class {
		get = (_key: string, fallback: unknown) => fallback;
		set = () => {};
	},
}));
vi.mock('../../../main/utils/logger', () => ({
	logger: { info() {}, warn() {}, error() {}, debug() {} },
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException() {} }));
vi.mock('../../../main/agents/provider-account-dirs', () => ({
	getProviderAccountDirs: async () => [],
}));
vi.mock('../../../main/utils/statsCache', () => ({
	encodeClaudeProjectPath: (project: string) => project.replace(/[^a-zA-Z0-9]/g, '-'),
}));

import { ClaudeSessionStorage } from '../../../main/storage/claude-session-storage';
import { CodexSessionStorage } from '../../../main/storage/codex-session-storage';
import { CopilotSessionStorage } from '../../../main/storage/copilot-session-storage';
import { setSessionInfoCacheForTest } from '../../../main/storage/session-info-cache';

beforeEach(async () => {
	isolation.home = await fs.mkdtemp(path.join(os.tmpdir(), 'maestro-account-history-'));
	vi.stubEnv('COPILOT_HOME', '');
});
afterEach(async () => {
	setSessionInfoCacheForTest('claude-code', null);
	vi.unstubAllEnvs();
	await fs.rm(isolation.home, { recursive: true, force: true });
});

const providers = [
	{ provider: 'claude', Storage: ClaudeSessionStorage },
	{ provider: 'codex', Storage: CodexSessionStorage },
	{ provider: 'copilot', Storage: CopilotSessionStorage },
] as const;

async function seed(provider: string, configDir: string, prompt: string, id?: string) {
	const cwd = path.join(isolation.home, 'project');
	// Reuse the version-pinned native writers. Copilot creates its own UUID;
	// substitute only that UUID to model identical IDs in separate accounts.
	const turn =
		provider === 'copilot'
			? createCopilotTurn({ configDir, cwd, prompt })
			: createTurn({ provider, configDir, cwd, prompt, id });
	turn.finish(`${prompt} answer`);
	if (provider === 'copilot' && id) {
		const dir = path.dirname(turn.file);
		for (const name of ['workspace.yaml', 'events.jsonl']) {
			const file = path.join(dir, name);
			await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replaceAll(turn.id, id));
		}
		await fs.rename(dir, path.join(path.dirname(dir), id));
		return { id, file: path.join(path.dirname(dir), id, 'events.jsonl') };
	}
	return turn;
}

it.each(providers)(
	'$provider keeps search and preview in the listed account',
	async ({ provider, Storage }) => {
		const project = path.join(isolation.home, 'project');
		const selected = path.join(isolation.home, 'selected');
		const chosen = await seed(provider, selected, 'needle-selected');
		const fallback = await seed(
			provider,
			path.join(isolation.home, `.${provider}`),
			'needle-default',
			chosen.id
		);
		const before = await Promise.all([chosen.file, fallback.file].map((file) => fs.readFile(file)));
		const storage = new Storage();
		const page = await storage.listSessionsPaginated(project, { configDir: selected, limit: 1 });
		expect(page.sessions.map((session) => session.sessionId)).toEqual([chosen.id]);
		for (const mode of ['title', 'user', 'assistant', 'all'] as const) {
			const results = await storage.searchSessions(
				project,
				'needle-selected',
				mode,
				undefined,
				selected
			);
			expect(results).toEqual([
				expect.objectContaining({
					sessionId: chosen.id,
					matchPreview: expect.stringContaining('needle-selected'),
				}),
			]);
			expect(
				await storage.searchSessions(project, 'needle-default', mode, undefined, selected)
			).toEqual([]);
			expect(await storage.searchSessions(project, 'needle-default', mode)).toHaveLength(1);
		}
		const preview = await storage.readSessionMessages(project, chosen.id, { configDir: selected });
		expect(preview.messages.map((message) => message.content)).toEqual([
			'needle-selected',
			'needle-selected answer',
		]);
		expect(
			await Promise.all([chosen.file, fallback.file].map((file) => fs.readFile(file)))
		).toEqual(before);
	}
);

it.each(providers)(
	'$provider rejects a missing selected account on search and preview',
	async ({ provider, Storage }) => {
		const project = path.join(isolation.home, 'project');
		const fallback = await seed(
			provider,
			path.join(isolation.home, `.${provider}`),
			'needle-default'
		);
		const missing = path.join(isolation.home, 'missing');
		const storage = new Storage();
		await expect
			.soft(storage.searchSessions(project, 'needle-default', 'all', undefined, missing))
			.rejects.toMatchObject({ code: 'ENOENT' });
		await expect
			.soft(storage.readSessionMessages(project, fallback.id, { configDir: missing }))
			.rejects.toMatchObject({ code: 'ENOENT' });
	}
);
