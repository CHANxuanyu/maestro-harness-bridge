import { memo, useCallback, useEffect, useState } from 'react';
import { autoRunActiveElapsedMs } from '../../hooks/batch/useTimeTracking';
import { useT } from '../../i18n';
import { selectNewShellEnabled, useSettingsStore } from '../../stores/settingsStore';
import {
	formatElapsedTicker,
	formatSteppedElapsed,
	steppedElapsedTime,
	DURATION_MS,
} from '../../../shared/duration';

/**
 * ElapsedTimeDisplay - a live count of time since a turn (or an Auto Run)
 * started. The new shell steps by ten seconds, then minutes; classic ticks each
 * second. Machine sleep is subtracted: the agent was
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
		const newShell = useSettingsStore(selectNewShellEnabled);
		const t = useT();
		const measure = useCallback(
			() => autoRunActiveElapsedMs({ startTime, accumulatedElapsedMs, lastActiveTimestamp }),
			[startTime, accumulatedElapsedMs, lastActiveTimestamp]
		);
		const [elapsedMs, setElapsedMs] = useState(
			() => Math.floor(measure() / DURATION_MS.second) * DURATION_MS.second
		);

		useEffect(() => {
			if (!newShell) {
				const tick = () =>
					setElapsedMs(Math.floor(measure() / DURATION_MS.second) * DURATION_MS.second);
				tick();
				const interval = setInterval(tick, DURATION_MS.second);
				return () => clearInterval(interval);
			}
			let timeout: ReturnType<typeof setTimeout>;
			const tick = () => {
				const elapsed = measure();
				const stepped = steppedElapsedTime(elapsed);
				setElapsedMs(stepped.elapsedMs);
				// A paused Auto Run owns a fixed accumulated time, with no live clock.
				if (accumulatedElapsedMs !== undefined && lastActiveTimestamp === undefined) return;
				timeout = setTimeout(tick, stepped.nextUpdateMs);
			};
			tick();
			return () => clearTimeout(timeout);
		}, [measure, newShell, accumulatedElapsedMs, lastActiveTimestamp]);

		return (
			<span className={className} style={textColor ? { color: textColor } : undefined}>
				{newShell
					? formatSteppedElapsed(elapsedMs, t('workflows.newShellCopy.feedback.justStarted'))
					: format(elapsedMs)}
			</span>
		);
	}
);

ElapsedTimeDisplay.displayName = 'ElapsedTimeDisplay';
