import { Palette } from 'lucide-react';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import type { Theme } from '../../../../../types';
import type { FileExplorerIconTheme } from '../../../../../utils/fileExplorerIcons/shared';
import { useT } from '../../../../../i18n';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';

interface IconThemeSectionProps {
	theme: Theme;
	fileExplorerIconTheme: FileExplorerIconTheme;
	setFileExplorerIconTheme: (value: FileExplorerIconTheme) => void;
}

export function IconThemeSection({
	theme,
	fileExplorerIconTheme,
	setFileExplorerIconTheme,
}: IconThemeSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-icon-theme">
			<SettingsSectionHeading icon={Palette}>
				{t('settings.display.iconTheme.heading')}
			</SettingsSectionHeading>
			<ToggleButtonGroup
				options={[
					{ value: 'flat', label: t('settings.display.iconTheme.flat') },
					{ value: 'rich', label: t('settings.display.iconTheme.rich') },
				]}
				value={fileExplorerIconTheme}
				onChange={setFileExplorerIconTheme}
				theme={theme}
			/>
			<p className="text-xs opacity-70 mt-2">{t('settings.display.iconTheme.description')}</p>
		</div>
	);
}
