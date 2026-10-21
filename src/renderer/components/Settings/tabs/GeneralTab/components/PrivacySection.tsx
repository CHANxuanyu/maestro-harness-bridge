import { Bug } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { SettingCheckbox } from '../../../../SettingCheckbox';
import { useT } from '../../../../../i18n';

interface PrivacySectionProps {
	theme: Theme;
	crashReportingEnabled: boolean;
	setCrashReportingEnabled: (enabled: boolean) => void;
}

export function PrivacySection({
	theme,
	crashReportingEnabled,
	setCrashReportingEnabled,
}: PrivacySectionProps) {
	const t = useT();
	return (
		<div data-setting-id="general-crash-reporting">
			<SettingCheckbox
				icon={Bug}
				sectionLabel={t('settings.general.privacy.heading')}
				title={t('settings.general.privacy.title')}
				description={t('settings.general.privacy.description')}
				checked={crashReportingEnabled}
				onChange={setCrashReportingEnabled}
				theme={theme}
			/>
		</div>
	);
}
