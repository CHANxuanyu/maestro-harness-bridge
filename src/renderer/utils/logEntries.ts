/**
 * LogEntry classification helpers.
 *
 * ## Why this exists
 *
 * A `LogEntry` is really two different things wearing one type:
 *
 *  - **A stream.** Plain `stdout` / `stderr` / `thinking` text that arrives in
 *    chunks. Consecutive chunks are coalesced into one entry so the transcript
 *    doesn't become one bubble per packet.
 *  - **A self-contained card.** A single entry that renders as its own widget -
 *    a `!` command's output, a retry-outage status card, a session-recovery
 *    prompt, a tool call. Its text is owned by whoever created it and is
 *    updated by log id, never by appending.
 *
 * Cards are marked by an extra field while keeping a natural `source` (a `!`
 * command's card is `source: 'stdout'` because its body genuinely is terminal
 * output). That means **source alone cannot tell you whether appending is
 * safe**, and every coalescing site that assumed it could has been a bug:
 * agent text got concatenated into a command card's terminal output because the
 * card was the newest `stdout` entry when the next chunk arrived.
 *
 * So the rule lives here, once, expressed positively. Adding a new card kind
 * means adding its marker to `isSelfContainedCard` and every coalescing site is
 * correct by construction - rather than each site growing its own exclusion.
 */

import { isClaudeLimitNotice } from '../../shared/agentErrorPatterns';
import type { LogEntry } from '../types';

/**
 * True when the entry is a self-contained card rather than an open stream.
 *
 * ADD NEW CARD MARKERS HERE. If a new `LogEntry` field means "this entry is a
 * widget with its own body", list it below, or streamed output will start
 * getting appended to it wherever coalescing happens.
 */
export function isSelfContainedCard(entry: LogEntry): boolean {
	return Boolean(
		// `!` command output card - text owned by services/shellCommand.ts
		entry.shellCommand ||
		// Agent Resilience outage card - driven by retryStore
		entry.retryOutageId ||
		// "Create new session from prior context" prompt
		entry.recoveryAction ||
		// Custom AI command chip on a user message
		entry.aiCommand ||
		// "Back from snooze" marker - text owned by utils/snoozeHelpers.ts
		entry.snoozeReturn ||
		// Agent-to-agent hand-off pill - owned by services/agentDelegation.ts
		entry.delegation ||
		// A live public progress message: one complete message, never a stream
		entry.purpose === 'commentary' ||
		// Tool call card / hidden-progress placeholder
		entry.metadata?.hiddenProgress ||
		entry.metadata?.toolState ||
		// Claude's plan-limit banner. Unlike every other kind above, this one has
		// no marker field to key off: Claude forwards the banner as ordinary
		// assistant output on the `result` envelope, AFTER the synthetic
		// `assistant` message before it already raised the failure that started
		// the retry. So the transcript holds a plain `stdout` entry whose entire
		// body is the notice, sitting right under the outage card that says the
		// same thing.
		//
		// It is a standalone notice, never the head of a reply, and the answer the
		// retry eventually produces lands as the NEXT `stdout` entry - half an
		// hour later, but still the next one in the same response group. Without
		// this the transcript renders that answer with "You've hit your session
		// limit - resets ..." glued to its front. Recognizing the text rather than
		// a marker also fixes transcripts already on disk.
		//
		// Anchored and length-capped by isClaudeLimitNotice, so an agent
		// *discussing* limits (which Maestro's own agents do constantly) carries
		// surrounding prose and does not match.
		isClaudeLimitNotice(entry.text)
	);
}

/**
 * True when `entry` is an open stream of `source` that new bytes may be
 * appended to.
 *
 * Callers still own their own *policy* on top of this (a time window, whether
 * the session is still busy); this answers only the model-level question of
 * whether appending is structurally valid.
 */
export function canAppendToLogEntry(
	entry: LogEntry | undefined,
	source: LogEntry['source']
): boolean {
	if (!entry) return false;
	if (entry.source !== source) return false;
	// A message read back from the provider transcript is complete. New output
	// belongs to a new turn, never onto the end of a stored answer.
	if (entry.nativeTranscript) return false;
	return !isSelfContainedCard(entry);
}

/**
 * True for a thinking/tool entry that is scratch state of the live turn, which
 * the stream and exit clear points may drop. An entry read back from the
 * provider transcript is history: dropping it would erase tool cards and
 * reasoning the conversation really contains, with nothing to bring them back
 * until the tab is re-read.
 */
export function isTransientActivityEntry(entry: LogEntry, opts: ActivityRetention = {}): boolean {
	if (entry.nativeTranscript) return false;
	if (entry.source === 'tool') return !opts.keepTools;
	return entry.source === 'thinking';
}

/**
 * How a clear point treats the live turn's activity. `keepTools`: tool calls
 * are part of the record, not scratch state - the conversation-centred layout
 * shows them folded and the user expects to read what ran (and its result)
 * after the turn ends, a Stop, or a restart. Reasoning is still scratch.
 */
export interface ActivityRetention {
	keepTools?: boolean;
}

/**
 * Give every live tool call still marked running an honest final state when
 * its turn is over without a result for it: `canceled` when the user stopped
 * the turn, no status at all (unknown) when the process simply exited. Either
 * way it stops pulsing, and nothing unfinished is ever drawn as a success.
 * Returns `logs` itself when nothing was running.
 */
export function settleRunningToolEntries(
	logs: LogEntry[],
	reason: 'stopped' | 'exited'
): LogEntry[] {
	let changed = false;
	const next = logs.map((entry) => {
		if (entry.source !== 'tool' || entry.metadata?.toolState?.status !== 'running') return entry;
		changed = true;
		const rest = { ...entry.metadata.toolState };
		delete rest.status;
		return {
			...entry,
			metadata: {
				...entry.metadata,
				toolState: reason === 'stopped' ? { ...rest, status: 'canceled' as const } : rest,
			},
		};
	});
	return changed ? next : logs;
}
