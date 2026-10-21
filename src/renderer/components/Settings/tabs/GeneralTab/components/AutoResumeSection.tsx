import { RotateCcw } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { ToggleSwitch } from '../../../../ui/ToggleSwitch';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';

interface AutoResumeSectionProps {
	theme: Theme;
	autoResumeOnLimit: boolean;
	setAutoResumeOnLimit: (enabled: boolean) => void;
	autoResumeCheckIntervalHours: number;
	setAutoResumeCheckIntervalHours: (hours: number) => void;
	autoResumeGiveUpDays: number;
	setAutoResumeGiveUpDays: (days: number) => void;
}

export function AutoResumeSection({
	theme,
	autoResumeOnLimit,
	setAutoResumeOnLimit,
	autoResumeCheckIntervalHours,
	setAutoResumeCheckIntervalHours,
	autoResumeGiveUpDays,
	setAutoResumeGiveUpDays,
}: AutoResumeSectionProps) {
	const t = useT();
	return (
		<div>
			<SettingsSectionHeading icon={RotateCcw}>
				{t('settings.general.resume.heading')}
			</SettingsSectionHeading>
			<div
				className="p-3 rounded border space-y-3"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div
					data-setting-id="general-auto-resume"
					className="flex items-center justify-between cursor-pointer"
					onClick={() => setAutoResumeOnLimit(!autoResumeOnLimit)}
					role="button"
					tabIndex={0}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setAutoResumeOnLimit(!autoResumeOnLimit);
						}
					}}
				>
					<div className="flex-1 pr-3">
						<div className="font-medium" style={{ color: theme.colors.textMain }}>
							{t('settings.general.resume.title')}
						</div>
						<div className="text-xs opacity-70 mt-0.5">
							{t('settings.general.resume.description')}
						</div>
					</div>
					<ToggleSwitch
						checked={autoResumeOnLimit}
						onChange={setAutoResumeOnLimit}
						theme={theme}
						ariaLabel={t('settings.general.resume.title')}
					/>
				</div>

				{autoResumeOnLimit && (
					<div
						data-setting-id="general-auto-resume-interval"
						className="pt-3 border-t flex flex-wrap items-center gap-4"
						style={{ borderColor: theme.colors.border }}
					>
						<div className="flex items-center gap-2">
							<label className="text-xs opacity-70">{t('settings.general.resume.interval')}</label>
							<input
								type="number"
								min={1}
								value={autoResumeCheckIntervalHours}
								onChange={(e) =>
									setAutoResumeCheckIntervalHours(Math.max(1, parseInt(e.target.value, 10) || 1))
								}
								className="w-20 p-1.5 rounded border bg-transparent outline-none text-xs"
								style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
							/>
						</div>
						<div className="flex items-center gap-2">
							<label className="text-xs opacity-70">{t('settings.general.resume.giveUp')}</label>
							<input
								type="number"
								min={1}
								value={autoResumeGiveUpDays}
								onChange={(e) =>
									setAutoResumeGiveUpDays(Math.max(1, parseInt(e.target.value, 10) || 1))
								}
								className="w-20 p-1.5 rounded border bg-transparent outline-none text-xs"
								style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
							/>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
