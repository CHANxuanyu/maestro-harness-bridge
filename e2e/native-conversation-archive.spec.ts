import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { appendTurn } from './fixtures/native/append-turn.cjs';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import { createMockSession } from '../src/__tests__/helpers/mockSession';

// This scenario never reads real credentials or sends a model request.
test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Archive acceptance uses synthetic providers only');
test.setTimeout(120_000);

// eslint-disable-next-line no-empty-pattern
test('archive conversation, restart and unarchive without changing native history', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			defaultSaveToHistory: false,
		})
	);
	const archived = await native.externalTurn('codex', 'Archive this conversation', {
		answer: 'Synthetic archive answer',
	});
	const kept = await native.externalTurn('codex', 'Keep this conversation', {
		answer: 'Synthetic kept answer',
	});
	const before = fs.readFileSync(archived.file);
	let failed = false;
	try {
		await native.start(home);
		const owner = await native.createAgent('codex');
		const row = () => native.page.locator(`[data-native-session-id="${archived.id}"]`);
		await expect(row()).toBeVisible();
		await row().locator('[data-tree-nav]').click();
		await native.page.locator(`[data-native-session-id="${kept.id}"] [data-tree-nav]`).click();
		const search = native.page.getByPlaceholder('Search conversations...', { exact: true });
		await search.fill('Archive this conversation');
		await expect(native.page.locator('[data-content-hit]')).toHaveCount(1);
		expect(
			(await native.cli('native-history', 'search', 'Archive this conversation')).result.hits
		).toHaveLength(1);
		await row().locator('[data-tree-nav]').click({ button: 'right' });
		await native.page.getByRole('menuitem', { name: /^Archive/ }).click();
		await expect(row()).toHaveCount(0);
		await expect(native.page.locator('[data-content-hit]')).toHaveCount(0);
		expect(
			(await native.cli('native-history', 'search', 'Archive this conversation')).result.hits
		).toEqual([]);
		await search.clear();
		await expect(
			native.page.getByRole('button', { name: 'Archived 1', exact: true })
		).toBeVisible();
		expect(fs.readFileSync(archived.file)).toEqual(before);
		const listed = await native.cli('native-history', 'list', '--archived');
		expect(
			listed.result.conversations.map(
				(record: { nativeSessionId: string }) => record.nativeSessionId
			)
		).toContain(archived.id);
		await native.restart(home);
		await expect(row()).toHaveCount(0);
		const reopenedSearch = native.page.getByPlaceholder('Search conversations...', { exact: true });
		await reopenedSearch.fill('Archive this conversation');
		await expect(native.page.locator('[data-content-hit]')).toHaveCount(0);
		// Search replaces the project list, so the archived row returns with the list.
		await reopenedSearch.fill('');
		await native.page.getByRole('button', { name: 'Archived 1', exact: true }).click();
		await native.page.getByRole('button', { name: 'Unarchive', exact: true }).click();
		await expect(row()).toBeVisible();
		await expect(native.page.locator('[data-content-hit]')).toHaveCount(1);
		expect(
			(await native.cli('native-history', 'search', 'Archive this conversation')).result.hits
		).toHaveLength(1);
		await expect(native.page.getByRole('button', { name: 'Archived 1', exact: true })).toHaveCount(
			0
		);
		expect(fs.readFileSync(archived.file)).toEqual(before);
		await native.cli('native-history', 'archive', owner, archived.id);
		await expect(row()).toHaveCount(0);
		await expect(native.page.locator('[data-content-hit]')).toHaveCount(0);
		await native.cli('native-history', 'unarchive', owner, archived.id);
		await expect(row()).toBeVisible();
		await expect(native.page.locator('[data-content-hit]')).toHaveCount(1);
		await expect(reopenedSearch).toHaveValue('Archive this conversation');
		expect(fs.readFileSync(archived.file)).toEqual(before);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('unarchive without reopening retains readonly after another restart', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	fs.mkdirSync(home, { recursive: true });
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			defaultSaveToHistory: false,
		})
	);
	const turn = await native.externalTurn('codex', 'Readonly archive source', {
		answer: 'Synthetic answer',
	});
	const tab = createMockAITab({
		id: 'readonly-source',
		agentSessionId: turn.id,
		permissionMode: 'readonly',
		readOnlyMode: true,
		saveToHistory: false,
	});
	const owner = createMockSession({
		id: 'archive-owner',
		toolType: 'codex',
		cwd: native.project,
		projectRoot: native.project,
		customPath: path.resolve('e2e/fixtures/native/codex'),
		customEnvVars: { CODEX_HOME: native.codex, MAESTRO_NATIVE_SCRIPT: native.script },
		aiTabs: [tab],
		activeTabId: tab.id,
		unifiedTabOrder: [{ type: 'ai', id: tab.id }],
	});
	fs.writeFileSync(
		path.join(native.data, 'maestro-sessions.json'),
		JSON.stringify({ sessions: [owner] })
	);
	const before = fs.readFileSync(turn.file);
	let failed = false;
	try {
		await native.start(home);
		await native.cli('tab', 'archive', tab.id, '--agent', owner.id);
		await expect(
			native.page.getByRole('button', { name: 'Archived 1', exact: true })
		).toBeVisible();
		await native.restart(home);
		await native.page.getByRole('button', { name: 'Archived 1', exact: true }).click();
		await native.page.getByRole('button', { name: 'Unarchive', exact: true }).click();
		await expect(native.page.locator(`[data-native-session-id="${turn.id}"]`)).toBeVisible();
		// The restored history row stays unopened, including across this restart.
		await native.restart(home);
		const created = await native.cli('tab', 'new', '--agent', owner.id);
		expect(created.success).toBe(true);
		await expect(
			native.page.locator(`[data-conversation-key="${owner.id}:${created.tabId}"]`)
		).toBeVisible();
		await expect(native.page.getByTitle(/^Toggle Read-Only mode/)).toHaveText('Read-Only');
		// Creation is acknowledged before debounced persistence updates the CLI inventory.
		await expect
			.poll(async () => {
				try {
					return (await native.cli('tab', 'show', created.tabId, '--agent', owner.id)).tab?.tabId;
				} catch (error) {
					if (String(error).includes(`Tab not found: ${created.tabId}`)) return null;
					throw error;
				}
			})
			.toBe(created.tabId);
		const shown = await native.cli('tab', 'show', created.tabId, '--agent', owner.id);
		expect(shown.tab).toMatchObject({
			tabId: created.tabId,
			agentId: owner.id,
			permissionMode: 'readonly',
			readOnly: true,
		});
		expect((await native.cli('native-history', 'list', '--archived')).result.conversations).toEqual(
			[]
		);
		expect(fs.readFileSync(turn.file)).toEqual(before);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
	}
});

