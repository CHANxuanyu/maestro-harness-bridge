import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';

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
