import { Columns3 } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { useSettingsStore } from '../../../../../stores/settingsStore';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';
import { SectionCard } from './SectionCard';
import { ToggleSettingRow } from './ToggleSettingRow';

/**
 * The opt-in switch for the new shell (docs/roadmap/new-shell.md). It swaps
 * the window's layout in place, so it reads and writes the store directly
 * rather than threading another prop through the Display tab.
 */
export function NewShellSection({ theme }: { theme: Theme }) {
	const t = useT();
	const newShell = useSettingsStore((s) => s.newShell);
	const setNewShell = useSettingsStore((s) => s.setNewShell);
	return (
		<div data-setting-id="display-new-shell">
			<SettingsSectionHeading icon={Columns3}>
				{t('settings.display.newShell.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.newShell.title')}
					description={t('settings.display.newShell.description')}
					checked={newShell}
					onChange={setNewShell}
					ariaLabel={t('settings.display.newShell.title')}
				/>
			</SectionCard>
		</div>
	);
}
