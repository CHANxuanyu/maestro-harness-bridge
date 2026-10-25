// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';
import { afterEach, expect, it, vi } from 'vitest';
import { createSession, appendTurn } from '../../../scripts/native-performance-fixtures.cjs';

const isolation = vi.hoisted(() => ({ home: '', userData: '' }));
vi.mock('os', async (original) => {
	const actual = await original<typeof import('os')>();
	return { ...actual, default: { ...actual, homedir: () => isolation.home } };
});
vi.mock('electron', () => ({ app: { getPath: () => isolation.userData } }));
vi.mock('electron-store', () => ({
	default: class {
		get = (_key: string, fallback: unknown) => fallback;
		set = () => {};
	},
}));
vi.mock('../../main/utils/logger', () => ({
	logger: { info() {}, warn() {}, error() {}, debug() {} },
}));
vi.mock('../../main/utils/sentry', () => ({ captureException() {} }));
vi.mock('../../main/agents/provider-account-dirs', () => ({
	getProviderAccountDirs: async () => [],
}));
vi.mock('../../main/utils/statsCache', () => ({
	encodeClaudeProjectPath: (project: string) => project.replace(/[^a-zA-Z0-9]/g, '-'),
}));

import { ClaudeSessionStorage } from '../../main/storage/claude-session-storage';
import { CodexSessionStorage } from '../../main/storage/codex-session-storage';
import { setSessionInfoCacheForTest } from '../../main/storage/session-info-cache';

const MiB = 1024 * 1024;
// Fixed before the baseline. Three planned samples, never retry a failure.
const budgets = {
	first10k: 800,
	first50k: 2000,
	firstLarge: 3000,
	increment: 150,
	page: 50,
	scan: 5000,
	search: 10000,
	pageBytes: MiB,
};
type Measurement = {
	name: string;
	ms: number;
	jsonBytes: number;
	v8Bytes: number;
	budgetMs: number;
};
let root: string;
afterEach(async () => {
	vi.restoreAllMocks();
	setSessionInfoCacheForTest('claude-code', null);
	if (root) await fs.rm(root, { recursive: true, force: true });
});

