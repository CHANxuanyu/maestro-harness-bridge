import { MessagesSquare } from 'lucide-react';
import type { Theme } from '../../../../../types';
import { useT } from '../../../../../i18n';
import { SettingsSectionHeading } from '../../../SettingsSectionHeading';
import { SectionCard } from './SectionCard';
import { ToggleSettingRow } from './ToggleSettingRow';

interface GroupChatSectionProps {
	theme: Theme;
	groupChatAutoScroll: boolean;
	setGroupChatAutoScroll: (enabled: boolean) => void;
}

export function GroupChatSection({
	theme,
	groupChatAutoScroll,
	setGroupChatAutoScroll,
}: GroupChatSectionProps) {
	const t = useT();
	return (
		<div data-setting-id="display-group-chat-auto-scroll">
			<SettingsSectionHeading icon={MessagesSquare}>
				{t('settings.display.groupChat.heading')}
			</SettingsSectionHeading>
			<SectionCard theme={theme}>
				<ToggleSettingRow
					theme={theme}
					title={t('settings.display.groupChat.title')}
					description={t('settings.display.groupChat.description')}
					checked={groupChatAutoScroll}
					onChange={setGroupChatAutoScroll}
					ariaLabel={t('settings.display.groupChat.aria')}
				/>
			</SectionCard>
		</div>
	);
}