// eslint-disable-next-line no-empty-pattern
test('subdirectory archives stay reachable on desktop across restarts', async ({}, info) => {
	const native = new NativeApp(info, { providerCli: false });
	const home = path.join(native.root, 'home');
	const cwd = path.join(native.project, 'packages', 'api');
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(cwd, { recursive: true });
	const settingsFile = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settingsFile,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			newShell: true,
			defaultSaveToHistory: false,
		})
	);
	const turn = appendTurn(
		{ provider: 'codex', configDir: native.codex, cwd, prompt: 'Subdirectory archive' },
		{ answer: 'Synthetic subdirectory answer' }
	);
	const before = fs.readFileSync(turn.file);
	let failed = false;
	try {
		await native.start(home);
		const owner = await native.createAgent('codex');
		const row = () => native.page.locator(`[data-native-session-id="${turn.id}"]`);
		const archived = () => native.page.getByRole('button', { name: 'Archived 1', exact: true });
		await expect(row()).toBeVisible();
		// Archive history directly, without opening a tab or creating a subdirectory runner.
		await row().locator('[data-tree-nav]').click({ button: 'right' });
		await native.page.getByRole('menuitem', { name: /^Archive/ }).click();
		await expect(row()).toHaveCount(0);
		await expect(archived()).toBeVisible();
		expect(fs.readFileSync(turn.file)).toEqual(before);
		// Browser reads and subscriptions are covered by useRemoteIntegration.test.ts.
		await native.restart(home);
		await expect(row()).toHaveCount(0);
		await expect(archived()).toBeVisible();
		await archived().click();
		await native.page.getByRole('button', { name: 'Unarchive', exact: true }).click();
		await expect(archived()).toHaveCount(0);
		await expect(row()).toBeVisible();
		expect(fs.readFileSync(turn.file)).toEqual(before);
		await native.restart(home);
		await expect(archived()).toHaveCount(0);
		await expect(row()).toBeVisible();
		await native.cli('native-history', 'archive', owner, turn.id);
		await expect(archived()).toBeVisible();
		await expect(row()).toHaveCount(0);
		await native.cli('native-history', 'unarchive', owner, turn.id);
		await expect(archived()).toHaveCount(0);
		await expect(row()).toBeVisible();
		expect(fs.readFileSync(turn.file)).toEqual(before);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
	}
});
