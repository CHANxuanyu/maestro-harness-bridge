import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';

// Refuse real-provider mode before creating a fixture or reading any credentials.
test.beforeAll(() => {
	if (process.env.MAESTRO_E2E_REAL === '1')
		throw new Error('Tool output acceptance uses synthetic history only');
});

for (const provider of ['claude', 'codex'] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`${provider} full tool output is read on demand and never saved`, async ({}, info) => {
		const native = new NativeApp(info, { providerCli: false });
		const home = path.join(native.root, 'home');
		fs.mkdirSync(home, { recursive: true });
		const settings = path.join(native.data, 'maestro-settings.json');
		fs.writeFileSync(
			settings,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settings, 'utf8')),
				newShell: true,
				defaultSaveToHistory: false,
			})
		);
		const tail = `SYNTHETIC_${provider}_FINAL_ERROR`;
		const output = 'synthetic build output\n'.repeat(600) + tail;
		let failed = false;
		let closed = false;
		try {
			const seed = await native.externalTurn(provider, 'Synthetic full output history', {
				answer: 'Synthetic build finished.',
				tools: [{ id: 'full-output-call', command: 'synthetic build', output, status: 'failed' }],
			});
			await native.start(home);
			await native.createAgent(provider);
			await native.page
				.locator('[data-conversation-kind="history"] button[data-tree-nav]')
				.filter({ hasText: 'Synthetic full output history' })
				.click();
			await expect(native.output()).toContainText('Synthetic build finished.');
			await native
				.output()
				.locator('[data-feed-row="turn-activity"] button[aria-expanded="false"]')
				.click();
			await native
				.output()
				.getByRole('button', { name: /^Show details for/ })
				.click();
			await expect(native.output()).not.toContainText(tail);
			await native
				.output()
				.getByRole('button', { name: /^Show full output/ })
				.click();
			const full = native.page.getByTestId('native-tool-output');
			await expect(full).toContainText(tail);
			const cli = await native.cli('native-history', 'tool-output', seed.id, 'full-output-call');
			expect(cli.result.text).toContain(tail);
			await native.output().getByRole('button', { name: 'Hide full output' }).click();
			await expect(full).toHaveCount(0);
			await native.close();
			closed = true;
			const stored = fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8');
			expect(stored).not.toContain(tail);
			expect(stored).toContain('tool output truncated');
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (!closed && native.app) await native.close(failed);
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	});
}
