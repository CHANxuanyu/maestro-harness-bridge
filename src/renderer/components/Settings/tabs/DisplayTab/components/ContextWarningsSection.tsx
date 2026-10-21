import { AlertTriangle } from 'lucide-react';
import type { ContextManagementSettings, Theme } from '../../../../../types';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';
import { getRedThresholdUpdate, getYellowThresholdUpdate } from '../utils';
import { SectionCard } from './SectionCard';
import { ToggleSettingRow } from './ToggleSettingRow';

interface ContextWarningsSectionProps {
	theme: Theme;
	contextManagementSettings: ContextManagementSettings;
	updateContextManagementSettings: (partial: Partial<ContextManagementSettings>) => void;
}

export function ContextWarningsSection({
	theme,
	contextManagementSettings,
	updateContextManagementSettings,
}: ContextWarningsSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-context-warnings">
			<SettingsSectionHeading icon={AlertTriangle}>
				{t('settings.display.context.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<ToggleSettingRow
					theme={theme}
					title={<span className="font-medium">{t('settings.display.context.title')}</span>}
					description={
						<span style={{ color: theme.colors.textDim }}>
							{t('settings.display.context.description')}
						</span>
					}
					checked={contextManagementSettings.contextWarningsEnabled}
					onChange={(enabled) =>
						updateContextManagementSettings({ contextWarningsEnabled: enabled })
					}
					clickableRow
				/>

				<div
					className="space-y-4 pt-3 border-t"
					style={{
						borderColor: theme.colors.border,
						opacity: contextManagementSettings.contextWarningsEnabled ? 1 : 0.4,
						pointerEvents: contextManagementSettings.contextWarningsEnabled ? 'auto' : 'none',
					}}
				>
					<div>
						<div className="flex items-center justify-between mb-2">
							<div
								className="text-xs font-medium flex items-center gap-2"
								style={{ color: theme.colors.textMain }}
							>
								<div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#eab308' }} />
								{t('settings.display.context.yellow')}
							</div>
							<span
								className="text-xs font-mono px-2 py-0.5 rounded"
								style={{ backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#fde047' }}
							>
								{contextManagementSettings.contextWarningYellowThreshold}%
							</span>
						</div>
						<input
							type="range"
							min={0}
							max={100}
							step={5}
							value={contextManagementSettings.contextWarningYellowThreshold}
							onChange={(event) =>
								updateContextManagementSettings(
									getYellowThresholdUpdate(contextManagementSettings, Number(event.target.value))
								)
							}
							className="w-full h-2 rounded-lg appearance-none cursor-pointer"
							disabled={!contextManagementSettings.contextWarningsEnabled}
							style={{
								background: `linear-gradient(to right, #eab308 0%, #eab308 ${contextManagementSettings.contextWarningYellowThreshold}%, ${theme.colors.bgActivity} ${contextManagementSettings.contextWarningYellowThreshold}%, ${theme.colors.bgActivity} 100%)`,
							}}
						/>
					</div>

					<div>
						<div className="flex items-center justify-between mb-2">
							<div
								className="text-xs font-medium flex items-center gap-2"
								style={{ color: theme.colors.textMain }}
							>
								<div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />
								{t('settings.display.context.red')}
							</div>
							<span
								className="text-xs font-mono px-2 py-0.5 rounded"
								style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5' }}
							>
								{contextManagementSettings.contextWarningRedThreshold}%
							</span>
						</div>
						<input
							type="range"
							min={0}
							max={100}
							step={5}
							value={contextManagementSettings.contextWarningRedThreshold}
							onChange={(event) =>
								updateContextManagementSettings(
									getRedThresholdUpdate(contextManagementSettings, Number(event.target.value))
								)
							}
							className="w-full h-2 rounded-lg appearance-none cursor-pointer"
							disabled={!contextManagementSettings.contextWarningsEnabled}
							style={{
								background: `linear-gradient(to right, #ef4444 0%, #ef4444 ${contextManagementSettings.contextWarningRedThreshold}%, ${theme.colors.bgActivity} ${contextManagementSettings.contextWarningRedThreshold}%, ${theme.colors.bgActivity} 100%)`,
							}}
						/>
					</div>
				</div>
			</SectionCard>
		</div>
	);
}
