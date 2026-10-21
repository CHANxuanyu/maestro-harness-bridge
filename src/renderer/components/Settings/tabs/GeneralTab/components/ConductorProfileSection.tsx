import { User } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useResizableTextarea } from '../../../../../hooks/ui/useResizableTextarea';
import { useT } from '../../../../../i18n';

interface ConductorProfileSectionProps {
	theme: Theme;
	conductorProfile: string;
	setConductorProfile: (value: string) => void;
}

export function ConductorProfileSection({
	theme,
	conductorProfile,
	setConductorProfile,
}: ConductorProfileSectionProps) {
	const conductorProfileResize = useResizableTextarea({
		sizeKey: 'settings-conductor-profile',
		minHeight: 100,
	});

	const t = useT();

	return (
		<div data-setting-id="general-conductor-profile">
			<SettingsSectionHeading icon={User}>
				{t('settings.general.profile.heading')}
			</SettingsSectionHeading>
			<p className="text-xs opacity-70 mb-2">{t('settings.general.profile.description')}</p>
			<textarea
				ref={conductorProfileResize.textareaRef}
				aria-label={t('settings.general.profile.aria')}
				value={conductorProfile}
				onChange={(e) => setConductorProfile(e.target.value)}
				placeholder={t('settings.general.profile.placeholder')}
				className="w-full p-3 rounded border bg-transparent outline-none text-sm resize-y"
				style={{
					borderColor: theme.colors.border,
					color: theme.colors.textMain,
					minHeight: '100px',
					...conductorProfileResize.style,
				}}
				maxLength={5000}
			/>
			<div
				className="text-xs mt-1 text-right"
				style={{
					color: conductorProfile.length > 4500 ? theme.colors.warning : theme.colors.textDim,
				}}
			>
				{conductorProfile.length}/5000
			</div>
		</div>
	);
}
