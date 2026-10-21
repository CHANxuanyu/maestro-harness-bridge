import { SpellCheck } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { SettingCheckbox } from '../../../../SettingCheckbox';
import { useT } from '../../../../../i18n';

interface SpellCheckSectionProps {
	theme: Theme;
	spellCheck: boolean;
	setSpellCheck: (enabled: boolean) => void;
}

export function SpellCheckSection({ theme, spellCheck, setSpellCheck }: SpellCheckSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="general-spell-check">
			<SettingCheckbox
				icon={SpellCheck}
				sectionLabel={t('settings.general.spell.heading')}
				title={t('settings.general.spell.title')}
				description={t('settings.general.spell.description')}
				checked={spellCheck}
				onChange={setSpellCheck}
				theme={theme}
			/>
		</div>
	);
}
