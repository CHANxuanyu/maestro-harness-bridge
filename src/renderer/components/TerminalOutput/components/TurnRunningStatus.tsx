import { memo } from 'react';
import type { Theme } from '../../../types';
import { useT } from '../../../i18n';
import { ElapsedTimeDisplay } from '../../ui/ElapsedTimeDisplay';
import { formatElapsedTickerCompact } from '../../../../shared/duration';
import { formatTokensCompact } from '../../../utils/formatters';

interface TurnRunningStatusProps {
	theme: Theme;
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
}: TurnRunningStatusProps) {
	const t = useT();
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
