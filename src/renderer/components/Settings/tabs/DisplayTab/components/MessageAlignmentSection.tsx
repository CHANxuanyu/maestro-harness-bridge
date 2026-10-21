import { AlignHorizontalJustifyCenter } from 'lucide-react';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import type { Theme } from '../../../../../types';
import { useT } from '../../../../../i18n';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';

interface MessageAlignmentSectionProps {
	theme: Theme;
	userMessageAlignment: 'left' | 'right' | null | undefined;
	setUserMessageAlignment: (value: 'left' | 'right') => void;
}

export function MessageAlignmentSection({
	theme,
	userMessageAlignment,
	setUserMessageAlignment,
}: MessageAlignmentSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-message-alignment">
			<SettingsSectionHeading icon={AlignHorizontalJustifyCenter}>
				{t('settings.display.alignment.heading')}
			</SettingsSectionHeading>
			<ToggleButtonGroup
				options={[
					{ value: 'left', label: t('settings.display.alignment.left') },
					{ value: 'right', label: t('settings.display.alignment.right') },
				]}
				value={userMessageAlignment ?? 'right'}
				onChange={setUserMessageAlignment}
				theme={theme}
			/>
			<p className="text-xs opacity-70 mt-2">{t('settings.display.alignment.description')}</p>
		</div>
	);
}
