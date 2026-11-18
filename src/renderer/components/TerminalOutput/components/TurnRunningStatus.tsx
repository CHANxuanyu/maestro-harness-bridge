import { memo } from 'react';
import type { Theme } from '../../../types';
import { useT } from '../../../i18n';
import { ElapsedTimeDisplay } from '../../ui/ElapsedTimeDisplay';
import { formatElapsedTickerCompact } from '../../../../shared/duration';
import { formatTokensCompact } from '../../../utils/formatters';

import type { summarizeTurnActivity } from '../utils/foldTurnActivity';

interface TurnRunningStatusProps {
	theme: Theme;
	summary?: ReturnType<typeof summarizeTurnActivity>;
	/** When the running turn started (the tab's, falling back to the agent's). */
	startTime?: number;
	/** Tokens produced so far in this turn; shown once there are any. */
	tokens: number;
	/** The transcript's readable secondary color. */
	textColor: string;
}

/**
 * TurnRunningStatus - one line at the end of the transcript while the
 * conversation on screen runs: a pulsing dot, "Thinking...", how long it has run
 * and how much it has produced. The thinking pill no longer describes the turn
 * on screen (`isThinkingItemOnScreen`), so this row is where it is said.
 *
 * A status, not a control: Stop is the composer's send key
 * (`resolveStopPlacement`), and a second Stop here would be one control drawn
 * twice. Only the label is announced; the ticking parts are hidden from screen
 * readers, which would otherwise read a new number every second.
 */
export const TurnRunningStatus = memo(function TurnRunningStatus({
	theme,
	startTime,
	tokens,
	textColor,
	summary,
}: TurnRunningStatusProps) {
	const t = useT();
	if (summary) {
		const { counts, note, current, plan } = summary;
		const action =
			current?.kind === 'read' || current?.kind === 'search' || current?.kind === 'list'
				? t('workflows.activity.reading', { count: counts.reads })
				: current?.kind === 'write' || current?.kind === 'edit'
					? t('workflows.activity.editing', { count: counts.edits })
					: current?.kind === 'run'
						? t('workflows.activity.runningCommand')
						: t('workflows.activity.working');
		return (
			<span
				className="flex flex-col justify-center gap-1 w-full min-w-0 text-sm"
				style={{ height: 64, color: textColor }}
				data-testid="turn-activity-bar"
			>
				<span className="flex items-center gap-2 min-w-0">
					<span
						className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
						style={{ backgroundColor: textColor }}
						aria-hidden
					/>
					<span
						className="truncate min-w-0 text-left flex-1"
						data-testid="activity-note"
						title={note || action}
					>
						{note || action}
					</span>
					{startTime && (
						<ElapsedTimeDisplay
							startTime={startTime}
							className="shrink-0 tabular-nums text-xs"
							format={(ms) =>
								ms < 10000
									? t('workflows.activity.justStarted')
									: formatElapsedTickerCompact(
											Math.floor(ms / (ms < 60000 ? 10000 : 60000)) * (ms < 60000 ? 10000 : 60000)
										)
							}
						/>
					)}
				</span>
				<span
					className="flex items-center gap-2 min-w-0 text-xs whitespace-nowrap overflow-hidden"
					data-testid="activity-counts"
				>
					{plan && (
						<span data-testid="activity-plan">
							{t('workflows.activity.tasks', {
								completed: plan.completed,
								total: plan.tasks.length,
							})}
						</span>
					)}
					{counts.reads > 0 && (
						<span>{t('workflows.activity.reads', { count: counts.reads })}</span>
					)}
					{counts.edits > 0 && (
						<span>{t('workflows.activity.edits', { count: counts.edits })}</span>
					)}
					{counts.commands > 0 && (
						<span>{t('workflows.activity.commands', { count: counts.commands })}</span>
					)}
					{current?.target && (
						<span className="truncate font-mono" title={current.target}>
							{current.target}
						</span>
					)}
				</span>
			</span>
		);
	}
	return (
		// Indented like the turn activity row above an answer, so it starts where
		// the answer text does.
		<div className="px-3 sm:px-6 pt-1.5 pb-1" data-testid="turn-running-status" role="status">
			<div
				className="flex items-center gap-2 text-sm"
				style={{ paddingInlineStart: '0.5em', color: textColor }}
			>
				<span
					className="w-2 h-2 rounded-full shrink-0 animate-pulse"
					style={{ backgroundColor: theme.colors.warning }}
					aria-hidden
				/>
				<span className="min-w-0">
					{t('workflows.shellStatus.thinking')}
					{startTime ? (
						<span aria-hidden>
							{' · '}
							<ElapsedTimeDisplay
								startTime={startTime}
								format={formatElapsedTickerCompact}
								className="tabular-nums"
							/>
						</span>
					) : null}
					{tokens > 0 && (
						<span aria-hidden className="tabular-nums">
							{' · '}
							{t('workflows.transcript.turnTokens', { count: formatTokensCompact(tokens) })}
						</span>
					)}
				</span>
			</div>
		</div>
	);
});
