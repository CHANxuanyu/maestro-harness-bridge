/**
 * NewAgentChoiceModal - Presents two large tiles for creating a new agent:
 * 1. Manual Setup - Opens the standard NewInstanceModal
 * 2. Guided Setup (Wizard) - Opens the full onboarding wizard
 *
 * Includes an informational note about the in-tab wizard alternative.
 */

import { Bot, Wand2, Info } from 'lucide-react';
import type { Theme } from '../types';
import { Modal } from './ui/Modal';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { usePhoneLayout } from '../hooks/ui/useViewportBreakpoint';
import { useI18n } from '../i18n';

interface NewAgentChoiceModalProps {
	theme: Theme;
	onClose: () => void;
	onManualSetup: () => void;
	onWizardSetup: () => void;
	wizardAvailable: boolean;
}

export function NewAgentChoiceModal({
	theme,
	onClose,
	onManualSetup,
	onWizardSetup,
	wizardAvailable,
}: NewAgentChoiceModalProps) {
	const { t, tRich } = useI18n();
	const handleManual = () => {
		onClose();
		onManualSetup();
	};

	const handleWizard = () => {
		onClose();
		onWizardSetup();
	};

	// Two tiles side by side at 390px wrap their copy into columns a few words
	// wide; on a phone they stack.
	const phone = usePhoneLayout();
	const tileClass = `flex flex-col items-center gap-4 ${phone ? 'p-5' : 'p-8'} rounded-xl border-2 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-center`;

	return (
		<Modal
			theme={theme}
			title={t('workflows.newAgentChoice.title')}
			priority={MODAL_PRIORITIES.NEW_AGENT_CHOICE}
			onClose={onClose}
			width={680}
			testId="new-agent-choice-modal"
		>
			<div className="flex flex-col gap-5">
				{/* Two large tiles */}
				<div className={`grid gap-4 ${phone ? 'grid-cols-1' : 'grid-cols-2'}`}>
					{/* Manual Setup Tile */}
					<button
						type="button"
						onClick={handleManual}
						className={tileClass}
						style={{
							borderColor: theme.colors.border,
							backgroundColor: theme.colors.bgMain,
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.borderColor = theme.colors.accent;
							e.currentTarget.style.backgroundColor = `${theme.colors.accent}10`;
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.borderColor = theme.colors.border;
							e.currentTarget.style.backgroundColor = theme.colors.bgMain;
						}}
						data-testid="manual-setup-tile"
					>
						<div
							className="w-16 h-16 rounded-2xl flex items-center justify-center"
							style={{ backgroundColor: `${theme.colors.accent}20` }}
						>
							<Bot className="w-8 h-8" style={{ color: theme.colors.accent }} />
						</div>
						<div>
							<h3 className="text-base font-bold mb-1" style={{ color: theme.colors.textMain }}>
								{t('workflows.newAgentChoice.manual')}
							</h3>
							<p className="text-xs leading-relaxed" style={{ color: theme.colors.textDim }}>
								{t('workflows.newAgentChoice.manualDescription')}
							</p>
						</div>
					</button>

					{/* Wizard Setup Tile */}
					<button
						type="button"
						onClick={handleWizard}
						disabled={!wizardAvailable}
						className={`${tileClass} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100`}
						style={{
							borderColor: theme.colors.border,
							backgroundColor: theme.colors.bgMain,
						}}
						onMouseEnter={(e) => {
							if (!wizardAvailable) return;
							e.currentTarget.style.borderColor = theme.colors.accent;
							e.currentTarget.style.backgroundColor = `${theme.colors.accent}10`;
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.borderColor = theme.colors.border;
							e.currentTarget.style.backgroundColor = theme.colors.bgMain;
						}}
						data-testid="wizard-setup-tile"
					>
						<div
							className="w-16 h-16 rounded-2xl flex items-center justify-center"
							style={{ backgroundColor: `${theme.colors.accent}20` }}
						>
							<Wand2 className="w-8 h-8" style={{ color: theme.colors.accent }} />
						</div>
						<div>
							<h3 className="text-base font-bold mb-1" style={{ color: theme.colors.textMain }}>
								{t('workflows.newAgentChoice.guided')}
							</h3>
							<p className="text-xs leading-relaxed" style={{ color: theme.colors.textDim }}>
								{t('workflows.newAgentChoice.guidedDescription')}
							</p>
						</div>
					</button>
				</div>

				{/* Informational note (moved from wizard) */}
				<div
					className="flex items-start gap-3 px-4 py-3 rounded-lg text-xs leading-relaxed"
					style={{
						backgroundColor: `${theme.colors.accent}08`,
						border: `1px solid ${theme.colors.border}`,
					}}
				>
					<Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: theme.colors.accent }} />
					<span style={{ color: theme.colors.textDim }}>
						<strong style={{ color: theme.colors.textMain }}>
							{t('workflows.newAgentChoice.noteLabel')}
						</strong>{' '}
						{tRich('workflows.newAgentChoice.note', {
							command: (
								<code
									className="px-1 py-0.5 rounded text-xs-plus"
									style={{ backgroundColor: theme.colors.border }}
								>
									/wizard
								</code>
							),
							icon: (
								<Wand2
									className="inline w-3.5 h-3.5 align-text-bottom"
									style={{ color: theme.colors.accent }}
								/>
							),
						})}
					</span>
				</div>
			</div>
		</Modal>
	);
}
