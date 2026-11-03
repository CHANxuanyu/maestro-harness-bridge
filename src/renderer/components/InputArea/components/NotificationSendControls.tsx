import { useT } from '../../../i18n';
import { memo, useRef, useState } from 'react';
import { ArrowUp, Bell } from 'lucide-react';
import type { Theme } from '../../../types';
import { NotificationPopover } from '../../NotificationPopover';
import { StopTurnButton } from '../../ui/StopTurnButton';

interface NotificationSendControlsProps {
	theme: Theme;
	isTerminalMode: boolean;
	processInput: () => void;
	/**
	 * Set while the conversation on screen runs (`resolveStopPlacement` chose the
	 * composer): the send key becomes Stop.
	 */
	onStop?: () => void;
	/** The composer holds something to send; while running it is queued. */
	hasDraft?: boolean;
}

export const NotificationSendControls = memo(function NotificationSendControls({
	theme,
	isTerminalMode,
	processInput,
	onStop,
	hasDraft = false,
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
			{/* While the turn on screen runs the corner key is Stop; once there is a
			    draft the corner queues it and Stop steps in beside it. */}
			{onStop && <StopTurnButton theme={theme} onClick={onStop} variant="icon" />}
			{(!onStop || hasDraft) && (
				<button
					type="button"
					onClick={() => processInput()}
					className="flex h-8 w-8 items-center justify-center rounded-full shadow-sm transition-all hover:opacity-90 cursor-pointer"
					style={{
						backgroundColor: theme.colors.accent,
						color: theme.colors.accentForeground,
					}}
					title={
						isTerminalMode
							? t('workflows.shell.runCommandEnter')
							: onStop
								? t('workflows.shell.queueMessage')
								: t('workflows.shell.sendMessage')
					}
				>
					<ArrowUp className="w-4 h-4" />
				</button>
			)}
		</div>
	);
});
