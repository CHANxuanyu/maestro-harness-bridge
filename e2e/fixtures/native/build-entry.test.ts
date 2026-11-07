import { afterEach, expect, it, vi } from 'vitest';

const spawnSync = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ status: 0 })));
vi.mock('node:child_process', () => ({ spawnSync }));
afterEach(() => vi.unstubAllEnvs());

it('builds the desktop, web and CLI bundles before starting native acceptance', async () => {
	vi.stubEnv('MAESTRO_E2E_REAL', '0');
	await import('../../../scripts/native-e2e.mjs');
	expect(spawnSync.mock.calls.map((call) => call[1]).slice(0, 4)).toEqual([
		['run', 'build:main'],
		['run', 'build:renderer'],
		['run', 'build:web-desktop'],
		['run', 'build:cli'],
	]);
	expect(spawnSync).toHaveBeenCalledTimes(5);
});
