import { permissionModeLabel, permissionModeTooltip } from '../utils/displayLabels';
import { useT } from '../../../i18n';
import React, { memo, useCallback, useRef, useState } from 'react';
import {
	ArrowUp,
	Brain,
	Eye,
	History,
	ImageIcon,
	Keyboard,
	Mic,
	MoreHorizontal,
	PenLine,
	Pin,
	X,
} from 'lucide-react';
import type { Shortcut, Session, Theme, ThinkingMode } from '../../../types';
import { formatEnterToSend, isMacOS } from '../../../utils/shortcutFormatter';
import { resolveTabPermissionMode } from '../../../../shared/agentMetadata';
import { selectNewShellEnabled, useSettingsStore } from '../../../stores/settingsStore';
import { shortcutSuffix } from '../../ui/ShortcutHint';
import { updateAiTab, updateSessionWith } from '../../../stores/sessionStore';
import { captureException } from '../../../utils/sentry';
import { isCoarsePointer } from '../../../utils/touch';
import { useViewportBreakpoint } from '../../../hooks/ui';
import { usePhoneLayout } from '../../../hooks/ui/useViewportBreakpoint';
import {
	nextPermissionMode,
	permissionModeFields,
	setShowThinkingFields,
} from '../../../utils/tabHelpers';
import { addStagedImageIfUnique } from '../utils/stagedImages';
import { formatTerminalCwd } from '../utils/terminalPath';
import { ComposerOptionsSheet } from './ComposerOptionsSheet';
import { PermissionModeMenu } from './PermissionModeMenu';
import { effectiveStandardPermissionCapability } from '../../../../shared/codexAppServer';
import { toClaudeTokenModeSource } from '../../../../shared/claudeTokenMode';
import { ModelEffortPills } from './ModelEffortPills';
import { StopTurnButton } from '../../ui/StopTurnButton';

interface ToolbarControlsProps {
	contextUsage?: number;
	hasModelSelectionCapability?: boolean;
	session: Session;
	theme: Theme;
	isTerminalMode: boolean;
	canAttachImages: boolean;
	hasReadOnlyCapability: boolean;
	/** Whether `standard` mode is functional for this agent (has a working relay). */
	hasStandardCapability: boolean;
	enterToSend: boolean;
	setEnterToSend: (value: boolean) => void;
	setStagedImages: React.Dispatch<React.SetStateAction<string[]>>;
	/** Whether the browser supports the Web Speech API (from useVoiceInput). */
	voiceSupported?: boolean;
	/** Whether voice dictation is currently listening. */
	isVoiceListening?: boolean;
	/** Toggle voice dictation on/off. Stable identity (see InputArea). */
	onToggleVoiceInput?: () => void;
	onOpenPromptComposer?: () => void;
	shortcuts?: Record<string, Shortcut>;
	showFlashNotification?: (message: string) => void;
	tabSaveToHistory: boolean;
	onToggleTabSaveToHistory?: () => void;
	tabShowThinking: ThinkingMode;
	onToggleTabShowThinking?: () => void;
	supportsThinking: boolean;
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
	/**
	 * Send the composer's contents. Only used on a phone, where the send button
	 * moves into this row (see the phone branch below); the desktop passes its
	 * send controls as `trailing` instead.
	 */
	processInput?: () => void;
	/**
	 * Phone only, set while the conversation on screen runs: the send key becomes
	 * Stop (the desktop passes the same through `trailing`).
	 */
	onStop?: () => void;
	/** Phone only: the composer holds a draft, which a running turn queues. */
	hasDraft?: boolean;
	/**
	 * Desktop only: rendered at the end of this row, inside the input card
	 * (notification settings and send), so the composer is one card with
	 * nothing hanging off its right edge.
	 */
	trailing?: React.ReactNode;
}

