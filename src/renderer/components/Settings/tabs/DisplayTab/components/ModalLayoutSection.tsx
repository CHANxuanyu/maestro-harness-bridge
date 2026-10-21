import { Maximize2 } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { useT } from '../../../../../i18n';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { SectionCard } from './SectionCard';

interface ModalLayoutSectionProps {
	theme: Theme;
	resetModalSizes: () => void;
}

export function ModalLayoutSection({ theme, resetModalSizes }: ModalLayoutSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-modal-layout">
			<SettingsSectionHeading icon={Maximize2}>
				{t('settings.display.modal.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme} className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{t('settings.display.modal.title')}
					</div>
					<div className="text-xs mt-1" style={{ color: theme.colors.textDim }}>
						{t('settings.display.modal.description')}
					</div>
				</div>
				<button
					type="button"
					onClick={resetModalSizes}
					className="shrink-0 px-3 py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-85"
					style={{
						backgroundColor: theme.colors.bgActivity,
						border: `1px solid ${theme.colors.border}`,
						color: theme.colors.textMain,
					}}
				>
					{t('common.reset')}
				</button>
			</SectionCard>
		</div>
	);
}
