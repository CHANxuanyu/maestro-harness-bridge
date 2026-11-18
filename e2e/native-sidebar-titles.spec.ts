import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createTurn } from './fixtures/native/protocol.cjs';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';

// PRD 4.4 D6: 264px, eight conversations in one worktree, distinct plain titles.
test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Sidebar titles use synthetic history only');
test.setTimeout(120_000);

// eslint-disable-next-line no-empty-pattern
test('D6: eight worktree conversations retain distinct titles at 264px', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home);
	const git = (...args: string[]) =>
		execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
			cwd: native.project,
			env: {
				...process.env,
				HOME: home,
				USERPROFILE: home,
				GIT_CONFIG_NOSYSTEM: '1',
				GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
			},
			encoding: 'utf8',
		});
	git('init', '-b', 'main');
	git('config', 'user.name', 'Synthetic sidebar');
	git('config', 'user.email', 'sidebar@example.invalid');
	git('config', 'commit.gpgsign', 'false');
	git('commit', '--allow-empty', '-m', 'Synthetic baseline');
	const branch = 'feature/sidebar-long-shared-worktree-branch';
	const worktree = path.join(native.root, 'worktree');
	git('worktree', 'add', '-b', branch, worktree);
	const cwd = fs.realpathSync(worktree);
	const tabs = Array.from({ length: 8 }, (_, index) => {
		const name =
			'# 修复 `草稿` ' + '关闭窗口时保存最后一条消息'.repeat(4) + ' **情况' + index + '**';
		const turn = createTurn({ provider: 'codex', configDir: native.codex, cwd, prompt: name });
		turn.finish('Synthetic answer');
		return createMockAITab({
			id: `title-${index}`,
			name,
			agentSessionId: turn.id,
			createdAt: index + 1,
			logs: [{ id: `question-${index}`, source: 'user', text: name, timestamp: index + 1 }],
		});
	});
	const session = createMockSession({
		id: 'sidebar-owner',
		name: 'Synthetic project',
		toolType: 'codex',
		cwd,
		fullPath: cwd,
		projectRoot: fs.realpathSync(native.project),
		worktreeBranch: branch,
		isGitRepo: true,
		customPath: path.resolve('e2e/fixtures/native/codex'),
		customEnvVars: { CODEX_HOME: native.codex },
		aiTabs: tabs,
		activeTabId: tabs[0].id,
		unifiedTabOrder: tabs.map((tab) => ({ type: 'ai', id: tab.id })),
	});
	fs.writeFileSync(
		path.join(native.data, 'maestro-sessions.json'),
		JSON.stringify({ sessions: [session] })
	);
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			leftSidebarWidth: 264,
			defaultSaveToHistory: false,
			crashReportingEnabled: false,
		})
	);
	let failed = false;
	try {
		await native.start(home);
		const sidebar = native.page.locator('[data-panel="left"]');
		await expect(sidebar).toHaveCSS('width', '264px');
		const titles = sidebar.locator('[data-conversation-title]');
		await expect(titles).toHaveCount(8);
		await expect.poll(async () => new Set(await titles.allTextContents()).size).toBe(8);
		for (const tab of tabs) {
			const row = sidebar.locator(`[data-conversation-key="sidebar-owner:${tab.id}"]`);
			const title = row.locator('[data-conversation-title]');
			const canonical = await title.getAttribute('data-conversation-title');
			expect(canonical).not.toMatch(/[#`*]/);
			// A unique DOM string is insufficient if CSS clips its distinguishing tail.
			expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
				true
			);
			await expect(title).toHaveAttribute('title', canonical!);
			const marker = row.locator('[data-worktree]');
			await expect(marker).toHaveCount(1);
			await expect(marker).toHaveText('');
			await expect(marker).toHaveAttribute('title', new RegExp(branch));
			await row.locator(':scope > div > button[data-tree-nav]').last().click();
			await expect(native.page.getByTestId('header-conversation-title')).toHaveText(canonical!);
		}
		const branchLabel = native.page.locator('.new-shell-branch-text');
		await expect(branchLabel).toHaveText(branch);
		await expect(branchLabel.locator('..')).toHaveAttribute('title', branch);
		// Below the declared header breakpoint the branch becomes icon-only.
		await native.page.setViewportSize({ width: 740, height: 900 });
		await expect(branchLabel).toBeHidden();
		expect(fs.existsSync(path.join(native.codex, 'fixture-turn-count'))).toBe(false);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
	}
});
