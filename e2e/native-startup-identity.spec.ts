import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/native-app';
import { launchElectronApp } from './fixtures/electron-app';

for (const scenario of ['torn settings', 'no language marker', 'foreign sidecar'] as const) {
	test(`desktop identity keeps startup available with ${scenario}`, async ({ native }) => {
		const sidecar = path.join(native.data, 'maestro-product.json');
		const settings = path.join(native.data, 'maestro-settings.json');
		const identity = fs.readFileSync(sidecar, 'utf8');
		await native.close();
		const torn = '{"uiLanguage":';
		const foreign = JSON.stringify({ productName: 'Other Maestro', productId: 'test.other' });
		if (scenario === 'foreign sidecar') fs.writeFileSync(sidecar, foreign);
		else {
			fs.unlinkSync(sidecar);
			if (scenario === 'torn settings') fs.writeFileSync(settings, torn);
			else {
				const value = JSON.parse(fs.readFileSync(settings, 'utf8'));
				delete value.uiLanguage;
				fs.writeFileSync(settings, JSON.stringify(value));
			}
		}
		const home = path.join(native.root, 'isolated-home');
		fs.mkdirSync(home);
		native.app = await launchElectronApp(path.resolve('dist/main/index.js'), native.data, {
			...native.env,
			HOME: home,
		});
		await native.app.context().tracing.start({ screenshots: true, snapshots: true });
		native.page = await native.app.firstWindow();
		await native.page.waitForLoadState('domcontentloaded');
		expect(await native.app.evaluate(({ app }) => app.isReady())).toBe(true);
		expect(
			await native.page.evaluate(() => window.maestro.settings.get('activeThemeId'))
		).toBeTruthy();
		await expect.poll(() => fs.existsSync(path.join(native.data, 'cli-server.json'))).toBe(true);
		expect(fs.readFileSync(sidecar, 'utf8')).toBe(
			scenario === 'foreign sidecar' ? foreign : identity
		);
		if (scenario === 'torn settings') {
			const quarantined = fs
				.readdirSync(native.data)
				.find((name) => name.startsWith('maestro-settings.corrupt-'));
			expect(quarantined).toBeTruthy();
			expect(fs.readFileSync(path.join(native.data, quarantined!), 'utf8')).toBe(torn);
		}
		if (scenario === 'foreign sidecar')
			// The fixture always appends --json, so use a verb that takes it and reads
			// the data folder; bare `list` fails on the option before the folder check.
			await expect(native.cli('list', 'agents')).rejects.toThrow(/different product/);
	});
}
