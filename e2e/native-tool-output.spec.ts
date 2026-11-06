import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { nativeIdentity } from './fixtures/native-real';
import { moveClaudeToolResultToChild } from './fixtures/native/tool-output';

// Refuse real-provider mode before creating a fixture or reading any credentials.
test.beforeAll(() => {
	if (process.env.MAESTRO_E2E_REAL === '1')
		throw new Error('Tool output acceptance uses synthetic history only');
});

for (const scenario of [
	{ provider: 'claude', mode: 'history' },
	{ provider: 'codex', mode: 'history' },
	{ provider: 'claude', mode: 'child' },
	{ provider: 'claude', mode: 'switch' },
	{ provider: 'codex', mode: 'live' },
] as const) {
	const { provider, mode } = scenario;
	// eslint-disable-next-line no-empty-pattern
	test(`${provider} ${mode} full tool output is read on demand and never saved`, async ({}, info) => {
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
			const scene = {
				answer: 'Synthetic build finished.',
				tools: [
					{
						id: 'full-output-call',
						itemId: 'item_7',
						command: 'synthetic build',
						output,
						status: 'failed' as const,
					},
				],
			};
			const seed =
				mode === 'live'
					? undefined
					: await native.externalTurn(provider, 'Synthetic full output history', scene);
			if (mode === 'live') native.scriptTurns([scene]);
			await native.start(home);
			const ownerId = await native.createAgent(provider);
			if (mode === 'live') {
				await native.send('Synthetic full output live turn');
			} else {
				await native.page
					.locator('[data-conversation-kind="history"] button[data-tree-nav]')
					.filter({ hasText: 'Synthetic full output history' })
					.click();
			}
			await expect(native.output()).toContainText('Synthetic build finished.');
			await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
			const file = await native.oneTranscript(provider);
			const nativeId = seed?.id ?? nativeIdentity(provider, file).id;
			if (!nativeId) throw new Error('Synthetic native identity missing');
			if (mode === 'child') {
				// Model a live child card whose result was saved only in its child JSONL.
				const childFile = moveClaudeToolResultToChild(file, nativeId, 'full-output-call');
				expect(fs.readFileSync(childFile, 'utf8')).toContain(tail);
				expect(fs.readFileSync(file, 'utf8')).not.toContain(tail);
			}
			if (mode === 'switch') {
				await native.cli('update-agent', ownerId, '--provider', 'codex', '--force');
				await native.cli(
					'update-agent',
					ownerId,
					'--custom-path',
					path.resolve('e2e/fixtures/native/codex'),
					'--env',
					`CODEX_HOME=${native.codex}`,
					'--env',
					`MAESTRO_NATIVE_SCRIPT=${native.script}`
				);
				native.scriptTurns([{ answer: 'Synthetic Codex continuation.' }]);
				await native.send('Continue in synthetic Codex');
				await expect(native.output()).toContainText('Synthetic Codex continuation.');
				await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
				await expect(native.output()).toContainText('Synthetic build finished.');
			}
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
			const cli = await native.cli('native-history', 'tool-output', nativeId, 'full-output-call');
			expect(cli.result.text).toContain(tail);
			await native.output().getByRole('button', { name: 'Hide full output' }).click();
			await expect(full).toHaveCount(0);
			await native.close();
			closed = true;
			const stored = fs.readFileSync(path.join(native.data, 'maestro-sessions.json'), 'utf8');
			expect(stored).not.toContain(tail);
			// A child conversation's tool rows live in its own transcript, not this session file.
			if (mode !== 'child') expect(stored).toContain('tool output truncated');
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (!closed && native.app) await native.close(failed);
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	});
}
