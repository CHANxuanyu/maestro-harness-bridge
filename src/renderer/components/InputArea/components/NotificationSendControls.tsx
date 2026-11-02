import { useT } from '../../../i18n';
import { memo, useRef, useState } from 'react';
import { ArrowUp, Bell } from 'lucide-react';
import type { Theme } from '../../../types';
import { NotificationPopover } from '../../NotificationPopover';

interface NotificationSendControlsProps {
	theme: Theme;
	isTerminalMode: boolean;
	processInput: () => void;
}

export const NotificationSendControls = memo(function NotificationSendControls({
	theme,
	isTerminalMode,
	processInput,
}: NotificationSendControlsProps) {
	const t = useT();
	const [notificationPopoverOpen, setNotificationPopoverOpen] = useState(false);
	const notificationBtnRef = useRef<HTMLButtonElement>(null);

	return (
		// Sits at the end of the composer's toolbar row, inside the card: a quiet
		// bell, then the round send button in the corner.
		<div className="flex flex-shrink-0 items-center gap-1">
			<button
				ref={notificationBtnRef}
				type="button"
				onClick={() => setNotificationPopoverOpen((prev) => !prev)}
				className="p-1.5 rounded-md opacity-60 hover:opacity-100 hover:bg-white/10 transition-all"
				style={{ color: theme.colors.textDim }}
				title={t('workflows.shell.notificationSettings')}
			>
				<Bell className="w-4 h-4" />
			</button>
			{notificationPopoverOpen && (
				<NotificationPopover
					theme={theme}
					anchorRef={notificationBtnRef}
					onClose={() => setNotificationPopoverOpen(false)}
				/>
			)}
			<button
				type="button"
				onClick={() => processInput()}
				className="flex h-8 w-8 items-center justify-center rounded-full shadow-sm transition-all hover:opacity-90 cursor-pointer"
				style={{
					backgroundColor: theme.colors.accent,
					color: theme.colors.accentForeground,
				}}
				title={
					isTerminalMode ? t('workflows.shell.runCommandEnter') : t('workflows.shell.sendMessage')
				}
			>
				<ArrowUp className="w-4 h-4" />
			</button>
		</div>
	);
});
