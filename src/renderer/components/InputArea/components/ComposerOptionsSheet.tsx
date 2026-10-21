import { useT } from '../../../i18n';
/**
 * ComposerOptionsSheet - everything the composer toolbar offers, on a phone.
 *
 * The desktop toolbar spreads History / Access / Thinking / Model / Effort
 * across one row of pills, each opening its own dropdown. At 390px that row
 * cannot hold them: it wrapped, then the model and effort pills crowded the
 * send button, and their dropdowns opened as anchored popovers sized for a
 * mouse. So on a phone the toolbar keeps only what a thumb reaches for while
 * typing (attach an image, send) plus a "..." that opens this sheet.
 *
 * Everything here is an ACCORDION rather than a tap-to-cycle pill. Access and
 * Thinking are three-state on the desktop toolbar and advance one step per
 * click, which is a fine control beside a mouse and a poor one on a
 * touchscreen: the user cannot see the options, cannot go back, and has to tap
 * twice through a state they did not want. Listing the options and letting one
 * be picked is the same information in a form a finger can use. History is a
 * plain boolean, so it stays a switch.
 *
 * The rows themselves are the shared `PhoneSheetRows` vocabulary, so this sheet
 * and the file-preview actions sheet cannot drift on tap-target heights.
 */

import { memo, useState } from 'react';
import { Brain, Eye, Gauge, History, Sparkles } from 'lucide-react';
import type { Theme, ThinkingMode } from '../../../types';
import { permissionModeLabel } from '../utils/displayLabels';
import { THINKING_MODES } from '../../../../shared/types';
import { PhoneBottomSheet } from '../../ui/PhoneBottomSheet';
import {
	PHONE_SHEET_ROW_HEIGHT,
	PhoneSheetOptionRow,
	PhoneSheetSection,
} from '../../ui/PhoneSheetRows';

export type PermissionMode = 'full' | 'standard' | 'readonly';

interface ComposerOptionsSheetProps {
	open: boolean;
	onClose: () => void;
	theme: Theme;
	/** Provider id, so read-only reads as the agent's own word for it. */
	agentId?: string;
	tabSaveToHistory: boolean;
	onToggleTabSaveToHistory?: () => void;
	hasReadOnlyCapability: boolean;
	/** Whether `standard` is functional for this agent (has a working relay). */
	hasStandardCapability: boolean;
	permissionMode: PermissionMode;
	onPermissionModeChange: (mode: PermissionMode) => void;
	supportsThinking: boolean;
	tabShowThinking: ThinkingMode;
	onThinkingModeChange?: (mode: ThinkingMode) => void;
	currentModel?: string;
	availableModels: string[];
	onModelChange?: (model: string) => void;
	currentEffort?: string;
	availableEfforts: string[];
	onEffortChange?: (effort: string) => void;
}

