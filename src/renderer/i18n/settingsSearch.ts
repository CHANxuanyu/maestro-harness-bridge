/**
 * Locale overlays for the Settings search registry.
 *
 * The registry (`components/Settings/searchableSettings*.ts`) stays English and
 * owns ids, tabs and jump targets. An overlay only replaces what the user reads
 * and adds terms they might type. Localized entries keep the English label,
 * description and keywords as extra search terms, so a user who learned the
 * English name of a setting can still find it after switching language.
 */

import type { AppLocale } from '../../shared/i18n';
import type { SearchableSetting } from '../components/Settings/searchableSettings';
import { settingsSearchZhCN } from './locales/zh-CN/settingsSearch';
import { translate, type MessageKey } from './translate';

export interface SettingsSearchOverlayEntry {
	label: string;
	description?: string;
	keywords?: string[];
}

export type SettingsSearchOverlay = Readonly<Record<string, SettingsSearchOverlayEntry>>;

export const SETTINGS_SEARCH_OVERLAYS: Readonly<Partial<Record<AppLocale, SettingsSearchOverlay>>> =
	{
		'zh-CN': settingsSearchZhCN,
	};

export function localizeSearchableSetting(
	setting: SearchableSetting,
	locale: AppLocale
): SearchableSetting {
	if (locale === 'en') return setting;
	const entry = SETTINGS_SEARCH_OVERLAYS[locale]?.[setting.id];
	const tabLabel = translate(locale, `settings.tab.${setting.tab}` as MessageKey);
	const englishTerms = [setting.label, setting.description ?? '', setting.tabLabel];
	return {
		...setting,
		tabLabel,
		label: entry?.label ?? setting.label,
		description: entry ? entry.description : setting.description,
		keywords: [...(entry?.keywords ?? []), ...englishTerms, ...(setting.keywords ?? [])],
	};
}
