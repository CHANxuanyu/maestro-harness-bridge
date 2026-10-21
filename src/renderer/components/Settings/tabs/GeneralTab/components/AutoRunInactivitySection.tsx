import { Clock, Timer } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';

interface AutoRunInactivitySectionProps {
	theme: Theme;
	autoRunInactivityTimeoutMin: number;
	setAutoRunInactivityTimeoutMin: (minutes: number) => void;
	autoRunMaxTaskDurationMin: number;
	setAutoRunMaxTaskDurationMin: (minutes: number) => void;
}

export function AutoRunInactivitySection({
	theme,
	autoRunInactivityTimeoutMin,
	setAutoRunInactivityTimeoutMin,
	autoRunMaxTaskDurationMin,
	setAutoRunMaxTaskDurationMin,
}: AutoRunInactivitySectionProps) {
	const t = useT();
	const hr = (count: number) => t('settings.general.duration.hr', { count });
	const unlimited = t('settings.general.unlimited');
	return (
		<>
			<div data-setting-id="general-autorun-inactivity-timeout">
				<SettingsSectionHeading icon={Clock}>
					{t('settings.general.autorun.inactivityHeading')}
				</SettingsSectionHeading>
				<ToggleButtonGroup
					options={[
						{ value: 30, label: t('settings.general.duration.min', { count: 30 }) },
						{ value: 60, label: hr(1) },
						{ value: 240, label: hr(4) },
						{ value: 480, label: hr(8) },
						{ value: 0, label: unlimited },
					]}
					value={autoRunInactivityTimeoutMin}
					onChange={setAutoRunInactivityTimeoutMin}
					theme={theme}
				/>
				<p className="text-xs opacity-70 mt-2">
					{t('settings.general.autorun.inactivityDescription')}
				</p>
			</div>
			<div data-setting-id="general-autorun-max-task-duration">
				<SettingsSectionHeading icon={Timer}>
					{t('settings.general.autorun.maxHeading')}
				</SettingsSectionHeading>
				<ToggleButtonGroup
					options={[
						{ value: 60, label: hr(1) },
						{ value: 240, label: hr(4) },
						{ value: 480, label: hr(8) },
						{ value: 720, label: hr(12) },
						{ value: 0, label: unlimited },
					]}
					value={autoRunMaxTaskDurationMin}
					onChange={setAutoRunMaxTaskDurationMin}
					theme={theme}
				/>
				<p className="text-xs opacity-70 mt-2">{t('settings.general.autorun.maxDescription')}</p>
			</div>
		</>
	);
}
