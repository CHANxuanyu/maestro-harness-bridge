import { getT } from '../../../i18n';
import type { QuickAction } from '../types';
import type { ToastPosition } from '../../../../shared/toastPosition';
import { TOAST_POSITIONS, isTopToastPosition } from '../../../../shared/toastPosition';

interface BuildNotificationCommandsArgs {
	/** Number of toasts currently on screen. */
	visibleToastCount: number;
	clearToasts: () => void;
	/** Unread entries in the notification center. */
	unreadNotificationCount: number;
	openNotificationCenter: () => void;
	clearAllNotificationsShortcut?: QuickAction['shortcut'];
	openNotificationCenterShortcut?: QuickAction['shortcut'];
	/** Corner the toast stack is pinned to right now. */
	toastPosition: ToastPosition;
	setToastPosition: (value: ToastPosition) => void;
	setQuickActionOpen: (open: boolean) => void;
}

/**
 * Bulk escape hatch for a stacked-up toast queue.
 *
 * Sticky (dismissible) toasts have no auto-dismiss timer, so a burst of them -
 * or a misbehaving integration firing them in a loop - leaves a wall of cards
 * that can only be cleared one close button at a time.
 *
 * Always offered, even with an empty queue. Unlike the media-player restore
 * command (which is a recovery affordance you only reach for while something is
 * playing), this is a command users go hunting for by name. Hiding it at zero
 * makes the search that should find it come back empty, which reads as "the
 * feature doesn't exist" rather than "there is nothing to clear". The count
 * lives in the subtext instead, and clearing an empty queue is a harmless no-op.
 */
export function buildNotificationCommands({
	visibleToastCount,
	clearToasts,
	unreadNotificationCount,
	openNotificationCenter,
	clearAllNotificationsShortcut,
	openNotificationCenterShortcut,
	toastPosition,
	setToastPosition,
	setQuickActionOpen,
}: BuildNotificationCommandsArgs): QuickAction[] {
	const t = getT();
	const TOAST_POSITION_LABELS = {
		'top-left': t('workflows.labels.topLeft'),
		'top-right': t('workflows.labels.topRight'),
		'bottom-left': t('workflows.labels.bottomLeft'),
		'bottom-right': t('workflows.labels.bottomRight'),
	};
	return [
		{
			id: 'clear-all-notifications',
			label: t('workflows.shell.clearAllNotifications'),
			shortcut: clearAllNotificationsShortcut,
			subtext:
				visibleToastCount > 0
					? t('workflows.shell.dismissValueVisibleToastvalue', {
							p0: visibleToastCount,
							p1: visibleToastCount === 1 ? '' : t('workflows.shell.pluralSuffix'),
						})
					: t('workflows.shell.noNotificationsOnScreen'),
			action: () => {
				clearToasts();
				setQuickActionOpen(false);
			},
		},
		{
			id: 'open-notification-center',
			label: t('workflows.shell.openNotificationCenter'),
			shortcut: openNotificationCenterShortcut,
			subtext:
				unreadNotificationCount > 0
					? t('workflows.shell.valueUnreadNotificationvalue', {
							p0: unreadNotificationCount,
							p1: unreadNotificationCount === 1 ? '' : t('workflows.shell.pluralSuffix'),
						})
					: t('workflows.shell.noUnreadNotifications'),
			action: () => {
				openNotificationCenter();
				setQuickActionOpen(false);
			},
		},
		// One command per corner, all four always listed so a search for any corner
		// name finds it. The current corner stays in the list (marked in the
		// subtext) rather than vanishing, which would read as a missing option.
		// setToastPosition fires its own preview toast, so the move is visible.
		...TOAST_POSITIONS.map(
			(position): QuickAction => ({
				id: `toast-position-${position}`,
				label: t('workflows.shell.moveToastNotificationsToValue', {
					p0: TOAST_POSITION_LABELS[position],
				}),
				subtext:
					position === toastPosition
						? t('workflows.shell.currentPosition')
						: isTopToastPosition(position)
							? t('workflows.shell.toastsStackDownwardFromThisCorner')
							: t('workflows.shell.toastsStackUpwardFromThisCorner'),
				action: () => {
					setToastPosition(position);
					setQuickActionOpen(false);
				},
			})
		),
	];
}
