import { Battery } from 'lucide-react';
import { isLinux } from '../../../../../../shared/platformDetection';
import { isMacOSPlatform } from '../../../../../utils/platformUtils';
import type { Theme } from '../../../../../types';
import { ToggleSwitch } from '../../../../ui/ToggleSwitch';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';

interface PowerSectionProps {
	theme: Theme;
	preventSleepEnabled: boolean;
	setPreventSleepEnabled: (enabled: boolean) => void;
	preventDisplaySleepEnabled: boolean;
	setPreventDisplaySleepEnabled: (enabled: boolean) => void;
}

export function PowerSection({
	theme,
	preventSleepEnabled,
	setPreventSleepEnabled,
	preventDisplaySleepEnabled,
	setPreventDisplaySleepEnabled,
}: PowerSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="general-power">
			<SettingsSectionHeading icon={Battery}>
				{t('settings.general.power.heading')}
			</SettingsSectionHeading>
			<div
				className="p-3 rounded border space-y-3"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div
					className="flex items-center justify-between cursor-pointer"
					onClick={() => setPreventSleepEnabled(!preventSleepEnabled)}
					role="button"
					tabIndex={0}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setPreventSleepEnabled(!preventSleepEnabled);
						}
					}}
				>
					<div className="flex-1 pr-3">
						<div className="font-medium" style={{ color: theme.colors.textMain }}>
							{t('settings.general.power.preventSleep')}
						</div>
						<div className="text-xs opacity-70 mt-0.5">
							{t('settings.general.power.preventSleepDescription')}
						</div>
					</div>
					<ToggleSwitch
						checked={preventSleepEnabled}
						onChange={setPreventSleepEnabled}
						theme={theme}
						ariaLabel={t('settings.general.power.preventSleep')}
					/>
				</div>

				{/*
				 * Display sleep is a separate, stronger claim than staying awake.
				 * It is what stops the screen saver, the screen lock, and idle
				 * logout - and on macOS it is also what tells the OS a human is
				 * present, which parks discretionary maintenance. Off by default,
				 * and only meaningful while the parent toggle holds a blocker.
				 */}
				<div data-setting-id="general-display-sleep">
					<div
						className={`flex items-center justify-between pl-3 border-l ${
							preventSleepEnabled ? 'cursor-pointer' : 'opacity-50'
						}`}
						style={{ borderColor: theme.colors.border }}
						onClick={() => {
							if (preventSleepEnabled) setPreventDisplaySleepEnabled(!preventDisplaySleepEnabled);
						}}
						role="button"
						tabIndex={preventSleepEnabled ? 0 : -1}
						aria-disabled={!preventSleepEnabled}
						onKeyDown={(e) => {
							if (!preventSleepEnabled) return;
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								setPreventDisplaySleepEnabled(!preventDisplaySleepEnabled);
							}
						}}
					>
						<div className="flex-1 pr-3">
							<div className="font-medium" style={{ color: theme.colors.textMain }}>
								{t('settings.general.power.display')}
							</div>
							<div className="text-xs opacity-50 mt-0.5">
								{t('settings.general.power.displayDescription')}
							</div>
						</div>
						<ToggleSwitch
							checked={preventDisplaySleepEnabled}
							onChange={setPreventDisplaySleepEnabled}
							theme={theme}
							disabled={!preventSleepEnabled}
							ariaLabel={t('settings.general.power.display')}
							title={
								preventSleepEnabled ? undefined : t('settings.general.power.displayDisabledTitle')
							}
						/>
					</div>

					{/* macOS maintenance warning */}
					{isMacOSPlatform() && preventSleepEnabled && preventDisplaySleepEnabled && (
						<div
							className="text-xs p-2 rounded mt-2"
							style={{
								backgroundColor: theme.colors.warning + '15',
								color: theme.colors.warning,
							}}
						>
							{t('settings.general.power.macWarning')}
						</div>
					)}
				</div>

				{isLinux() && (
					<div
						className="text-xs p-2 rounded"
						style={{
							backgroundColor: theme.colors.warning + '15',
							color: theme.colors.warning,
						}}
					>
						{t('settings.general.power.linuxNote')}
					</div>
				)}
			</div>
		</div>
	);
}
