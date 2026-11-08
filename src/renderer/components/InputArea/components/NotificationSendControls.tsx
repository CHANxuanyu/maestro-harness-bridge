import { selectNewShellEnabled, useSettingsStore } from '../../../stores/settingsStore';
import { useT } from '../../../i18n';
import { memo, useRef, useState } from 'react';
import { ArrowUp, Bell } from 'lucide-react';
import type { Theme } from '../../../types';
import { NotificationPopover } from '../../NotificationPopover';
import { StopTurnButton } from '../../ui/StopTurnButton';
import { FIXED_SHORTCUTS } from '../../../constants/shortcuts';

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
	onSteer?: () => Promise<void>;
	submitting?: boolean;
}

export const NotificationSendControls = memo(function NotificationSendControls({
	theme,
	isTerminalMode,
	processInput,
	onStop,
	hasDraft = false,
	onSteer,
	submitting = false,
}: NotificationSendControlsProps) {
	const t = useT();
	const newShell = useSettingsStore(selectNewShellEnabled);
	const [notificationPopoverOpen, setNotificationPopoverOpen] = useState(false);
	const [steering, setSteering] = useState(false);
	const steeringRef = useRef(false);
	const notificationBtnRef = useRef<HTMLButtonElement>(null);

	return (
		// Sits at the end of the composer's toolbar row, inside the card: a quiet
		// bell, then the round send button in the corner.
		<div className="flex flex-shrink-0 items-center gap-1">
			{!newShell && (
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
			)}
			{!newShell && notificationPopoverOpen && (
				<NotificationPopover
					theme={theme}
					anchorRef={notificationBtnRef}
					onClose={() => setNotificationPopoverOpen(false)}
				/>
			)}
			{/* While the turn on screen runs the corner key is Stop; once there is a
			    draft the corner queues it and Stop steps in beside it. */}
			{newShell && onSteer && hasDraft && (
				<button
					type="button"
					disabled={steering || submitting}
					onClick={async () => {
						if (steeringRef.current || submitting) return;
						steeringRef.current = true;
						setSteering(true);
						try {
							await onSteer();
						} finally {
							steeringRef.current = false;
							setSteering(false);
						}
					}}
					className="px-2 py-1 text-xs rounded border disabled:opacity-50"
					style={{ color: theme.colors.textMain, borderColor: theme.colors.border }}
					aria-label={t('workflows.shell.steerTurn')}
				>
					{t(steering ? 'workflows.shell.steerPending' : 'workflows.shell.steerTurn')}
				</button>
			)}
			{onStop && (
				<StopTurnButton
					theme={theme}
					onClick={onStop}
					variant="icon"
					shortcutKeys={FIXED_SHORTCUTS.stopTurn.keys}
				/>
			)}
			{(!onStop || hasDraft) && (
				<button
					type="button"
					disabled={submitting}
					onClick={() => {
						if (!submitting) processInput();
					}}
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
