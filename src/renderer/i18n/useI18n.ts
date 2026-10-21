/**
 * React bindings for the UI language.
 *
 * Components subscribe to the RESOLVED locale only, so a language change
 * re-renders exactly the components that render translated text and nothing
 * remounts: conversation state, composer drafts and scroll positions survive.
 */

import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { resolveAppLocale, type AppLocale } from '../../shared/i18n';
import { useSettingsStore } from '../stores/settingsStore';
import { applyDocumentLanguage, getSystemLocale } from './documentLanguage';
import { interpolateNodes, type RichMessageParams } from './richText';
import { getTranslator, translate, type MessageKey, type TFunction } from './translate';

function subscribeSystemLocale(onChange: () => void): () => void {
	if (typeof window === 'undefined') return () => {};
	const handleLanguageChange = () => {
		applyDocumentLanguage(useSettingsStore.getState().uiLanguage);
		onChange();
	};
	window.addEventListener('languagechange', handleLanguageChange);
	return () => window.removeEventListener('languagechange', handleLanguageChange);
}

/** The resolved locale the app is rendering in right now. */
export function useAppLocale(): AppLocale {
	const preference = useSettingsStore((s) => s.uiLanguage);
	const systemLocale = useSyncExternalStore(subscribeSystemLocale, getSystemLocale, () => 'en');
	return resolveAppLocale(preference, systemLocale);
}

/** A translator bound to the current locale (stable until the locale changes). */
export function useT(): TFunction {
	return getTranslator(useAppLocale());
}

export type TRichFunction = (key: MessageKey, params: RichMessageParams) => ReactNode;

export interface I18n {
	locale: AppLocale;
	t: TFunction;
	/** For templates whose parameters are elements (`<kbd>`, links, bold names). */
	tRich: TRichFunction;
}

export function useI18n(): I18n {
	const locale = useAppLocale();
	const t = getTranslator(locale);
	const tRich = useCallback<TRichFunction>(
		(key, params) => interpolateNodes(translate(locale, key, undefined), params),
		[locale]
	);
	return useMemo(() => ({ locale, t, tRich }), [locale, t, tRich]);
}

/** The locale outside React (services, command builders, toasts). */
export function getAppLocale(): AppLocale {
	return resolveAppLocale(useSettingsStore.getState().uiLanguage, getSystemLocale());
}

/**
 * A translator for the locale in effect at call time, for code that runs
 * outside React. Call it where the text is produced, not at module load, or the
 * string freezes in whatever language was active when the module was imported.
 */
export function getT(): TFunction {
	return getTranslator(getAppLocale());
}
