import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSession } from '../../../../scripts/native-performance-fixtures.cjs';

const isolation = vi.hoisted(() => ({ home: '' }));
vi.mock('os', async (original) => {
	const actual = await original<typeof import('os')>();
	return { ...actual, default: { ...actual, homedir: () => isolation.home } };
});
vi.mock('electron', () => ({ app: { getPath: () => path.join(isolation.home, 'maestro') } }));
vi.mock('../../../main/utils/logger', () => ({
	logger: { info() {}, warn() {}, error() {}, debug() {} },
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException() {} }));

import { CodexSessionStorage } from '../../../main/storage/codex-session-storage';

beforeEach(async () => {
	isolation.home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-search-'));
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(isolation.home, { recursive: true, force: true });
});

it('searches a project without walking the same account directories for every result', async () => {
	const project = path.join(isolation.home, 'project');
	const account = path.join(isolation.home, '.codex');
	const fixtures = Array.from({ length: 40 }, () => createSession('codex', account, project, 4));
	const listing = vi.spyOn(fs, 'readdir');
	const results = await new CodexSessionStorage().searchSessions(project, 'needle', 'user');
	expect(results.map((result) => result.sessionId).sort()).toEqual(
		fixtures.map((fixture) => fixture.id).sort()
	);
	expect(results.every((result) => result.matchCount === 1 && result.matchType === 'user')).toBe(
		true
	);
	// Two date-tree enumerations suffice regardless of the number of native UUID files.
	expect(listing.mock.calls.length).toBeLessThanOrEqual(8);
});

it('preserves legacy filename lookup and independent concurrent searches', async () => {
	const account = path.join(isolation.home, '.codex');
	const projects = ['a', 'b'].map((name) => path.join(isolation.home, name));
	const fixtures = projects.map((project) => createSession('codex', account, project, 4));
	await fs.rename(fixtures[0].file, path.join(path.dirname(fixtures[0].file), 'legacy.jsonl'));
	const storage = new CodexSessionStorage();
	const results = await Promise.all(
		projects.map((project) => storage.searchSessions(project, 'needle', 'user'))
	);
	expect(results.map((result) => result.map((match) => match.sessionId))).toEqual(
		fixtures.map((fixture) => [fixture.id])
	);
});

it('keeps the selected account across history pages for the same project', async () => {
	const project = path.join(isolation.home, 'project');
	const selected = path.join(isolation.home, 'work-account');
	const defaultSession = createSession('codex', path.join(isolation.home, '.codex'), project, 4);
	const selectedSessions = Array.from({ length: 2 }, () =>
		createSession('codex', selected, project, 4)
	);
	const storage = new CodexSessionStorage();
	const first = await storage.listSessionsPaginated(project, { configDir: selected, limit: 1 });
	expect(first.totalCount).toBe(2);
	expect(first.hasMore).toBe(true);
	expect(first.nextCursor).toBe(first.sessions[0].sessionId);
	const second = await storage.listSessionsPaginated(project, {
		configDir: selected,
		cursor: first.nextCursor!,
		limit: 1,
	});
	expect(
		[...first.sessions, ...second.sessions].map((session) => session.sessionId).sort()
	).toEqual(selectedSessions.map((session) => session.id).sort());
	expect(second.totalCount).toBe(2);
	expect(second.hasMore).toBe(false);
	expect(second.nextCursor).toBeNull();
	const defaults = await storage.listSessionsPaginated(project);
	expect(defaults.sessions.map((session) => session.sessionId)).toEqual([defaultSession.id]);
});

it('does not borrow default history when the selected account directory is missing', async () => {
	const project = path.join(isolation.home, 'project');
	createSession('codex', path.join(isolation.home, '.codex'), project, 4);
	const result = await new CodexSessionStorage().listSessionsPaginated(project, {
		configDir: path.join(isolation.home, 'missing-account'),
	});
	expect(result).toEqual({ sessions: [], totalCount: 0, hasMore: false, nextCursor: null });
});
