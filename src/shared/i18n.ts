/** Supported application UI languages. Native-agent prompts and user content are unaffected. */
export type UiLanguagePreference = 'system' | 'en' | 'zh-CN';
export type AppLocale = 'en' | 'zh-CN';

export const DEFAULT_UI_LANGUAGE: UiLanguagePreference = 'system';

export function isUiLanguagePreference(value: unknown): value is UiLanguagePreference {
	return value === 'system' || value === 'en' || value === 'zh-CN';
}

/** Resolve explicit preferences, with an English fallback for unsupported system languages. */
export function resolveAppLocale(preference: unknown, systemLocale = 'en'): AppLocale {
	if (preference === 'en' || preference === 'zh-CN') return preference;
	return /^zh(?:[-_]|$)/i.test(systemLocale) ? 'zh-CN' : 'en';
}

/** Validate this scalar setting before either IPC or the CLI can write it. */
export function assertValidUiLanguageSetting(key: string, value: unknown): void {
	if (key.startsWith('uiLanguage.')) {
		throw new Error('uiLanguage is a single value, not a nested setting.');
	}
	if (key === 'uiLanguage' && !isUiLanguagePreference(value)) {
		throw new Error('uiLanguage must be one of: system, en, zh-CN.');
	}
}
