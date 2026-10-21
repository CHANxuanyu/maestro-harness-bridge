import { Globe2 } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { SectionCard } from '../../DisplayTab/components/SectionCard';
import { ToggleSettingRow } from '../../DisplayTab/components/ToggleSettingRow';
import { useT } from '../../../../../i18n';

interface WebInterfaceSectionProps {
	theme: Theme;
	webInterfaceAutoStart: boolean;
	setWebInterfaceAutoStart: (enabled: boolean) => void;
}

export function WebInterfaceSection({
	theme,
	webInterfaceAutoStart,
	setWebInterfaceAutoStart,
}: WebInterfaceSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="general-web-interface-auto-start">
			<SettingsSectionHeading icon={Globe2}>
				{t('settings.general.web.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.general.web.title')}
					description={t('settings.general.web.description')}
					checked={webInterfaceAutoStart}
					onChange={setWebInterfaceAutoStart}
					ariaLabel={t('settings.general.web.title')}
					clickableRow
				/>
			</SectionCard>
		</div>
	);
}
