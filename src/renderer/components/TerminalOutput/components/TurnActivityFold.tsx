import React, { memo } from 'react';
import { shallow } from 'zustand/shallow';
import { ChevronRight } from 'lucide-react';
import type { Theme } from '../../../types';
import { formatElapsedTickerCompact } from '../../../../shared/duration';
import type { TurnActivity } from '../utils/foldTurnActivity';
import { toolRunStatus } from '../utils/foldNativeToolRuns';
import { readableTextOn } from '../../../../shared/colorContrast';
import { useT } from '../../../i18n';

/**
 * A finished turn's process as ONE quiet row above its answer - "Worked for
 * 1m 23s", the way Codex shows it. Unfolding lists every step the agent took
 * (progress notes, reasoning, one line per tool call) in order.
 *
 * The row stands in the transcript for the turn's first activity entry, so it
 * carries that entry's id and index for the scroll anchors and jump targets.
 * A failed or stopped call still shows on the folded row, so a problem is never
 * hidden behind the fold. It reads as one line ("Worked for 3s · 1 failed
 * step"): a failed step the agent recovered from is part of the work, not an
 * alarm, so it is counted in words rather than flagged with a badge.
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
	onToggle: (key: string) => void;
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
	const failedSteps =
		activity.status === 'error'
			? Math.max(
					1,
					activity.entries.filter(
						(entry) => entry.source === 'tool' && toolRunStatus([entry]) === 'error'
					).length
				)
			: 0;
	const problem =
		activity.status === 'error'
			? t(
					failedSteps === 1
						? 'workflows.transcript.failedStepOne'
						: 'workflows.transcript.failedSteps',
					{ count: failedSteps }
				)
			: activity.status === 'canceled'
				? t('workflows.transcript.toolStopped')
				: activity.status === 'unknown'
					? t('workflows.transcript.toolUnknown')
					: null;
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
					onClick={() => onToggle(`turn:${hostId}`)}
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
					{/* Real spaces, not only the CSS gap: the row is one sentence for a
					    screen reader and for copied text alike. */}
					{problem && ' '}
					{problem && (
						<span data-tool-status={activity.status}>
							{'· '}
							<span
								style={
									activity.status === 'error'
										? { color: readableTextOn(theme.colors.error, [theme.colors.bgMain]) }
										: undefined
								}
							>
								{problem}
							</span>
						</span>
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

// Only the new shell opts in. Closed rows have no rendered children; comparing
// all entry fields also catches corrections, while merged response objects
// with unchanged fields can still be reused. Nested data stays immutable.
export const MemoizedTurnActivityFold = memo(
	TurnActivityFold,
	(prev, next) =>
		prev.hostId === next.hostId &&
		prev.index === next.index &&
		prev.open === next.open &&
		prev.onToggle === next.onToggle &&
		prev.theme === next.theme &&
		prev.secondaryTextColor === next.secondaryTextColor &&
		prev.children === next.children &&
		prev.activity.durationMs === next.activity.durationMs &&
		prev.activity.status === next.activity.status &&
		prev.activity.entries.length === next.activity.entries.length &&
		prev.activity.entries.every((entry, index) => shallow(entry, next.activity.entries[index]))
);
