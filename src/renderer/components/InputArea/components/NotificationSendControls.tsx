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
		<div className="flex flex-shrink-0 flex-col gap-2">
			<button
				ref={notificationBtnRef}
				type="button"
				onClick={() => setNotificationPopoverOpen((prev) => !prev)}
				className="p-2 rounded-lg border transition-all"
				style={{
					backgroundColor: theme.colors.bgMain,
					borderColor: theme.colors.border,
					color: theme.colors.textDim,
				}}
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
				className="p-2 rounded-md shadow-sm transition-all hover:opacity-90 cursor-pointer"
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
