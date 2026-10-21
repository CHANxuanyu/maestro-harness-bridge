import { describe, expect, it } from 'vitest';
import {
	DEFAULT_UI_LANGUAGE,
	assertValidUiLanguageSetting,
	isUiLanguagePreference,
	resolveAppLocale,
} from '../../shared/i18n';
import { SETTINGS_DEFAULTS } from '../../main/stores/defaults';
import { getSettingDefault } from '../../shared/settingsMetadata';

describe('UI language preferences', () => {
	it('uses the same system-language default in the store and CLI metadata', () => {
		expect(DEFAULT_UI_LANGUAGE).toBe('system');
		expect(SETTINGS_DEFAULTS.uiLanguage).toBe(DEFAULT_UI_LANGUAGE);
		expect(getSettingDefault('uiLanguage')).toBe(DEFAULT_UI_LANGUAGE);
	});

	it.each(['system', 'en', 'zh-CN'])('accepts the supported preference %s', (value) => {
		expect(isUiLanguagePreference(value)).toBe(true);
		expect(() => assertValidUiLanguageSetting('uiLanguage', value)).not.toThrow();
	});

	it.each([undefined, null, '', 'zh', 'fr', 'EN', true, 1, [], {}, { value: 'zh-CN' }])(
		'rejects unsupported values and malformed scalar values (%j)',
		(value) => {
			expect(isUiLanguagePreference(value)).toBe(false);
			expect(() => assertValidUiLanguageSetting('uiLanguage', value)).toThrow(
				'uiLanguage must be one of'
			);
		}
	);

	it('rejects dot-notation writes that would turn the preference into an object', () => {
		expect(() => assertValidUiLanguageSetting('uiLanguage.value', 'zh-CN')).toThrow(
			'not a nested setting'
		);
		expect(() => assertValidUiLanguageSetting('other.nested', { value: 1 })).not.toThrow();
	});

	it.each(['zh', 'zh-CN', 'zh-Hans-CN', 'zh_TW', 'ZH-hant'])('%s resolves to Chinese', (system) => {
		expect(resolveAppLocale('system', system)).toBe('zh-CN');
	});

	it.each(['en-US', 'fr-FR', 'ja', '', 'zho'])('%s falls back to English', (system) => {
		expect(resolveAppLocale('system', system)).toBe('en');
	});

	it('lets explicit language choices override the operating-system language', () => {
		expect(resolveAppLocale('en', 'zh-CN')).toBe('en');
		expect(resolveAppLocale('zh-CN', 'en-US')).toBe('zh-CN');
	});

	it('treats missing or obsolete persisted values as the system default', () => {
		expect(resolveAppLocale(undefined, 'zh-CN')).toBe('zh-CN');
		expect(resolveAppLocale({ invalid: true }, 'fr-FR')).toBe('en');
	});
});
