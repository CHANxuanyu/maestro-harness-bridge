import { ListFilter } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { formatMetaKeyName } from '../../../../../utils/shortcutFormatter';
import { useT } from '../../../../../i18n';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { SectionCard } from './SectionCard';
import { ToggleSettingRow } from './ToggleSettingRow';

interface TabOptionsSectionProps {
	theme: Theme;
	showStarredInUnreadFilter: boolean;
	setShowStarredInUnreadFilter: (enabled: boolean) => void;
	showFilePreviewsInUnreadFilter: boolean;
	setShowFilePreviewsInUnreadFilter: (enabled: boolean) => void;
	showTerminalTabsInUnreadFilter: boolean;
	setShowTerminalTabsInUnreadFilter: (enabled: boolean) => void;
	showBrowserTabsInUnreadFilter: boolean;
	setShowBrowserTabsInUnreadFilter: (enabled: boolean) => void;
	useCmd0AsLastTab: boolean;
	setUseCmd0AsLastTab: (enabled: boolean) => void;
	showBrowserTabDomain: boolean;
	setShowBrowserTabDomain: (enabled: boolean) => void;
	showTabCountBadge: boolean;
	setShowTabCountBadge: (enabled: boolean) => void;
	tabBarWheelScroll: boolean;
	setTabBarWheelScroll: (enabled: boolean) => void;
}

export function TabOptionsSection({
	theme,
	showStarredInUnreadFilter,
	setShowStarredInUnreadFilter,
	showFilePreviewsInUnreadFilter,
	setShowFilePreviewsInUnreadFilter,
	showTerminalTabsInUnreadFilter,
	setShowTerminalTabsInUnreadFilter,
	showBrowserTabsInUnreadFilter,
	setShowBrowserTabsInUnreadFilter,
	useCmd0AsLastTab,
	setUseCmd0AsLastTab,
	showBrowserTabDomain,
	setShowBrowserTabDomain,
	showTabCountBadge,
	setShowTabCountBadge,
	tabBarWheelScroll,
	setTabBarWheelScroll,
}: TabOptionsSectionProps) {
	const t = useT();
	// Spelled-out modifier for shortcut hints: 'Command' on macOS, 'Ctrl' elsewhere.
	// formatMetaKeyName reads the preload platform bridge, which is the only source
	// that survives the renderer's `process` shim (process.platform is 'browser').
	const meta = formatMetaKeyName();
	const lastTabTitle = t('settings.display.tabs.lastTab', { meta });

	return (
		<div data-setting-id="display-tab-filtering">
			<SettingsSectionHeading icon={ListFilter}>
				{t('settings.display.tabs.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.tabs.starred')}
					description={t('settings.display.tabs.starredDescription')}
					checked={showStarredInUnreadFilter}
					onChange={setShowStarredInUnreadFilter}
					ariaLabel={t('settings.display.tabs.starred')}
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.tabs.filePreviews')}
					description={t('settings.display.tabs.filePreviewsDescription')}
					checked={showFilePreviewsInUnreadFilter}
					onChange={setShowFilePreviewsInUnreadFilter}
					ariaLabel={t('settings.display.tabs.filePreviews')}
					borderTop
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.tabs.terminals')}
					description={t('settings.display.tabs.terminalsDescription')}
					checked={showTerminalTabsInUnreadFilter}
					onChange={setShowTerminalTabsInUnreadFilter}
					ariaLabel={t('settings.display.tabs.terminals')}
					borderTop
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.tabs.browsers')}
					description={t('settings.display.tabs.browsersDescription')}
					checked={showBrowserTabsInUnreadFilter}
					onChange={setShowBrowserTabsInUnreadFilter}
					ariaLabel={t('settings.display.tabs.browsers')}
					borderTop
				/>
				<ToggleSettingRow
					theme={theme}
					title={lastTabTitle}
					description={t('settings.display.tabs.lastTabDescription', { meta })}
					checked={useCmd0AsLastTab}
					onChange={setUseCmd0AsLastTab}
					ariaLabel={lastTabTitle}
					borderTop
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.tabs.domain')}
					description={t('settings.display.tabs.domainDescription')}
					checked={showBrowserTabDomain}
					onChange={setShowBrowserTabDomain}
					ariaLabel={t('settings.display.tabs.domain')}
					borderTop
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.tabs.countBadge')}
					description={t('settings.display.tabs.countBadgeDescription')}
					checked={showTabCountBadge}
					onChange={setShowTabCountBadge}
					ariaLabel={t('settings.display.tabs.countBadge')}
					borderTop
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.tabs.wheel')}
					description={t('settings.display.tabs.wheelDescription')}
					checked={tabBarWheelScroll}
					onChange={setTabBarWheelScroll}
					ariaLabel={t('settings.display.tabs.wheel')}
					borderTop
				/>
			</SectionCard>
		</div>
	);
}
