/**
 * TypographyChoiceModal - the one-time "how should Maestro read?" chooser.
 *
 * Maestro was monospace on every surface until per-surface fonts existed. Now
 * that the interface, chat, terminal, preview, document graph, and editor can
 * each carry their own face, the honest opening question is one choice rather
 * than six pickers, so this offers two presets as large side-by-side cards and
 * writes all six settings at once.
 *
 * Shown once, gated on the `typographyPromptSeen` setting. That flag is false
 * both on a fresh install and on every install that predates it, which is what
 * makes the SAME modal reach existing users once after the update - they get
 * copy that names the look they already have rather than new-user copy that
 * would read as if their preference were being ignored.
 *
 * There is deliberately no "Not now". A preset is always in effect, so
 * declining is not an available outcome - whichever card is selected when this
 * closes IS the answer. The close button and Escape still work and change
 * nothing: the shipped defaults produce the Hacker look, so a user who leaves
 * keeps exactly what they had. The flag is set on any exit, so the modal
 * cannot come back and nag.
 */

import { useCallback, useRef, useState } from 'react';
import { Check, Sparkles, Terminal, Type } from 'lucide-react';
import type { Theme } from '../types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal } from './ui/Modal';
import { ModalBackButton } from './ui/ModalBackButton';
import {
	TYPOGRAPHY_PRESETS,
	TYPOGRAPHY_PRESET_IDS,
	type TypographyPresetId,
} from '../../shared/typographyPresets';
import {
	withMonoFallback,
	SANS_FALLBACK_STACK,
	FONT_PREVIEW_PROSE,
	FONT_PREVIEW_CODE,
} from '../../shared/fontStack';
import { logger } from '../utils/logger';
import { useT, type MessageKey, type TFunction } from '../i18n';

export interface TypographyChoiceModalProps {
	theme: Theme;
	isOpen: boolean;
	/**
	 * Whether this user was already using Maestro before the chooser existed.
	 * Only changes the copy - both audiences get the same two choices.
	 */
	isReturningUser: boolean;
	/** Apply a preset's five font settings. */
	onChoose: (id: TypographyPresetId) => void;
	/** Mark the prompt seen and close, with or without a choice. */
	onDismiss: () => void;
	/**
	 * Reopen the previous step of the series. Omitted when this is the first
	 * step, in which case no Back control is drawn - a disabled one would claim
	 * a history that does not exist.
	 */
	onBack?: () => void;
	/** Open Settings on the Display tab, where the individual pickers live. */
	onOpenDisplaySettings: () => void;
}

/**
 * Preview lines rendered inside each card, in that preset's own faces. Shared
 * with the Settings font pickers so a face reads the same on both screens.
 */
const PREVIEW_PROSE = FONT_PREVIEW_PROSE;
const PREVIEW_CODE = FONT_PREVIEW_CODE;

/**
 * Display text for the shared preset table, which stays English because the
 * Settings picker and the CLI read it too. Keyed by preset id and by the
 * surface's English label; an unknown label renders as-is.
 */
const PRESET_TEXT_KEYS: Record<TypographyPresetId, { label: MessageKey; tagline: MessageKey }> = {
	default: {
		label: 'workflows.typography.preset.default',
		tagline: 'workflows.typography.preset.defaultTagline',
	},
	hacker: {
		label: 'workflows.typography.preset.hacker',
		tagline: 'workflows.typography.preset.hackerTagline',
	},
};
const SURFACE_LABEL_KEYS: Record<string, MessageKey> = {
	Interface: 'workflows.typography.surface.interface',
	'AI chat': 'workflows.typography.surface.aiChat',
	Terminal: 'workflows.typography.surface.terminal',
	'File preview': 'workflows.typography.surface.filePreview',
	'Document graph': 'workflows.typography.surface.documentGraph',
	'File editor': 'workflows.typography.surface.fileEditor',
};

function presetLabel(t: TFunction, id: TypographyPresetId): string {
	const keys = PRESET_TEXT_KEYS[id];
	return keys ? t(keys.label) : TYPOGRAPHY_PRESETS[id].label;
}

