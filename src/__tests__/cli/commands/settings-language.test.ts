import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { settingsSet } from '../../../cli/commands/settings-set';
import { settingsGet } from '../../../cli/commands/settings-get';
import { settingsReset } from '../../../cli/commands/settings-reset';
import { readSettingValue, writeSettingValue } from '../../../cli/services/storage';

describe('language settings CLI with isolated disk storage', () => {
	let directory: string;
	let file: string;
	let log: ReturnType<typeof vi.spyOn>;
	let errors: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'maestro-language-cli-'));
		file = path.join(directory, 'maestro-settings.json');
		vi.stubEnv('MAESTRO_USER_DATA', directory);
		writeFileSync(file, JSON.stringify({ fontSize: 18, customAICommands: [{ name: '自定义' }] }));
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('CLI exit');
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		rmSync(directory, { recursive: true, force: true });
	});

	it.each(['system', 'en', 'zh-CN'])(
		'sets and reads %s without changing unrelated settings',
		(value) => {
			settingsSet('uiLanguage', value, { json: true });
			expect(readSettingValue('uiLanguage')).toBe(value);
			settingsGet('uiLanguage', { json: true });
			expect(JSON.parse(log.mock.calls.at(-1)?.[0] as string)).toMatchObject({
				type: 'setting',
				key: 'uiLanguage',
				value,
				defaultValue: 'system',
			});
			expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
				fontSize: 18,
				customAICommands: [{ name: '自定义' }],
				uiLanguage: value,
			});
			expect(errors).not.toHaveBeenCalled();
		}
	);

	it('resets the language to the registered system default', () => {
		settingsSet('uiLanguage', 'zh-CN', { json: true });
		settingsReset('uiLanguage', { json: true });
		expect(JSON.parse(log.mock.calls.at(-1)?.[0] as string)).toMatchObject({
			type: 'setting_reset',
			key: 'uiLanguage',
			oldValue: 'zh-CN',
			defaultValue: 'system',
		});
		expect(readSettingValue('uiLanguage')).toBeUndefined();
		expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
			fontSize: 18,
			customAICommands: [{ name: '自定义' }],
		});
	});

	it.each(['fr', 'null', 'true', '1', '{}', '["en"]'])(
		'rejects invalid CLI language %s without touching disk',
		(value) => {
			const before = readFileSync(file, 'utf8');
			expect(() => settingsSet('uiLanguage', value, { json: true })).toThrow('CLI exit');
			expect(readFileSync(file, 'utf8')).toBe(before);
			expect(JSON.parse(errors.mock.calls.at(-1)?.[0] as string)).toMatchObject({
				error: 'uiLanguage must be one of: system, en, zh-CN.',
			});
		}
	);

	it('rejects nested writes and raw JSON objects through the same validator', () => {
		writeSettingValue('uiLanguage', 'en');
		expect(() => writeSettingValue('uiLanguage.value', 'zh-CN')).toThrow('not a nested setting');
		expect(() => settingsSet('uiLanguage', '', { json: true, raw: '{"value":"zh-CN"}' })).toThrow(
			'CLI exit'
		);
		expect(readSettingValue('uiLanguage')).toBe('en');
	});
});
