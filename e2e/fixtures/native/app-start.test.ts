import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import type { TestInfo } from '@playwright/test';

const mocks = vi.hoisted(() => ({
	installedCli: vi.fn(),
	prepareCredentials: vi.fn(),
	launch: vi.fn(),
	visible: vi.fn(),
}));
vi.mock('@playwright/test', async (original) => ({
	...(await original<typeof import('@playwright/test')>()),
	expect: () => ({ toBeVisible: mocks.visible }),
}));
vi.mock('./real-runtime.cjs', () => ({
	installedCli: mocks.installedCli,
	prepareCredentials: mocks.prepareCredentials,
}));
vi.mock('../electron-app', () => ({ launchElectronApp: mocks.launch }));
import { NativeApp } from '../native-app';

let native: NativeApp;
beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv('MAESTRO_E2E_REAL', '1');
	const locator = { or: () => locator };
	const page = {
		waitForLoadState: vi.fn(),
		getByText: () => locator,
		getByRole: () => locator,
		getByPlaceholder: vi.fn(),
	};
	mocks.launch.mockResolvedValue({
		context: () => ({ tracing: { start: vi.fn() } }),
		firstWindow: async () => page,
	});
	mocks.installedCli.mockReturnValue({
		executable: '/synthetic/codex',
		version: 'fixture-version',
	});
	mocks.prepareCredentials.mockReturnValue({ SYNTHETIC_CREDENTIAL: 'fixture-token' });
});
afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(native.root, { recursive: true, force: true });
});

it.each(['desktop identity startup', 'codex g: provider-free startup'])(
	'launches %s without CLI resolution or credentials on every start',
	async (title) => {
		native = new NativeApp({ title } as TestInfo, { providerCli: false });
		await native.start();
		await native.start('/synthetic/home');
		expect(mocks.launch).toHaveBeenCalledTimes(2);
		expect(mocks.launch.mock.calls[1][2].HOME).toBe('/synthetic/home');
		expect(mocks.installedCli).not.toHaveBeenCalled();
		expect(mocks.prepareCredentials).not.toHaveBeenCalled();
		expect(native.realCli).toBeUndefined();
		expect(mocks.visible).toHaveBeenCalledTimes(2);
	}
);

it('keeps title parsing and cached provider preparation for existing tests', async () => {
	const info = { title: 'codex g: shared startup', annotations: [] } as unknown as TestInfo;
	native = new NativeApp(info);
	await native.start();
	await native.start();
	expect(mocks.installedCli).toHaveBeenCalledExactlyOnceWith('codex', process.env, true);
	expect(mocks.prepareCredentials).toHaveBeenCalledExactlyOnceWith(
		'codex',
		native.codex,
		process.env
	);
	expect(info.annotations).toEqual([
		{ type: 'native-cli-version', description: 'fixture-version' },
	]);
	expect(mocks.launch.mock.calls[0][2].SYNTHETIC_CREDENTIAL).toBe('fixture-token');
});
