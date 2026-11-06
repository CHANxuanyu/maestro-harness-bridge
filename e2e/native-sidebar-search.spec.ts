import fs from 'node:fs';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createTurn } from './fixtures/native/protocol.cjs';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';

for (const provider of ['claude', 'codex'] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`${provider}: sidebar content search opens an older message and flashes it`, async ({}, info) => {
		if (process.env.MAESTRO_E2E_REAL === '1')
			throw new Error('This scenario requires synthetic history');
		const native = new NativeApp(info, { providerCli: false });
		const home = path.join(native.root, 'home');
		fs.mkdirSync(home);
		const cwd = fs.realpathSync(native.project);
		const account = provider === 'claude' ? native.claude : native.codex;
		const phrase = 'The amber lighthouse remembers this sentence';
		const initial = createTurn({
			provider,
			configDir: account,
			cwd,
			prompt: 'Archive conversation',
		});
		initial.finish(phrase);
		for (let index = 0; index < 310; index++) {
			createTurn({
				provider,
				configDir: account,
				cwd,
				id: initial.id,
				prompt: `Later question ${index}`,
			}).finish(`Later answer ${index}`);
		}
		let file = initial.file;
		if (provider === 'codex') {
			const archive = path.join(account, 'archived_sessions');
			fs.mkdirSync(archive, { recursive: true });
			file = path.join(archive, path.basename(file) + '.zst');
			fs.writeFileSync(file, zstdCompressSync(fs.readFileSync(initial.file)));
			fs.unlinkSync(initial.file);
		}
		const original = fs.readFileSync(file);
		const settingsFile = path.join(native.data, 'maestro-settings.json');
		fs.writeFileSync(
			settingsFile,
			JSON.stringify({
				...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
				newShell: true,
				defaultSaveToHistory: false,
				crashReportingEnabled: false,
			})
		);
		const toolType = provider === 'claude' ? 'claude-code' : 'codex';
		const env: Record<string, string> =
			provider === 'claude' ? { CLAUDE_CONFIG_DIR: account } : { CODEX_HOME: account };
		const session = createMockSession({
			id: 'search-owner',
			name: 'Search project',
			toolType,
			cwd,
			projectRoot: cwd,
			customPath: path.resolve(`e2e/fixtures/native/${provider}`),
			customEnvVars: env,
			aiTabs: [createMockAITab({ id: 'blank', saveToHistory: false })],
			activeTabId: 'blank',
			unifiedTabOrder: [{ type: 'ai', id: 'blank' }],
		});
		fs.writeFileSync(
			path.join(native.data, 'maestro-sessions.json'),
			JSON.stringify({ sessions: [session] })
		);
		let failed = false;
		try {
			await native.start(home);
			const input = native.page.getByPlaceholder('Search conversations...', { exact: true });
			await input.fill(phrase);
			const section = native.page.getByRole('region', {
				name: 'Conversation content',
				exact: true,
			});
			const row = section.locator('[data-content-hit]');
			await expect(row).toHaveCount(1);
			await expect(row.locator('mark')).toHaveText(phrase);
			const cli = await native.cli('native-history', 'search', phrase, '--project', cwd);
			expect(cli.result.hits).toHaveLength(1);
			expect(cli.result.hits[0].conversation.nativeSessionId).toBe(initial.id);
			await row.click();
			const flashed = native
				.output()
				.locator('[data-log-id].jump-flash')
				.filter({ hasText: phrase });
			await expect(flashed).toBeVisible();
			await expect(flashed).toBeInViewport();
			await expect(native.output().getByText(phrase, { exact: true })).toBeInViewport();
			await expect(native.output().locator('.jump-flash')).toHaveCount(0);
			await input.focus();
			await input.press('Escape');
			await expect(input).toHaveValue('');
			await expect(section).toHaveCount(0);
			await input.fill(phrase);
			await expect(row).toHaveCount(1);
			await input.press('ArrowUp');
			await expect(row).toBeFocused();
			await row.press('Enter');
			await expect(
				native.output().locator('[data-log-id].jump-flash').filter({ hasText: phrase })
			).toBeInViewport();
			expect(fs.readFileSync(file)).toEqual(original);
			expect(fs.existsSync(path.join(account, 'fixture-turn-count'))).toBe(false);
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			if (native.app) await native.close(failed);
		}
	});
}
