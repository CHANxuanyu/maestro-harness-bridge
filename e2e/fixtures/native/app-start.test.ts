import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { TestInfo } from '@playwright/test';

const mocks = vi.hoisted(() => ({
	installedCli: vi.fn(),
	prepareCredentials: vi.fn(),
	launch: vi.fn(),
	visible: vi.fn(),
	projectStart: vi.fn(),
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

it('pins existing provider scenarios to an explicit classic choice', () => {
	native = new NativeApp({ title: 'synthetic existing scenario' } as TestInfo, {
		providerCli: false,
	});
	expect(
		JSON.parse(fs.readFileSync(path.join(native.data, 'maestro-settings.json'), 'utf8'))
	).toMatchObject({ newShell: false, newShellChoice: 'classic' });
});
beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv('MAESTRO_E2E_REAL', '1');
	const locator = { or: () => locator };
	mocks.projectStart.mockReturnValue(locator);
	const page = {
		waitForLoadState: vi.fn(),
		getByText: () => locator,
		getByRole: () => locator,
		getByTestId: mocks.projectStart,
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
		expect(mocks.projectStart).toHaveBeenCalledWith('project-start');
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

it('passes a test-only client PATH to Electron without changing the runner environment', async () => {
	vi.stubEnv('MAESTRO_E2E_REAL', '0');
	native = new NativeApp({ title: 'loopback SSH' } as TestInfo, { providerCli: false });
	const before = process.env.PATH;
	await native.start(undefined, { PATH: '/synthetic/ssh-client:/usr/bin:/bin' });
	expect(mocks.launch.mock.calls[0][2]).toMatchObject({
		PATH: '/synthetic/ssh-client:/usr/bin:/bin',
		HOME: native.syntheticHome,
		CLAUDE_CONFIG_DIR: native.claude,
		CODEX_HOME: native.codex,
	});
	expect(process.env.PATH).toBe(before);
	expect(mocks.prepareCredentials).not.toHaveBeenCalled();
});

it.each([undefined, '/synthetic/existing-codex-home'])(
	'login diagnostics inherit CODEX_HOME (%s) without preparing an account',
	async (codexHome) => {
		vi.stubEnv('CODEX_HOME', codexHome);
		native = new NativeApp({ title: 'codex plan login' } as TestInfo, {
			providerCli: false,
			inheritCodexHome: true,
		});
		await native.start();
		const overrides = mocks.launch.mock.calls[0][2];
		expect(overrides).not.toHaveProperty('CODEX_HOME');
		expect(overrides).not.toHaveProperty('HOME');
		expect(overrides).not.toHaveProperty('CODEX_API_KEY');
		expect(overrides).not.toHaveProperty('OPENAI_API_KEY');
		expect(process.env.CODEX_HOME).toBe(codexHome);
		expect(mocks.prepareCredentials).not.toHaveBeenCalled();
		expect(mocks.installedCli).not.toHaveBeenCalled();
	}
);
