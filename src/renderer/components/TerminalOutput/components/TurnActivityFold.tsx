import React, { memo, useEffect, useMemo, useRef } from 'react';
import { shallow } from 'zustand/shallow';
import { ChevronRight } from 'lucide-react';
import type { Theme } from '../../../types';
import { formatElapsedTickerCompact } from '../../../../shared/duration';
import { TurnRunningStatus } from './TurnRunningStatus';
import { summarizeTurnActivity } from '../utils/foldTurnActivity';
import type { TurnActivity } from '../utils/foldTurnActivity';
import { toolRunStatus } from '../utils/foldNativeToolRuns';
import { readableTextOn } from '../../../../shared/colorContrast';
import { useT } from '../../../i18n';
import { isProgressNoteEntry } from '../../../utils/transcriptMessages';

/**
 * A finished turn's process as ONE quiet row above its answer - "Worked for
 * 1m 23s", the way Codex shows it. Unfolding lists every step the agent took
 * (progress notes, reasoning, one line per tool call) in order.
 *
 * The row stands in the transcript for the turn's first activity entry, so it
 * carries that entry's id and index for the scroll anchors and jump targets.
 * Classic presentation retains its step-status summary. The new shell uses
 * the turn's terminal outcome, with intermediate failures only in the detail,
 * and keeps the same fold as a fixed two-line activity bar while running.
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
	newShell = false,
	approvalHostId,
	awaitingApproval = false,
}: {
	hostId: string;
	newShell?: boolean;
	approvalHostId?: string;
	awaitingApproval?: boolean;
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
	const summary = useMemo(() => summarizeTurnActivity(activity.entries), [activity.entries]);
	const wasRunning = useRef(activity.running);
	const detailRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (newShell && wasRunning.current && !activity.running && open) onToggle(`turn:${hostId}`);
		wasRunning.current = activity.running;
	}, [activity.running, newShell, open, onToggle, hostId]);
	useEffect(() => {
		if (newShell && open && activity.failingStepId) {
			const step = Array.from(
				detailRef.current?.querySelectorAll<HTMLElement>('[data-log-id]') ?? []
			).find((node) => node.dataset.logId === activity.failingStepId);
			step?.scrollIntoView?.({ block: 'nearest' });
		}
	}, [newShell, open, activity.failingStepId]);
	const label = activity.running
		? null
		: activity.durationMs !== undefined && activity.durationMs >= 1000
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
			? newShell
				? activity.errorType === 'auth_expired'
					? t('workflows.newShellCopy.feedback.error.auth_expired')
					: activity.reason || t('workflows.activity.turnFailed')
				: t(
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
	const failedBeforeSteps =
		newShell && !activity.running && activity.status === 'error' && summary.steps === 0;
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
				{newShell && approvalHostId && <div id={approvalHostId} data-turn-approval-slot="" />}
				{!awaitingApproval && (
					<button
						type="button"
						onClick={() => onToggle(`turn:${hostId}`)}
						aria-expanded={open}
						title={
							open
								? t('workflows.transcript.hideTurnActivity')
								: t('workflows.transcript.showTurnActivity')
						}
						data-testid={
							newShell ? (activity.running ? 'activity-toggle' : 'activity-collapsed') : undefined
						}
						className={`${activity.running ? 'w-full' : 'self-start'}${newShell ? ' min-w-0 max-w-full' : ''} flex items-center gap-1.5 text-sm rounded outline-none focus-visible:ring-1 hover:brightness-125`}
						style={{ color: secondaryTextColor }}
					>
						{newShell && activity.running ? (
							<TurnRunningStatus
								theme={theme}
								startTime={activity.startedAt}
								tokens={0}
								textColor={secondaryTextColor}
								summary={summary}
							/>
						) : failedBeforeSteps ? null : (
							<span className={newShell ? 'shrink-0 whitespace-nowrap' : undefined}>
								{label}
								{newShell &&
									` · ${t(summary.steps === 1 ? 'workflows.activity.stepOne' : 'workflows.activity.steps', { count: summary.steps })}`}
							</span>
						)}
						{/* Real spaces, not only the CSS gap: the row is one sentence for a
					    screen reader and for copied text alike. */}
						{problem && !failedBeforeSteps && ' '}
						{problem && (
							<span
								data-tool-status={activity.status}
								className={newShell ? 'min-w-0 truncate' : undefined}
							>
								{!failedBeforeSteps && '· '}
								<span
									style={
										activity.status === 'error'
											? { color: readableTextOn(theme.colors.error, [theme.colors.bgMain]) }
											: undefined
									}
								>
									{failedBeforeSteps
										? t('workflows.activity.failedWithReason', { reason: problem })
										: problem}
								</span>
							</span>
						)}
						<ChevronRight
							className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
							aria-hidden
						/>
					</button>
				)}
				{open && !awaitingApproval && (
					<div
						className="mt-1 mb-1 ml-1.5 pl-3 border-l flex flex-col"
						style={{ borderColor: theme.colors.border }}
						data-turn-activity-steps=""
						ref={detailRef}
					>
						{children}
					</div>
				)}
			</div>
		</div>
	);
}

// Only the new shell opts in. A closed running bar paints tools and public
// notes, not the answer or reasoning accumulating behind it. Opening or ending
// the turn still renders the latest complete entries. Finished folds compare
// every entry so historical corrections cannot leave their summary stale.
export const MemoizedTurnActivityFold = memo(TurnActivityFold, (prev, next) => {
	if (
		!(
			prev.hostId === next.hostId &&
			prev.newShell === next.newShell &&
			prev.approvalHostId === next.approvalHostId &&
			prev.awaitingApproval === next.awaitingApproval &&
			prev.activity.running === next.activity.running &&
			prev.activity.startedAt === next.activity.startedAt &&
			prev.activity.reason === next.activity.reason &&
			prev.activity.errorType === next.activity.errorType &&
			prev.activity.failingStepId === next.activity.failingStepId &&
			prev.index === next.index &&
			prev.open === next.open &&
			prev.onToggle === next.onToggle &&
			prev.theme === next.theme &&
			prev.secondaryTextColor === next.secondaryTextColor &&
			prev.children === next.children &&
			prev.activity.status === next.activity.status
		)
	)
		return false;
	const onlyRunningBar = prev.newShell && prev.activity.running && !prev.open;
	if (!onlyRunningBar && prev.activity.durationMs !== next.activity.durationMs) return false;
	const previousEntries = onlyRunningBar
		? prev.activity.entries.filter((entry) => entry.source === 'tool' || isProgressNoteEntry(entry))
		: prev.activity.entries;
	const nextEntries = onlyRunningBar
		? next.activity.entries.filter((entry) => entry.source === 'tool' || isProgressNoteEntry(entry))
		: next.activity.entries;
	return (
		previousEntries.length === nextEntries.length &&
		previousEntries.every((entry, index) => shallow(entry, nextEntries[index]))
	);
});
