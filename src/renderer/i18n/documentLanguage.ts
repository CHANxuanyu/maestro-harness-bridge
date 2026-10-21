/**
 * The system half of locale resolution, plus the `<html lang>` sync.
 *
 * Deliberately a leaf module (imports only `src/shared/i18n`) so the settings
 * store can call it without an import cycle through the hooks.
 */

import { resolveAppLocale, type AppLocale } from '../../shared/i18n';

/** The OS / browser language the `system` preference follows. */
export function getSystemLocale(): string {
	if (typeof navigator === 'undefined') return 'en';
	return navigator.languages?.[0] || navigator.language || 'en';
}

/**
 * Resolve a stored preference and stamp the result on `<html lang>`, which
 * drives screen-reader pronunciation, CJK font selection, and hyphenation.
 */
export function applyDocumentLanguage(preference: unknown): AppLocale {
	const locale = resolveAppLocale(preference, getSystemLocale());
	if (typeof document !== 'undefined' && document.documentElement.lang !== locale) {
		document.documentElement.lang = locale;
	}
	return locale;
}
