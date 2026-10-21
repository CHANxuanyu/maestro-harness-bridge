import { Tags } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { useT } from '../../../../../i18n';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { ToggleSettingRow } from './ToggleSettingRow';

interface ProviderModePillSectionProps {
	theme: Theme;
	showProviderModePill: boolean;
	setShowProviderModePill: (value: boolean) => void;
}

export function ProviderModePillSection({
	theme,
	showProviderModePill,
	setShowProviderModePill,
}: ProviderModePillSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-provider-mode-pill">
			<SettingsSectionHeading icon={Tags}>
				{t('settings.display.providerPill.heading')}
			</SettingsSectionHeading>
			<div className="p-3 rounded border" style={{ borderColor: theme.colors.border }}>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.providerPill.title')}
					description={t('settings.display.providerPill.description')}
					checked={showProviderModePill}
					onChange={setShowProviderModePill}
					ariaLabel={t('settings.display.providerPill.aria')}
				/>
			</div>
		</div>
	);
}
