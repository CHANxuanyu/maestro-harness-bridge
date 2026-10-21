import { Languages } from 'lucide-react';
import type { UiLanguagePreference } from '../../../../../../shared/i18n';
import type { Theme } from '../../../../../types';
import { LANGUAGE_OPTIONS, useI18n } from '../../../../../i18n';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { SectionCard } from '../../DisplayTab/components/SectionCard';

interface LanguageSectionProps {
	theme: Theme;
	uiLanguage: UiLanguagePreference;
	setUiLanguage: (value: UiLanguagePreference) => void;
}

/** A locale's own name, used for the "following the system" note. */
const NATIVE_LOCALE_NAMES: Record<string, string> = {
	en: 'English',
	'zh-CN': '简体中文',
};

export function LanguageSection({ theme, uiLanguage, setUiLanguage }: LanguageSectionProps) {
	const { t, locale } = useI18n();

	return (
		<div data-setting-id="general-language">
			<SettingsSectionHeading icon={Languages} description={t('settings.language.description')}>
				{t('settings.language.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<ToggleButtonGroup
					options={LANGUAGE_OPTIONS.map((option) => ({
						value: option.value,
						label: option.labelKey ? t(option.labelKey) : option.nativeLabel,
					}))}
					value={uiLanguage}
					onChange={setUiLanguage}
					theme={theme}
				/>
				{uiLanguage === 'system' && (
					<p className="text-xs opacity-70">
						{t('settings.language.systemResolved', { language: NATIVE_LOCALE_NAMES[locale] })}
					</p>
				)}
			</SectionCard>
		</div>
	);
}
