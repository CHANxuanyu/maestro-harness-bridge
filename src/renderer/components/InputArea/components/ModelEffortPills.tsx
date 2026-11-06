import { selectNewShellEnabled, useSettingsStore } from '../../../stores/settingsStore';
import { modelDisplayLabel, effortDisplayLabel } from '../../../utils/workflowLabels';
import { useT } from '../../../i18n';
import { memo, useState } from 'react';
import type React from 'react';
import { ChevronDown } from 'lucide-react';
import type { Theme } from '../../../types';
import { ShortcutHint, shortcutSuffix } from '../../ui/ShortcutHint';

/** Plain dim text with a chevron, the way a chat composer names its model. */
const PICKER_CLASS =
	'flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs whitespace-nowrap cursor-pointer transition-all opacity-80 hover:opacity-100 hover:bg-white/10';

interface ModelEffortPillsProps {
	allowModelSelection?: boolean;
	isVisible: boolean;
	theme: Theme;
	/**
	 * Chord for the full-screen model/effort switcher, pinned as a hint row at
	 * the top of both dropdowns ("Try: ⌥ ⌘ .").
	 *
	 * Passed in rather than hardcoded because the chord is a rebindable
	 * shortcut, and because not every surface that shows these pills is one the
	 * shortcut can act on: it retunes the ACTIVE tab, so the composer offers the
	 * hint while the queued-message editor (which edits one pending item, not
	 * the tab) leaves it undefined. Omit it and no header row renders.
	 */
	shortcutKeys?: string[];
	currentModel?: string;
	currentEffort?: string;
	availableModels: string[];
	availableEfforts: string[];
	onModelChange?: (model: string) => void;
	onEffortChange?: (effort: string) => void;
	modelMenuOpen: boolean;
	setModelMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
	modelMenuRef: React.RefObject<HTMLDivElement>;
	effortMenuOpen: boolean;
	setEffortMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
	effortMenuRef: React.RefObject<HTMLDivElement>;
}

