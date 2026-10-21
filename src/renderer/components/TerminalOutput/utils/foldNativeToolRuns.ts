import type { LogEntry } from '../../../types';

/**
 * Fold each run of consecutive tool calls into ONE row while the user has tool
 * calls switched off.
 *
 * The Show Tool Calls switch exists to keep the transcript free of tool noise,
 * and it stays the rule: with it off, a run of tool calls draws as a single
 * folded "N tool calls" row instead of N rows. Dropping them outright would make
 * a long turn read as if the agent answered without doing anything, and - for a
 * turn still running - hide what the agent is executing right now.
 *
 * Which tool entries fold:
 *  - calls read back from a provider transcript (`nativeTranscript`): always;
 *  - live calls of the running turn: only when `foldLive` is set (the
 *    conversation-centred layout). Otherwise they stay hidden, as before.
 *
 * The run's FIRST entry stays in the list as the host and carries the whole run
 * (itself included) in `runByHostId`. With tools visible nothing folds: each
 * call draws as its own row. Pure + exported so it is unit-testable.
 */
export function foldNativeToolRuns(
	logs: LogEntry[],
	toolsVisible: boolean,
	foldLive = false
): { logs: LogEntry[]; runByHostId: Map<string, LogEntry[]> } {
	const runByHostId = new Map<string, LogEntry[]>();
	if (toolsVisible) return { logs, runByHostId };
	const folds = (log: LogEntry) => log.source === 'tool' && (foldLive || !!log.nativeTranscript);
	if (!logs.some(folds)) {
		return { logs: logs.filter((log) => log.source !== 'tool'), runByHostId };
	}
	const result: LogEntry[] = [];
	let run: LogEntry[] = [];
	const flush = () => {
		if (run.length === 0) return;
		result.push(run[0]);
		runByHostId.set(run[0].id, run);
		run = [];
	};
	for (const log of logs) {
		if (folds(log)) {
			run.push(log);
			continue;
		}
		// A hidden live call does not break a run of stored ones apart.
		if (log.source === 'tool') continue;
		flush();
		result.push(log);
	}
	flush();
	return { logs: result, runByHostId };
}

/**
 * The run's state as one glyph: running beats failed beats stopped beats
 * finished. `completed` only when EVERY call completed - a stopped or unknown
 * call must never make the run read as a success.
 */
export function toolRunStatus(
	run: LogEntry[]
): 'running' | 'error' | 'canceled' | 'completed' | undefined {
	const statuses = run.map((entry) => entry.metadata?.toolState?.status);
	if (statuses.includes('running')) return 'running';
	if (statuses.some((s) => s === 'error' || s === 'failed')) return 'error';
	if (statuses.includes('canceled')) return 'canceled';
	if (statuses.length > 0 && statuses.every((s) => s === 'completed')) return 'completed';
	return undefined;
}
