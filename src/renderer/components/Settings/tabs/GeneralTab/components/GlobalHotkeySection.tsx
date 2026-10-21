import { Keyboard } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { formatShortcutKeys } from '../../../../../utils/shortcutFormatter';
import { KeyCaptureButton } from '../../../../ui/KeyCaptureButton';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { useT } from '../../../../../i18n';

interface GlobalHotkeySectionProps {
	theme: Theme;
	globalShowHotkey: string[];
	setGlobalShowHotkey: (keys: string[]) => void;
}

export function GlobalHotkeySection({
	theme,
	globalShowHotkey,
	setGlobalShowHotkey,
}: GlobalHotkeySectionProps) {
	const t = useT();
	return (
		<div data-setting-id="general-global-show-hotkey">
			<SettingsSectionHeading icon={Keyboard}>
				{t('settings.general.hotkey.heading')}
			</SettingsSectionHeading>
			<p className="text-xs opacity-70 mb-2">
				{t('settings.general.hotkey.description', {
					example: formatShortcutKeys(['Meta', 'Shift', 'M']),
				})}
			</p>
			<div className="flex justify-center">
				<KeyCaptureButton
					theme={theme}
					keys={globalShowHotkey}
					onKeysChange={setGlobalShowHotkey}
					emptyLabel={t('settings.general.hotkey.empty')}
				/>
			</div>
		</div>
	);
}
