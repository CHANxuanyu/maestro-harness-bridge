import { Clock, History, Layers } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { SettingCheckbox } from '../../../../SettingCheckbox';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';

interface HistorySectionProps {
	theme: Theme;
	defaultSaveToHistory: boolean;
	setDefaultSaveToHistory: (enabled: boolean) => void;
	synopsisDebounceSeconds: number;
	setSynopsisDebounceSeconds: (seconds: number) => void;
	groupCueEntries: boolean;
	setGroupCueEntries: (enabled: boolean) => void;
}

export function HistorySection({
	theme,
	defaultSaveToHistory,
	setDefaultSaveToHistory,
	synopsisDebounceSeconds,
	setSynopsisDebounceSeconds,
	groupCueEntries,
	setGroupCueEntries,
}: HistorySectionProps) {
	const t = useT();
	return (
		<div data-setting-id="general-history">
			<SettingCheckbox
				icon={History}
				sectionLabel={t('settings.general.history.heading')}
				title={t('settings.general.history.title')}
				description={t('settings.general.history.description')}
				checked={defaultSaveToHistory}
				onChange={setDefaultSaveToHistory}
				theme={theme}
			/>

			{defaultSaveToHistory && (
				<div className="mt-3" data-setting-id="general-synopsis-debounce">
					<SettingsSectionHeading icon={Clock}>
						{t('settings.general.history.debounceHeading')}
					</SettingsSectionHeading>
					<ToggleButtonGroup
						options={[
							{ value: 0, label: t('common.off') },
							{ value: 15, label: t('settings.general.duration.sec', { count: 15 }) },
							{ value: 30, label: t('settings.general.duration.sec', { count: 30 }) },
							{ value: 60, label: t('settings.general.duration.min', { count: 1 }) },
							{ value: 120, label: t('settings.general.duration.min', { count: 2 }) },
						]}
						value={synopsisDebounceSeconds}
						onChange={setSynopsisDebounceSeconds}
						theme={theme}
					/>
					<p className="text-xs opacity-70 mt-2">
						{t('settings.general.history.debounceDescription')}
					</p>
				</div>
			)}

			{/* Group Cue entries in the History panel */}
			<div className="mt-3" data-setting-id="general-group-cue-entries">
				<SettingCheckbox
					icon={Layers}
					sectionLabel={t('settings.general.history.cueHeading')}
					title={t('settings.general.history.cueTitle')}
					description={t('settings.general.history.cueDescription')}
					checked={groupCueEntries}
					onChange={setGroupCueEntries}
					theme={theme}
				/>
			</div>
		</div>
	);
}
