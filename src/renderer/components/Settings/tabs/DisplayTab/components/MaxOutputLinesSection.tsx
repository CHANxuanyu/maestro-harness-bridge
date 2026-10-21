import { WrapText } from 'lucide-react';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import type { Theme } from '../../../../../types';
import { useT } from '../../../../../i18n';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';

interface MaxOutputLinesSectionProps {
	theme: Theme;
	maxOutputLines: number;
	setMaxOutputLines: (value: number) => void;
}

export function MaxOutputLinesSection({
	theme,
	maxOutputLines,
	setMaxOutputLines,
}: MaxOutputLinesSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-max-output-lines">
			<SettingsSectionHeading icon={WrapText}>
				{t('settings.display.outputLines.heading')}
			</SettingsSectionHeading>
			<ToggleButtonGroup
				options={[
					{ value: 15 },
					{ value: 25 },
					{ value: 50 },
					{ value: 100 },
					{ value: Infinity, label: t('settings.display.outputLines.all') },
				]}
				value={maxOutputLines}
				onChange={setMaxOutputLines}
				theme={theme}
			/>
			<p className="text-xs opacity-70 mt-2">{t('settings.display.outputLines.description')}</p>
		</div>
	);
}
