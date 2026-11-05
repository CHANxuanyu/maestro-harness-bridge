import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ root: '', list: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => mocks.root } }));
vi.mock('../../../../main/stats/singleton', () => ({
	getStatsDB: () => ({
		isReady: () => true,
		getSessionLifecycleEvents: () => [
			{ agentType: 'codex', projectPath: path.join(mocks.root, 'repo') },
			{ agentType: 'codex', projectPath: path.join(mocks.root, 'worktree') },
		],
	}),
}));
vi.mock('../../../../main/agents', () => ({
	getSessionStorage: () => ({ listSessions: mocks.list }),
}));
vi.mock('../../../../main/agents/provider-account-dirs', () => ({
	getProviderAccountDirs: async () => [path.join(mocks.root, 'account')],
}));
vi.mock('../../../../main/utils/sentry', () => ({ captureException() {} }));
vi.mock('../../../../main/utils/logger', () => ({ logger: { debug() {} } }));
import {
	getTokenUsageAggregate,
	invalidateTokenUsageMemo,
} from '../../../../main/stats/token-usage/token-usage-accessor';
import { setTokenUsageCacheForTest } from '../../../../main/stats/token-usage/token-usage-cache';
beforeEach(async () => {
	mocks.root = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-tokens-'));
	invalidateTokenUsageMemo();
	setTokenUsageCacheForTest(null);
});
afterEach(async () => {
	setTokenUsageCacheForTest(null);
	await fs.rm(mocks.root, { recursive: true, force: true });
});
it('counts a native conversation once when both main and worktree projects list it', async () => {
	mocks.list.mockResolvedValue([
		{
			sessionId: 'same-native-id',
			projectPath: path.join(mocks.root, 'worktree'),
			timestamp: '2026-11-03T00:00:00Z',
			modifiedAt: '2026-11-03T00:00:00Z',
			sizeBytes: 100,
			inputTokens: 100,
			outputTokens: 10,
			cacheReadTokens: 0,
			cacheCreationTokens: 0,
		},
	]);
	const result = await getTokenUsageAggregate({}, true);
	expect(result.totals.sessionCount).toBe(1);
	expect(result.totals.inputTokens).toBe(100);
});
