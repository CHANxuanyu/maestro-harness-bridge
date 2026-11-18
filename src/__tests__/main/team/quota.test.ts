import { beforeEach, describe, expect, it, vi } from 'vitest';
import { teamQuotaSample } from '../../../main/team/quota';
import { getSnapshot } from '../../../main/stores/claudeUsageStore';
import { getAllCodexUsageSnapshots } from '../../../main/stores/codexUsageStore';

vi.mock('../../../main/agents/provider-account-dirs', () => ({
	getAgentAccountDirLayers: () => ({ homeDir: '/synthetic' }),
}));
vi.mock('../../../main/stores/claudeUsageStore', () => ({ getSnapshot: vi.fn() }));
vi.mock('../../../main/stores/codexUsageStore', () => ({ getAllCodexUsageSnapshots: vi.fn() }));

const now = Date.parse('2026-11-18T12:00:00Z');
const later = new Date(now + 3_600_000).toISOString();
beforeEach(() => vi.resetAllMocks());
describe('cached team quota preflight', () => {
	it('uses the canonical seat account and waits for the last exhausted window', () => {
		vi.mocked(getSnapshot).mockReturnValue({
			sampledAt: new Date(now).toISOString(),
			authState: 'authenticated',
			session: { percent: 100, resetsAt: later },
			weekAllModels: { percent: 100, resetsAt: new Date(now + 7_200_000).toISOString() },
		} as never);
		expect(
			teamQuotaSample(
				{ tool: 'claude-code', customEnv: { CLAUDE_CONFIG_DIR: '/synthetic/seat' } },
				{ CLAUDE_CONFIG_DIR: '/synthetic/provider' },
				now
			)
		).toMatchObject({ exhausted: true, resetsAt: now + 7_200_000 });
		expect(getSnapshot).toHaveBeenCalledWith('/synthetic/seat');
	});
	it('ignores a spent window after reset and does not assume an unknown reset', () => {
		vi.mocked(getSnapshot).mockReturnValue({
			sampledAt: new Date(now).toISOString(),
			authState: 'authenticated',
			session: { percent: 100, resetsAt: new Date(now - 1).toISOString() },
		} as never);
		expect(teamQuotaSample({ tool: 'claude-code' }, undefined, now)?.exhausted).toBe(false);
		vi.mocked(getSnapshot).mockReturnValue({
			sampledAt: new Date(now).toISOString(),
			authState: 'authenticated',
			session: { percent: 100 },
		} as never);
		expect(teamQuotaSample({ tool: 'claude-code' }, undefined, now)).toMatchObject({
			exhausted: true,
			resetsAt: undefined,
		});
	});
	it('reports the exact provider login and never applies subscription quota to an API key', () => {
		vi.mocked(getAllCodexUsageSnapshots).mockReturnValue({
			'/synthetic/.codex': { sampledAt: new Date(now).toISOString(), authState: 'unauthenticated' },
		} as never);
		expect(teamQuotaSample({ tool: 'codex' }, undefined, now)).toMatchObject({
			login: true,
			exhausted: true,
			detail: expect.stringContaining('codex'),
		});
		expect(
			teamQuotaSample(
				{ tool: 'claude-code', customEnv: { ANTHROPIC_API_KEY: 'synthetic-key' } },
				undefined,
				now
			)
		).toBeUndefined();
		expect(getSnapshot).not.toHaveBeenCalled();
	});
});
