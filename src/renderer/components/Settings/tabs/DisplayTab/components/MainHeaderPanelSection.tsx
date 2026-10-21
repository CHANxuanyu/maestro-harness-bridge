import { PanelTop } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { useT } from '../../../../../i18n';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { SectionCard } from './SectionCard';
import { ToggleSettingRow } from './ToggleSettingRow';

interface MainHeaderPanelSectionProps {
	theme: Theme;
	showAgentName: boolean;
	setShowAgentName: (enabled: boolean) => void;
	showSessionIdPill: boolean;
	setShowSessionIdPill: (enabled: boolean) => void;
	showSessionCostPill: boolean;
	setShowSessionCostPill: (enabled: boolean) => void;
}

export function MainHeaderPanelSection({
	theme,
	showAgentName,
	setShowAgentName,
	showSessionIdPill,
	setShowSessionIdPill,
	showSessionCostPill,
	setShowSessionCostPill,
}: MainHeaderPanelSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-main-header-panel">
			<SettingsSectionHeading icon={PanelTop}>
				{t('settings.display.header.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.header.agentName')}
					description={t('settings.display.header.agentNameDescription')}
					checked={showAgentName}
					onChange={setShowAgentName}
					ariaLabel={t('settings.display.header.agentName')}
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.header.sessionId')}
					description={t('settings.display.header.sessionIdDescription')}
					checked={showSessionIdPill}
					onChange={setShowSessionIdPill}
					ariaLabel={t('settings.display.header.sessionId')}
					borderTop
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.header.cost')}
					description={t('settings.display.header.costDescription')}
					checked={showSessionCostPill}
					onChange={setShowSessionCostPill}
					ariaLabel={t('settings.display.header.cost')}
					borderTop
				/>
			</SectionCard>
		</div>
	);
}
