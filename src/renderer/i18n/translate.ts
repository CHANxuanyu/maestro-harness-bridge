/**
 * Locale-aware lookup over the typed message catalogs.
 *
 * English is the source catalog and the fallback: every key exists there, and
 * any key a translation omits renders in English rather than as a raw key.
 * Adding a locale means adding a catalog under `locales/<tag>/`, widening
 * `AppLocale` in `src/shared/i18n.ts`, and registering it in `CATALOGS` below.
 */

import type { AppLocale } from '../../shared/i18n';
import { interpolate, type MessageParams } from './interpolate';
import { en, type MessageKey, type TranslationCatalog } from './locales/en';
import { zhCN } from './locales/zh-CN';

export type { MessageKey, TranslationCatalog } from './locales/en';
export type { MessageParams, MessageParamValue } from './interpolate';

/** Translation function bound to one locale. */
export type TFunction = (key: MessageKey, params?: MessageParams) => string;

export const CATALOGS: Readonly<Record<AppLocale, TranslationCatalog>> = {
	en,
	'zh-CN': zhCN,
};

/** Every locale the renderer ships a catalog for, in display order. */
export const SUPPORTED_LOCALES: readonly AppLocale[] = ['en', 'zh-CN'];

export function translate(locale: AppLocale, key: MessageKey, params?: MessageParams): string {
	const template = CATALOGS[locale]?.[key] ?? en[key] ?? key;
	return interpolate(template, params);
}

/** Whether `locale` supplies its own text for `key` (no English fallback). */
export function hasTranslation(locale: AppLocale, key: MessageKey): boolean {
	return typeof CATALOGS[locale]?.[key] === 'string';
}

const translatorCache = new Map<AppLocale, TFunction>();

/**
 * A stable translator per locale. Identity only changes when the locale does,
 * so it is safe in dependency arrays and memo comparisons.
 */
export function getTranslator(locale: AppLocale): TFunction {
	let t = translatorCache.get(locale);
	if (!t) {
		t = (key, params) => translate(locale, key, params);
		translatorCache.set(locale, t);
	}
	return t;
}
