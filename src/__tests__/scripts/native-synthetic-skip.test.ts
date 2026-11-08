import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { test } from '@playwright/test';
import { NativeApp } from '../../../e2e/fixtures/native-app';

// Collect declarations only; no fixture, Electron or provider may start here.
vi.mock('@playwright/test', () => ({
	test: Object.assign(vi.fn(), { skip: vi.fn(), setTimeout: vi.fn() }),
	expect: vi.fn(),
}));
vi.mock('../../../e2e/fixtures/native-app', () => ({ NativeApp: vi.fn() }));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

it.each([
	['native-sidebar-search', 5],
	['native-conversation-archive', 3],
	['native-commands', 1],
] as const)(
	'%s skips synthetic scenarios in real mode and collects them in synthetic mode',
	async (file, count) => {
		for (const real of [true, false]) {
			vi.resetModules();
			vi.clearAllMocks();
			vi.stubEnv('MAESTRO_E2E_REAL', real ? '1' : '0');
			await import(`../../../e2e/${file}.spec.ts`);
			expect(test.skip).toHaveBeenCalledExactlyOnceWith(real, expect.any(String));
			expect(test).toHaveBeenCalledTimes(count);
			expect(NativeApp).not.toHaveBeenCalled();
		}
	}
);
