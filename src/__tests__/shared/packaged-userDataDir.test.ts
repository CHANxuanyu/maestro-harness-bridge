import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resolveUserDataDir, assertUserDataDirProduct } from '../../shared/userDataDir';
let root: string;
const product = { productName: 'Maestro I18n', productId: 'com.maestro.i18n.local' };
beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-product-'));
});
afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});
it('resolves the packaged product name from metadata beside the shipped CLI', () => {
	const resources = path.join(root, 'renamed-bundle', 'Contents', 'Resources');
	fs.mkdirSync(resources, { recursive: true });
	fs.writeFileSync(path.join(resources, 'maestro-product.json'), JSON.stringify(product));
	expect(
		resolveUserDataDir({
			env: {},
			platform: 'darwin',
			homedir: root,
			isPackaged: true,
			runtimeDir: resources,
		})
	).toBe(path.join(root, 'Library', 'Application Support', 'Maestro I18n'));
});
it('refuses a foreign product folder even when explicitly selected', () => {
	fs.writeFileSync(
		path.join(root, 'maestro-product.json'),
		JSON.stringify({ productName: 'Maestro', productId: 'com.maestro.app' })
	);
	expect(() => resolveUserDataDir({ env: { MAESTRO_USER_DATA: root }, product })).toThrow(
		'different product'
	);
});
it('refuses an unmarked upstream settings folder and accepts an existing fork marker', () => {
	fs.writeFileSync(
		path.join(root, 'maestro-settings.json'),
		JSON.stringify({ activeThemeId: 'dracula' })
	);
	expect(() => assertUserDataDirProduct(root, product)).toThrow('Cannot verify');
	fs.writeFileSync(path.join(root, 'maestro-product.json'), JSON.stringify(product));
	expect(assertUserDataDirProduct(root, product)).toBe(root);
});
it('recognizes the legacy fork language marker without modifying its settings', () => {
	const settings = JSON.stringify({ uiLanguage: 'zh-CN', activeThemeId: 'clay-dark' });
	fs.writeFileSync(path.join(root, 'maestro-settings.json'), settings);
	expect(assertUserDataDirProduct(root, product)).toBe(root);
	expect(fs.readFileSync(path.join(root, 'maestro-settings.json'), 'utf8')).toBe(settings);
});
