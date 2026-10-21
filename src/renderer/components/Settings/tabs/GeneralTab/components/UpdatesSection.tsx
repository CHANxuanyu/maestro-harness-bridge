import { Download, FlaskConical } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { ToggleSwitch } from '../../../../ui/ToggleSwitch';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';

interface UpdatesSectionProps {
	theme: Theme;
	checkForUpdatesOnStartup: boolean;
	setCheckForUpdatesOnStartup: (enabled: boolean) => void;
	enableBetaUpdates: boolean;
	setEnableBetaUpdates: (enabled: boolean) => void;
}

export function UpdatesSection({
	theme,
	checkForUpdatesOnStartup,
	setCheckForUpdatesOnStartup,
	enableBetaUpdates,
	setEnableBetaUpdates,
}: UpdatesSectionProps) {
	const t = useT();
	return (
		<div>
			<SettingsSectionHeading icon={Download}>
				{t('settings.general.updates.heading')}
			</SettingsSectionHeading>
			<div
				className="p-3 rounded border space-y-3"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div
					data-setting-id="general-updates"
					className="flex items-center justify-between cursor-pointer"
					onClick={() => setCheckForUpdatesOnStartup(!checkForUpdatesOnStartup)}
					role="button"
					tabIndex={0}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setCheckForUpdatesOnStartup(!checkForUpdatesOnStartup);
						}
					}}
				>
					<div className="flex-1 pr-3">
						<div className="font-medium" style={{ color: theme.colors.textMain }}>
							{t('settings.general.updates.check')}
						</div>
						<div className="text-xs opacity-70 mt-0.5">
							{t('settings.general.updates.checkDescription')}
						</div>
					</div>
					<ToggleSwitch
						checked={checkForUpdatesOnStartup}
						onChange={setCheckForUpdatesOnStartup}
						theme={theme}
						ariaLabel={t('settings.general.updates.check')}
					/>
				</div>

				<div
					data-setting-id="general-beta-updates"
					className="flex items-center justify-between cursor-pointer pt-3 border-t"
					style={{ borderColor: theme.colors.border }}
					onClick={() => setEnableBetaUpdates(!enableBetaUpdates)}
					role="button"
					tabIndex={0}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setEnableBetaUpdates(!enableBetaUpdates);
						}
					}}
				>
					<div className="flex-1 pr-3">
						<div
							className="font-medium flex items-center gap-2"
							style={{ color: theme.colors.textMain }}
						>
							<FlaskConical className="w-4 h-4" />
							{t('settings.general.updates.beta')}
						</div>
						<div className="text-xs opacity-70 mt-0.5">
							{t('settings.general.updates.betaDescription')}
						</div>
					</div>
					<ToggleSwitch
						checked={enableBetaUpdates}
						onChange={setEnableBetaUpdates}
						theme={theme}
						ariaLabel={t('settings.general.updates.beta')}
					/>
				</div>
			</div>
		</div>
	);
}
