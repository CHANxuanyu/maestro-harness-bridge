import type { Theme } from '../../../../../types';
import { MODAL_PRIORITIES } from '../../../../../constants/modalPriorities';
import { useI18n } from '../../../../../i18n';
import { Modal } from '../../../../ui/Modal';

interface BionifyInfoModalProps {
	theme: Theme;
	onClose: () => void;
}

export function BionifyInfoModal({ theme, onClose }: BionifyInfoModalProps) {
	const { t } = useI18n();
	// Algorithm tokens are literal syntax, never translated.
	const code = (value: string) => `\`${value}\``;
	return (
		<Modal
			theme={theme}
			title={t('settings.display.bionify.title')}
			priority={MODAL_PRIORITIES.GROUP_CHAT_INFO}
			onClose={onClose}
			resizeKey="bionify-reference"
			defaultSize={{ width: 520, height: 560 }}
			minSize={{ width: 380, height: 320 }}
			closeOnBackdropClick
		>
			<div className="space-y-4 text-sm" style={{ color: theme.colors.textMain }}>
				<div
					className="rounded border px-3 py-2 font-mono text-sm"
					style={{
						backgroundColor: theme.colors.bgMain,
						borderColor: theme.colors.border,
					}}
				>
					- 0 1 1 2 0.4
				</div>
				<p style={{ color: theme.colors.textDim }}>
					{t('settings.display.bionify.sign', {
						minus: code('-'),
						plus: code('+'),
						a: code('a'),
						and: code('and'),
						the: code('the'),
					})}
				</p>
				<ul className="list-disc pl-5 space-y-2" style={{ color: theme.colors.textDim }}>
					<li>{t('settings.display.bionify.lengths')}</li>
					<li>{t('settings.display.bionify.fraction', { example: code('0.4') })}</li>
					<li>{t('settings.display.bionify.default', { example: code('- 0 1 1 2 0.4') })}</li>
				</ul>
			</div>
		</Modal>
	);
}
