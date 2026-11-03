import { memo, useCallback, useEffect, useState } from 'react';
import { autoRunActiveElapsedMs } from '../../hooks/batch/useTimeTracking';
import { formatElapsedTicker } from '../../../shared/duration';

/**
 * ElapsedTimeDisplay - a live count of time since a turn (or an Auto Run)
 * started, ticking once a second. Machine sleep is subtracted: the agent was
 * suspended along with the app, so counting the sleep would report an overnight
 * wake as hours of work. For an Auto Run, pass the tracker fields too: a paused
 * run's clock stops.
 *
 * Shared by the thinking pill and the transcript's running-turn row, so a turn
 * reads the same time wherever it is described.
 */
export const ElapsedTimeDisplay = memo(
	({
		startTime,
		accumulatedElapsedMs,
		lastActiveTimestamp,
		textColor,
		format = formatElapsedTicker,
		className = 'font-mono text-xs',
	}: {
		startTime: number;
		accumulatedElapsedMs?: number;
		lastActiveTimestamp?: number;
		textColor?: string;
		/** Defaults to the padded ticker (`"0m 3s"`). */
		format?: (ms: number) => string;
		/**
		 * Monospace by default: it counts up once a second, and proportional digits
		 * change width as they tick, so its row would twitch. A proportional caller
		 * passes `tabular-nums` instead.
		 */
		className?: string;
	}) => {
		const measureSeconds = useCallback(
			() =>
				Math.floor(
					autoRunActiveElapsedMs({ startTime, accumulatedElapsedMs, lastActiveTimestamp }) / 1000
				),
			[startTime, accumulatedElapsedMs, lastActiveTimestamp]
		);
		const [elapsedSeconds, setElapsedSeconds] = useState(measureSeconds);

		useEffect(() => {
			setElapsedSeconds(measureSeconds());
			const interval = setInterval(() => {
				setElapsedSeconds(measureSeconds());
			}, 1000);
			return () => clearInterval(interval);
		}, [measureSeconds]);

		return (
			<span className={className} style={textColor ? { color: textColor } : undefined}>
				{format(elapsedSeconds * 1000)}
			</span>
		);
	}
);

ElapsedTimeDisplay.displayName = 'ElapsedTimeDisplay';