export const ComposerOptionsSheet = memo(function ComposerOptionsSheet({
	open,
	onClose,
	theme,
	agentId,
	tabSaveToHistory,
	onToggleTabSaveToHistory,
	hasReadOnlyCapability,
	hasStandardCapability,
	permissionMode,
	onPermissionModeChange,
	supportsThinking,
	tabShowThinking,
	onThinkingModeChange,
	currentModel,
	availableModels,
	onModelChange,
	currentEffort,
	availableEfforts,
	onEffortChange,
}: ComposerOptionsSheetProps) {
	const t = useT();
	const THINKING_LABELS: Record<ThinkingMode, string> = {
		off: t('common.off'),
		on: t('common.on'),
		sticky: t('workflows.labels.sticky'),
	};
	const [expanded, setExpanded] = useState<string | null>(null);
	const toggle = (key: string) => setExpanded((prev) => (prev === key ? null : key));

	// `standard` is hidden for an agent with no working relay: offering it would
	// let the user pick a mode whose tool approvals never arrive.
	const permissionModes: PermissionMode[] = hasStandardCapability
		? ['full', 'standard', 'readonly']
		: ['full', 'readonly'];

	// A leading '' is the "(default)" entry - the agent's own configured model.
	const modelOptions = availableModels.includes('') ? availableModels : ['', ...availableModels];

	return (
		<PhoneBottomSheet
			open={open}
			onClose={onClose}
			theme={theme}
			ariaLabel={t('workflows.shell.composerOptions')}
			// Half the screen, per the brief: enough that an expanded model list is
			// usable without the sheet swallowing the conversation behind it.
			maxHeight="50dvh"
			// Opened by a plain tap, so no synthesized click trails the gesture and
			// the scrim can be live immediately.
			scrimArmMs={0}
			testId="composer-options-sheet"
		>
			{onToggleTabSaveToHistory && (
				<button
					type="button"
					onClick={onToggleTabSaveToHistory}
					className="flex w-full items-center gap-3 px-4 text-left border-b"
					style={{
						minHeight: PHONE_SHEET_ROW_HEIGHT,
						borderColor: theme.colors.border,
						color: theme.colors.textMain,
					}}
					role="switch"
					aria-checked={tabSaveToHistory}
					data-testid="composer-options-history"
				>
					<History
						className="w-4 h-4 shrink-0"
						style={{ color: tabSaveToHistory ? theme.colors.accent : theme.colors.textDim }}
					/>
					<span className="text-sm flex-1 min-w-0">{t('workflows.shell.history')}</span>
					<span
						className="text-xs font-mono"
						style={{ color: tabSaveToHistory ? theme.colors.accent : theme.colors.textDim }}
					>
						{tabSaveToHistory ? t('workflows.shell.on') : t('workflows.shell.off')}
					</span>
				</button>
			)}

			{hasReadOnlyCapability && (
				<PhoneSheetSection
					icon={Eye}
					label={t('workflows.shell.access')}
					value={permissionModeLabel(t, permissionMode, agentId)}
					accent={permissionMode === 'readonly' ? theme.colors.warning : theme.colors.accent}
					expanded={expanded === 'access'}
					onToggle={() => toggle('access')}
					theme={theme}
					testId="composer-options-access"
				>
					{permissionModes.map((mode) => (
						<PhoneSheetOptionRow
							key={mode}
							label={permissionModeLabel(t, mode, agentId)}
							selected={mode === permissionMode}
							accent={mode === 'readonly' ? theme.colors.warning : theme.colors.accent}
							onSelect={() => onPermissionModeChange(mode)}
							theme={theme}
						/>
					))}
				</PhoneSheetSection>
			)}

			{supportsThinking && onThinkingModeChange && (
				<PhoneSheetSection
					icon={Brain}
					label={t('workflows.shell.thinking2')}
					value={THINKING_LABELS[tabShowThinking]}
					accent={tabShowThinking === 'sticky' ? theme.colors.warning : theme.colors.accentText}
					expanded={expanded === 'thinking'}
					onToggle={() => toggle('thinking')}
					theme={theme}
					testId="composer-options-thinking"
				>
					{THINKING_MODES.map((mode) => (
						<PhoneSheetOptionRow
							key={mode}
							label={THINKING_LABELS[mode]}
							selected={mode === tabShowThinking}
							accent={mode === 'sticky' ? theme.colors.warning : theme.colors.accentText}
							onSelect={() => onThinkingModeChange(mode)}
							theme={theme}
						/>
					))}
				</PhoneSheetSection>
			)}

			{onEffortChange && availableEfforts.some((e) => e !== '') && (
				<PhoneSheetSection
					icon={Gauge}
					label={t('workflows.shell.effort')}
					value={currentEffort || t('common.default')}
					accent={theme.colors.warning}
					expanded={expanded === 'effort'}
					onToggle={() => toggle('effort')}
					theme={theme}
					testId="composer-options-effort"
				>
					{availableEfforts.map((effort) => (
						<PhoneSheetOptionRow
							key={effort || '__default__'}
							label={effort || t('workflows.shell.default')}
							selected={effort === currentEffort}
							accent={theme.colors.warning}
							onSelect={() => onEffortChange(effort)}
							theme={theme}
						/>
					))}
				</PhoneSheetSection>
			)}

			{onModelChange && availableModels.length > 0 && (
				<PhoneSheetSection
					icon={Sparkles}
					label={t('workflows.shell.model')}
					value={currentModel || t('common.default')}
					accent={theme.colors.accent}
					expanded={expanded === 'model'}
					onToggle={() => toggle('model')}
					theme={theme}
					testId="composer-options-model"
				>
					{modelOptions.map((model) => (
						<PhoneSheetOptionRow
							key={model || '__default__'}
							label={model || t('workflows.shell.default')}
							selected={model === currentModel}
							accent={theme.colors.accent}
							onSelect={() => onModelChange(model)}
							theme={theme}
						/>
					))}
				</PhoneSheetSection>
			)}
		</PhoneBottomSheet>
	);
});
