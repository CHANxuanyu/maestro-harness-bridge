import { AlertTriangle, AtSign } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { ToggleButtonGroup } from '../../../../ToggleButtonGroup';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useI18n } from '../../../../../i18n';

interface CrossAgentMentionsSectionProps {
	theme: Theme;
	crossAgentMentionsWritable: boolean;
	setCrossAgentMentionsWritable: (enabled: boolean) => void;
	crossAgentHandoffsWritable: boolean;
	setCrossAgentHandoffsWritable: (enabled: boolean) => void;
}

export function CrossAgentMentionsSection({
	theme,
	crossAgentMentionsWritable,
	setCrossAgentMentionsWritable,
	crossAgentHandoffsWritable,
	setCrossAgentHandoffsWritable,
}: CrossAgentMentionsSectionProps) {
	const { t, tRich } = useI18n();
	const accessOptions = [
		{ value: 'readonly' as const, label: t('settings.general.readOnly') },
		{ value: 'readwrite' as const, label: t('settings.general.readWrite') },
	];
	return (
		<div data-setting-id="general-cross-agent-mentions">
			<SettingsSectionHeading icon={AtSign}>
				{t('settings.general.mentions.heading')}
			</SettingsSectionHeading>
			<p className="text-xs opacity-70 mb-3">
				{tRich('settings.general.mentions.description', {
					consult: <span className="font-medium">{t('settings.general.mentions.consult')}</span>,
					delegation: (
						<span className="font-medium">{t('settings.general.mentions.delegation')}</span>
					),
					handoff: <span className="font-medium">{t('settings.general.mentions.handoff')}</span>,
				})}
			</p>

			<div
				className="p-3 rounded border"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div className="font-medium" style={{ color: theme.colors.textMain }}>
					{t('settings.general.mentions.consultOrDelegate')}
				</div>
				<div className="text-xs opacity-70 mt-0.5 mb-2">
					{crossAgentMentionsWritable
						? t('settings.general.mentions.delegateState')
						: t('settings.general.mentions.consultState')}
				</div>

				{crossAgentMentionsWritable && (
					<div
						className="flex items-start gap-1.5 text-xs mb-2"
						style={{ color: theme.colors.warning }}
					>
						<AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
						<span>{t('settings.general.mentions.delegateWarning')}</span>
					</div>
				)}

				<ToggleButtonGroup
					options={accessOptions}
					value={crossAgentMentionsWritable ? 'readwrite' : 'readonly'}
					onChange={(value) => setCrossAgentMentionsWritable(value === 'readwrite')}
					theme={theme}
				/>
			</div>

			{/* Hand-offs ("then send what you find to @agent") pass finished work on,
			    so they get their own switch and default to Read/Write. */}
			<div
				className="p-3 rounded border mt-3"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div className="font-medium" style={{ color: theme.colors.textMain }}>
					{t('settings.general.mentions.handoffs')}
				</div>
				<div className="text-xs opacity-70 mt-0.5 mb-2">
					{crossAgentHandoffsWritable
						? t('settings.general.mentions.handoffWriteState')
						: t('settings.general.mentions.handoffReadState')}
				</div>

				{crossAgentHandoffsWritable && (
					<div
						className="flex items-start gap-1.5 text-xs mb-2"
						style={{ color: theme.colors.warning }}
					>
						<AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
						<span>{t('settings.general.mentions.handoffWarning')}</span>
					</div>
				)}

				<ToggleButtonGroup
					options={accessOptions}
					value={crossAgentHandoffsWritable ? 'readwrite' : 'readonly'}
					onChange={(value) => setCrossAgentHandoffsWritable(value === 'readwrite')}
					theme={theme}
				/>
			</div>
		</div>
	);
}
