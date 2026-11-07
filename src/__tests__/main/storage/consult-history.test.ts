import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTurn } from '../../../../e2e/fixtures/native/protocol.cjs';

const isolation = vi.hoisted(() => ({ home: '' }));
vi.mock('os', async (original) => {
	const actual = await original<typeof import('os')>();
	return { ...actual, default: { ...actual, homedir: () => isolation.home } };
});
vi.mock('electron', () => ({ app: { getPath: () => path.join(isolation.home, 'maestro') } }));
vi.mock('electron-store', () => ({
	default: class {
		get(_key: string, fallback: unknown) {
			return fallback;
		}
	},
}));
vi.mock('../../../main/utils/logger', () => ({
	logger: { info() {}, warn() {}, error() {}, debug() {} },
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException() {} }));
vi.mock('../../../main/agents/provider-account-dirs', () => ({ getProviderAccountDirs: () => [] }));
import { ClaudeSessionStorage } from '../../../main/storage/claude-session-storage';
import { CodexSessionStorage } from '../../../main/storage/codex-session-storage';
import { transcriptMessagesToLogEntries } from '../../../shared/transcriptEntries';
import { setSessionInfoCacheForTest } from '../../../main/storage/session-info-cache';

beforeEach(async () => {
	isolation.home = await fs.mkdtemp(path.join(os.tmpdir(), 'consult-history-'));
});
afterEach(async () => {
	setSessionInfoCacheForTest('claude-code', null);
	await fs.rm(isolation.home, { recursive: true, force: true });
});

// Frozen production bytes: old native records have no format version or escaping.
const prompt =
	'You are being consulted by another agent in Maestro. There is no prior conversation to read - the question below is self-contained.\n\n**Question from the user (relayed via the source agent):**\n@Worker Inspect the queue. Then inspect shutdown.';

it.each(['claude', 'codex'] as const)(
	'cleans %s native title, preview, reopened user text and search without rewriting history',
	async (provider) => {
		const account = path.join(isolation.home, 'account');
		const project = path.join(isolation.home, 'project');
		await fs.mkdir(project);
		const turn = createTurn({ provider, configDir: account, cwd: project, prompt });
		const before = await fs.readFile(turn.file);
		const storage = provider === 'claude' ? new ClaudeSessionStorage() : new CodexSessionStorage();
		const [record] = await storage.listSessions(project, undefined, account);
		expect(record.firstUserMessage).toBe('@Worker Inspect the queue. Then inspect shutdown.');
		expect(record.firstMessage).toBe('@Worker Inspect the queue. Then inspect shutdown.');
		expect(record.sessionName).toBe('Inspect the queue.');
		const messages = await storage.readSessionMessages(project, record.sessionId, {
			configDir: account,
			readOnly: true,
		});
		expect(
			transcriptMessagesToLogEntries(messages.messages)
				.filter((entry) => entry.source === 'user')
				.map((entry) => entry.text)
		).toEqual(['@Worker Inspect the queue. Then inspect shutdown.']);
		expect(
			await storage.searchSessions(project, 'You are being consulted', 'user', undefined, account)
		).toEqual([]);
		expect(
			(await storage.searchSessions(project, 'Inspect the queue', 'user', undefined, account))
				.length
		).toBe(1);
		expect(await fs.readFile(turn.file)).toEqual(before);
	}
);
