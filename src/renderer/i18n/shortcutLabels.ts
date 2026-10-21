/**
 * Localized names for keyboard-shortcut actions.
 *
 * A shortcut's English `label` lives with its definition and is also what gets
 * persisted alongside custom bindings, so it cannot be swapped for a translated
 * string. Display sites call `localizeShortcutLabel` instead, which looks the
 * action up by its stable `id` and falls back to the stored English label.
 */

import { useCallback } from 'react';
import type { AppLocale } from '../../shared/i18n';
import { shortcutLabelsZhCN } from './locales/zh-CN/shortcutLabels';
import { useAppLocale } from './useI18n';

export const SHORTCUT_LABEL_OVERLAYS: Readonly<
	Partial<Record<AppLocale, Readonly<Record<string, string>>>>
> = {
	'zh-CN': shortcutLabelsZhCN,
};

export function localizeShortcutLabel(
	locale: AppLocale,
	shortcut: { id: string; label: string }
): string {
	return SHORTCUT_LABEL_OVERLAYS[locale]?.[shortcut.id] ?? shortcut.label;
}

export function useShortcutLabel(): (shortcut: { id: string; label: string }) => string {
	const locale = useAppLocale();
	return useCallback((shortcut) => localizeShortcutLabel(locale, shortcut), [locale]);
}
