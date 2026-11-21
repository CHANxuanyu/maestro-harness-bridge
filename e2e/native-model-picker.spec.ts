import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import fixture from '../src/__tests__/fixtures/model-catalog/codex.json';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'Synthetic catalog acceptance only');
test.describe.configure({ retries: 0 });

// eslint-disable-next-line no-empty-pattern
test('codex: D7 catalog additions, D8 remembered efforts, D9 keyboard and running Escape, D10 quota', async ({}, info) => {
	test.setTimeout(120_000);
	const native = new NativeApp(info, { providerCli: false });
	const settings = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settings,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settings, 'utf8')),
			newShell: true,
			defaultSaveToHistory: false,
		})
	);
	const catalogFile = path.join(native.codex, 'models_cache.json');
	const catalog = structuredClone(fixture);
	fs.writeFileSync(catalogFile, JSON.stringify(catalog));
	fs.writeFileSync(path.join(native.codex, 'config.toml'), 'model = "astra"\n');
	native.scriptTurns([{ answer: 'Synthetic running turn', waitForStop: true }]);
	// D10 reads the existing usage store only; nothing here triggers a network sample.
	const usageStore = path.join(native.data, 'codex-usage-snapshots.json');
	const writeQuotaSample = (ageMs: number) => {
		const now = Date.now();
		const codexHomeKey = path.resolve(native.codex);
		fs.writeFileSync(
			usageStore,
			JSON.stringify({
				snapshots: {
					[codexHomeKey]: {
						sampledAt: new Date(now - ageMs).toISOString(),
						codexHomeKey,
						authState: 'authenticated',
						session: { percent: 37, resetsAt: new Date(now + 3 * 3_600_000).toISOString() },
						weekly: { percent: 12, resetsAt: new Date(now + 5 * 86_400_000).toISOString() },
					},
				},
			})
		);
	};
	let failed = false;
	try {
		await native.start();
		await native.createAgent('codex');
		const page = native.page;
		const pill = page.getByTestId('model-effort-picker');
		const models = page.getByRole('listbox', { name: 'Models' });
		const levels = page.getByRole('listbox', { name: 'Reasoning' });
		const chord = process.platform === 'darwin' ? 'Alt+Meta+.' : 'Control+Alt+.';
		await pill.click();
		await expect(models.getByRole('option', { name: /Follow default.*Astra/ })).toBeVisible();
		// D10: no sample for this account, so the picker shows no quota row at all.
		await expect(page.getByTestId('model-picker-quota')).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(pill).toBeFocused();

		// D7: mutate only vendor fixture data after the first read, without a renderer change.
		catalog.models.push({
			...catalog.models[0],
			slug: 'future-fixture',
			display_name: 'Future Fixture',
			description: 'Added only to the synthetic vendor catalog',
			priority: 40,
		});
		fs.writeFileSync(catalogFile, JSON.stringify(catalog));
		fs.writeFileSync(path.join(native.codex, 'config.toml'), 'model = "sol"\n');
		writeQuotaSample(60_000);
		await pill.click();
		await expect(models.getByRole('option', { name: /Future Fixture/ })).toContainText(
			'Added only to the synthetic vendor catalog'
		);
		await expect(models.getByRole('option', { name: /Follow default.*Sol/ })).toBeVisible();
		// D10: a fresh sample shows what remains of each window, with no stale note.
		const quota = page.getByTestId('model-picker-quota');
		await expect(quota).toContainText('Session: 63% remaining');
		await expect(quota).toContainText('Weekly: 88% remaining');
		await expect(quota).not.toContainText('Last available sample');

		await models.getByRole('option', { name: /^Astra/ }).click();
		await levels.getByRole('option', { name: /^Ultra/ }).click();
		await expect(pill).toContainText('Ultra');
		// D10: past the 24-hour TTL the last sample is still shown, marked as such.
		writeQuotaSample(25 * 3_600_000);
		await pill.click();
		await expect(quota).toContainText('Last available sample');
		await expect(quota).toContainText('Session: 63% remaining');
		await models.getByRole('option', { name: /^Sol/ }).click();
		await page.getByRole('button', { name: 'Apply', exact: true }).click();
		await pill.click();
		await models.getByRole('option', { name: /^Astra/ }).click();
		await expect(levels.getByRole('option', { name: /^Ultra/ })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await page.getByRole('button', { name: 'Apply', exact: true }).click();
		await native.restart();
		await expect(native.page.getByTestId('model-effort-picker')).toContainText('Ultra');

		// D9: chord, Down (Luna), Right, Down (Extra High), Enter = five presses.
		await native.input().focus();
		await native.page.keyboard.press(chord);
		await expect(native.page.getByRole('combobox')).toBeFocused();
		for (const key of ['ArrowDown', 'ArrowRight', 'ArrowDown', 'Enter'])
			await native.page.keyboard.press(key);
		await expect(native.page.getByTestId('model-effort-picker')).toContainText('GPT-6-Luna');
		await expect(native.page.getByTestId('model-effort-picker')).toContainText('Extra High');
		await expect(native.input()).toBeFocused();

		await native.send('Keep the synthetic turn running');
		await expect(native.page.getByTestId('stop-turn-button')).toBeVisible();
		await native.input().focus();
		await native.page.keyboard.press(chord);
		await expect(
			native.page.getByText('Changes apply to the next turn. The running turn stays unchanged.')
		).toBeVisible();
		await native.page.keyboard.press('Escape');
		await expect(native.page.getByTestId('model-effort-popover')).toHaveCount(0);
		await expect(native.page.getByTestId('stop-turn-button')).toBeVisible();
		await expect(native.input()).toBeFocused();
		await native.page.getByTestId('stop-turn-button').click();
		await expect(native.page.getByTestId('stop-turn-button')).toHaveCount(0);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		try {
			if (native.app) await native.close(failed);
		} finally {
			fs.rmSync(native.root, { recursive: true, force: true });
		}
	}
});
