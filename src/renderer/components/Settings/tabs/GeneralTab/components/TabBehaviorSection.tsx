import { Tag } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import { ToggleSwitch } from '../../../../ui/ToggleSwitch';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT, type MessageKey } from '../../../../../i18n';

type TabPlacement = 'end' | 'after-current';

interface TabBehaviorSectionProps {
	theme: Theme;
	automaticTabNamingEnabled: boolean;
	setAutomaticTabNamingEnabled: (enabled: boolean) => void;
	newTabPlacement: TabPlacement;
	setNewTabPlacement: (placement: TabPlacement) => void;
	newBrowserTabPlacement: TabPlacement;
	setNewBrowserTabPlacement: (placement: TabPlacement) => void;
	newTerminalPlacement: TabPlacement;
	setNewTerminalPlacement: (placement: TabPlacement) => void;
	openedFilePlacement: TabPlacement;
	setOpenedFilePlacement: (placement: TabPlacement) => void;
}

export function TabBehaviorSection({
	theme,
	automaticTabNamingEnabled,
	setAutomaticTabNamingEnabled,
	newTabPlacement,
	setNewTabPlacement,
	newBrowserTabPlacement,
	setNewBrowserTabPlacement,
	newTerminalPlacement,
	setNewTerminalPlacement,
	openedFilePlacement,
	setOpenedFilePlacement,
}: TabBehaviorSectionProps) {
	const t = useT();
	const placementOptions = [
		{ value: 'end' as const, label: t('settings.general.endOfList') },
		{ value: 'after-current' as const, label: t('settings.general.afterCurrentTab') },
	];
	const placementRows: Array<{
		titleKey: MessageKey;
		descriptionKey: MessageKey;
		value: TabPlacement;
		onChange: (placement: TabPlacement) => void;
	}> = [
		{
			titleKey: 'settings.general.tabs.newTab',
			descriptionKey: 'settings.general.tabs.newTabDescription',
			value: newTabPlacement,
			onChange: setNewTabPlacement,
		},
		{
			titleKey: 'settings.general.tabs.newBrowserTab',
			descriptionKey: 'settings.general.tabs.newBrowserTabDescription',
			value: newBrowserTabPlacement,
			onChange: setNewBrowserTabPlacement,
		},
		{
			titleKey: 'settings.general.tabs.newTerminal',
			descriptionKey: 'settings.general.tabs.newTerminalDescription',
			value: newTerminalPlacement,
			onChange: setNewTerminalPlacement,
		},
		{
			titleKey: 'settings.general.tabs.openedFile',
			descriptionKey: 'settings.general.tabs.openedFileDescription',
			value: openedFilePlacement,
			onChange: setOpenedFilePlacement,
		},
	];

	return (
		<div data-setting-id="general-tab-behavior">
			<SettingsSectionHeading icon={Tag}>
				{t('settings.general.tabs.heading')}
			</SettingsSectionHeading>
			<div
				className="p-3 rounded border space-y-3"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div
					className="flex items-center justify-between cursor-pointer"
					onClick={() => setAutomaticTabNamingEnabled(!automaticTabNamingEnabled)}
					role="button"
					tabIndex={0}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setAutomaticTabNamingEnabled(!automaticTabNamingEnabled);
						}
					}}
				>
					<div className="flex-1 pr-3">
						<div className="font-medium" style={{ color: theme.colors.textMain }}>
							{t('settings.general.tabs.autoName')}
						</div>
						<div className="text-xs opacity-70 mt-0.5">
							{t('settings.general.tabs.autoNameDescription')}
						</div>
					</div>
					<ToggleSwitch
						checked={automaticTabNamingEnabled}
						onChange={setAutomaticTabNamingEnabled}
						theme={theme}
						ariaLabel={t('settings.general.tabs.autoName')}
					/>
				</div>

				{placementRows.map((row) => (
					<div key={row.titleKey}>
						<div className="font-medium" style={{ color: theme.colors.textMain }}>
							{t(row.titleKey)}
						</div>
						<div className="text-xs opacity-70 mt-0.5 mb-2">{t(row.descriptionKey)}</div>
						<ToggleButtonGroup
							options={placementOptions}
							value={row.value}
							onChange={row.onChange}
							theme={theme}
						/>
					</div>
				))}
			</div>
		</div>
	);
}
