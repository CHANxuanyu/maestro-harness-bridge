import { expect, it, vi } from 'vitest';

const playwright = vi.hoisted(() => ({
	test: Object.assign(vi.fn(), { skip: vi.fn(), setTimeout: vi.fn() }),
}));
vi.mock('@playwright/test', () => ({ test: playwright.test, expect: vi.fn() }));
vi.mock('../../../e2e/fixtures/native-app', () => ({ NativeApp: vi.fn() }));

it('skips the synthetic subtasks file before any real-smoke scenario can run', async () => {
	vi.stubEnv('MAESTRO_E2E_REAL', '1');
	try {
		await import('../../../e2e/native-subtasks.spec');
		expect(playwright.test.skip).toHaveBeenCalledWith(true, expect.any(String));
		expect(playwright.test).toHaveBeenCalled();
	} finally {
		vi.unstubAllEnvs();
	}
});
