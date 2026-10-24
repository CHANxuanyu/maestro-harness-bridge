import type { LogEntry } from '../../../types';
import { isSelfContainedCard } from '../../../utils/logEntries';
import { isProgressNoteEntry } from '../../../utils/transcriptMessages';

/** One axis that differs from the previous reply that recorded it. */
export interface TurnSettingAxisChange {
	from: string;
	to: string;
}

/** What changed on a reply, per axis. An absent axis did not change. */
export interface TurnSettingChange {
	model?: TurnSettingAxisChange;
	effort?: TurnSettingAxisChange;
}

/**
 * Whether a RENDERED row is an assistant reply in the conversation layout: the
 * agent's own answer text, or a cross-agent answer. Everything the transcript
 * draws around an answer is excluded - the user's messages, tool calls,
 * reasoning, errors, progress notes, self-contained cards (command output,
 * outage and recovery cards, hand-offs), and `system` notices such as the
 * Stop marker, which carry no turn stamp and are not what the agent said.
 *
 * Decided from the entry's own fields only, never from its text.
 */
export function isFeedReplyRow(log: LogEntry): boolean {
	if (
		log.source === 'user' ||
		log.source === 'tool' ||
		log.source === 'thinking' ||
		log.source === 'error' ||
		log.source === 'stderr' ||
		log.source === 'system'
	) {
		return false;
	}
	return !isSelfContainedCard(log) && !isProgressNoteEntry(log);
}

/**
 * Where the model or effort a reply ran under differs from the previous reply,
 * and which reply is the newest.
 *
 * The transcript no longer prints every reply's model and effort (the composer
 * shows the current pair), so the one case worth calling out in the reading
 * flow is a real CHANGE: the conversation switched configuration and this is
 * the first answer produced under the new one.
 *
 * Rules:
 * - Each axis keeps its own baseline: the last reply that recorded a value.
 * - A change is reported only when BOTH values are recorded and differ. An
 *   unstamped reply (written before stamps existed, read back from a provider
 *   transcript that recorded nothing, or run on the agent default) is unknown,
 *   so it neither reports a change nor moves the baseline. Labelling a guess as
 *   the model would be worse than saying nothing.
 * - Both values must also come from the same place. A send-time stamp holds
 *   what the user picked (often an alias such as `opus`); a native record holds
 *   the id the provider wrote. A reply of the other kind only moves the
 *   baseline, so a spelling difference is never reported as a switch.
 * - A cross-agent reply ran under ANOTHER agent's configuration and carries
 *   its own attribution header, so it reports nothing and leaves the baseline
 *   alone. It still counts as the newest reply: it is an answer.
 *
 * Takes the rows as rendered (after `collapseAiResponseLogs` lifted each
 * group's stamps onto its first entry), so the ids match `data-log-id`.
 */
export function computeTurnSettingChanges(rows: LogEntry[]): {
	changes: Map<string, TurnSettingChange>;
	latestReplyId: string | null;
} {
	const changes = new Map<string, TurnSettingChange>();
	let latestReplyId: string | null = null;
	let lastModel: { value: string; source: LogEntry['turnSettingsSource'] } | undefined;
	let lastEffort: { value: string; source: LogEntry['turnSettingsSource'] } | undefined;

	for (const row of rows) {
		if (!isFeedReplyRow(row)) continue;
		latestReplyId = row.id;
		if (row.metadata?.crossAgent) continue;

		const source = row.turnSettingsSource;
		const change: TurnSettingChange = {};
		if (row.turnModel) {
			if (lastModel && lastModel.source === source && lastModel.value !== row.turnModel) {
				change.model = { from: lastModel.value, to: row.turnModel };
			}
			lastModel = { value: row.turnModel, source };
		}
		if (row.turnEffort) {
			if (lastEffort && lastEffort.source === source && lastEffort.value !== row.turnEffort) {
				change.effort = { from: lastEffort.value, to: row.turnEffort };
			}
			lastEffort = { value: row.turnEffort, source };
		}
		if (change.model || change.effort) changes.set(row.id, change);
	}

	return { changes, latestReplyId };
}

/** Value equality for the memo comparator: the map is rebuilt per render. */
export function sameTurnSettingChange(a?: TurnSettingChange, b?: TurnSettingChange): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.model?.from === b.model?.from &&
		a.model?.to === b.model?.to &&
		a.effort?.from === b.effort?.from &&
		a.effort?.to === b.effort?.to
	);
}
