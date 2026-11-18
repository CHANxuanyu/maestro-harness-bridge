import { nativeToolCommand } from '../../../../shared/nativeToolOutput';
import {
	collectTurnWrites,
	summarizeTurnDelivery,
	toolInputWritePaths,
} from '../../../../shared/gitChangeTurns';
import type { LogEntry } from '../../../types';
import { isSelfContainedCard, turnFailureReason } from '../../../utils/logEntries';
import { isProgressNoteEntry } from '../../../utils/transcriptMessages';
import { isHiddenProgressEntry } from './collapseAiResponseLogs';
import { latestAgentTaskList } from '../../../utils/agentTaskList';
import { describeToolActivity } from '../../../utils/toolActivityLabel';
import { toolRunStatus } from './foldNativeToolRuns';

/** What one finished turn did on the way to its answer, folded behind one row. */
export interface TurnActivity {
	/** Every folded entry, in transcript order. The first one hosts the row. */
	entries: LogEntry[];
	running?: boolean;
	turnId?: string;
	startedAt?: number;
	reason?: string;
	errorType?: NonNullable<LogEntry['agentError']>['type'];
	failingStepId?: string;
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
 * Classic presentation leaves a running turn open. The new shell folds it
 * immediately, including a placeholder before the first activity, and uses an
 * explicit terminal outcome rather than the worst tool status.
 *
 * Like the other folds, the run's FIRST entry stays in the list as the host and
 * carries the whole run in `activityByHostId`, so ids, order and the rendered-id
 * map keep working. Pure + exported so it is unit-testable.
 */
export function foldTurnActivity(
	logs: LogEntry[],
	{ keepLastTurnOpen, newShell = false }: { keepLastTurnOpen: boolean; newShell?: boolean }
): {
	logs: LogEntry[];
	activityByHostId: Map<string, TurnActivity>;
	deliveryByHostId: Map<
		string,
		{
			turnId: string;
			delivery?: import('../../../../shared/gitChangeTurns').TurnDelivery;
			plan: ReturnType<typeof latestAgentTaskList>;
		}
	>;
} {
	const activityByHostId = new Map<string, TurnActivity>();
	const deliveryByHostId = new Map<
		string,
		{
			turnId: string;
			delivery?: import('../../../../shared/gitChangeTurns').TurnDelivery;
			plan: ReturnType<typeof latestAgentTaskList>;
		}
	>();
	if (!newShell && !logs.some(isTurnActivityEntry))
		return { logs, activityByHostId, deliveryByHostId };

	const result: LogEntry[] = [];
	let user: LogEntry | undefined;
	const foldTurn = (turn: LogEntry[], startedAt: number | undefined, isLast: boolean) => {
		if (
			turn.length === 0 &&
			!(
				newShell &&
				user &&
				((isLast && keepLastTurnOpen) || user.turnCompletion?.status === 'error')
			)
		)
			return;
		let finalReply = -1;
		turn.forEach((log, i) => {
			if (isReplyEntry(log)) finalReply = i;
		});
		// The last turn also stays open while it has no answer and still ends in
		// activity: it is still working (e.g. Codex generating in the shared
		// desktop app, so this tab is not the one marked busy).
		if (newShell) {
			const running = isLast && keepLastTurnOpen;
			const status = running ? 'running' : turnActivityOutcome(turn, user);
			const entries = turn.filter(
				(log, index) => isTurnActivityEntry(log) || (isReplyEntry(log) && index !== finalReply)
			);
			const footer =
				!running && user
					? {
							turnId: user.nativeTranscript?.messageId ?? user.id,
							delivery: user.turnCompletion
								? user.turnCompletion.delivery
								: (() => {
										const writes = collectTurnWrites([user, ...turn])[0];
										return writes
											? summarizeTurnDelivery(
													writes.paths.map((path) => ({ path, additions: null, deletions: null }))
												)
											: undefined;
									})(),
							plan: latestAgentTaskList(turn),
						}
					: undefined;
			// A terminal failure still needs its own summary when no activity is
			// available (startup errors, or a repeated native call id merged into
			// history). Keep the actionable error card visible below this summary.
			if (!entries.length && !running && status !== 'error') {
				if (footer && turn.length) deliveryByHostId.set(turn[turn.length - 1].id, footer);
				result.push(...turn);
				return;
			}
			const error = [...turn].reverse().find((log) => log.source === 'error');
			const host = entries[0] ?? {
				...(user ?? error!),
				id: `activity:${user?.id ?? error!.id}`,
				source: 'system' as const,
				text: '',
			};
			const end = user?.turnCompletion?.timestamp ?? turn.at(-1)?.timestamp ?? startedAt;
			activityByHostId.set(host.id, {
				entries,
				running,
				status,
				startedAt,
				turnId: user?.nativeTranscript?.messageId ?? user?.id,
				durationMs: end !== undefined && startedAt !== undefined ? end - startedAt : undefined,
				reason:
					status === 'error'
						? user?.turnCompletion?.reason
							? turnFailureReason({ text: user.turnCompletion.reason })
							: error && turnFailureReason(error)
						: undefined,
				errorType: status === 'error' ? error?.agentError?.type : undefined,
				failingStepId:
					status === 'error'
						? [...entries]
								.reverse()
								.find((log) => log.source === 'tool' && toolRunStatus([log]) === 'error')?.id
						: undefined,
			});
			const ids = new Set(entries.map((log) => log.id));
			const visible = [host, ...turn.filter((log) => !ids.has(log.id))];
			result.push(...visible);
			if (footer) deliveryByHostId.set(visible[visible.length - 1].id, footer);
			return;
		}
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
			user = log;
			continue;
		}
		turn.push(log);
	}
	foldTurn(turn, startedAt, true);
	return { logs: result, activityByHostId, deliveryByHostId };
}

/** A failed tool is not a failed turn. Explicit completion wins over step status. */
export function turnActivityOutcome(
	turn: readonly LogEntry[],
	user?: LogEntry
): TurnActivity['status'] {
	if (user?.turnCompletion) return user.turnCompletion.status;
	const last = [...turn].reverse().find((log) => isReplyEntry(log) || log.source === 'error');
	if (last?.source === 'error') return 'error';
	if (last && isReplyEntry(last)) return 'completed';
	if (turn.some((log) => log.metadata?.toolState?.status === 'canceled')) return 'canceled';
	return 'unknown';
}

/** One pass over this turn only; no tool output parsing or transcript-wide counters. */
export function summarizeTurnActivity(entries: readonly LogEntry[]) {
	const counts = { reads: 0, edits: 0, commands: 0 };
	let steps = 0;
	let note: string | undefined;
	let current: ReturnType<typeof describeToolActivity> | undefined;
	for (const entry of entries) {
		if (isProgressNoteEntry(entry) && entry.text.trim()) note = entry.text;
		if (entry.source !== 'tool' || entry.metadata?.parentToolUseId) continue;
		steps++;
		const action = describeToolActivity(entry.text, entry.metadata?.toolState?.input);
		if (entry.text === 'file_change') {
			action.kind = 'edit';
			action.target = toolInputWritePaths(entry.text, entry.metadata?.toolState?.input).join(', ');
		}
		if (action.kind === 'run')
			action.target = nativeToolCommand(entry.metadata?.toolState?.input) ?? action.target;
		if (['read', 'search', 'list'].includes(action.kind)) counts.reads++;
		if (['write', 'edit'].includes(action.kind)) counts.edits++;
		if (action.kind === 'run') counts.commands++;
		if (entry.metadata?.toolState?.status === 'running') current = action;
	}
	return { counts, steps, note, current, plan: latestAgentTaskList(entries) };
}
