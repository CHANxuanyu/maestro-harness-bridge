import { useT } from '../../../../../i18n';
import { Check, ChevronDown, Settings } from 'lucide-react';
import { getAgentDisplayName, isBetaAgent } from '../../../../../../shared/agentMetadata';
import type { DirectorNotesSettings, Theme, ToolType } from '../../../../../types';
import { IDEAL_END_STATE_MAX_LENGTH } from '../../../../../../shared/directorNotesEndState';
import { useResizableTextarea } from '../../../../../hooks/ui/useResizableTextarea';
import { AgentConfigPanel } from '../../../../shared/AgentConfigPanel';
import { ToggleSwitchTrack } from '../../../../ui/ToggleSwitch';
import { pickFirstAvailableProvider } from '../../../../../../shared/directorNotesProvider';
import type { AgentConfig } from '../../../../../types';
import type { DirectorNotesAgentState } from '../types';

interface DirectorNotesSectionProps {
	theme: Theme;
	directorNotesSettings: DirectorNotesSettings;
	setDirectorNotesSettings: (settings: DirectorNotesSettings) => void;
	directorNotesAgentState: DirectorNotesAgentState;
}

export function DirectorNotesSection({
	theme,
	directorNotesSettings,
	setDirectorNotesSettings,
	directorNotesAgentState,
}: DirectorNotesSectionProps) {
	const tExtra = useT();
	const ac = directorNotesAgentState.agentConfiguration;

	// Default ON: an install that has never touched this setting should get the
	// auto behavior rather than a silently-pinned provider.
	const dnAutoProvider = directorNotesSettings.autoSelectProvider !== false;
	// Which provider auto would land on right now. Shown in the helper text so the
	// ghosted dropdown is not the only clue about what will actually run.
	// `detectedAgents` is already filtered to available, non-hidden agents.
	const dnAutoPick = pickFirstAvailableProvider(
		ac.detectedAgents.map((agent: AgentConfig) => agent.id)
	);
	const dnAutoPickName =
		directorNotesAgentState.availableTiles.find((t) => t.id === dnAutoPick)?.name ?? dnAutoPick;

	const idealEndStateResize = useResizableTextarea({
		sizeKey: 'settings-director-notes-ideal-end-state',
		minHeight: 120,
	});

	return (
		<div data-setting-id="encore-director-notes" className="space-y-6">
			<div className="pt-4" data-setting-id="encore-director-notes-provider">
				<div
					className="block text-xs font-bold opacity-70 uppercase mb-2"
					style={{ color: theme.colors.textMain }}
				>
					{tExtra('settings.extra.directorNotesSection.synopsisProvider')}
				</div>

				{/* Auto-selection. On by default; turning it off un-ghosts the
				    picker below and pins the synopsis to one provider. */}
				<button
					type="button"
					onClick={() =>
						setDirectorNotesSettings({
							...directorNotesSettings,
							autoSelectProvider: !dnAutoProvider,
						})
					}
					className="w-full flex items-center justify-between gap-3 mb-3 text-left"
					role="switch"
					aria-checked={dnAutoProvider}
					aria-label={tExtra(
						'settings.extra.directorNotesSection.useTheFirstAvailableProviderForDirector'
					)}
				>
					<div>
						<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{tExtra('settings.extra.directorNotesSection.useTheFirstAvailableProvider')}
						</div>
						<div className="text-xs opacity-70 mt-0.5">
							{dnAutoProvider
								? dnAutoPickName
									? tExtra('settings.extra.directorNotesSection.pickedProvider', {
											provider: dnAutoPickName,
										})
									: tExtra(
											'settings.extra.directorNotesSection.pickedAtGenerationTimeNoSupportedProvider'
										)
								: tExtra('settings.extra.directorNotesSection.offTheSynopsisAlwaysRunsOnThe')}
						</div>
					</div>
					<ToggleSwitchTrack checked={dnAutoProvider} theme={theme} />
				</button>

				{ac.isDetecting ? (
					<div className="flex items-center gap-2 py-2">
						<div
							className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
							style={{
								borderColor: theme.colors.accent,
								borderTopColor: 'transparent',
							}}
						/>
						<span className="text-sm" style={{ color: theme.colors.textDim }}>
							{tExtra('settings.extra.directorNotesSection.detectingAgents')}
						</span>
					</div>
				) : directorNotesAgentState.availableTiles.length === 0 ? (
					<div className="text-sm py-2" style={{ color: theme.colors.textDim }}>
						{tExtra('settings.extra.directorNotesSection.noAgentsAvailablePleaseInstallClaudeCode')}
					</div>
				) : (
					<div
						className={`flex items-center gap-2 transition-opacity ${
							dnAutoProvider ? 'opacity-40' : ''
						}`}
					>
						<div className="relative flex-1">
							<select
								disabled={dnAutoProvider}
								value={directorNotesSettings.provider}
								onChange={(event) =>
									directorNotesAgentState.handleAgentChange(event.target.value as ToolType)
								}
								className="w-full px-3 py-2 pr-10 rounded-lg border outline-none appearance-none cursor-pointer text-sm"
								style={{
									backgroundColor: theme.colors.bgMain,
									borderColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
								aria-label={tExtra(
									'settings.extra.directorNotesSection.selectSynopsisProviderAgent'
								)}
							>
								{directorNotesAgentState.availableTiles.map((tile) => {
									const isBeta = isBetaAgent(tile.id);
									return (
										<option key={tile.id} value={tile.id}>
											{getAgentDisplayName(tile.id)}
											{isBeta ? tExtra('settings.extra.directorNotesSection.beta') : ''}
										</option>
									);
								})}
							</select>
							<ChevronDown
								className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
								style={{ color: theme.colors.textDim }}
							/>
						</div>

						<button
							onClick={ac.toggleConfigExpanded}
							className="flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-colors hover:bg-white/5"
							style={{
								borderColor: ac.isConfigExpanded ? theme.colors.accent : theme.colors.border,
								color: ac.isConfigExpanded ? theme.colors.accent : theme.colors.textDim,
								backgroundColor: ac.isConfigExpanded ? `${theme.colors.accent}10` : 'transparent',
							}}
							title={tExtra('settings.extra.directorNotesSection.customizeProviderSettings')}
						>
							<Settings className="w-4 h-4" />
							<span className="text-sm">
								{tExtra('settings.extra.directorNotesSection.customize')}
							</span>
							{ac.hasCustomization && (
								<span
									className="w-2 h-2 rounded-full"
									style={{ backgroundColor: theme.colors.accent }}
								/>
							)}
						</button>
					</div>
				)}

				{ac.isConfigExpanded &&
					directorNotesAgentState.selectedAgentConfig &&
					directorNotesAgentState.selectedTile && (
						<div
							className="mt-3 p-4 rounded-lg border"
							style={{
								backgroundColor: theme.colors.bgActivity,
								borderColor: theme.colors.border,
							}}
						>
							<div className="flex items-center justify-between mb-3">
								<span className="text-xs font-medium" style={{ color: theme.colors.textDim }}>
									{getAgentDisplayName(directorNotesAgentState.selectedTile.id)}{' '}
									{tExtra('settings.extra.directorNotesSection.configuration')}
								</span>
								{ac.hasCustomization && (
									<div className="flex items-center gap-1">
										<Check className="w-3 h-3" style={{ color: theme.colors.success }} />
										<span className="text-xs" style={{ color: theme.colors.success }}>
											{tExtra('settings.extra.directorNotesSection.customized')}
										</span>
									</div>
								)}
							</div>
							<AgentConfigPanel
								theme={theme}
								agent={directorNotesAgentState.selectedAgentConfig}
								customPath={ac.customPath}
								onCustomPathChange={ac.setCustomPath}
								onCustomPathBlur={directorNotesAgentState.persistCustomConfig}
								customArgs={ac.customArgs}
								onCustomArgsChange={ac.setCustomArgs}
								onCustomArgsBlur={directorNotesAgentState.persistCustomConfig}
								customEnvVars={ac.customEnvVars}
								onEnvVarKeyChange={directorNotesAgentState.handleEnvVarKeyChange}
								onEnvVarValueChange={directorNotesAgentState.handleEnvVarValueChange}
								onEnvVarRemove={directorNotesAgentState.handleEnvVarRemove}
								onEnvVarAdd={directorNotesAgentState.handleEnvVarAdd}
								onEnvVarsBlur={directorNotesAgentState.persistCustomConfig}
								agentConfig={ac.agentConfig}
								onConfigChange={directorNotesAgentState.handleConfigChange}
								onConfigBlur={directorNotesAgentState.handleConfigBlur}
								availableModels={ac.availableModels}
								loadingModels={ac.loadingModels}
								onRefreshModels={ac.refreshModels}
								dynamicOptions={ac.dynamicOptions}
								loadingDynamicOptions={ac.loadingDynamicOptions}
								onRefreshAgent={ac.refreshAgent}
								refreshingAgent={ac.refreshingAgent}
								compact
								showBuiltInEnvVars
							/>
						</div>
					)}

				<p className="text-xs mt-2" style={{ color: theme.colors.textDim }}>
					{tExtra('settings.extra.directorNotesSection.theAiAgentUsedToGenerateSynopsis')}
				</p>
			</div>

			<div>
				<label
					htmlFor="director-notes-default-lookback-days"
					className="block text-xs font-bold mb-2"
					style={{ color: theme.colors.textMain }}
				>
					{tExtra('settings.extra.directorNotesSection.defaultLookbackPeriod')}{' '}
					{directorNotesSettings.defaultLookbackDays}{' '}
					{tExtra('settings.extra.directorNotesSection.days')}
				</label>
				<input
					id="director-notes-default-lookback-days"
					type="range"
					min={1}
					max={90}
					value={directorNotesSettings.defaultLookbackDays}
					onChange={(event) =>
						setDirectorNotesSettings({
							...directorNotesSettings,
							defaultLookbackDays: parseInt(event.target.value, 10),
						})
					}
					className="w-full"
				/>
				<div className="flex justify-between text-2xs mt-1" style={{ color: theme.colors.textDim }}>
					<span>{tExtra('settings.extra.directorNotesSection.1Day')}</span>
					<span>7</span>
					<span>14</span>
					<span>30</span>
					<span>60</span>
					<span>{tExtra('settings.extra.directorNotesSection.90Days')}</span>
				</div>
				<p className="text-xs mt-2" style={{ color: theme.colors.textDim }}>
					{tExtra('settings.extra.directorNotesSection.howFarBackToLookWhenGenerating')}
				</p>
			</div>

			{/* Ideal End State - optional; drives the extra progress section */}
			<div data-setting-id="encore-director-notes-ideal-end-state">
				<div className="block text-xs font-bold mb-2" style={{ color: theme.colors.textMain }}>
					{tExtra('settings.extra.directorNotesSection.idealEndStateOptional')}
				</div>
				<p className="text-xs mb-2" style={{ color: theme.colors.textDim }}>
					{tExtra('settings.extra.directorNotesSection.describeWhereYouAreTryingToGet')}
				</p>
				<textarea
					ref={idealEndStateResize.textareaRef}
					value={directorNotesSettings.idealEndState ?? ''}
					onChange={(e) =>
						setDirectorNotesSettings({
							...directorNotesSettings,
							idealEndState: e.target.value,
						})
					}
					placeholder={tExtra('settings.extra.directorNotesSection.eGShippingV2OfTheIngest')}
					className="w-full p-3 rounded border bg-transparent outline-none text-sm resize-y"
					style={{
						borderColor: theme.colors.border,
						color: theme.colors.textMain,
						minHeight: '120px',
						...idealEndStateResize.style,
					}}
					maxLength={IDEAL_END_STATE_MAX_LENGTH}
				/>
				<div
					className="text-xs mt-1 text-right"
					style={{
						color:
							(directorNotesSettings.idealEndState?.length ?? 0) > IDEAL_END_STATE_MAX_LENGTH * 0.9
								? theme.colors.warning
								: theme.colors.textDim,
					}}
				>
					{directorNotesSettings.idealEndState?.length ?? 0}/{IDEAL_END_STATE_MAX_LENGTH}
				</div>
			</div>

			{/* Default Reading Mode (Rich widget dashboard vs Plain markdown) */}
			<div data-setting-id="encore-director-notes-default-mode">
				<div className="block text-xs font-bold mb-2" style={{ color: theme.colors.textMain }}>
					{tExtra('settings.extra.directorNotesSection.defaultReadingMode')}
				</div>
				<div
					className="flex items-center rounded overflow-hidden w-fit"
					style={{ border: `1px solid ${theme.colors.border}` }}
					role="group"
					aria-label={tExtra('settings.extra.directorNotesSection.defaultReadingMode264')}
				>
					{(['rich', 'plain'] as const).map((mode) => {
						const active = (directorNotesSettings.defaultMode ?? 'rich') === mode;
						return (
							<button
								key={tExtra(`settings.extra.directorNotesSection.mode.${mode}`)}
								onClick={() =>
									setDirectorNotesSettings({
										...directorNotesSettings,
										defaultMode: mode,
									})
								}
								aria-pressed={active}
								className="px-3 py-1.5 text-xs font-medium capitalize transition-colors"
								style={{
									backgroundColor: active ? theme.colors.accent : 'transparent',
									color: active ? theme.colors.accentForeground : theme.colors.textDim,
								}}
							>
								{tExtra(`settings.extra.directorNotesSection.mode.${mode}`)}
							</button>
						);
					})}
				</div>
				<p className="text-xs mt-2" style={{ color: theme.colors.textDim }}>
					{tExtra('settings.extra.directorNotesSection.whichViewTheAiOverviewOpensIn')}
				</p>
			</div>
		</div>
	);
}
