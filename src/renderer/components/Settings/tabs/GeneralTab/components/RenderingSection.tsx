import { Monitor, PartyPopper } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { ToggleSwitch } from '../../../../ui/ToggleSwitch';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';

interface RenderingSectionProps {
	theme: Theme;
	disableGpuAcceleration: boolean;
	setDisableGpuAcceleration: (disabled: boolean) => void;
	disableConfetti: boolean;
	setDisableConfetti: (disabled: boolean) => void;
}

export function RenderingSection({
	theme,
	disableGpuAcceleration,
	setDisableGpuAcceleration,
	disableConfetti,
	setDisableConfetti,
}: RenderingSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="general-rendering">
			<SettingsSectionHeading icon={Monitor}>
				{t('settings.general.rendering.heading')}
			</SettingsSectionHeading>
			<div
				className="p-3 rounded border space-y-3"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			>
				<div
					className="flex items-center justify-between cursor-pointer"
					onClick={() => setDisableGpuAcceleration(!disableGpuAcceleration)}
					role="button"
					tabIndex={0}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setDisableGpuAcceleration(!disableGpuAcceleration);
						}
					}}
				>
					<div className="flex-1 pr-3">
						<div className="font-medium" style={{ color: theme.colors.textMain }}>
							{t('settings.general.rendering.gpu')}
						</div>
						<div className="text-xs opacity-70 mt-0.5">
							{t('settings.general.rendering.gpuDescription')}
						</div>
					</div>
					<ToggleSwitch
						checked={disableGpuAcceleration}
						onChange={setDisableGpuAcceleration}
						theme={theme}
						ariaLabel={t('settings.general.rendering.gpu')}
					/>
				</div>

				<div
					className="flex items-center justify-between cursor-pointer pt-3 border-t"
					style={{ borderColor: theme.colors.border }}
					onClick={() => setDisableConfetti(!disableConfetti)}
					role="button"
					tabIndex={0}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							setDisableConfetti(!disableConfetti);
						}
					}}
				>
					<div className="flex-1 pr-3">
						<div
							className="font-medium flex items-center gap-2"
							style={{ color: theme.colors.textMain }}
						>
							<PartyPopper className="w-4 h-4" />
							{t('settings.general.rendering.confetti')}
						</div>
						<div className="text-xs opacity-70 mt-0.5">
							{t('settings.general.rendering.confettiDescription')}
						</div>
					</div>
					<ToggleSwitch
						checked={disableConfetti}
						onChange={setDisableConfetti}
						theme={theme}
						ariaLabel={t('settings.general.rendering.confetti')}
					/>
				</div>
			</div>
		</div>
	);
}
