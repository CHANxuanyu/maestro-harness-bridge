import { Sparkles } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';
import { SectionCard } from './SectionCard';
import { ToggleSettingRow } from './ToggleSettingRow';

interface DocumentGraphSectionProps {
	theme: Theme;
	documentGraphShowExternalLinks: boolean;
	setDocumentGraphShowExternalLinks: (enabled: boolean) => void;
	documentGraphConfirmClose: boolean;
	setDocumentGraphConfirmClose: (enabled: boolean) => void;
	documentGraphMaxNodes: number;
	setDocumentGraphMaxNodes: (value: number) => void;
}

export function DocumentGraphSection({
	theme,
	documentGraphShowExternalLinks,
	setDocumentGraphShowExternalLinks,
	documentGraphConfirmClose,
	setDocumentGraphConfirmClose,
	documentGraphMaxNodes,
	setDocumentGraphMaxNodes,
}: DocumentGraphSectionProps) {
	const maxNodePercentage = ((documentGraphMaxNodes - 50) / 950) * 100;
	const t = useT();

	return (
		<div data-setting-id="display-document-graph">
			<SettingsSectionHeading icon={Sparkles}>
				{t('settings.display.graph.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.graph.externalLinks')}
					description={t('settings.display.graph.externalLinksDescription')}
					checked={documentGraphShowExternalLinks}
					onChange={setDocumentGraphShowExternalLinks}
				/>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.graph.confirmClose')}
					description={t('settings.display.graph.confirmCloseDescription')}
					checked={documentGraphConfirmClose}
					onChange={setDocumentGraphConfirmClose}
				/>
				<div>
					<label htmlFor="document-graph-max-nodes" className="block text-xs opacity-70 mb-2">
						{t('settings.display.graph.maxNodes')}
					</label>
					<div className="flex items-center gap-3">
						<input
							id="document-graph-max-nodes"
							type="range"
							min={50}
							max={1000}
							step={50}
							value={documentGraphMaxNodes}
							onChange={(event) => setDocumentGraphMaxNodes(Number(event.target.value))}
							className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
							style={{
								background: `linear-gradient(to right, ${theme.colors.accent} 0%, ${theme.colors.accent} ${maxNodePercentage}%, ${theme.colors.bgActivity} ${maxNodePercentage}%, ${theme.colors.bgActivity} 100%)`,
							}}
						/>
						<span
							className="text-sm font-mono w-12 text-right"
							style={{ color: theme.colors.textMain }}
						>
							{documentGraphMaxNodes}
						</span>
					</div>
					<p className="text-xs opacity-70 mt-1">
						{t('settings.display.graph.maxNodesDescription')}
					</p>
				</div>
			</SectionCard>
		</div>
	);
}
