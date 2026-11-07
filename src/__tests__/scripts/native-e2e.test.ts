import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

describe('native E2E build entry', () => {
	const originalArgv = process.argv;

	beforeEach(() => {
		vi.resetModules();
		vi.mocked(spawnSync).mockReset();
		vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
		vi.stubEnv('MAESTRO_E2E_REAL', '0');
		vi.stubEnv('DISPLAY', ':fixture');
		process.argv = [
			process.execPath,
			'scripts/native-e2e.mjs',
			'native-conversation-archive.spec.ts',
		];
	});

	afterEach(() => {
		process.argv = originalArgv;
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('builds the browser renderer before launching native browser acceptance', async () => {
		await import('../../../scripts/native-e2e.mjs');

		const commands = vi.mocked(spawnSync).mock.calls.map(([, args]) => args);
		expect(commands.slice(0, -1)).toEqual([
			['run', 'build:main'],
			['run', 'build:renderer'],
			['run', 'build:web-desktop'],
			['run', 'build:cli'],
		]);
		expect(commands.at(-1)).toEqual(
			expect.arrayContaining(['test', '--project=native', 'native-conversation-archive.spec.ts'])
		);
	});

	it('stops before Playwright when the browser build fails', async () => {
		vi.mocked(spawnSync).mockImplementation(
			(_command, args) =>
				({
					status: args?.includes('build:web-desktop') ? 23 : 0,
				}) as ReturnType<typeof spawnSync>
		);
		const exited = new Error('fixture build exit');
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw exited;
		});

		await expect(import('../../../scripts/native-e2e.mjs')).rejects.toBe(exited);
		expect(exit).toHaveBeenCalledWith(23);
		expect(vi.mocked(spawnSync).mock.calls.map(([, args]) => args)).toEqual([
			['run', 'build:main'],
			['run', 'build:renderer'],
			['run', 'build:web-desktop'],
		]);
	});
});
