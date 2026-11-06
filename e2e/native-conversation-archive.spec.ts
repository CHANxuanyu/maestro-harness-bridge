import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { appendTurn } from './fixtures/native/append-turn.cjs';
import { createMockAITab } from '../src/__tests__/helpers/mockTab';
import { createMockSession } from '../src/__tests__/helpers/mockSession';

// This scenario never reads real credentials or sends a model request.
if (process.env.MAESTRO_E2E_REAL === '1')
	throw new Error('Run archive acceptance with synthetic providers only');
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
		await row().locator('[data-tree-nav]').click({ button: 'right' });
		await native.page.getByRole('menuitem', { name: /^Archive/ }).click();
		await expect(row()).toHaveCount(0);
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
		await native.page.getByRole('button', { name: 'Archived 1', exact: true }).click();
		await native.page.getByRole('button', { name: 'Unarchive', exact: true }).click();
		await expect(row()).toBeVisible();
		await expect(native.page.getByRole('button', { name: 'Archived 1', exact: true })).toHaveCount(
			0
		);
		expect(fs.readFileSync(archived.file)).toEqual(before);
		await native.cli('native-history', 'archive', owner, archived.id);
		await expect(row()).toHaveCount(0);
		await native.cli('native-history', 'unarchive', owner, archived.id);
		await expect(row()).toBeVisible();
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
		await expect(native.page.getByTitle(/^Toggle Read-Only mode/)).toHaveText('Read-Only');
		const shown = await native.cli('tab', 'show', created.tabId, '--agent', owner.id);
		expect(shown.tab).toMatchObject({ permissionMode: 'readonly', readOnly: true });
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
test('subdirectory archives stay reachable in the browser after refresh and live changes', async ({}, info) => {
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
		await expect(row()).toBeVisible();
		// Archive history directly, without opening a tab or creating a subdirectory runner.
		await row().locator('[data-tree-nav]').click({ button: 'right' });
		await native.page.getByRole('menuitem', { name: /^Archive/ }).click();
		await expect(row()).toHaveCount(0);
		await expect(
			native.page.getByRole('button', { name: 'Archived 1', exact: true })
		).toBeVisible();
		await native.restart(home);
		const url = new URL(await native.page.evaluate(() => window.maestro.webserver.getUrl()));
		url.hostname = '127.0.0.1';
		const opened = native.app!.waitForEvent('window');
		await native.app!.evaluate(({ BrowserWindow }, href) => {
			const window = new BrowserWindow({
				webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
			});
			void window.loadURL(href);
		}, url.href);
		const web = await opened;
		const archived = web.getByRole('button', { name: 'Archived 1', exact: true });
		await expect(archived).toBeVisible();
		await web.reload();
		await expect(archived).toBeVisible();
		await native.cli('native-history', 'unarchive', owner, turn.id);
		await expect(archived).toHaveCount(0);
		await expect(web.locator(`[data-native-session-id="${turn.id}"]`)).toBeVisible();
		await native.cli('native-history', 'archive', owner, turn.id);
		await expect(archived).toBeVisible();
		await archived.click();
		await web.getByRole('button', { name: 'Unarchive', exact: true }).click();
		await expect(archived).toHaveCount(0);
		await expect(row()).toBeVisible();
		expect(fs.readFileSync(turn.file)).toEqual(before);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (native.app) await native.close(failed);
	}
});
