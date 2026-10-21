import { Database } from 'lucide-react';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import type { Theme } from '../../../../../types';
import { formatNumber } from '../../../../../../shared/formatters';
import { useT } from '../../../../../i18n';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';

interface MaxLogBufferSectionProps {
	theme: Theme;
	maxLogBuffer: number;
	setMaxLogBuffer: (value: number) => void;
}

export function MaxLogBufferSection({
	theme,
	maxLogBuffer,
	setMaxLogBuffer,
}: MaxLogBufferSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-max-log-buffer">
			<SettingsSectionHeading icon={Database}>
				{t('settings.display.logBuffer.heading')}
			</SettingsSectionHeading>
			<ToggleButtonGroup
				options={[1000, 5000, 10000, 25000, 50000].map((value) => ({
					value,
					label: formatNumber(value),
				}))}
				value={maxLogBuffer}
				onChange={setMaxLogBuffer}
				theme={theme}
			/>
			<p className="text-xs opacity-70 mt-2">{t('settings.display.logBuffer.description')}</p>
		</div>
	);
}
