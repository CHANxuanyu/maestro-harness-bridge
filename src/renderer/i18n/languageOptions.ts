import type { UiLanguagePreference } from '../../shared/i18n';
import type { MessageKey } from './translate';

export interface LanguageOption {
	value: UiLanguagePreference;
	/**
	 * A language's own name is shown in that language, whatever the UI is in,
	 * so someone who cannot read the current UI can still find their language.
	 * Only "follow the system" is translated.
	 */
	nativeLabel?: string;
	labelKey?: MessageKey;
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
	{ value: 'system', labelKey: 'settings.language.system' },
	{ value: 'en', nativeLabel: 'English' },
	{ value: 'zh-CN', nativeLabel: '简体中文' },
];
