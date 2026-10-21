import { useT } from '../../../../../i18n';
import { ChevronDown } from 'lucide-react';
import type { Theme } from '../../../../../types';
import type { CueSettingsState } from '../types';

interface CueSettingsSectionProps {
	theme: Theme;
	cueState: CueSettingsState;
}

/**
 * Maestro Cue config BODY (extension detail pane, Settings tab). Chromeless:
 * the detail-pane header carries the title/beta badge/state/enable toggle.
 */
export function CueSettingsSection({ theme, cueState }: CueSettingsSectionProps) {
	const tExtra = useT();
	return (
		<div data-setting-id="encore-cue" className="space-y-4">
			<div className="flex items-center justify-between pt-3">
				<div
					className="text-xs font-bold uppercase opacity-70"
					style={{ color: theme.colors.textMain }}
				>
					{tExtra('settings.extra.cueSettingsSection.globalCueSettings')}
				</div>
				{cueState.cueSettingsLoaded && (
					<div className="text-2xs" style={{ color: theme.colors.textDim }}>
						{cueState.cueSettingsSaveState === 'saving' && (
							<>{tExtra('settings.extra.cueSettingsSection.saving')}</>
						)}
						{cueState.cueSettingsSaveState === 'saved' &&
							tExtra('settings.extra.cueSettingsSection.saved')}
						{cueState.cueSettingsSaveState === 'error' && (
							<span style={{ color: theme.colors.error }}>
								{tExtra('settings.extra.cueSettingsSection.saveFailed')}
							</span>
						)}
						{cueState.cueSettingsSaveState === 'no-targets' && (
							<span style={{ color: theme.colors.warning }}>
								{tExtra('settings.extra.cueSettingsSection.noCueYamlYetOpenAPipeline')}
							</span>
						)}
					</div>
				)}
			</div>

			{!cueState.cueSettingsLoaded ? (
				<div className="text-xs" style={{ color: theme.colors.textDim }}>
					{tExtra('settings.extra.cueSettingsSection.loadingSettings')}
				</div>
			) : (
				<>
					<div>
						<label
							htmlFor="cue-timeout-minutes"
							className="block text-xs-plus font-medium mb-1"
							style={{ color: theme.colors.textDim }}
						>
							{tExtra('settings.extra.cueSettingsSection.timeoutMinutes')}
						</label>
						<input
							id="cue-timeout-minutes"
							type="number"
							min={1}
							max={1440}
							value={cueState.cueSettings.timeout_minutes}
							onChange={(event) => cueState.handleTimeoutMinutesChange(event.target.value)}
							className="w-full px-3 py-2 rounded-lg border outline-none text-sm"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						/>
						<p className="text-2xs mt-1 opacity-70">
							{tExtra('settings.extra.cueSettingsSection.maximumTimeATriggeredRunCanExecute')}
						</p>
					</div>

					<div>
						<label
							htmlFor="cue-timeout-on-fail"
							className="block text-xs-plus font-medium mb-1"
							style={{ color: theme.colors.textDim }}
						>
							{tExtra('settings.extra.cueSettingsSection.onSourceFailure')}
						</label>
						<div className="relative">
							<select
								id="cue-timeout-on-fail"
								value={cueState.cueSettings.timeout_on_fail}
								onChange={(event) =>
									cueState.handleTimeoutOnFailChange(event.target.value as 'break' | 'continue')
								}
								className="w-full px-3 py-2 pr-10 rounded-lg border outline-none appearance-none cursor-pointer text-sm"
								style={{
									backgroundColor: theme.colors.bgMain,
									borderColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
							>
								<option value="break">
									{tExtra('settings.extra.cueSettingsSection.breakStopChain')}
								</option>
								<option value="continue">
									{tExtra('settings.extra.cueSettingsSection.continueSkipFailed')}
								</option>
							</select>
							<ChevronDown
								className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
								style={{ color: theme.colors.textDim }}
							/>
						</div>
						<p className="text-2xs mt-1 opacity-70">
							{tExtra('settings.extra.cueSettingsSection.whatToDoWhenAPipelineStage')}
						</p>
					</div>

					<div>
						<label
							htmlFor="cue-max-concurrent"
							className="block text-xs-plus font-medium mb-1"
							style={{ color: theme.colors.textDim }}
						>
							{tExtra('settings.extra.cueSettingsSection.maxConcurrentRuns')}
						</label>
						<input
							id="cue-max-concurrent"
							type="number"
							min={1}
							max={10}
							value={cueState.cueSettings.max_concurrent}
							onChange={(event) => cueState.handleMaxConcurrentChange(event.target.value)}
							className="w-full px-3 py-2 rounded-lg border outline-none text-sm"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						/>
						<p className="text-2xs mt-1 opacity-70">
							{tExtra('settings.extra.cueSettingsSection.howManyCueTriggeredRunsCanExecute')}
						</p>
					</div>

					<div>
						<label
							htmlFor="cue-queue-size"
							className="block text-xs-plus font-medium mb-1"
							style={{ color: theme.colors.textDim }}
						>
							{tExtra('settings.extra.cueSettingsSection.eventQueueSize')}
						</label>
						<input
							id="cue-queue-size"
							type="number"
							min={0}
							max={10000}
							value={cueState.cueQueueSizeStr}
							onChange={(event) => cueState.handleQueueSizeChange(event.target.value)}
							onBlur={cueState.handleQueueSizeBlur}
							className="w-full px-3 py-2 rounded-lg border outline-none text-sm"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
							}}
						/>
						<p className="text-2xs mt-1 opacity-70">
							{tExtra('settings.extra.cueSettingsSection.eventsThatArriveWhileTheConcurrentLimit')}
						</p>
					</div>
				</>
			)}
		</div>
	);
}
