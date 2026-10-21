import { ScrollText } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';

interface LogLevelSectionProps {
	theme: Theme;
	logLevel: string;
	setLogLevel: (level: string) => void;
}

export function LogLevelSection({ theme, logLevel, setLogLevel }: LogLevelSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="general-log-level">
			<SettingsSectionHeading icon={ScrollText}>
				{t('settings.general.logLevel.heading')}
			</SettingsSectionHeading>
			<ToggleButtonGroup
				options={[
					{ value: 'debug', label: t('settings.general.logLevel.debug'), activeColor: '#6366f1' },
					{ value: 'info', label: t('settings.general.logLevel.info'), activeColor: '#3b82f6' },
					{ value: 'warn', label: t('settings.general.logLevel.warn'), activeColor: '#f59e0b' },
					{ value: 'error', label: t('settings.general.logLevel.error'), activeColor: '#ef4444' },
				]}
				value={logLevel}
				onChange={setLogLevel}
				theme={theme}
			/>
			<p className="text-xs opacity-70 mt-2">{t('settings.general.logLevel.description')}</p>
		</div>
	);
}
