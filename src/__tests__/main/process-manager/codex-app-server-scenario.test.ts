// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

const { createNativeTempDir } = require('../../../../e2e/fixtures/native/temp-root.cjs');
const scenario = vi.hoisted(() => ({
	run: undefined as ((fixtures: object, info: object) => Promise<void>) | undefined,
	root: '',
	start: vi.fn(),
	close: vi.fn(),
}));

vi.mock('@playwright/test', () => ({
	test: Object.assign(
		(_name: string, run: typeof scenario.run) => {
			scenario.run = run;
		},
		{ setTimeout: vi.fn(), skip: vi.fn() }
	),
	expect,
}));
vi.mock('../../../../e2e/fixtures/native-app', () => ({
	NativeApp: class {
		root = scenario.root;
		data = scenario.root;
		app = {};
		start = scenario.start;
		close = scenario.close;
	},
}));

it('preserves an earlier scenario failure when Playwright still reports passed inside finally', async () => {
	scenario.root = createNativeTempDir('maestro-u4-scenario-');
	fs.writeFileSync(path.join(scenario.root, 'maestro-settings.json'), '{}');
	const original = new Error('Initial approval locator timed out');
	scenario.start.mockRejectedValueOnce(original);
	scenario.close.mockImplementation(async (failed: boolean) => {
		if (!failed) throw new Error('stop-turn-button: Expected 0, Received 1');
	});
	try {
		await import('../../../../e2e/native-codex-app-server.spec');
		await expect(scenario.run!({}, { status: 'passed', expectedStatus: 'passed' })).rejects.toBe(
			original
		);
		expect(scenario.close).toHaveBeenCalledExactlyOnceWith(true);
	} finally {
		fs.rmSync(scenario.root, { recursive: true, force: true });
	}
});
