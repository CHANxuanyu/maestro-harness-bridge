import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedModelCatalogQuota } from '../../../main/agents/model-catalog-quota';
import { getRetainedSnapshots } from '../../../main/stores/claudeUsageStore';
import { getRetainedCodexUsageSnapshots } from '../../../main/stores/codexUsageStore';

vi.mock('../../../main/stores/claudeUsageStore', () => ({
	getRetainedSnapshots: vi.fn(),
	SNAPSHOT_TTL_MS: 86400000,
}));
vi.mock('../../../main/stores/codexUsageStore', () => ({
	getRetainedCodexUsageSnapshots: vi.fn(),
	CODEX_USAGE_SNAPSHOT_TTL_MS: 86400000,
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getRetainedSnapshots).mockReturnValue({});
	vi.mocked(getRetainedCodexUsageSnapshots).mockReturnValue({});
});

describe('cached picker quota', () => {
	it('returns undefined for missing accounts and never reads local stores for SSH', () => {
		expect(cachedModelCatalogQuota('codex', 'absent')).toBeUndefined();
		expect(cachedModelCatalogQuota('claude-code', 'absent')).toBeUndefined();
		vi.clearAllMocks();
		expect(cachedModelCatalogQuota('codex', 'account', 'remote')).toBeUndefined();
		expect(getRetainedCodexUsageSnapshots).not.toHaveBeenCalled();
		expect(getRetainedSnapshots).not.toHaveBeenCalled();
	});
	it('returns remaining percent and reset time, retaining known zero usage without a reset', () => {
		vi.mocked(getRetainedSnapshots).mockReturnValue({
			account: {
				configDirKey: 'account',
				sampledAt: new Date().toISOString(),
				session: { percent: 25, resetsAt: '2026-12-01T12:00:00Z' },
				weekAllModels: { percent: 0 },
				weekSonnetOnly: { percent: NaN },
			},
		});
		expect(cachedModelCatalogQuota('claude-code', 'account')).toMatchObject({
			stale: false,
			windows: [
				{ id: 'session', remainingPercent: 75, resetsAt: '2026-12-01T12:00:00Z' },
				{ id: 'weekAllModels', remainingPercent: 100 },
			],
		});
		expect(cachedModelCatalogQuota('claude-code', 'other')).toBeUndefined();
	});
	it('marks retained old samples stale and includes additional Codex windows', () => {
		vi.mocked(getRetainedCodexUsageSnapshots).mockReturnValue({
			account: {
				codexHomeKey: 'account',
				authState: 'authenticated',
				sampledAt: '2020-01-01T00:00:00Z',
				weekly: { percent: 120, resetsAt: '2020-01-08T00:00:00Z' },
				additionalLimits: [{ name: 'premium', percent: 40 }],
			},
		});
		expect(cachedModelCatalogQuota('codex', 'account')).toMatchObject({
			stale: true,
			windows: [
				{ id: 'weekly', remainingPercent: 0 },
				{ id: 'additional:0', label: 'premium', remainingPercent: 60 },
			],
		});
	});
	it('suppresses failed authentication samples', () => {
		vi.mocked(getRetainedCodexUsageSnapshots).mockReturnValue({
			account: {
				codexHomeKey: 'account',
				authState: 'error',
				sampledAt: new Date().toISOString(),
				session: { percent: 0, resetsAt: 'later' },
			},
		});
		expect(cachedModelCatalogQuota('codex', 'account')).toBeUndefined();
	});
});