it.each(['codex', 'claude'] as const)(
	'%s native storage budgets on generated histories',
	async (provider) => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'maestro-native-performance-'));
		isolation.home = path.join(root, 'history');
		isolation.userData = path.join(root, 'maestro');
		await fs.mkdir(isolation.userData, { recursive: true });
		const project = path.join(root, 'project');
		const makeStorage = () =>
			provider === 'codex' ? new CodexSessionStorage() : new ClaudeSessionStorage();
		const measurements: Measurement[] = [];
		async function measure<T>(name: string, budgetMs: number, operation: () => Promise<T>) {
			const start = performance.now();
			const value = await operation();
			const ms = performance.now() - start;
			// Payload estimates only: Electron's framing and renderer time are not measured.
			const metric = {
				name,
				ms: Math.round(ms * 10) / 10,
				jsonBytes: Buffer.byteLength(JSON.stringify(value)),
				v8Bytes: serialize(value).length,
				budgetMs,
			};
			measurements.push(metric);
			console.info(JSON.stringify({ provider, ...metric }));
			return value;
		}
		for (const [label, count, budget] of [
			['10k', 10000, budgets.first10k],
			['50k', 50000, budgets.first50k],
			['large', 4, budgets.firstLarge],
		] as const) {
			const fixture = createSession(
				provider,
				path.join(root, label),
				project,
				count,
				label === 'large' ? 'x'.repeat(53 * MiB) : undefined
			);
			const initial = await fs.stat(fixture.file);
			console.info(
				JSON.stringify({ provider, fixture: label, messages: count, bytes: initial.size })
			);
			if (label === 'large') expect(initial.size).toBeGreaterThan(100 * MiB);
			for (let sample = 0; sample < 3; sample++) {
				const storage = makeStorage();
				const options = { configDir: fixture.configDir, readOnly: true, limit: 500 };
				const read = (extra = {}) =>
					storage.readSessionMessages(project, fixture.id, { ...options, ...extra });
				const first = await measure(`${label}/first/${sample}`, budget, () => read());
				expect(first.total).toBe(count + sample * 4);
				expect(first.messages.at(-1)?.model).toBe(
					provider === 'codex' ? 'gpt-5.3-codex' : 'claude-sonnet-4-6'
				);
				expect(first.messages.filter((message) => message.toolUse).length).toBeGreaterThan(0);
				const before = await storage.getTranscriptRevision(project, fixture.id, options);
				appendTurn(fixture, count + sample);
				const afterAppend = await fs.stat(fixture.file);
				expect(await storage.getTranscriptRevision(project, fixture.id, options)).not.toBe(before);
				const increment = await measure(`${label}/increment/${sample}`, budgets.increment, () =>
					read()
				);
				expect(increment.total).toBe(first.total + 4);
				expect(increment.messages.at(-1)?.content).toContain(`answer ${count + sample} `);
				const full = await makeStorage().readSessionMessages(project, fixture.id, {
					...options,
					readOnly: false,
				});
				expect(increment).toEqual(full);
				const page = await measure(`${label}/page/${sample}`, budgets.page, () =>
					read({ offset: label === 'large' ? 1 : 500 })
				);
				expect(page.total).toBe(increment.total);
				if (label !== 'large') expect(page.messages).toHaveLength(500);
				if (label === '50k') {
					const loaded = await measure(`50k/loaded-tab/${sample}`, budgets.page, () =>
						read({ limit: increment.total })
					);
					expect(loaded.messages).toHaveLength(increment.total);
				}
				// Reads leave native content untouched, including the huge tool results.
				const afterReads = await fs.stat(fixture.file);
				expect([afterReads.size, afterReads.mtimeMs, afterReads.ctimeMs]).toEqual([
					afterAppend.size,
					afterAppend.mtimeMs,
					afterAppend.ctimeMs,
				]);
			}
			if (label === 'large') {
				// The existing metadata scanner deliberately excludes files above 100 MiB.
				// Opening a known ID works; list/search discovery remains a recorded limit.
				expect(await makeStorage().listSessions(project, undefined, fixture.configDir)).toEqual([]);
			}
		}
		const account = path.join(isolation.home, `.${provider}`);
		for (let index = 0; index < 5000; index++) createSession(provider, account, project, 4);
		for (let sample = 0; sample < 3; sample++) {
			await fs.rm(path.join(isolation.userData, 'stats-cache'), { recursive: true, force: true });
			setSessionInfoCacheForTest('claude-code', null);
			const storage = makeStorage();
			const sessions = await measure(`history/scan/${sample}`, budgets.scan, () =>
				storage.listSessions(project)
			);
			expect(sessions).toHaveLength(5000);
			const page = await measure(`history/page/${sample}`, budgets.scan, () =>
				storage.listSessionsPaginated(project, { limit: 100 })
			);
			expect(page.totalCount).toBe(5000);
			expect(page.sessions).toHaveLength(100);
			const results = await measure(`history/search/${sample}`, budgets.search, () =>
				storage.searchSessions(project, 'needle', 'user')
			);
			expect(results).toHaveLength(5000);
			expect(results.every((result) => result.matchCount === 1)).toBe(true);
		}
		for (const metric of measurements) {
			expect
				.soft(metric.ms, `${provider} ${metric.name} time`)
				.toBeLessThanOrEqual(metric.budgetMs);
			if (!metric.name.includes('loaded-tab') && !metric.name.startsWith('history/')) {
				expect
					.soft(metric.jsonBytes, `${provider} ${metric.name} JSON bytes`)
					.toBeLessThan(budgets.pageBytes);
				expect
					.soft(metric.v8Bytes, `${provider} ${metric.name} V8 bytes`)
					.toBeLessThan(budgets.pageBytes);
			}
		}
	},
	600000
);
