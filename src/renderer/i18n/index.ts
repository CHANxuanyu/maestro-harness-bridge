/**
 * UI internationalization for the renderer. See docs/internationalization.md.
 *
 * Only application chrome is translated. Never route model output, user
 * content, code, paths, provider or model ids, CLI flags, stored values, or any
 * prompt sent to an agent through these functions.
 */

export { useAppLocale, useT, useI18n, getAppLocale, getT } from './useI18n';
export type { I18n, TRichFunction } from './useI18n';
export { translate, getTranslator, hasTranslation, CATALOGS, SUPPORTED_LOCALES } from './translate';
export type {
	MessageKey,
	MessageParams,
	MessageParamValue,
	TFunction,
	TranslationCatalog,
} from './translate';
export { interpolate } from './interpolate';
export { interpolateNodes } from './richText';
export { applyDocumentLanguage, getSystemLocale } from './documentLanguage';
export { LANGUAGE_OPTIONS } from './languageOptions';
export { formatRelativeTimeFor, useFormatRelativeTime } from './format';
export { localizedFileManagerName } from './platformLabels';
export { localizeShortcutLabel, useShortcutLabel } from './shortcutLabels';
