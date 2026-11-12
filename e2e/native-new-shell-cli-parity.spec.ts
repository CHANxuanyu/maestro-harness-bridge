import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { createTurn } from './fixtures/native/protocol.cjs';
import { createMockSession } from '../src/__tests__/helpers/mockSession';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';

test.setTimeout(180_000);
test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'CLI parity uses synthetic providers and temporary accounts only'
);

// eslint-disable-next-line no-empty-pattern
test('new shell CLI parity: search, tasks, settings, split, queue, refresh and immediate active read', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home);
	const cwd = fs.realpathSync(native.project);
	const phrase = 'The amber lighthouse remembers the CLI locator';
	const history = createTurn({
		provider: 'codex',
		configDir: native.codex,
		cwd,
		prompt: 'Find the archive',
	});
	// A progress message inside a folded turn must be expanded by open-hit.
	fs.appendFileSync(
		history.file,
		JSON.stringify({
			type: 'response_item',
			timestamp: new Date().toISOString(),
			payload: {
				type: 'message',
				role: 'assistant',
				channel: 'commentary',
				content: [{ type: 'output_text', text: phrase }],
			},
		}) + '\n'
	);
	history.finish('Archive ready');
	for (let index = 0; index < 310; index++)
		createTurn({
			provider: 'codex',
			configDir: native.codex,
			cwd,
			id: history.id,
			prompt: `Later ${index}`,
		}).finish(`Answer ${index}`);
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
	fs.writeFileSync(
		native.script,
		JSON.stringify({ scene: { answer: 'Forced queue item completed' } })
	);
	const first = createMockAITab({
		id: 'parity-first',
		name: 'Parity first',
		saveToHistory: false,
		newShellPanel: { tab: 'tasks', open: true },
		logs: [
			{
				id: 'tasks',
				source: 'tool',
				text: 'update_plan',
				timestamp: 1,
				metadata: {
					toolState: {
						status: 'completed',
						input: {
							plan: [
								{ step: 'Read the panel', status: 'completed' },
								{ step: 'Verify CLI parity', status: 'in_progress' },
							],
						},
					},
				},
			},
		],
	});
	const second = createMockAITab({
		id: 'parity-second',
		name: 'Parity second',
		saveToHistory: false,
		// The inline queued card lives in the transcript; an empty conversation
		// shows the tool picker and only the queue indicator instead.
		logs: [
			{ id: 'parity-second-user', timestamp: 1, source: 'user', text: 'Earlier parity request' },
			{ id: 'parity-second-ai', timestamp: 2, source: 'stdout', text: 'Earlier parity answer' },
		],
	});
	const owner = createMockSession({
		id: 'parity-owner',
		name: 'Parity project',
		toolType: 'codex',
		cwd,
		fullPath: cwd,
		projectRoot: cwd,
		customPath: path.resolve('e2e/fixtures/native/codex'),
		customEnvVars: {
			CODEX_HOME: native.codex,
			CLAUDE_CONFIG_DIR: native.claude,
			MAESTRO_NATIVE_SCRIPT: native.script,
		},
		aiTabs: [first, second],
		activeTabId: first.id,
		unifiedTabOrder: [first, second].map((tab) => ({ type: 'ai' as const, id: tab.id })),
		executionQueue: [
			{
				id: 'parity-queued',
				tabId: second.id,
				type: 'message',
				text: 'Run the held parity item',
				timestamp: 1,
				paused: true,
			},
		],
	});
	fs.writeFileSync(
		path.join(native.data, 'maestro-sessions.json'),
		JSON.stringify({ sessions: [owner] })
	);
	let failed = false;
	try {
		await native.start(home);
		const win = await native.app.browserWindow(native.page);
		await win.evaluate((window) => window.setContentSize(1800, 960));
		await native.cli('tab', 'select', first.id);
		await test.step('tasks snapshot matches the rendered list and empty state', async () => {
			await native.cli('tab', 'panel', first.id, 'tasks');
			const snapshot = await native.cli('tab', 'tasks', first.id);
			expect(snapshot.empty).toBe(false);
			const panel = native.page.getByTestId('tasks-panel');
			await expect(panel.locator('li > span:last-child')).toHaveText(
				snapshot.list.tasks.map((task: { content: string }) => task.content)
			);
			await expect(panel.getByTestId('tasks-progress')).toHaveText(
				`${snapshot.list.completed} / ${snapshot.list.tasks.length} completed`
			);
			const labels = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' };
			for (const [index, task] of snapshot.list.tasks.entries())
				await expect(panel.locator('li > span[aria-label]').nth(index)).toHaveAttribute(
					'aria-label',
					labels[task.status as keyof typeof labels]
				);
			await native.cli('tab', 'select', second.id);
			await native.cli('tab', 'panel', second.id, 'tasks');
			const empty = await native.cli('tab', 'tasks', second.id);
			expect(empty.empty).toBe(true);
			expect(empty.list).toBeNull();
			await expect(native.page.getByTestId('tasks-empty')).toHaveText(empty.emptyText);
		});
		await test.step('switch then immediately read without a persistence wait', async () => {
			await native.page.locator(`[data-conversation-key$=":${first.id}"] [data-tree-nav]`).click();
			const listed = await native.cli('session', 'list');
			expect(listed.sessions.find((tab: { current?: boolean }) => tab.current).tabId).toBe(
				first.id
			);
			expect((await native.cli('tab', 'show', 'active')).tab.tabId).toBe(first.id);
		});
		await test.step('sidebar query and native hit locate, backfill, expand and flash', async () => {
			expect((await native.cli('ui', 'sidebar-search', phrase)).query).toBe(phrase);
			await expect(
				native.page.getByPlaceholder('Search conversations...', { exact: true })
			).toHaveValue(phrase);
			await expect(native.page.locator('[data-content-hit]')).toHaveCount(1);
			const hit = (await native.cli('native-history', 'search', phrase, '--project', cwd)).result
				.hits[0];
			const opened = await native.cli(
				'native-history',
				'open-hit',
				owner.id,
				history.id,
				'--message',
				JSON.stringify(hit.message)
			);
			expect(opened.tabId).toBeTruthy();
			const flashed = native
				.output()
				.locator('[data-log-id].jump-flash')
				.filter({ hasText: phrase });
			await expect(flashed).toBeInViewport();
			await expect(flashed).not.toHaveAttribute('data-feed-row', 'turn-activity');
			await native.cli('ui', 'sidebar-search', '--clear');
			await expect(
				native.page.getByPlaceholder('Search conversations...', { exact: true })
			).toHaveValue('');
			createTurn({
				provider: 'codex',
				configDir: native.codex,
				cwd,
				id: history.id,
				prompt: 'External refresh',
			}).finish('Native refresh reached the transcript');
			const refreshed = await native.cli('tab', 'refresh', opened.tabId);
			expect(['updated', 'unchanged']).toContain(refreshed.status);
			await expect(
				native.output().getByText('Native refresh reached the transcript', { exact: true })
			).toBeVisible();
		});
		await test.step('project settings open and close', async () => {
			await native.cli('open', 'project-settings', '--path', cwd);
			await expect(
				native.page.getByRole('dialog', { name: 'Project settings', exact: true })
			).toBeVisible();
			await native.cli('open', 'project-settings', '--close');
			await expect(
				native.page.getByRole('dialog', { name: 'Project settings', exact: true })
			).toHaveCount(0);
		});
		await test.step('one command creates a conversation in the right split pane', async () => {
			await native.cli('tab', 'select', first.id);
			const created = await native.cli(
				'tab',
				'new',
				'--agent',
				owner.id,
				'--split',
				'--ratio',
				'0.6'
			);
			await expect(native.page.getByTestId('new-shell-split-pane')).toHaveCount(2);
			await expect(
				native.page.locator(`[data-testid="new-shell-split-pane"][data-tab-id="${created.tabId}"]`)
			).toBeVisible();
			await native.cli('tab', 'unsplit', '--agent', owner.id);
		});
		await test.step('force send consumes and runs the held queue item', async () => {
			await native.cli('tab', 'select', second.id);
			await expect(
				native.page.getByRole('button', { name: 'Force Send', exact: true })
			).toBeVisible();
			const sent = await native.cli('queue', 'force-send', 'parity-queued');
			expect(sent.itemId).toBe('parity-queued');
			await native.cli('tab', 'select', second.id);
			await expect(
				native.output().getByText('Forced queue item completed', { exact: true })
			).toBeVisible();
			await expect(
				native.page.getByRole('button', { name: 'Force Send', exact: true })
			).toHaveCount(0);
		});
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
	}
});
