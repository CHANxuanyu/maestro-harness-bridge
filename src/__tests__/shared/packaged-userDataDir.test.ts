import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
	resolveUserDataDir,
	assertUserDataDirProduct,
	recordUserDataProduct,
} from '../../shared/userDataDir';
let root: string;
const product = { productName: 'Maestro I18n', productId: 'com.maestro.i18n.local' };
beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-product-'));
});
afterEach(() => {
	vi.unstubAllGlobals();
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

it.each(['{"uiLanguage":', '{"activeThemeId":"dracula"}'])(
	'desktop records its identity without validating legacy settings: %s',
	(settings) => {
		vi.stubGlobal('__MAESTRO_PRODUCT__', product);
		const settingsFile = path.join(root, 'maestro-settings.json');
		fs.writeFileSync(settingsFile, settings);
		expect(() => recordUserDataProduct(root)).not.toThrow();
		expect(JSON.parse(fs.readFileSync(path.join(root, 'maestro-product.json'), 'utf8'))).toEqual(
			product
		);
		expect(fs.readFileSync(settingsFile, 'utf8')).toBe(settings);
	}
);

it('desktop warns about a foreign sidecar and keeps starting while CLI still refuses it', () => {
	vi.stubGlobal('__MAESTRO_PRODUCT__', product);
	const file = path.join(root, 'maestro-product.json');
	const foreign = JSON.stringify({ productName: 'Maestro', productId: 'com.maestro.app' });
	fs.writeFileSync(file, foreign);
	const warning = vi.fn();
	expect(() => recordUserDataProduct(root, warning)).not.toThrow();
	expect(warning).toHaveBeenCalledWith(expect.stringContaining('different product'));
	expect(fs.readFileSync(file, 'utf8')).toBe(foreign);
	expect(() => resolveUserDataDir({ env: { MAESTRO_USER_DATA: root }, product })).toThrow(
		'different product'
	);
});

it('desktop contains sidecar I/O and warning reporter failures', () => {
	vi.stubGlobal('__MAESTRO_PRODUCT__', product);
	fs.mkdirSync(path.join(root, 'maestro-product.json'));
	const warning = vi.fn(() => {
		throw new Error('reporter unavailable');
	});
	expect(() => recordUserDataProduct(root, warning)).not.toThrow();
	expect(warning).toHaveBeenCalledOnce();
});

it('desktop shared services trust the folder Electron already chose with a foreign sidecar', () => {
	fs.writeFileSync(
		path.join(root, 'maestro-product.json'),
		JSON.stringify({ productName: 'Maestro', productId: 'com.maestro.app' })
	);
	vi.stubGlobal('process', {
		...process,
		versions: { ...process.versions, electron: '41.5.0' },
		type: 'browser',
	});
	expect(resolveUserDataDir({ env: { MAESTRO_USER_DATA: root }, product })).toBe(root);
	vi.stubGlobal('__MAESTRO_PRODUCT__', { productId: '' });
	expect(resolveUserDataDir({ env: { MAESTRO_USER_DATA: root } })).toBe(root);
});

it.each(['{"uiLanguage":', 'null'])(
	'CLI gives a clear cannot verify error for unreadable legacy settings: %s',
	(settings) => {
		fs.writeFileSync(path.join(root, 'maestro-settings.json'), settings);
		const resolve = () => resolveUserDataDir({ env: { MAESTRO_USER_DATA: root }, product });
		expect(resolve).toThrow(/^Cannot verify/);
		expect(resolve).not.toThrow(SyntaxError);
		expect(fs.readFileSync(path.join(root, 'maestro-settings.json'), 'utf8')).toBe(settings);
		expect(fs.existsSync(path.join(root, 'maestro-product.json'))).toBe(false);
	}
);
