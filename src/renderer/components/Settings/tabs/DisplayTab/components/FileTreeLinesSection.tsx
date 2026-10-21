import { ListTree } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { useT } from '../../../../../i18n';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { SectionCard } from './SectionCard';
import { ToggleSettingRow } from './ToggleSettingRow';

interface FileTreeLinesSectionProps {
	theme: Theme;
	fileTreeBranchConnectors: boolean;
	setFileTreeBranchConnectors: (value: boolean) => void;
}

/** Files pane tree lines (#1585). */
export function FileTreeLinesSection({
	theme,
	fileTreeBranchConnectors,
	setFileTreeBranchConnectors,
}: FileTreeLinesSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-file-tree-connectors">
			<SettingsSectionHeading icon={ListTree}>
				{t('settings.display.treeLines.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.treeLines.title')}
					description={t('settings.display.treeLines.description')}
					checked={fileTreeBranchConnectors}
					onChange={setFileTreeBranchConnectors}
					ariaLabel={t('settings.display.treeLines.aria')}
				/>
			</SectionCard>
		</div>
	);
}