export const ModelEffortPills = memo(function ModelEffortPills({
	allowModelSelection = false,
	isVisible,
	theme,
	shortcutKeys,
	currentModel,
	currentEffort,
	availableModels,
	availableEfforts,
	onModelChange,
	onEffortChange,
	modelMenuOpen,
	setModelMenuOpen,
	modelMenuRef,
	effortMenuOpen,
	setEffortMenuOpen,
	effortMenuRef,
}: ModelEffortPillsProps) {
	const t = useT();
	const newShell = useSettingsStore(selectNewShellEnabled);
	const [typedModel, setTypedModel] = useState('');

	if (!isVisible) {
		return null;
	}

	return (
		<>
			{onModelChange && (allowModelSelection || availableModels.length > 0) && (
				<div className="relative" ref={modelMenuRef} data-tour="model-selector">
					<button
						onClick={() => {
							setModelMenuOpen(!modelMenuOpen);
							setEffortMenuOpen(false);
						}}
						className={PICKER_CLASS}
						style={{ color: theme.colors.textDim }}
						title={t('workflows.shell.changeModelvalue', { p0: shortcutSuffix(shortcutKeys) })}
					>
						<span>
							{(newShell ? modelDisplayLabel(currentModel ?? '') : currentModel) ||
								t('workflows.shell.default2')}
						</span>
						<ChevronDown className="w-3 h-3 opacity-70" />
					</button>
					{modelMenuOpen && (
						<div
							className="absolute bottom-full right-0 mb-1 rounded border shadow-lg z-50"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
							}}
						>
							<ShortcutHint
								theme={theme}
								keys={shortcutKeys ?? []}
								label={t('workflows.shell.try')}
								variant="row"
							/>
							<div className="max-h-48 overflow-y-auto scrollbar-thin">
								{(availableModels.includes('') ? availableModels : ['', ...availableModels]).map(
									(model) => (
										<button
											key={model || '__default__'}
											onClick={() => {
												onModelChange(model);
												setModelMenuOpen(false);
											}}
											className="w-full text-left px-3 py-1.5 text-xs font-mono whitespace-nowrap hover:bg-white/10 transition-colors"
											style={{
												color: model === currentModel ? theme.colors.accent : theme.colors.textMain,
												backgroundColor:
													model === currentModel ? 'rgba(255,255,255,0.05)' : undefined,
											}}
										>
											{(newShell ? modelDisplayLabel(model) : model) ||
												t('workflows.shell.default')}
										</button>
									)
								)}
							</div>
							{/*
							 * Escape hatch for a model discovery cannot know about: a preview or
							 * limited-access model that the CLI's published catalog does not list
							 * and that this machine has never run. The typed ID is applied like
							 * any other selection, so it persists as the tab's model.
							 *
							 * It reaches this dropdown only once the CLI records a run of it in
							 * `lastModelUsage`, which the interactive (maestro-p) spawn path does
							 * and `claude --print` does not - so on an API-mode tab this field
							 * stays the way in.
							 */}
							<div className="border-t px-3 py-1.5" style={{ borderColor: theme.colors.border }}>
								<input
									type="text"
									value={typedModel}
									onChange={(e) => setTypedModel(e.target.value)}
									onKeyDown={(e) => {
										// The composer and the global shortcuts both listen for plain
										// keys; typing a model ID must not reach them. That includes
										// Escape, which elsewhere interrupts the turn - but swallowing
										// it outright left the field with no way out, so it closes the
										// menu here instead of doing nothing.
										e.stopPropagation();
										if (e.key === 'Escape') {
											setTypedModel('');
											setModelMenuOpen(false);
											return;
										}
										if (e.key !== 'Enter') {
											return;
										}
										// Enter confirms an IME candidate mid-composition; committing
										// there would apply half a model ID and close the menu.
										if (e.nativeEvent.isComposing) {
											return;
										}
										const next = typedModel.trim();
										if (!next) {
											return;
										}
										onModelChange(next);
										setTypedModel('');
										setModelMenuOpen(false);
									}}
									placeholder={t('workflows.shell.orTypeAModelId')}
									aria-label={t('workflows.shell.useAModelIdThatIsNotListed')}
									className="w-full bg-transparent text-xs font-mono outline-none placeholder:opacity-50"
									style={{ color: theme.colors.textMain }}
								/>
							</div>
						</div>
					)}
				</div>
			)}
			{onEffortChange && availableEfforts.some((e) => e !== '') && (
				<div className="relative" ref={effortMenuRef} data-tour="effort-selector">
					<button
						onClick={() => {
							setEffortMenuOpen(!effortMenuOpen);
							setModelMenuOpen(false);
						}}
						className={PICKER_CLASS}
						style={{ color: theme.colors.textDim }}
						title={t('workflows.shell.changeEffortLevelvalue', {
							p0: shortcutSuffix(shortcutKeys),
						})}
					>
						<span>
							{(newShell ? effortDisplayLabel(t, currentEffort ?? '') : currentEffort) ||
								t('workflows.shell.default2')}
						</span>
						<ChevronDown className="w-3 h-3 opacity-70" />
					</button>
					{effortMenuOpen && (
						<div
							className="absolute bottom-full right-0 mb-1 rounded border shadow-lg z-50"
							style={{
								backgroundColor: theme.colors.bgMain,
								borderColor: theme.colors.border,
							}}
						>
							<ShortcutHint
								theme={theme}
								keys={shortcutKeys ?? []}
								label={t('workflows.shell.try')}
								variant="row"
							/>
							<div className="max-h-48 overflow-y-auto scrollbar-thin">
								{availableEfforts.map((effort) => (
									<button
										key={effort}
										onClick={() => {
											onEffortChange(effort);
											setEffortMenuOpen(false);
										}}
										className="w-full text-left px-3 py-1.5 text-xs whitespace-nowrap hover:bg-white/10 transition-colors"
										style={{
											color:
												effort === currentEffort ? theme.colors.warning : theme.colors.textMain,
											backgroundColor:
												effort === currentEffort ? 'rgba(255,255,255,0.05)' : undefined,
										}}
									>
										{(newShell ? effortDisplayLabel(t, effort) : effort) ||
											t('workflows.shell.default')}
									</button>
								))}
							</div>
						</div>
					)}
				</div>
			)}
		</>
	);
});