export const ToolbarControls = memo(function ToolbarControls({
	contextUsage = 0,
	hasModelSelectionCapability = false,
	session,
	theme,
	isTerminalMode,
	canAttachImages,
	hasReadOnlyCapability,
	hasStandardCapability,
	enterToSend,
	setEnterToSend,
	setStagedImages,
	voiceSupported,
	isVoiceListening,
	onToggleVoiceInput,
	onOpenPromptComposer,
	shortcuts,
	showFlashNotification,
	tabSaveToHistory,
	onToggleTabSaveToHistory,
	tabShowThinking,
	onToggleTabShowThinking,
	supportsThinking,
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
	processInput,
	onStop,
	hasDraft = false,
	trailing,
}: ToolbarControlsProps) {
	const t = useT();
	const newShell = useSettingsStore(selectNewShellEnabled);
	const isAiMode = session.inputMode === 'ai';
	const { isNarrow: isNarrowViewport } = useViewportBreakpoint();
	const phone = usePhoneLayout();
	const [toolbarExpanded, setToolbarExpanded] = useState(false);
	const [optionsSheetOpen, setOptionsSheetOpen] = useState(false);
	// On a phone every toggle moves into the options sheet, so the inline group
	// never renders there however the "..." was last left.
	const showToggleGroup = !phone && (newShell || !isNarrowViewport || toolbarExpanded);

	// Voice dictation is a primary touch affordance, so it stays in the always-
	// visible left action group (next to attach-image) rather than the collapsing
	// toggle group - burying it behind the "..." overflow on the exact phones it
	// targets would defeat the point. Shown only when the Web Speech API is
	// supported AND the primary pointer is coarse (touch), so mouse/keyboard
	// desktop users never see it.
	const showVoiceButton =
		!newShell && isAiMode && !!voiceSupported && !!onToggleVoiceInput && isCoarsePointer();

	const activeTab = session.aiTabs?.find((t) => t.id === session.activeTabId);
	const rawPermissionMode: 'full' | 'standard' | 'readonly' = resolveTabPermissionMode(activeTab);
	// New conversations already carry a supported permission. Keep that value
	// visible while capabilities load; retain the classic fallback.
	const currentPermissionMode: 'full' | 'standard' | 'readonly' =
		!newShell && rawPermissionMode === 'standard' && !hasStandardCapability
			? 'full'
			: rawPermissionMode;

	// Advertise the full-screen model/effort switcher from inside the dropdowns
	// the user already opened, which is where they are thinking about the
	// setting. Read from the shortcut map rather than hardcoding the chord: the
	// binding is rebindable, its display differs per platform, and on a build
	// that has no such shortcut this resolves to undefined so no hint renders
	// instead of pointing at a key combo that does nothing.
	// Handed to ModelEffortPills as raw keys rather than a formatted string:
	// a shortcut the user has cleared is present in the map with an EMPTY key
	// list, not absent from it - the store rebuilds the map from the bundled
	// defaults on every load, so the entry always exists here. ShortcutHint and
	// shortcutSuffix both render nothing for an empty list, which is what keeps
	// a cleared binding from drawing a bare "Try: ".
	const modelEffortKeys = shortcuts?.openModelEffort?.keys;

	// The three tab-scoped toggles below are all bindable chords. Read them live
	// from the tab shortcut map rather than spelling the default combo into the
	// tooltip: a user who rebinds one should see their own chord, not ours.
	const tabShortcuts = useSettingsStore((s) => s.tabShortcuts);
	// Offer the switch only when claude -p alone would make Standard work here.
	const canSwitchToPrint =
		newShell &&
		session.toolType === 'claude-code' &&
		!hasStandardCapability &&
		effectiveStandardPermissionCapability(
			{ supportsStandardPermissionMode: true },
			{ newShell },
			!!session.sessionSshRemoteConfig?.enabled,
			{ ...toClaudeTokenModeSource('api'), customPath: session.customPath }
		);

	const activeTabId = activeTab?.id;

	const imageInputRef = useRef<HTMLInputElement>(null);
	const selectionTargetRef = useRef<{ sessionId: string; tabId: string } | null>(null);
	const openImagePicker = () => {
		selectionTargetRef.current =
			newShell && activeTabId ? { sessionId: session.id, tabId: activeTabId } : null;
		imageInputRef.current?.click();
	};

	const imageFileInput = (
		<input
			ref={imageInputRef}
			type="file"
			accept="image/*"
			multiple
			className="hidden"
			onChange={(e) => {
				const files = Array.from(e.target.files || []);
				const target =
					selectionTargetRef.current ??
					(newShell && activeTabId ? { sessionId: session.id, tabId: activeTabId } : null);
				files.forEach((file) => {
					const reader = new FileReader();
					reader.onload = (event) => {
						if (event.target?.result) {
							const imageData = event.target.result as string;
							if (target) {
								updateAiTab(target.sessionId, target.tabId, (tab) => ({
									...tab,
									stagedImages: addStagedImageIfUnique(
										tab.stagedImages ?? [],
										imageData,
										showFlashNotification
									),
								}));
							} else {
								setStagedImages((prev) =>
									addStagedImageIfUnique(prev, imageData, showFlashNotification)
								);
							}
						}
					};
					reader.onerror = (event) => {
						captureException(reader.error ?? event, {
							extra: {
								component: 'InputArea.ToolbarControls',
								action: 'attachImage.readError',
								fileName: file.name,
								fileType: file.type,
								fileSize: file.size,
							},
						});
						showFlashNotification?.(t('workflows.shell.extraFailedToAttachImage'));
					};
					reader.onabort = (event) => {
						captureException(new Error('Image attachment read aborted'), {
							extra: {
								component: 'InputArea.ToolbarControls',
								action: 'attachImage.readAbort',
								fileName: file.name,
								fileType: file.type,
								fileSize: file.size,
								eventType: event.type,
							},
						});
						showFlashNotification?.(t('workflows.shell.extraImageAttachmentCanceled'));
					};
					reader.readAsDataURL(file);
				});
				e.target.value = '';
			}}
		/>
	);

	// The sheet NAMES a mode rather than stepping to the next one, so both
	// writes go through the shared field patches instead of a second inline copy
	// of "keep readOnlyMode and permissionMode in lockstep" / "clear the
	// thinking logs when the mode goes off".
	const handlePermissionModeChange = useCallback(
		(mode: 'full' | 'standard' | 'readonly') => {
			if (!activeTabId) return;
			updateSessionWith(session.id, (s) => ({
				...s,
				aiTabs: s.aiTabs.map((t) =>
					t.id === activeTabId ? { ...t, ...permissionModeFields(mode) } : t
				),
			}));
		},
		[session.id, activeTabId]
	);

	const handleThinkingModeChange = useCallback(
		(mode: ThinkingMode) => {
			if (!activeTabId) return;
			updateSessionWith(session.id, (s) => ({
				...s,
				aiTabs: s.aiTabs.map((t) =>
					t.id === activeTabId ? { ...t, ...setShowThinkingFields(t, mode) } : t
				),
			}));
		},
		[session.id, activeTabId]
	);

	// Phone: the row holds only what a thumb reaches for mid-sentence - attach an
	// image, send, and the "..." that opens every other setting as a half-screen
	// sheet. The prompt composer and the notification bell are dropped outright
	// (both open surfaces of their own, neither belongs on a 390px composer),
	// the model and effort pills move into the sheet, and the send button moves
	// here from the column beside the composer so the three controls sit on one
	// reachable line.
	if (phone) {
		const sendLabel = isTerminalMode
			? t('workflows.shell.runCommand')
			: onStop
				? t('workflows.shell.queueMessage')
				: t('workflows.shell.sendMessage');
		return (
			<>
				<div className="flex min-w-0 items-center gap-1 px-2 pb-2 pt-1">
					{isTerminalMode && (
						<div
							className="text-xs font-mono opacity-60 px-2 truncate min-w-0 flex-1"
							style={{ color: theme.colors.textDim }}
						>
							{formatTerminalCwd(session)}
						</div>
					)}
					{isAiMode && canAttachImages && (
						<button
							onClick={openImagePicker}
							className="flex h-9 w-9 items-center justify-center rounded opacity-70"
							title={t('workflows.shell.attachImage')}
							aria-label={t('workflows.shell.attachImage')}
						>
							<ImageIcon className="w-5 h-5" />
						</button>
					)}
					{showVoiceButton && (
						<button
							type="button"
							onClick={onToggleVoiceInput}
							className={`flex h-9 w-9 items-center justify-center rounded transition-colors ${
								isVoiceListening ? 'animate-pulse' : 'opacity-70'
							}`}
							style={
								isVoiceListening
									? { color: theme.colors.accent, backgroundColor: `${theme.colors.accent}20` }
									: undefined
							}
							title={
								isVoiceListening
									? t('workflows.shell.stopVoiceInput')
									: t('workflows.shell.voiceInput')
							}
							aria-label={
								isVoiceListening
									? t('workflows.shell.stopVoiceInput')
									: t('workflows.shell.startVoiceInput')
							}
							aria-pressed={!!isVoiceListening}
						>
							<Mic className="w-5 h-5" />
						</button>
					)}
					{imageFileInput}
					{/* Send sits in the MIDDLE, between the left actions and the "...", so
					    it is the one control at the centre of the thumb's arc. While the
					    turn on screen runs it is Stop; a draft brings the key back to
					    queue it, with Stop beside it. */}
					{(processInput || onStop) && (
						<div className="mx-auto flex items-center gap-2">
							{onStop && (
								<StopTurnButton
									theme={theme}
									onClick={onStop}
									variant="icon"
									className="h-9 w-14 rounded-lg"
								/>
							)}
							{processInput && (!onStop || hasDraft) && (
								<button
									type="button"
									onClick={() => processInput()}
									className="flex h-9 w-14 items-center justify-center rounded-lg shadow-sm transition-all"
									style={{
										backgroundColor: theme.colors.accent,
										color: theme.colors.accentForeground,
									}}
									title={sendLabel}
									aria-label={sendLabel}
								>
									<ArrowUp className="w-5 h-5" />
								</button>
							)}
						</div>
					)}
					<button
						type="button"
						onClick={() => setOptionsSheetOpen(true)}
						className="flex h-9 w-9 items-center justify-center rounded-full transition-all opacity-70"
						style={{ color: theme.colors.textDim, border: `1px solid ${theme.colors.border}` }}
						title={t('workflows.shell.moreOptions')}
						aria-label={t('workflows.shell.moreOptions')}
						aria-haspopup="dialog"
						aria-expanded={optionsSheetOpen}
						data-testid="composer-options-button"
					>
						<MoreHorizontal className="w-5 h-5" />
					</button>
				</div>
				{isAiMode && (
					<ComposerOptionsSheet
						open={optionsSheetOpen}
						onClose={() => setOptionsSheetOpen(false)}
						theme={theme}
						agentId={session.toolType}
						tabSaveToHistory={tabSaveToHistory}
						onToggleTabSaveToHistory={onToggleTabSaveToHistory}
						hasReadOnlyCapability={hasReadOnlyCapability}
						hasStandardCapability={hasStandardCapability}
						permissionMode={currentPermissionMode}
						onPermissionModeChange={handlePermissionModeChange}
						supportsThinking={supportsThinking}
						tabShowThinking={tabShowThinking}
						onThinkingModeChange={onToggleTabShowThinking ? handleThinkingModeChange : undefined}
						currentModel={currentModel}
						availableModels={availableModels}
						onModelChange={onModelChange}
						currentEffort={currentEffort}
						availableEfforts={availableEfforts}
						onEffortChange={onEffortChange}
					/>
				)}
			</>
		);
	}

	// Ghost controls, the way a chat composer draws its settings: no fill and no
	// border, dim when off, the icon (or the label) takes the color when on.
	const ghost =
		'flex items-center gap-1 rounded-md px-1.5 py-1 text-xs whitespace-nowrap cursor-pointer transition-all hover:bg-white/10';

	return (
		<div className="flex min-w-0 flex-wrap items-center gap-1 px-2 pb-2 pt-1">
			{/* Left: what the user adds to the message and how the turn runs. In AI
			    mode it keeps its own width (flex-auto), so a composer too narrow for
			    both groups wraps the right one onto its own row; terminal mode keeps
			    flex-1 so its cwd still truncates in place. */}
			<div className={`flex min-w-0 gap-1 items-center ${isTerminalMode ? 'flex-1' : 'flex-auto'}`}>
				{isTerminalMode && (
					<div
						className="text-xs font-mono opacity-60 px-2 truncate"
						style={{ color: theme.colors.textDim }}
					>
						{formatTerminalCwd(session)}
					</div>
				)}
				{isAiMode && canAttachImages && (
					<button
						onClick={openImagePicker}
						className="p-1 hover:bg-white/10 rounded opacity-50 hover:opacity-100"
						title={t('workflows.shell.attachImage')}
					>
						<ImageIcon className="w-4 h-4" />
					</button>
				)}
				{!newShell && isAiMode && onOpenPromptComposer && (
					<button
						onClick={onOpenPromptComposer}
						className="p-1 hover:bg-white/10 rounded opacity-50 hover:opacity-100"
						title={t('workflows.shell.openPromptComposervalue', {
							p0: shortcutSuffix(shortcuts?.openPromptComposer?.keys),
						})}
					>
						<PenLine className="w-4 h-4" />
					</button>
				)}
				{showVoiceButton && (
					<button
						type="button"
						onClick={onToggleVoiceInput}
						className={`p-1 rounded transition-colors ${
							isVoiceListening ? 'animate-pulse' : 'hover:bg-white/10 opacity-50 hover:opacity-100'
						}`}
						style={
							isVoiceListening
								? { color: theme.colors.accent, backgroundColor: `${theme.colors.accent}20` }
								: undefined
						}
						title={
							isVoiceListening
								? t('workflows.shell.stopVoiceInput')
								: t('workflows.shell.voiceInput')
						}
						aria-label={
							isVoiceListening
								? t('workflows.shell.stopVoiceInput')
								: t('workflows.shell.startVoiceInput')
						}
						aria-pressed={!!isVoiceListening}
					>
						<Mic className="w-4 h-4" />
					</button>
				)}
				{imageFileInput}

				{!newShell && isNarrowViewport && (
					<button
						type="button"
						onClick={() => setToolbarExpanded((v) => !v)}
						className="p-1 hover:bg-white/10 rounded opacity-50 hover:opacity-100"
						style={{ color: theme.colors.textDim }}
						title={
							toolbarExpanded ? t('workflows.shell.hideOptions') : t('workflows.shell.showOptions')
						}
						aria-label={
							toolbarExpanded
								? t('workflows.shell.hideToolbarOptions')
								: t('workflows.shell.showToolbarOptions')
						}
					>
						{toolbarExpanded ? <X className="w-4 h-4" /> : <MoreHorizontal className="w-4 h-4" />}
					</button>
				)}

				<div
					className={`flex items-center gap-0.5 ${showToggleGroup ? '' : 'hidden'}`}
					data-tour="toolbar-toggles"
				>
					{isAiMode &&
						hasReadOnlyCapability &&
						(newShell ? (
							<PermissionModeMenu
								theme={theme}
								agentId={session.toolType}
								mode={currentPermissionMode}
								hasStandardCapability={hasStandardCapability}
								standardUnavailableNotice={
									session.sessionSshRemoteConfig?.enabled
										? 'workflows.sessions.standardTransportRefused'
										: 'workflows.sessions.standardPrintNotice'
								}
								onChange={handlePermissionModeChange}
								onSwitchToPrint={
									canSwitchToPrint
										? () =>
												updateSessionWith(session.id, (s) => ({
													...s,
													...toClaudeTokenModeSource('api'),
												}))
										: undefined
								}
							/>
						) : (
							<button
								onClick={() =>
									handlePermissionModeChange(
										nextPermissionMode(currentPermissionMode, hasStandardCapability)
									)
								}
								className={`${ghost} ${currentPermissionMode === 'standard' ? 'opacity-60 hover:opacity-100' : ''}`}
								style={{
									color:
										currentPermissionMode === 'readonly'
											? theme.colors.warning
											: currentPermissionMode === 'full'
												? theme.colors.accent
												: theme.colors.textDim,
								}}
								title={`${permissionModeTooltip(
									t,
									currentPermissionMode,
									session.toolType
								)}${shortcutSuffix(tabShortcuts.toggleReadOnlyMode?.keys)}`}
							>
								<Eye className="w-3.5 h-3.5" />
								<span>{permissionModeLabel(t, currentPermissionMode, session.toolType)}</span>
							</button>
						))}
					{!newShell && isAiMode && supportsThinking && onToggleTabShowThinking && (
						<button
							onClick={onToggleTabShowThinking}
							className={`${ghost} ${tabShowThinking !== 'off' ? '' : 'opacity-40 hover:opacity-100'}`}
							style={{
								color:
									tabShowThinking === 'sticky'
										? theme.colors.warning
										: tabShowThinking === 'on'
											? theme.colors.accentText
											: theme.colors.textDim,
							}}
							title={`${
								tabShowThinking === 'off'
									? t('workflows.shell.extraShowThinkingClickToStreamAiReasoning')
									: tabShowThinking === 'on'
										? t('workflows.shell.extraThinkingTemporaryClickForStickyMode')
										: t('workflows.shell.extraThinkingStickyClickToTurnOff')
							}${shortcutSuffix(tabShortcuts.toggleShowThinking?.keys)}`}
							aria-label={t('workflows.shell.thinking2')}
							aria-pressed={tabShowThinking !== 'off'}
						>
							<Brain className="w-3.5 h-3.5" />
							{tabShowThinking === 'sticky' && <Pin className="w-2.5 h-2.5" />}
						</button>
					)}
					{!newShell && isAiMode && onToggleTabSaveToHistory && (
						<button
							onClick={onToggleTabSaveToHistory}
							className={`${ghost} ${tabSaveToHistory ? '' : 'opacity-40 hover:opacity-100'}`}
							style={{ color: tabSaveToHistory ? theme.colors.accent : theme.colors.textDim }}
							title={t('workflows.shell.saveToHistoryvalueSynopsisAddedAfterEachCompletion', {
								p0: shortcutSuffix(tabShortcuts.toggleSaveToHistory?.keys),
							})}
							aria-label={t('workflows.shell.history')}
							aria-pressed={tabSaveToHistory}
						>
							<History className="w-3.5 h-3.5" />
						</button>
					)}
					{!newShell && (
						<button
							onClick={() => setEnterToSend(!enterToSend)}
							className={`${ghost} opacity-40 hover:opacity-100`}
							style={{ color: theme.colors.textDim }}
							title={t('workflows.input.sendWith', {
								key: enterToSend ? `${isMacOS() ? 'Cmd' : 'Ctrl'}+Enter` : 'Enter',
							})}
						>
							<Keyboard className="w-3.5 h-3.5" />
							<span className="text-2xs">{formatEnterToSend(enterToSend)}</span>
						</button>
					)}
				</div>
			</div>

			{/* Right: which model answers, then send, in the corner of the card. */}
			<div className="ml-auto flex items-center gap-1">
				{newShell && isAiMode && contextUsage >= 50 && (
					<span
						className="text-xs whitespace-nowrap tabular-nums"
						style={{ color: theme.colors.textDim }}
					>
						{t('workflows.shell.contextUsage', { percent: Math.round(contextUsage) })}
					</span>
				)}
				<ModelEffortPills
					allowModelSelection={newShell && hasModelSelectionCapability}
					isVisible={isAiMode}
					theme={theme}
					shortcutKeys={modelEffortKeys}
					currentModel={currentModel}
					currentEffort={currentEffort}
					availableModels={availableModels}
					availableEfforts={availableEfforts}
					onModelChange={onModelChange}
					onEffortChange={onEffortChange}
					modelMenuOpen={modelMenuOpen}
					setModelMenuOpen={setModelMenuOpen}
					modelMenuRef={modelMenuRef}
					effortMenuOpen={effortMenuOpen}
					setEffortMenuOpen={setEffortMenuOpen}
					effortMenuRef={effortMenuRef}
				/>
				{trailing}
			</div>
		</div>
	);
});
