import type { LogEntry } from '../../../types';
import { isSelfContainedCard } from '../../../utils/logEntries';
import { isProgressNoteEntry } from '../../../utils/transcriptMessages';
import { isHiddenProgressEntry } from './collapseAiResponseLogs';
import { toolRunStatus } from './foldNativeToolRuns';

/** What one finished turn did on the way to its answer, folded behind one row. */
export interface TurnActivity {
	/** Every folded entry, in transcript order. The first one hosts the row. */
	entries: LogEntry[];
	/** From the user's message to the turn's last entry; undefined when unknown. */
	durationMs: number | undefined;
	/** The folded tool calls' combined state (see `toolRunStatus`). */
	status: ReturnType<typeof toolRunStatus>;
}

/** Work the agent shows while it goes: tool calls, reasoning, progress notes. */
export const isTurnActivityEntry = (log: LogEntry): boolean =>
	log.source === 'tool' ||
	log.source === 'thinking' ||
	isProgressNoteEntry(log) ||
	isHiddenProgressEntry(log);

/** A row of the local agent's own answer text. */
const isReplyEntry = (log: LogEntry): boolean =>
	(log.source === 'stdout' || log.source === 'ai') &&
	!log.metadata?.crossAgent &&
	!isSelfContainedCard(log) &&
	!isProgressNoteEntry(log);

/**
 * Fold each finished turn's process into ONE row, the way Codex shows
 * "Worked for 1m 23s" above the answer.
 *
 * A turn is everything between two user messages. The activity (tool calls,
 * reasoning, progress notes) and interim answer text that came before its last
 * answer fold behind a single row; the last answer, and anything after it, stays
 * on the page in order. Errors, notices,
 * cards and cross-agent replies never fold, so nothing the user must see is
 * hidden. A turn with no activity is left alone.
 *
 * The turn still running (`keepLastTurnOpen`, or a last turn that has not
 * answered yet) is not folded: what the agent is doing right now stays visible
 * until it finishes.
 *
 * Like the other folds, the run's FIRST entry stays in the list as the host and
 * carries the whole run in `activityByHostId`, so ids, order and the rendered-id
 * map keep working. Pure + exported so it is unit-testable.
 */
export function foldTurnActivity(
	logs: LogEntry[],
	{ keepLastTurnOpen }: { keepLastTurnOpen: boolean }
): { logs: LogEntry[]; activityByHostId: Map<string, TurnActivity> } {
	const activityByHostId = new Map<string, TurnActivity>();
	if (!logs.some(isTurnActivityEntry)) return { logs, activityByHostId };

	const result: LogEntry[] = [];
	const foldTurn = (turn: LogEntry[], startedAt: number | undefined, isLast: boolean) => {
		if (turn.length === 0) return;
		let finalReply = -1;
		turn.forEach((log, i) => {
			if (isReplyEntry(log)) finalReply = i;
		});
		// The last turn also stays open while it has no answer and still ends in
		// activity: it is still working (e.g. Codex generating in the shared
		// desktop app, so this tab is not the one marked busy).
		const stillWorking = isLast && finalReply === -1 && isTurnActivityEntry(turn[turn.length - 1]);
		if ((isLast && keepLastTurnOpen) || stillWorking || !turn.some(isTurnActivityEntry)) {
			result.push(...turn);
			return;
		}
		// Only what came BEFORE the answer folds: the row sits above it, so
		// anything after it would be read out of order. A turn with no answer
		// (stopped, or only tool calls) folds all of its activity.
		const before = finalReply === -1 ? turn.length : finalReply;
		const folded = turn.filter(
			(log, i) => i < before && (isTurnActivityEntry(log) || isReplyEntry(log))
		);
		if (!folded.some(isTurnActivityEntry)) {
			result.push(...turn);
			return;
		}
		const host = folded[0];
		const start = startedAt ?? turn[0].timestamp;
		const end = Math.max(...turn.map((log) => log.timestamp));
		activityByHostId.set(host.id, {
			entries: folded,
			durationMs: end > start ? end - start : undefined,
			status: toolRunStatus(folded.filter((log) => log.source === 'tool')),
		});
		const foldedIds = new Set(folded.map((log) => log.id));
		for (const log of turn) {
			if (log === host || !foldedIds.has(log.id)) result.push(log);
		}
	};

	let turn: LogEntry[] = [];
	let startedAt: number | undefined;
	for (const log of logs) {
		if (log.source === 'user') {
			foldTurn(turn, startedAt, false);
			result.push(log);
			turn = [];
			startedAt = log.timestamp;
			continue;
		}
		turn.push(log);
	}
	foldTurn(turn, startedAt, true);
	return { logs: result, activityByHostId };
}