function PresetCard({
	theme,
	presetId,
	selected,
	onSelect,
	buttonRef,
}: {
	theme: Theme;
	presetId: TypographyPresetId;
	selected: boolean;
	onSelect: () => void;
	buttonRef?: React.Ref<HTMLButtonElement>;
}) {
	const t = useT();
	const preset = TYPOGRAPHY_PRESETS[presetId];
	// Each card previews itself in its OWN faces rather than the app's current
	// ones, so the difference between the two is visible before committing to
	// either. Resolved here rather than read from settings for the same reason.
	const proseFont =
		presetId === 'hacker' ? withMonoFallback(preset.fonts.fontFamily) : SANS_FALLBACK_STACK;
	const codeFont = withMonoFallback('');

	return (
		<button
			ref={buttonRef}
			type="button"
			onClick={onSelect}
			aria-pressed={selected}
			data-testid={`typography-preset-${presetId}`}
			className="flex-1 min-w-0 flex flex-col gap-3 p-5 rounded-xl border-2 text-left transition-colors hover:bg-white/5"
			style={{
				borderColor: selected ? theme.colors.accent : theme.colors.border,
				backgroundColor: selected ? `${theme.colors.accent}12` : 'transparent',
			}}
		>
			<div className="flex items-center gap-2">
				{presetId === 'hacker' ? (
					<Terminal className="w-4 h-4 shrink-0" style={{ color: theme.colors.accent }} />
				) : (
					<Sparkles className="w-4 h-4 shrink-0" style={{ color: theme.colors.accent }} />
				)}
				<span
					className="text-base font-semibold"
					style={{ color: theme.colors.textMain, fontFamily: proseFont }}
				>
					{presetLabel(t, presetId)}
				</span>
				{selected && (
					<span
						className="ml-auto flex items-center gap-1 text-xs-plus font-bold px-2 py-0.5 rounded-full"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						<Check className="w-3 h-3" />
						{t('workflows.typography.selected')}
					</span>
				)}
			</div>

			<p className="text-xs" style={{ color: theme.colors.textDim, fontFamily: proseFont }}>
				{PRESET_TEXT_KEYS[presetId] ? t(PRESET_TEXT_KEYS[presetId].tagline) : preset.tagline}
			</p>

			{/* Live sample: prose in the preset's reading face, code in its code face. */}
			<div
				className="rounded-lg p-3 space-y-2 border"
				style={{ backgroundColor: theme.colors.bgActivity, borderColor: theme.colors.border }}
			>
				<p
					className="text-sm leading-snug"
					style={{ color: theme.colors.textMain, fontFamily: proseFont }}
				>
					{PREVIEW_PROSE}
				</p>
				<p
					className="text-xs leading-snug"
					style={{ color: theme.colors.textDim, fontFamily: codeFont }}
				>
					{PREVIEW_CODE}
				</p>
			</div>

			<dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs-plus">
				{preset.surfaces.map((surface) => (
					<div key={surface.label} className="contents">
						<dt style={{ color: theme.colors.textDim, fontFamily: proseFont }}>
							{SURFACE_LABEL_KEYS[surface.label]
								? t(SURFACE_LABEL_KEYS[surface.label])
								: surface.label}
						</dt>
						<dd
							className="text-right"
							style={{
								color: surface.kind === 'mono' ? theme.colors.accent : theme.colors.textMain,
								fontFamily: surface.kind === 'mono' ? codeFont : proseFont,
							}}
						>
							{surface.kind === 'mono'
								? t('workflows.typography.monospace')
								: t('workflows.typography.proportional')}
						</dd>
					</div>
				))}
			</dl>
		</button>
	);
}

export function TypographyChoiceModal({
	theme,
	isOpen,
	isReturningUser,
	onChoose,
	onDismiss,
	onBack,
	onOpenDisplaySettings,
}: TypographyChoiceModalProps) {
	// A returning user is already ON Hacker, so that card starts selected and
	// the choice reads as "keep this or try the other" rather than a blank form.
	const [selected, setSelected] = useState<TypographyPresetId>(
		isReturningUser ? 'hacker' : 'default'
	);
	const confirmRef = useRef<HTMLButtonElement>(null);
	const t = useT();

	const handleConfirm = useCallback(() => {
		onChoose(selected);
		onDismiss();
	}, [selected, onChoose, onDismiss]);

	const handleOpenSettings = useCallback(() => {
		// Applying first means the pickers open showing what was just chosen,
		// rather than the previous look the user is trying to move away from.
		onChoose(selected);
		onDismiss();
		onOpenDisplaySettings();
	}, [selected, onChoose, onDismiss, onOpenDisplaySettings]);

	if (!isOpen) return null;

	return (
		<Modal
			theme={theme}
			title={
				isReturningUser
					? t('workflows.typography.titleReturning')
					: t('workflows.typography.titleNew')
			}
			headerIcon={<Type className="w-4 h-4" style={{ color: theme.colors.accent }} />}
			priority={MODAL_PRIORITIES.TYPOGRAPHY_CHOICE}
			onClose={onDismiss}
			closeOnBackdropClick={false}
			width={780}
			maxWidthCss="92vw"
			initialFocusRef={confirmRef}
			testId="typography-choice-modal"
			footer={
				<div className="flex items-center gap-3 w-full">
					{onBack && (
						<ModalBackButton theme={theme} onBack={onBack} testId="typography-choice-back" />
					)}
					<button
						type="button"
						onClick={handleOpenSettings}
						className="text-xs underline underline-offset-2 hover:opacity-80 transition-opacity"
						style={{ color: theme.colors.textDim }}
					>
						{t('workflows.typography.fineTune')}
					</button>
					<div className="ml-auto flex items-center gap-2">
						<button
							ref={confirmRef}
							type="button"
							onClick={handleConfirm}
							data-testid="typography-choice-confirm"
							className="px-3 py-1.5 rounded text-xs font-bold"
							style={{
								backgroundColor: theme.colors.accent,
								color: theme.colors.accentForeground,
							}}
						>
							{t('workflows.typography.use', { name: presetLabel(t, selected) })}
						</button>
					</div>
				</div>
			}
		>
			<div className="space-y-4">
				<p className="text-sm leading-relaxed" style={{ color: theme.colors.textMain }}>
					{isReturningUser
						? t('workflows.typography.introReturning')
						: t('workflows.typography.introNew')}
				</p>

				<div className="flex gap-4">
					{TYPOGRAPHY_PRESET_IDS.map((id) => (
						<PresetCard
							key={id}
							theme={theme}
							presetId={id}
							selected={selected === id}
							onSelect={() => setSelected(id)}
						/>
					))}
				</div>

				<p className="text-xs leading-relaxed" style={{ color: theme.colors.textDim }}>
					{t('workflows.typography.footnote')}
				</p>
			</div>
		</Modal>
	);
}

/**
 * Debug hook so the chooser can be re-opened from the console after the flag is
 * set - otherwise verifying a copy change means clearing a setting first.
 * Usage: window.__showTypographyChoiceModal()
 */
export function exposeTypographyChoiceModalDebug(setOpen: (open: boolean) => void): void {
	(window as unknown as Record<string, unknown>).__showTypographyChoiceModal = () => {
		setOpen(true);
		logger.info('[TypographyChoiceModal] Modal triggered via console command');
	};
}

export default TypographyChoiceModal;
