import React, { useRef, useCallback, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { Theme } from '../types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal } from './ui/Modal';
import { useI18n } from '../i18n';

interface DeleteAgentConfirmModalProps {
	theme: Theme;
	agentName: string;
	workingDirectory: string;
	onConfirm: () => void;
	onConfirmAndErase: () => void;
	onClose: () => void;
}

export function DeleteAgentConfirmModal({
	theme,
	agentName,
	workingDirectory,
	onConfirm,
	onConfirmAndErase,
	onClose,
}: DeleteAgentConfirmModalProps) {
	const confirmButtonRef = useRef<HTMLButtonElement>(null);
	const { t, tRich } = useI18n();
	const [confirmationText, setConfirmationText] = useState('');
	const isEraseEnabled = confirmationText === agentName;

	const handleConfirm = useCallback(() => {
		onConfirm();
		onClose();
	}, [onConfirm, onClose]);

	const handleConfirmAndErase = useCallback(() => {
		onConfirmAndErase();
		onClose();
	}, [onConfirmAndErase, onClose]);

	// Stop Enter key propagation to prevent parent handlers from triggering after modal closes
	const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
		if (e.key === 'Enter') {
			e.stopPropagation();
			action();
		}
	};

	return (
		<Modal
			theme={theme}
			title={t('workflows.deleteAgent.title')}
			// Reachable by right-clicking any Left Bar row, so the agent being
			// deleted is often not the highlighted one. The body names it, but a
			// destructive confirm should say what it targets in the header too.
			subtitle={agentName}
			priority={MODAL_PRIORITIES.CONFIRM}
			onClose={onClose}
			headerIcon={<Trash2 className="w-4 h-4" style={{ color: theme.colors.error }} />}
			width={540}
			zIndex={10000}
			initialFocusRef={confirmButtonRef}
			footer={
				<div className="flex gap-2 w-full flex-nowrap">
					<button
						type="button"
						onClick={onClose}
						onKeyDown={(e) => handleKeyDown(e, onClose)}
						className="px-3 py-1.5 rounded border hover:bg-white/5 transition-colors outline-none focus:ring-2 focus:ring-offset-1 text-xs whitespace-nowrap mr-auto"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					>
						{t('common.cancel')}
					</button>
					<button
						ref={confirmButtonRef}
						type="button"
						onClick={handleConfirm}
						onKeyDown={(e) => handleKeyDown(e, handleConfirm)}
						className="px-3 py-1.5 rounded transition-colors outline-none focus:ring-2 focus:ring-offset-1 text-xs whitespace-nowrap"
						style={{
							backgroundColor: `${theme.colors.error}99`,
							color: '#ffffff',
						}}
					>
						{t('workflows.deleteAgent.agentOnly')}
					</button>
					<button
						type="button"
						onClick={isEraseEnabled ? handleConfirmAndErase : undefined}
						onKeyDown={isEraseEnabled ? (e) => handleKeyDown(e, handleConfirmAndErase) : undefined}
						disabled={!isEraseEnabled}
						className={`px-3 py-1.5 rounded transition-colors outline-none focus:ring-2 focus:ring-offset-1 text-xs whitespace-nowrap ${
							!isEraseEnabled ? 'opacity-50 cursor-not-allowed' : ''
						}`}
						style={{
							backgroundColor: theme.colors.error,
							color: '#ffffff',
						}}
					>
						{t('workflows.deleteAgent.agentAndDirectory')}
					</button>
				</div>
			}
		>
			<div className="flex gap-4">
				<div
					className="flex-shrink-0 p-2 rounded-full h-fit"
					style={{ backgroundColor: `${theme.colors.error}20` }}
				>
					<AlertTriangle className="w-5 h-5" style={{ color: theme.colors.error }} />
				</div>
				<div className="space-y-3">
					<p className="leading-relaxed" style={{ color: theme.colors.textMain }}>
						<strong style={{ color: theme.colors.warning }}>
							{t('workflows.deleteAgent.danger')}
						</strong>{' '}
						{t('workflows.deleteAgent.warning', { name: agentName })}
					</p>
					<p className="text-sm leading-relaxed" style={{ color: theme.colors.textDim }}>
						{tRich('workflows.deleteAgent.directoryNote', {
							option: <strong>{t('workflows.deleteAgent.agentAndDirectory')}</strong>,
						})}
					</p>
					<code
						className="block text-xs px-2 py-1 rounded break-all"
						style={{
							backgroundColor: theme.colors.bgActivity,
							color: theme.colors.textDim,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						{workingDirectory}
					</code>
					<p className="text-xs leading-relaxed" style={{ color: theme.colors.textDim }}>
						{t('workflows.deleteAgent.typeNamePrompt')}
					</p>
					<input
						type="text"
						value={confirmationText}
						onChange={(e) => setConfirmationText(e.target.value)}
						placeholder=""
						className="block w-full text-sm px-3 py-2 rounded outline-none focus:ring-2 focus:ring-offset-1"
						style={{
							backgroundColor: theme.colors.bgMain,
							color: theme.colors.textMain,
							border: `1px solid ${theme.colors.border}`,
						}}
						aria-label={t('workflows.deleteAgent.typeNameLabel')}
					/>
				</div>
			</div>
		</Modal>
	);
}
