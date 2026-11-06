import fs from 'node:fs';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createTurn } from './fixtures/native/protocol.cjs';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import { embedSystemPromptInPrompt } from '../src/shared/embeddedSystemPrompt';

for (const [provider, scenario] of [
	['claude', 'older-answer'],
	['codex', 'older-answer'],
	['codex', 'wrapped-user'],
	['codex', 'folded-progress'],
	['codex', 'legacy-title'],
] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`${provider}: sidebar content search ${scenario} opens the visible body and flashes it`, async ({}, info) => {
		if (process.env.MAESTRO_E2E_REAL === '1')
			throw new Error('This scenario requires synthetic history');
		const native = new NativeApp(info, { providerCli: false });
		const home = path.join(native.root, 'home');
		fs.mkdirSync(home);
		const cwd =
			scenario === 'legacy-title'
				? path.join(native.root, 'unloaded-project')
				: fs.realpathSync(native.project);
		fs.mkdirSync(cwd, { recursive: true });
		const account = provider === 'claude' ? native.claude : native.codex;
		const phrase = 'The amber lighthouse remembers this sentence';
		const initial = createTurn({
			provider,
			configDir: account,
			cwd,
			prompt:
				scenario === 'wrapped-user'
					? embedSystemPromptInPrompt('# Maestro System Context', phrase)
					: 'Archive conversation',
		});
		if (scenario === 'folded-progress') {
			for (const text of ['Opening the archive', phrase])
				fs.appendFileSync(
					initial.file,
					JSON.stringify({
						type: 'response_item',
						timestamp: new Date().toISOString(),
						payload: {
							type: 'message',
							role: 'assistant',
							channel: 'commentary',
							content: [{ type: 'output_text', text }],
						},
					}) + '\n'
				);
		}
		initial.finish(
			scenario === 'wrapped-user' || scenario === 'folded-progress' ? 'Archive ready' : phrase
		);
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
		const nativeTitle = 'Named conversation from an unopened project';
		const titleIndex = path.join(account, 'session_index.jsonl');
		if (scenario === 'legacy-title') {
			const rows = fs
				.readFileSync(file, 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line));
			rows[0] = { id: initial.id, timestamp: rows[0].timestamp };
			rows.splice(
				1,
				0,
				{
					type: 'message',
					role: 'user',
					content: [
						{ type: 'input_text', text: '# AGENTS.md instructions\nSynthetic injected context' },
					],
				},
				{
					type: 'message',
					role: 'user',
					content: [
						{
							type: 'input_text',
							text: `<environment_context><cwd>${cwd}</cwd></environment_context>`,
						},
					],
				}
			);
			fs.writeFileSync(
				file,
				rows
					.map((entry) =>
						JSON.stringify(
							entry.type === 'response_item' && entry.payload?.type === 'message'
								? { ...entry.payload, timestamp: entry.timestamp }
								: entry
						)
					)
					.join('\n') + '\n'
			);
			fs.writeFileSync(
				titleIndex,
				JSON.stringify({ id: initial.id, thread_name: nativeTitle }) + '\n'
			);
		}
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
			cwd: fs.realpathSync(native.project),
			projectRoot: fs.realpathSync(native.project),
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
			if (scenario === 'legacy-title') await expect(row).toContainText(nativeTitle);
			const cli = await native.cli('native-history', 'search', phrase, '--project', cwd);
			expect(cli.result.hits).toHaveLength(1);
			expect(cli.result.hits[0].conversation.nativeSessionId).toBe(initial.id);
			if (scenario === 'legacy-title')
				expect(cli.result.hits[0].conversation.title).toBe(nativeTitle);
			const transcript = await native.cli('native-history', 'read', session.id, initial.id);
			expect(transcript.result.messages.length).toBeGreaterThan(500);
			expect(
				transcript.result.messages.some((message: { content: string }) =>
					message.content.includes(phrase)
				)
			).toBe(true);
			await row.click();
			const flashed = native
				.output()
				.locator('[data-log-id].jump-flash')
				.filter({ hasText: phrase });
			await expect(flashed).toBeVisible();
			await expect(flashed).toBeInViewport();
			await expect(flashed).not.toHaveAttribute('data-feed-row', 'turn-activity');
			await expect(native.output().getByText(phrase, { exact: true })).toBeInViewport();
			if (scenario === 'legacy-title') {
				// Wait for the opened tab to reach the CLI before resolving the active tab.
				await expect
					.poll(async () => (await native.cli('session', 'list')).sessions)
					.toContainEqual(
						expect.objectContaining({
							agentSessionId: initial.id,
							active: true,
						})
					);
				await expect
					.poll(async () => (await native.cli('tab', 'show', 'active')).tab)
					.toMatchObject({
						name: nativeTitle,
						agentSessionId: initial.id,
					});
			}
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
