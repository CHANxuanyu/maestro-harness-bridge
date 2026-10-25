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
