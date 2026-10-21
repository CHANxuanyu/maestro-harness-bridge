import { AppWindow } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { useT } from '../../../../../i18n';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { SectionCard } from './SectionCard';
import { ToggleSettingRow } from './ToggleSettingRow';

interface WindowChromeSectionProps {
	theme: Theme;
	useNativeTitleBar: boolean;
	setUseNativeTitleBar: (enabled: boolean) => void;
	autoHideMenuBar: boolean;
	setAutoHideMenuBar: (enabled: boolean) => void;
}

export function WindowChromeSection({
	theme,
	useNativeTitleBar,
	setUseNativeTitleBar,
	autoHideMenuBar,
	setAutoHideMenuBar,
}: WindowChromeSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-window-chrome">
			<SettingsSectionHeading icon={AppWindow}>
				{t('settings.display.chrome.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.chrome.nativeTitleBar')}
					description={t('settings.display.chrome.nativeTitleBarDescription')}
					checked={useNativeTitleBar}
					onChange={setUseNativeTitleBar}
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.chrome.autoHideMenu')}
					description={t('settings.display.chrome.autoHideMenuDescription')}
					checked={autoHideMenuBar}
					onChange={setAutoHideMenuBar}
					borderTop
				/>
			</SectionCard>
		</div>
	);
}
