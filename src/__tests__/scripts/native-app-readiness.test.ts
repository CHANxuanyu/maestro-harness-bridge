import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { TestInfo } from '@playwright/test';
import { NativeApp } from '../../../e2e/fixtures/native-app';
import { launchElectronApp } from '../../../e2e/fixtures/electron-app';
import { CATALOGS, translate } from '../../../src/renderer/i18n/translate';

vi.mock('@playwright/test', () => ({
	test: { extend: vi.fn() },
	expect: () => ({ toBeVisible: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('../../../e2e/fixtures/electron-app', () => ({ launchElectronApp: vi.fn() }));

afterEach(() => {
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});

it.each(['en', 'zh-CN'] as const)(
	'waits for native readiness using the saved %s catalog',
	async (locale) => {
		vi.stubEnv('MAESTRO_E2E_REAL', '0');
		const native = new NativeApp({ title: 'Team readiness' } as TestInfo, { providerCli: false });
		try {
			const settingsPath = path.join(native.data, 'maestro-settings.json');
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
			fs.writeFileSync(settingsPath, JSON.stringify({ ...settings, uiLanguage: locale }));
			const locator = { or: vi.fn().mockReturnThis() };
			const page = {
				waitForLoadState: vi.fn(),
				getByText: vi.fn().mockReturnValue(locator),
				getByRole: vi.fn().mockReturnValue(locator),
				getByPlaceholder: vi.fn().mockReturnValue(locator),
			};
			vi.mocked(launchElectronApp).mockResolvedValue({
				context: () => ({ tracing: { start: vi.fn() } }),
				firstWindow: async () => page,
			} as unknown as Awaited<ReturnType<typeof launchElectronApp>>);
			await native.start();
			expect(page.getByText).toHaveBeenCalledWith(
				CATALOGS[locale]['workflows.emptyState.createFirstAgent'],
				{ exact: true }
			);
			expect(page.getByRole).toHaveBeenCalledWith('button', {
				name: CATALOGS[locale]['workflows.projects.folder'],
				exact: true,
			});
			const placeholder = page.getByPlaceholder.mock.calls[0][0] as RegExp;
			expect(translate(locale, 'workflows.shell.messageProvider', { provider: 'Claude' })).toMatch(
				placeholder
			);
			expect(
				translate(locale, 'workflows.shell.talkingToValuePoweredByValue', {
					p0: 'Test seat',
					p1: 'Codex',
				})
			).toMatch(placeholder);
			expect('Unrelated placeholder').not.toMatch(placeholder);
			if (locale === 'zh-CN')
				expect(
					translate('en', 'workflows.shell.messageProvider', { provider: 'Claude' })
				).not.toMatch(placeholder);
		} finally {
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	}
);
