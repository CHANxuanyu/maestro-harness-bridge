import { FileText } from 'lucide-react';
import type { Theme } from '../../../../../types';
import {
	FILE_PREVIEW_TOOLBAR_BUTTON_KEYS,
	type FilePreviewToolbarButton,
	type FilePreviewToolbarVisibility,
} from '../../../../../stores/settingsStore';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { localizedFileManagerName, useT } from '../../../../../i18n';
import { TOOLBAR_BUTTON_LABEL_KEYS } from '../utils';
import { SectionCard } from './SectionCard';
import { ToggleSettingRow } from './ToggleSettingRow';

interface FileEditPreviewSectionProps {
	theme: Theme;
	fileEditShowLineNumbers: boolean;
	setFileEditShowLineNumbers: (enabled: boolean) => void;
	fileEditWordWrap: boolean;
	setFileEditWordWrap: (enabled: boolean) => void;
	filePreviewToolbarVisibility: FilePreviewToolbarVisibility;
	setFilePreviewToolbarButtonVisibility: (
		button: FilePreviewToolbarButton,
		visible: boolean
	) => void;
}

export function FileEditPreviewSection({
	theme,
	fileEditShowLineNumbers,
	setFileEditShowLineNumbers,
	fileEditWordWrap,
	setFileEditWordWrap,
	filePreviewToolbarVisibility,
	setFilePreviewToolbarButtonVisibility,
}: FileEditPreviewSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-file-edit-preview">
			<SettingsSectionHeading icon={FileText}>
				{t('settings.display.fileEdit.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.fileEdit.lineNumbers')}
					description={t('settings.display.fileEdit.lineNumbersDescription')}
					checked={fileEditShowLineNumbers}
					onChange={setFileEditShowLineNumbers}
					ariaLabel={t('settings.display.fileEdit.lineNumbers')}
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.fileEdit.wrap')}
					description={t('settings.display.fileEdit.wrapDescription')}
					checked={fileEditWordWrap}
					onChange={setFileEditWordWrap}
					ariaLabel={t('settings.display.fileEdit.wrap')}
					borderTop
				/>

				<div className="pt-3 border-t" style={{ borderColor: theme.colors.border }}>
					<p className="text-sm" style={{ color: theme.colors.textMain }}>
						{t('settings.display.fileEdit.toolbar')}
					</p>
					<p className="text-xs opacity-70 mt-0.5">
						{t('settings.display.fileEdit.toolbarDescription')}
					</p>
					<div className="grid grid-cols-2 gap-2 mt-3">
						{FILE_PREVIEW_TOOLBAR_BUTTON_KEYS.map((key) => {
							const label =
								key === 'revealInFolder'
									? t(TOOLBAR_BUTTON_LABEL_KEYS[key], {
											manager: localizedFileManagerName(t, window.maestro?.platform ?? ''),
										})
									: t(TOOLBAR_BUTTON_LABEL_KEYS[key]);
							const enabled = filePreviewToolbarVisibility[key];
							return (
								<label
									key={key}
									className="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer hover:bg-white/5 transition-colors"
								>
									<span className="text-xs" style={{ color: theme.colors.textMain }}>
										{label}
									</span>
									<button
										type="button"
										onClick={() => setFilePreviewToolbarButtonVisibility(key, !enabled)}
										className="relative w-8 h-4 rounded-full transition-colors flex-shrink-0 outline-none"
										tabIndex={0}
										style={{
											backgroundColor: enabled ? theme.colors.accent : theme.colors.bgActivity,
										}}
										role="switch"
										aria-checked={enabled}
										aria-label={t('settings.display.fileEdit.showButton', { label })}
									>
										<span
											className={`absolute left-0 top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
												enabled ? 'translate-x-4' : 'translate-x-0.5'
											}`}
										/>
									</button>
								</label>
							);
						})}
					</div>
				</div>
			</SectionCard>
		</div>
	);
}
