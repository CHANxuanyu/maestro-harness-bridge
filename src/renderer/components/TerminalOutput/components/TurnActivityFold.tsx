import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { Theme } from '../../../types';
import { formatElapsedTickerCompact } from '../../../../shared/duration';
import type { TurnActivity } from '../utils/foldTurnActivity';
import { ToolStatusLabel } from './ToolBadge';
import { useT } from '../../../i18n';

/**
 * A finished turn's process as ONE quiet row above its answer - "Worked for
 * 1m 23s", the way Codex shows it. Unfolding lists every step the agent took
 * (progress notes, reasoning, one line per tool call) in order.
 *
 * The row stands in the transcript for the turn's first activity entry, so it
 * carries that entry's id and index for the scroll anchors and jump targets.
 * A failed or stopped call still shows on the folded row, so a problem is never
 * hidden behind the fold.
 */
export function TurnActivityFold({
	hostId,
	index,
	activity,
	open,
	onToggle,
	theme,
	secondaryTextColor,
	children,
}: {
	hostId: string;
	index: number;
	activity: TurnActivity;
	open: boolean;
	onToggle: () => void;
	theme: Theme;
	secondaryTextColor: string;
	/** The unfolded entries, rendered by the transcript's own row renderer. */
	children?: React.ReactNode;
}) {
	const t = useT();
	const label =
		activity.durationMs !== undefined && activity.durationMs >= 1000
			? t('workflows.transcript.workedFor', {
					duration: formatElapsedTickerCompact(activity.durationMs),
				})
			: t('workflows.transcript.worked');
	return (
		<div
			className="flex flex-col px-3 sm:px-6 pt-1.5 pb-1"
			data-log-index={index}
			data-log-id={hostId}
			data-feed-row="turn-activity"
		>
			{/* Indented like chat prose (0.5em of the chat size), so the row starts
			    where the answer text below it does. */}
			<div className="flex flex-col" style={{ paddingInlineStart: '0.5em' }}>
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={open}
					title={
						open
							? t('workflows.transcript.hideTurnActivity')
							: t('workflows.transcript.showTurnActivity')
					}
					className="self-start flex items-center gap-1.5 text-sm rounded outline-none focus-visible:ring-1 hover:brightness-125"
					style={{ color: secondaryTextColor }}
				>
					<span>{label}</span>
					{(activity.status === 'error' || activity.status === 'canceled') && (
						<ToolStatusLabel theme={theme} kind={activity.status} />
					)}
					<ChevronRight
						className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
						aria-hidden
					/>
				</button>
				{open && (
					<div
						className="mt-1 mb-1 ml-1.5 pl-3 border-l flex flex-col"
						style={{ borderColor: theme.colors.border }}
						data-turn-activity-steps=""
					>
						{children}
					</div>
				)}
			</div>
		</div>
	);
}
