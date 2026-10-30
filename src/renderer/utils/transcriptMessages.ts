/**
 * Conversion between provider transcript messages (as returned by
 * `window.maestro.agentSessions.read`) and the `LogEntry` shape the AI
 * transcript renders, plus the boundary maths used to splice older history in
 * above what is already on screen.
 *
 * Two call sites must produce IDENTICAL entries from the same message: resuming
 * a session into a tab (`useAgentSessionManagement`) and backfilling older
 * history when the user scrolls to the top (`useTranscriptBackfill`, issue
 * #1407). The backfill matches what it just read against what is already
 * rendered to find the splice point, so any divergence in id or text between
 * the two paths would duplicate the overlapping region.
 */

import type { LogEntry } from '../types';
import { stripEmbeddedSystemPrompt } from '../../shared/embeddedSystemPrompt';
import { compactToolOutput } from '../../shared/toolOutput';
import { generateId } from './ids';

/**
 * How many provider messages the resume path reads when hydrating a tab. The
 * scroll-to-top backfill seeds its first window from this rather than from the
 * tab's entry count, because messages with nothing readable are dropped on the
 * way in (and one message can also become several entries), so the entry count
 * says little about how many messages it covers.
 */
export const TRANSCRIPT_RESUME_READ_LIMIT = 500;

/**
 * A single message as returned by the agent session storage layer. Only the
 * fields the transcript needs are modelled; storage returns more.
 */
export interface TranscriptMessage {
	type: string;
	role?: string;
	content: string;
	timestamp: string;
	uuid: string;
	images?: string[];
	/**
	 * The provider's own purpose label for the message, when it reports one:
	 * `commentary` (progress notes written while working), `final` (the answer)
	 * or `analysis` (a public reasoning summary). Absent for most providers.
	 */
	channel?: string;
	/**
	 * Tool calls carried by the message. Shapes differ per provider: Claude
	 * writes raw `tool_use` blocks (`{ type, id, name, input }`), Codex/OpenCode/
	 * Grok write `{ tool | name, args?, state: { status, input?, output? } }`,
	 * Copilot writes `{ name, id, input }`. {@link normalizeToolUse} reads all of
	 * them; anything it cannot read is ignored rather than rendered raw.
	 */
	toolUse?: unknown;
	/**
	 * The model and reasoning effort the provider recorded for this assistant
	 * message, as written (Codex: both; Claude Code: model only). Absent means
	 * the native record has none; it is never filled from current settings.
	 */
	model?: string;
	effort?: string;
}

/** One tool call read out of a message's `toolUse`, in renderer terms. */
interface NormalizedToolCall {
	name: string;
	callId?: string;
	input?: unknown;
	output?: unknown;
	status?: HistoricToolStatus;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Codex writes function-call arguments as a JSON string. Parse it so the tool
 * card's input summary can read the fields; anything else passes through.
 */
function parseToolArgs(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
	try {
		return JSON.parse(trimmed);
	} catch {
		return value;
	}
}

/**
 * A stored status is only trusted when it says the call FINISHED. A transcript
 * is history: a call recorded as running/pending had its result written
 * elsewhere or never (an interrupted turn), and drawing it as running would
 * pulse forever on a conversation nothing is executing. Unknown stays unknown:
 * a provider that says so explicitly (Grok without its updates file) keeps
 * `unknown`, which draws as neither a success nor a call still running.
 */
const FINISHED_TOOL_STATUSES = new Set(['completed', 'complete', 'success', 'succeeded', 'done']);
const FAILED_TOOL_STATUSES = new Set(['error', 'failed', 'failure']);
/**
 * A call the user stopped is neither a failure nor a success, and the live
 * transcript already draws it as `canceled` (settleRunningToolEntries). History
 * must read back the same, or a conversation shows `x` before a reload and `!`
 * after it. The backend reports `canceled` for an interrupted Codex call.
 */
const CANCELED_TOOL_STATUSES = new Set(['canceled', 'cancelled', 'interrupted', 'aborted']);

type HistoricToolStatus = 'completed' | 'error' | 'canceled' | 'unknown';

function historicToolStatus(status: unknown): HistoricToolStatus | undefined {
	if (typeof status !== 'string') return undefined;
	const s = status.toLowerCase();
	if (FINISHED_TOOL_STATUSES.has(s)) return 'completed';
	if (FAILED_TOOL_STATUSES.has(s)) return 'error';
	if (CANCELED_TOOL_STATUSES.has(s)) return 'canceled';
	if (s === 'unknown') return 'unknown';
	return undefined;
}

/** Read every tool call a message carries; tool results attach to their call. */
function normalizeToolUse(toolUse: unknown): {
	calls: NormalizedToolCall[];
	results: Array<{ callId: string; output: unknown; isError: boolean }>;
} {
	const calls: NormalizedToolCall[] = [];
	const results: Array<{ callId: string; output: unknown; isError: boolean }> = [];
	if (!Array.isArray(toolUse)) return { calls, results };
	for (const raw of toolUse) {
		const item = asRecord(raw);
		if (!item) continue;
		if (item.type === 'tool_result') {
			const callId = nonEmptyString(item.tool_use_id);
			if (callId) results.push({ callId, output: item.content, isError: item.is_error === true });
			continue;
		}
		const name = nonEmptyString(item.tool) ?? nonEmptyString(item.name);
		if (!name) continue;
		const state = asRecord(item.state);
		const input = state?.input ?? item.input ?? parseToolArgs(item.args ?? item.arguments);
		const output = state?.output ?? item.output;
		calls.push({
			name,
			callId:
				nonEmptyString(item.id) ?? nonEmptyString(item.callID) ?? nonEmptyString(item.call_id),
			...(input !== undefined && input !== null && input !== '' ? { input } : {}),
			...(output !== undefined && output !== null && output !== '' ? { output } : {}),
			status: historicToolStatus(state?.status ?? item.status),
		});
	}
	return { calls, results };
}

/**
 * Whether a tool message's text is only the provider's placeholder for the
 * call (`Tool: exec_command`, one line per call) rather than prose. Checked
 * against the message's OWN tool names, never as a free-standing pattern, so an
 * assistant writing "Tool: ..." in an answer keeps its words.
 */
function isToolPlaceholderText(text: string, calls: NormalizedToolCall[]): boolean {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return true;
	const names = new Set(calls.map((call) => call.name));
	return lines.every((line) => line.startsWith('Tool: ') && names.has(line.slice(6).trim()));
}

/**
 * Codex Desktop records some app-shell events as user turns: webview wiring
 * (`<external_codex_apps_...>`) and automation heartbeats (`<heartbeat>` with
 * the automation's instructions or id). Neither is words the user typed.
 *
 * Matched only when the WHOLE message is one envelope, so a user quoting one
 * inside a question keeps their message. A heartbeat must also carry what makes
 * it an automation tick - an `<instructions>` block or an automation id - since
 * `<heartbeat>hello</heartbeat>` on its own is something a person could type.
 */
const APP_SHELL_ENVELOPE = /^<(external_codex_apps_[a-z0-9_]+)(?:\s[^>]*)?>[\s\S]*<\/\1>$/;
const HEARTBEAT_ENVELOPE = /^<heartbeat(\s[^>]*)?>([\s\S]*)<\/heartbeat>$/;
const HEARTBEAT_AUTOMATION_MARK = /<instructions>[\s\S]*<\/instructions>|automation[_-]?id/i;

export function isInternalDesktopEnvelope(text: string | undefined): boolean {
	if (typeof text !== 'string') return false;
	const trimmed = text.trim();
	if (APP_SHELL_ENVELOPE.test(trimmed)) return true;
	const heartbeat = HEARTBEAT_ENVELOPE.exec(trimmed);
	if (!heartbeat) return false;
	// The body must not close and reopen the tag: that is two envelopes with
	// prose between them, not one.
	if (heartbeat[2].includes('</heartbeat>')) return false;
	return HEARTBEAT_AUTOMATION_MARK.test(`${heartbeat[1] ?? ''}${heartbeat[2]}`);
}

/** `compactToolOutput`'s truncation footer, so a capped result can be compared. */
const TOOL_OUTPUT_TRUNCATION_NOTE = /\n\.\.\. \[tool output truncated, \d+ chars total\]$/;

/**
 * Whether a stored tool result is the same text an older build cached as an
 * assistant message (an orphan tool output, shown as plain text). The result
 * may have been capped by `compactToolOutput`; then the kept prefix must open
 * the cached text.
 */
function toolOutputMatchesText(output: unknown, text: string): boolean {
	if (typeof output !== 'string') return false;
	const cached = text.trim();
	if (!cached) return false;
	if (output.trim() === cached) return true;
	if (!TOOL_OUTPUT_TRUNCATION_NOTE.test(output)) return false;
	const prefix = output.replace(TOOL_OUTPUT_TRUNCATION_NOTE, '').trim();
	return prefix.length > 0 && cached.startsWith(prefix);
}

/**
 * How Codex records a message delivered INTO this thread from another thread
 * (the official app's `send_message_to_thread`): a function-call OUTPUT with no
 * call of its own in this thread, whose whole result is a `<codex_delegation>`
 * envelope naming the source thread and carrying the delivered input. The
 * stored form converts to a tool card named `send_message_to_thread` with an
 * output and NO input.
 */
const INBOUND_THREAD_MESSAGE_TOOL = 'send_message_to_thread';
const INBOUND_THREAD_MESSAGE_HEAD =
	/^<codex_delegation>\s*<source_thread_id>[^<\s]+<\/source_thread_id>\s*<input>/;
const INBOUND_THREAD_MESSAGE_TAIL = /<\/input>\s*<\/codex_delegation>$/;

/**
 * Whether a transcript entry is another thread's message arriving in this one:
 * the start of a turn nobody typed into Maestro, exactly as a user message is.
 *
 * Decided from structure, not from words appearing anywhere:
 *  - a STORED entry (`nativeTranscript`): live cards are Maestro's own turn;
 *  - a tool card named `send_message_to_thread` with NO input: a call this
 *    thread makes itself (outbound) carries its arguments, an inbound delivery
 *    is an output without a call;
 *  - its WHOLE result is the envelope (`source_thread_id` + `input`). A result
 *    capped for storage keeps the envelope's opening and the truncation note.
 *
 * Any other tool whose output merely contains the envelope text (an `exec`
 * that printed it, a file read) is not a boundary.
 */
export function isInboundThreadMessage(entry: LogEntry): boolean {
	if (entry.source !== 'tool' || !entry.nativeTranscript) return false;
	if (entry.text !== INBOUND_THREAD_MESSAGE_TOOL) return false;
	const state = entry.metadata?.toolState;
	if (!state) return false;
	if (state.input !== undefined && state.input !== null && state.input !== '') return false;
	if (typeof state.output !== 'string') return false;
	const output = state.output.trim();
	const truncated = TOOL_OUTPUT_TRUNCATION_NOTE.test(output);
	const body = output.replace(TOOL_OUTPUT_TRUNCATION_NOTE, '').trim();
	return (
		INBOUND_THREAD_MESSAGE_HEAD.test(body) && (truncated || INBOUND_THREAD_MESSAGE_TAIL.test(body))
	);
}

/** Where one turn ends and the next begins: a user message, or another thread's. */
function isTurnBoundary(entry: LogEntry): boolean {
	return entry.source === 'user' || isInboundThreadMessage(entry);
}

function toolEntryText(call: NormalizedToolCall): string {
	return call.name;
}

function capToolValue(value: unknown): unknown {
	return value === undefined ? undefined : compactToolOutput(value).output;
}

/**
 * Matches the Auto Run synopsis prompt that Maestro injects into the agent
 * session after a task ("Give/Provide a brief synopsis of what you just
 * accomplished ..."). The leading verb and trailing wording have drifted across
 * versions and the prompt is user-customizable, so we anchor on the stable core
 * phrase. A restored tab hides this request and the assistant's `**Summary:**`
 * reply since they are bookkeeping, not part of the user's conversation.
 */
const SYNOPSIS_REQUEST_PATTERN =
	/^\s*\S+\s+a\s+brief\s+synopsis\s+of\s+what\s+you\s+just\s+accomplished/i;

export function isSynopsisRequest(msg: {
	type?: string;
	role?: string;
	content?: string;
}): boolean {
	const isUser = msg.type === 'user' || msg.role === 'user';
	return isUser && typeof msg.content === 'string' && SYNOPSIS_REQUEST_PATTERN.test(msg.content);
}

/** Drop each synopsis request and the assistant reply that immediately follows it. */
export function stripSynopsisTurns<T extends { type: string; role?: string; content: string }>(
	messages: T[]
): T[] {
	return messages.filter((msg, i, arr) => {
		if (isSynopsisRequest(msg)) return false;
		const prev = arr[i - 1];
		const isAssistant = msg.type === 'assistant' || msg.role === 'assistant';
		if (prev && isSynopsisRequest(prev) && isAssistant) return false;
		return true;
	});
}

/**
 * Convert transcript messages to log entries.
 *
 * Every native message keeps its own entry (or entries): consecutive assistant
 * messages are separate entries, never one concatenated string, so a progress
 * note, a tool call and the answer stay apart. Tool calls become real
 * `source: 'tool'` cards carrying `metadata.toolState` (the same shape the live
 * tool listener writes), so the transcript's tool toggle and folding apply to
 * history too. A reasoning summary (`type: 'thinking'` / `channel: 'analysis'`)
 * becomes a `thinking` entry. Each entry is stamped `nativeTranscript` so the
 * live clear points and coalescing leave history alone.
 *
 * A message that carries Claude-style mixed content keeps BOTH its prose and
 * its tool cards. Messages with no text, image or readable tool call drop out.
 *
 * A user turn is unwrapped on the way through (`stripEmbeddedSystemPrompt`).
 * Every provider except Claude Code lacks a system-prompt flag, so the spawn
 * path embeds the whole Maestro system prompt in the FIRST user turn, and that
 * turn is what the provider writes to disk. Rendering it verbatim showed the
 * system prompt, the conductor profile and the injected context as if the user
 * had typed them, and buried the prompt they really sent at the bottom of it
 * (issue #1533). Stripping here rather than at each call site is what keeps
 * resume and backfill producing identical entries for the same message; it also
 * makes a hydrated first turn match the clean entry a live tab logged, which is
 * what `selectOlderEntries` needs to find its splice point.
 *
 * The strip runs BEFORE the empty check: a turn that carried nothing but the
 * envelope has no user text to show and should drop out entirely.
 */
export function transcriptMessagesToLogEntries(messages: TranscriptMessage[]): LogEntry[] {
	const entries: LogEntry[] = [];
	// Where each tool call landed, so a result recorded in a LATER message (a
	// `tool_result` block) completes the card for its call instead of drawing a
	// second one.
	const toolEntryByCallId = new Map<string, number>();
	const attachResults = (
		results: Array<{ callId: string; output: unknown; isError: boolean }>
	): void => {
		for (const result of results) {
			const index = toolEntryByCallId.get(result.callId);
			if (index === undefined) continue;
			const entry = entries[index];
			const state = entry.metadata?.toolState ?? {};
			entries[index] = {
				...entry,
				metadata: {
					...entry.metadata,
					toolState: {
						...state,
						status: result.isError ? 'error' : 'completed',
						...(result.output !== undefined ? { output: capToolValue(result.output) } : {}),
					},
				},
			};
		}
	};

	for (const msg of messages) {
		// Storage should always supply a uuid; the fallback keeps keys unique if
		// one is missing. Entries that fall back cannot be matched by id across
		// two reads, which is why `selectOlderEntries` also compares source+text.
		const messageId = msg.uuid || generateId();
		const timestamp = new Date(msg.timestamp).getTime();
		const channel = nonEmptyString(msg.channel);
		const nativeTranscript = { messageId, ...(channel ? { channel } : {}) };
		const images = msg.images && msg.images.length > 0 ? msg.images : undefined;
		const { calls, results } = normalizeToolUse(msg.toolUse);
		attachResults(results);

		if (msg.type === 'user') {
			const text = stripEmbeddedSystemPrompt(msg.content ?? '');
			if (!images && (isInternalDesktopEnvelope(text) || !text.trim())) continue;
			entries.push({
				id: messageId,
				timestamp,
				source: 'user',
				text,
				...(images && { images }),
				nativeTranscript,
			});
			continue;
		}

		// A message that carries tool calls keeps its prose (Claude writes text and
		// tool_use blocks in one message) but loses the provider's `Tool: name`
		// stand-in, which the tool card below replaces.
		const content = msg.content ?? '';
		const text = calls.length > 0 && isToolPlaceholderText(content, calls) ? '' : content;
		const hasBody = text.trim().length > 0 || !!images;
		if (hasBody) {
			const isReasoning = msg.type === 'thinking' || channel === 'analysis';
			// Like a live turn, only the agent's output carries the turn's settings.
			const model = isReasoning ? undefined : nonEmptyString(msg.model);
			const effort = isReasoning ? undefined : nonEmptyString(msg.effort);
			entries.push({
				id: messageId,
				timestamp,
				source: isReasoning ? 'thinking' : 'stdout',
				text,
				...(images && { images }),
				nativeTranscript,
				...(model ? { turnModel: model } : {}),
				...(effort ? { turnEffort: effort } : {}),
				...(model || effort ? { turnSettingsSource: 'native' as const } : {}),
			});
		}
		calls.forEach((call, index) => {
			// The message's own id goes to its first entry, whichever kind that is:
			// a cache hydrated by an older build holds this message under that id,
			// and keeping it is what lets a refresh upgrade that entry in place.
			const id = !hasBody && index === 0 ? messageId : `${messageId}:tool:${index}`;
			const input = capToolValue(call.input);
			const output = capToolValue(call.output);
			entries.push({
				id,
				timestamp,
				source: 'tool',
				text: toolEntryText(call),
				metadata: {
					toolState: {
						...(call.status ? { status: call.status } : {}),
						...(input !== undefined ? { input } : {}),
						...(output !== undefined ? { output } : {}),
					},
				},
				nativeTranscript,
			});
			if (call.callId) toolEntryByCallId.set(call.callId, entries.length - 1);
		});
	}
	return entries;
}

/**
 * A provider progress note (Codex `commentary`): shown, but below the answers.
 * Stored ones carry the native channel; live ones the `purpose` marker.
 */
export function isProgressNoteEntry(entry: LogEntry): boolean {
	return (
		entry.source === 'stdout' &&
		(entry.nativeTranscript?.channel === 'commentary' || entry.purpose === 'commentary')
	);
}

/**
 * Pick the entries of a freshly-read transcript window that sit strictly BEFORE
 * what the tab already shows, so they can be prepended without duplicating
 * anything on screen.
 *
 * `loaded` is the newest N messages read from disk and `visible` is the tail of
 * that same conversation, so the splice point is wherever `visible[0]` appears
 * inside `loaded`. Two things stop that from being a plain `indexOf`:
 *
 * - IDs only line up when the tab was hydrated from disk. A tab that ran live
 *   and then survived a restart holds locally generated IDs for the same
 *   messages, so the comparison has to fall back to source + text.
 * - Text alone is ambiguous: a user who sends "continue" ten times produces ten
 *   identical entries. So search outward from where the splice point is
 *   EXPECTED to be - the two lists differ only by entries that never reached
 *   disk - and take the nearest match rather than the first or last in the array.
 *
 * Nearest-to-expected is not enough on its own, though. `expected` is only an
 * estimate, and it is off by however many renderer-only entries the tab holds
 * (system notices, outage markers). Shift the estimate past one repetition of a
 * repeated message and the nearest source+text hit is the WRONG occurrence,
 * which either drops genuine turns or re-prepends ones already on screen. So
 * candidates are ranked by how much corroborating evidence they carry, and the
 * scan returns the best tier it found rather than the first hit of any tier:
 *
 *   1. Matching id - unambiguous, the tab was hydrated from this same file.
 *   2. Same source and text AND the same timestamp - a disk-hydrated entry keeps
 *      the provider's timestamp verbatim, so this pins the exact occurrence.
 *   3. Same source and text, and the entry AFTER it lines up with `visible[1]`
 *      too - two consecutive matches is far stronger than one.
 *   4. Same source and text alone - the old behavior, kept as a last resort
 *      because a live tab's entries carry locally generated ids and renderer
 *      clock timestamps, and their next entry may be a renderer-only notice
 *      that was never written to disk.
 */
export function selectOlderEntries(loaded: LogEntry[], visible: LogEntry[]): LogEntry[] {
	if (loaded.length === 0) return [];
	const boundary = visible[0];
	if (!boundary) return loaded;

	// Index of the best (lowest-numbered) tier seen so far. Because the scan
	// walks outward from `expected`, the first index recorded for a tier is
	// already the nearest one, so later hits in the same tier are ignored.
	let bestTier = Number.POSITIVE_INFINITY;
	let bestIndex = -1;
	const consider = (index: number): boolean => {
		const tier = matchTier(loaded, index, visible);
		if (tier === null) return false;
		if (tier < bestTier) {
			bestTier = tier;
			bestIndex = index;
		}
		// Tier 1 is an id match: nothing can beat it, so stop the scan.
		return tier === MATCH_TIER_ID;
	};

	const expected = Math.max(0, loaded.length - visible.length);
	for (let delta = 0; delta <= loaded.length; delta++) {
		const after = expected + delta;
		if (after < loaded.length && consider(after)) break;
		const before = expected - delta;
		if (delta > 0 && before >= 0 && consider(before)) break;
	}

	if (bestIndex >= 0) return loaded.slice(0, bestIndex);

	// No match: the boundary entry never reached disk (Maestro-injected system
	// notices and Agent Resilience outage markers live only in the tab). Cut on
	// time instead - staying strictly older than what is on screen is what keeps
	// the prepend duplicate-free.
	return loaded.filter((entry) => entry.timestamp < boundary.timestamp);
}

/**
 * The tail-side counterpart of {@link selectOlderEntries}: fold messages that
 * were written to the native transcript AFTER what the tab shows (another app
 * kept the conversation going) onto the end of `visible`, without dropping or
 * reordering anything already there.
 *
 * `loaded` is the newest window read from disk. The splice point is the NEWEST
 * entry of `visible` that also appears in `loaded`:
 *
 *  1. an id match, or the same source + text + timestamp (a disk-hydrated entry
 *     keeps both verbatim) - unambiguous;
 *  2. otherwise the same source + text written within the live clock window
 *     (30s for a user send, 10min for a streamed reply), preferring a match
 *     whose previous entry also lines up, then the nearest in time; a tie is
 *     ambiguous - for a tab whose entries ran live and carry local ids.
 *
 * Everything in `visible` survives: earlier backfilled history above the
 * anchor, and renderer-only entries below it (errors, notices, a failed send).
 * A loaded entry after the anchor is skipped when it is already on screen by
 * id, or when it repeats a still-unmatched entry of the visible tail (a reply
 * Maestro sent live and the provider then wrote with its own id), so running
 * this twice never duplicates. New entries are interleaved into that tail by
 * timestamp, keeping each side's own order.
 *
 * A provider that stores no per-message time (Grok) gives the clock window
 * nothing to compare, so for its entries the evidence is ORDER instead: a
 * native entry repeats the first unmatched local entry with the same text that
 * comes AFTER the last one it paired, one to one, never an earlier one. A real
 * repeat of the same words still has its own native message left over and is
 * appended. Such an entry is placed by disk order too: before the local entry
 * the next native message paired with, or at the end.
 *
 * Returns `null` when no entry of `visible` is in `loaded`: the window is too
 * small (widen it) or the two do not describe the same conversation. Never
 * guesses in that case, since a wrong splice would duplicate or hide turns.
 */
export function mergeNewerEntries(
	loaded: LogEntry[],
	visible: LogEntry[]
): { logs: LogEntry[]; added: number } | null {
	if (visible.length === 0)
		return loaded.length > 0 ? { logs: loaded, added: loaded.length } : null;
	const anchor = findNewestSharedEntry(loaded, visible);
	if (!anchor) return null;

	const tail = visible.slice(anchor.visibleIndex + 1);
	// A send already tied to its native copy is accounted for: it must not also
	// stand in, by text, for a later native message with the same words.
	const unmatchedTail = tail.filter((entry) => !isBoundOwnSend(entry));
	const visibleIds = new Set(visible.map((entry) => entry.id));
	// Native user messages already on screen as the tab's OWN send, tied to it by
	// bindDelayedOwnSends (the provider wrote them too late for the live window).
	const ownSendMessageIds = new Set(
		visible.filter(isBoundOwnSend).map((entry) => entry.nativeTranscript!.messageId)
	);
	const fresh: LogEntry[] = [];
	// Whether the disk entries being walked belong to a turn the tab already
	// showed LIVE (its user message matched a local send, and a local reply sits
	// under it). Such a turn's tool calls, progress notes and reasoning cannot be
	// matched by content - a tool card's text is only its name, and a streamed
	// reply's text is not the stored message's - so they are skipped rather than
	// appended a second time under the reply the user already read.
	// The exception is tool calls: the agent layout (and older builds) clear a
	// live turn's tool cards when it ends, so when the tab kept NONE for that
	// turn the stored calls - with their results - are the only record left and
	// are added back; when it kept its own, those already are the record.
	const anchorEntry = visible[anchor.visibleIndex];
	const anchorIsLive = anchorEntry.id !== loaded[anchor.loadedIndex].id;
	let liveTurn = anchorIsLive && (anchorEntry.source !== 'user' || tailHasLocalReply(tail, -1));
	let liveTurnHasTools = liveTurn && liveTurnShowsTools(visible, anchor.visibleIndex);
	// Order bookkeeping for native entries with no time: the tail index of the
	// last local entry one of them paired with, the new ones still waiting for
	// the next pairing to fix their place, and where each settled batch goes.
	let lastUntimedPairAt = -1;
	let pendingUntimed: LogEntry[] = [];
	const untimedBefore = new Map<number, LogEntry[]>();
	let untimedAdded = 0;
	for (const entry of loaded.slice(anchor.loadedIndex + 1)) {
		if (visibleIds.has(entry.id)) {
			// Another thread's message already on screen still starts a new turn:
			// what follows it is not the live turn's to suppress.
			if (isInboundThreadMessage(entry)) liveTurn = false;
			continue;
		}
		if (
			entry.source === 'user' &&
			ownSendMessageIds.has(entry.nativeTranscript?.messageId ?? entry.id)
		) {
			// The prompt is on screen already. Everything after it is treated
			// exactly as it was before the binding existed (as after any user
			// message the window could not pair), so only the duplicate goes.
			liveTurn = false;
			continue;
		}
		// Only a local entry written around the same time can be this disk entry.
		// The same short text sent again later from another app ("continue") is
		// a genuine new turn and must still be appended. Without a native time,
		// only the next local entry in sequence can be it.
		const untimed = !Number.isFinite(entry.timestamp);
		// An unmatched native user starts an external turn. Its reply cannot
		// claim a later local reply merely because their words are identical.
		const repeat = untimed
			? unmatchedTail.findIndex(
					(local) =>
						(entry.source === 'user' || liveTurn) &&
						tail.indexOf(local) > lastUntimedPairAt &&
						sameTextEntry(local, entry)
				)
			: unmatchedTail.findIndex((local) => sameLiveMessage(local, entry));
		if (repeat >= 0) {
			const local = unmatchedTail[repeat];
			unmatchedTail.splice(repeat, 1);
			const at = tail.indexOf(local);
			if (untimed) {
				lastUntimedPairAt = at;
				if (pendingUntimed.length > 0) {
					untimedBefore.set(at, pendingUntimed);
					pendingUntimed = [];
				}
			}
			if (entry.source === 'user') {
				liveTurn = tailHasLocalReply(tail, at);
				liveTurnHasTools = liveTurn && liveTurnShowsTools(tail, at);
			}
			continue;
		}
		// A user message, or another thread's message delivered into this one,
		// starts a turn the tab did not show live: it and what follows are new.
		if (isTurnBoundary(entry)) liveTurn = false;
		else if (liveTurn && (entry.source !== 'tool' || liveTurnHasTools)) continue;
		if (untimed) {
			pendingUntimed.push(entry);
			untimedAdded++;
		} else {
			fresh.push(entry);
		}
	}
	if (fresh.length === 0 && untimedAdded === 0) return { logs: visible, added: 0 };

	const mergedTail: LogEntry[] = [];
	let i = 0;
	let j = 0;
	while (i < tail.length || j < fresh.length) {
		if (j >= fresh.length || (i < tail.length && !(fresh[j].timestamp < tail[i].timestamp))) {
			const before = untimedBefore.get(i);
			if (before) mergedTail.push(...before);
			mergedTail.push(tail[i++]);
		} else {
			mergedTail.push(fresh[j++]);
		}
	}
	mergedTail.push(...pendingUntimed);
	return {
		logs: [...visible.slice(0, anchor.visibleIndex + 1), ...mergedTail],
		added: fresh.length + untimedAdded,
	};
}

/**
 * Bring entries a tab already holds up to the current conversion, IN PLACE.
 *
 * A tab hydrated by an older build holds the same native messages under the
 * same ids, but converted the old way: tool calls as `stdout` entries reading
 * `Tool: exec_command`, no channel, Claude's tool_use blocks dropped, and
 * Codex Desktop app-shell envelopes shown as user turns. `mergeNewerEntries`
 * only ever appends, so without this those entries would stay wrong forever,
 * including on a conversation that gained nothing new.
 *
 * Only entries that are PROVABLY the same native message are rewritten:
 *
 *  - same id as an entry the current conversion produced, AND
 *  - the same timestamp (a disk-hydrated entry keeps the provider's verbatim;
 *    a provider whose ids are positional and shifted would land on a message
 *    written at another moment), AND
 *  - the same side of the conversation (user vs agent), AND, for agent text,
 *    the same words or the old `Tool: name` stand-in for one of its calls.
 *
 * A rewritten entry is replaced by the native message's whole group (its text
 * entry plus any tool cards it carries), keeping fields only the renderer
 * knows (delivery, turn settings) from the cached copy. Anything that fails a
 * check is left exactly as it was: entries with local ids (live sends and
 * replies, errors, notices, cards) are never matched and never moved. The one
 * removal is a cached user entry whose ENTIRE text is a Codex Desktop app-shell
 * or automation-heartbeat envelope that the native read no longer returns.
 *
 * An entry already in the current form is updated field by field from its
 * native twin (same id, kind and moment) - a tool call first read without its
 * result gains it - but nothing missing beside it is restored, so an entry the
 * user deleted stays deleted.
 *
 * Idempotent: a second run over its own output changes nothing.
 */
export function reconcileTranscriptEntries(
	loaded: LogEntry[],
	visible: LogEntry[]
): { logs: LogEntry[]; upgraded: number } {
	if (loaded.length === 0 || visible.length === 0) return { logs: visible, upgraded: 0 };
	const groups = new Map<string, LogEntry[]>();
	const groupOfEntry = new Map<string, string>();
	for (const entry of loaded) {
		const messageId = entry.nativeTranscript?.messageId ?? entry.id;
		const group = groups.get(messageId);
		if (group) group.push(entry);
		else groups.set(messageId, [entry]);
		groupOfEntry.set(entry.id, messageId);
	}

	const loadedIndex = new Map(loaded.map((entry, index) => [entry.id, index]));
	const loadedById = new Map(loaded.map((entry) => [entry.id, entry]));
	const visibleIds = new Set(visible.map((entry) => entry.id));
	const emitted = new Set<string>();
	const refused = new Set<string>();
	const out: LogEntry[] = [];
	let upgraded = 0;
	// Where the last rewritten group ended in `loaded`, and whether anything the
	// conversation could contain (a live send or reply with a local id) sits
	// between it and the next one. Native messages the old conversion dropped
	// entirely (Claude writes each tool_use as its own empty-text message) are
	// filled into that gap only when it is clean; otherwise they might be the
	// disk copy of a live entry and would show twice.
	let lastLoaded = -1;
	let gapClean = false;
	for (const entry of visible) {
		const messageId = groupOfEntry.get(entry.id);
		if (messageId === undefined) {
			if (
				!entry.nativeTranscript &&
				entry.source === 'user' &&
				!(entry.images && entry.images.length > 0) &&
				isInternalDesktopEnvelope(entry.text)
			) {
				upgraded++;
				continue;
			}
			if (isConversationContent(entry)) gapClean = false;
			out.push(entry);
			continue;
		}
		if (emitted.has(messageId)) {
			// Already written out with its group, in its canonical form.
			continue;
		}
		if (entry.nativeTranscript) {
			// Already in the current form, and it closes any gap: an entry missing
			// next to it was removed after conversion (the user deleted it), not
			// dropped by an older build, so nothing is restored around it.
			gapClean = false;
			// Its own fields still follow the native message when that is provably
			// the same one (same id, kind and moment): a call read before its result
			// was written gains the result and its finished status here.
			const twin = loadedById.get(entry.id);
			if (twin && twin.source === entry.source && sameMoment(entry, twin)) {
				const next = withRendererFields(entry, twin);
				if (!sameRenderedEntry(entry, next)) {
					out.push(next);
					upgraded++;
					continue;
				}
			}
			out.push(entry);
			continue;
		}
		const group = groups.get(messageId)!;
		const twin = group.find((candidate) => candidate.id === entry.id)!;
		if (refused.has(messageId) || !isSameNativeMessage(entry, twin, group)) {
			refused.add(messageId);
			gapClean = false;
			out.push(entry);
			continue;
		}
		const first = loadedIndex.get(group[0].id)!;
		if (gapClean && lastLoaded >= 0 && first > lastLoaded + 1) {
			const missing = loaded
				.slice(lastLoaded + 1, first)
				.filter((candidate) => !visibleIds.has(candidate.id));
			const missingGroups = new Set(missing.map((m) => groupOfEntry.get(m.id)!));
			// Whole messages only: a message the tab holds part of is rewritten
			// where it stands, never pulled forward here.
			const fillable = missing.every((m) => {
				const id = groupOfEntry.get(m.id)!;
				return (
					!emitted.has(id) &&
					!refused.has(id) &&
					!groups.get(id)!.some((member) => visibleIds.has(member.id))
				);
			});
			if (missing.length > 0 && fillable) {
				out.push(...missing);
				for (const id of missingGroups) emitted.add(id);
				upgraded += missingGroups.size;
			}
		}
		emitted.add(messageId);
		const cached = new Map(
			visible.filter((v) => groupOfEntry.get(v.id) === messageId).map((v) => [v.id, v])
		);
		let changed = cached.size !== group.length;
		for (const native of group) {
			const old = cached.get(native.id);
			const next = old ? withRendererFields(old, native) : native;
			if (!old || !sameRenderedEntry(old, next)) changed = true;
			out.push(old && sameRenderedEntry(old, next) ? old : next);
		}
		if (changed) upgraded++;
		lastLoaded = loadedIndex.get(group[group.length - 1].id)!;
		gapClean = true;
	}
	return upgraded > 0 ? { logs: out, upgraded } : { logs: visible, upgraded: 0 };
}

/**
 * A prompt Maestro sent itself that has not been tied to its native copy yet:
 * a delivered user entry with a local id and no provenance.
 */
function isUnboundOwnSend(entry: LogEntry): boolean {
	return (
		entry.source === 'user' && !entry.nativeTranscript && entry.delivered === true && hasText(entry)
	);
}

/**
 * A prompt Maestro sent itself that {@link bindDelayedOwnSends} has tied to its
 * native copy: it keeps its local id, and carries the native message id.
 */
function isBoundOwnSend(entry: LogEntry): boolean {
	return (
		entry.source === 'user' &&
		!!entry.nativeTranscript &&
		entry.nativeTranscript.messageId !== entry.id
	);
}

/**
 * Whether the provider's turn after `loaded[nativeUser]` is the turn the tab
 * showed LIVE after `visible[localUser]`: some live entry of the tab's turn
 * (no provenance, so written by Maestro as it streamed) has the same source and
 * text as an entry of the native turn and was written within the live clock
 * window of it. `skipId` is the cached native copy of the prompt itself.
 */
function liveTurnMatchesNative(
	loaded: LogEntry[],
	nativeUser: number,
	visible: LogEntry[],
	localUser: number,
	skipId: string
): boolean {
	const nativeTurn: LogEntry[] = [];
	for (let k = nativeUser + 1; k < loaded.length && !isTurnBoundary(loaded[k]); k++) {
		nativeTurn.push(loaded[k]);
	}
	if (nativeTurn.length === 0) return false;
	for (let k = localUser + 1; k < visible.length; k++) {
		const entry = visible[k];
		if (entry.id === skipId) continue;
		if (isTurnBoundary(entry)) break;
		if (entry.nativeTranscript) continue;
		if (nativeTurn.some((native) => sameLiveMessage(entry, native))) return true;
	}
	return false;
}

/**
 * Tie a prompt Maestro sent to its native copy when the provider wrote that copy
 * LATE, and repair the duplicate an earlier refresh already showed for it.
 *
 * A provider persists the user message when it starts the turn, which is
 * normally within seconds of the send, and `mergeNewerEntries` pairs the two by
 * text inside `LIVE_SEND_CLOCK_WINDOW_MS`. A turn that first compacts the
 * context (Codex `contextCompaction`) writes it minutes later: 132s in the
 * observed case. The same words that late are, by text and clock alone,
 * indistinguishable from the user sending them again from another app, so the
 * merge rightly refuses them and the prompt was shown twice. This supplies the
 * missing evidence from ORDER instead of a wider window or a global text dedup.
 *
 * User messages are walked one-to-one in conversation order. A cursor into
 * `loaded` syncs on every visible entry the native read also holds (same id),
 * and moves to the next native user message each time a visible user message is
 * accounted for (the same id, a bound send, or an ordinary in-window live
 * match). An own send is bound to the next native user message only when all
 * of these hold:
 *  - it is delivered and has no provenance yet, and the cursor is at a known
 *    point (nothing unaccounted for between the last sync and it);
 *  - the next native user message after the cursor has the same text, was
 *    written AFTER the send by more than the live window (inside the window the
 *    ordinary merge already pairs it, so its behavior is unchanged), and is not
 *    already claimed by another send;
 *  - the native turn under it matches the tab's own LIVE turn under the send
 *    (an agent message streamed in that turn is the stored one: same text,
 *    within the reply window), which a later identical prompt from another app
 *    would not;
 *  - when an earlier refresh already put the native copy on screen, it sits
 *    after the send with no other user message between them.
 *
 * A bound send keeps its local id, timestamp, images and delivery, and gains
 * `nativeTranscript.messageId` of its native copy; a cached native copy of it
 * is removed from the tab (it is the same occurrence, not a turn). Nothing
 * else moves. Anything that fails a check is left exactly as it was: a
 * genuinely repeated prompt, a second native message with the same words, and
 * a later external turn all keep their own entries. Idempotent.
 */
export function bindDelayedOwnSends(
	loaded: LogEntry[],
	visible: LogEntry[]
): { logs: LogEntry[]; bound: number } {
	if (loaded.length === 0 || visible.length === 0) return { logs: visible, bound: 0 };
	const loadedIndex = new Map(loaded.map((entry, index) => [entry.id, index]));
	const userIndexByMessageId = new Map<string, number>();
	loaded.forEach((entry, index) => {
		if (entry.source === 'user') {
			userIndexByMessageId.set(entry.nativeTranscript?.messageId ?? entry.id, index);
		}
	});
	const claimed = new Set(
		visible.filter(isBoundOwnSend).map((entry) => entry.nativeTranscript!.messageId)
	);
	// The next native user message after `from`, or -1 when there is none or
	// another thread's message comes first (that turn has no local counterpart,
	// so pairing across it would be a guess).
	const nextNativeUser = (from: number): number => {
		for (let k = from + 1; k < loaded.length; k++) {
			if (loaded[k].source === 'user') return k;
			if (isInboundThreadMessage(loaded[k])) return -1;
		}
		return -1;
	};

	const stamp = new Map<string, string>();
	const drop = new Set<string>();
	// Index in `loaded` the walk has reached, or -1 while the position is unknown.
	let cursor = -1;
	for (let v = 0; v < visible.length; v++) {
		const entry = visible[v];
		if (drop.has(entry.id)) continue;
		const sync = loadedIndex.get(entry.id);
		if (sync !== undefined) {
			cursor = sync;
			continue;
		}
		if (entry.source !== 'user') continue;
		if (isBoundOwnSend(entry)) {
			cursor = userIndexByMessageId.get(entry.nativeTranscript!.messageId) ?? -1;
			continue;
		}
		if (cursor < 0) continue;
		const n = nextNativeUser(cursor);
		if (n < 0) {
			cursor = -1;
			continue;
		}
		const native = loaded[n];
		if (sameLiveMessage(entry, native)) {
			// The ordinary in-window pairing: the merge handles it as before.
			cursor = n;
			continue;
		}
		const messageId = native.nativeTranscript?.messageId ?? native.id;
		const cachedAt = visible.findIndex((candidate) => candidate.id === native.id);
		const bindable =
			isUnboundOwnSend(entry) &&
			!claimed.has(messageId) &&
			sameTextEntry(entry, native) &&
			native.timestamp - entry.timestamp > LIVE_SEND_CLOCK_WINDOW_MS &&
			(cachedAt < 0 ||
				(cachedAt > v &&
					!visible.slice(v + 1, cachedAt).some((between) => between.source === 'user'))) &&
			liveTurnMatchesNative(loaded, n, visible, v, native.id);
		if (!bindable) {
			// Unaccounted for: stop binding until the next shared entry.
			cursor = -1;
			continue;
		}
		claimed.add(messageId);
		stamp.set(entry.id, messageId);
		if (cachedAt >= 0) drop.add(native.id);
		cursor = n;
	}
	if (stamp.size === 0) return { logs: visible, bound: 0 };
	const logs = visible
		.filter((entry) => !drop.has(entry.id))
		.map((entry) => {
			const messageId = stamp.get(entry.id);
			return messageId ? { ...entry, nativeTranscript: { messageId } } : entry;
		});
	return { logs, bound: stamp.size };
}

/** An entry that could be a turn of the conversation, as opposed to a notice or card. */
function isConversationContent(entry: LogEntry): boolean {
	return (
		entry.source === 'user' ||
		entry.source === 'stdout' ||
		entry.source === 'ai' ||
		entry.source === 'thinking' ||
		entry.source === 'tool'
	);
}

/** The checks {@link reconcileTranscriptEntries} needs before rewriting `cached`. */
function isSameNativeMessage(cached: LogEntry, native: LogEntry, group: LogEntry[]): boolean {
	if (
		Number.isFinite(cached.timestamp) &&
		Number.isFinite(native.timestamp) &&
		cached.timestamp !== native.timestamp
	) {
		return false;
	}
	const cachedIsUser = cached.source === 'user';
	if (cachedIsUser !== (native.source === 'user')) return false;
	// Same id and same moment on the user side: the current read may have
	// unwrapped the turn (a question reply), so its words can legitimately differ.
	if (cachedIsUser) return true;
	const text = cached.text.trim();
	if (cached.source === 'tool') return native.source === 'tool' && cached.text === native.text;
	const toolNames = new Set(group.filter((e) => e.source === 'tool').map((e) => e.text));
	if (
		toolNames.size > 0 &&
		text
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.every((line) => line.startsWith('Tool: ') && toolNames.has(line.slice(6).trim()))
	) {
		return true;
	}
	// An orphan tool result an older build showed as the assistant's text: the
	// native read now returns it as a tool card whose result IS that text.
	if (
		group.some(
			(e) => e.source === 'tool' && toolOutputMatchesText(e.metadata?.toolState?.output, text)
		)
	) {
		return true;
	}
	return group.some((e) => e.source !== 'tool' && e.text.trim() === text);
}

/** Same provider timestamp, including two entries that both lack one. */
function sameMoment(a: LogEntry, b: LogEntry): boolean {
	return a.timestamp === b.timestamp || (Number.isNaN(a.timestamp) && Number.isNaN(b.timestamp));
}

/**
 * Keep what only the renderer knows about an entry (delivery, turn settings).
 * A send-time stamp outranks the native record as a pair: it is what the user
 * chose, and mixing one axis from each would describe no configuration at all.
 */
function withRendererFields(cached: LogEntry, native: LogEntry): LogEntry {
	const cachedStamp = !!(cached.turnModel || cached.turnEffort);
	const next: LogEntry = {
		...native,
		...(cached.delivered !== undefined ? { delivered: cached.delivered } : {}),
		...(cached.readOnly !== undefined ? { readOnly: cached.readOnly } : {}),
		...(cached.renderStyle ? { renderStyle: cached.renderStyle } : {}),
		...(cached.aiCommand ? { aiCommand: cached.aiCommand } : {}),
	};
	if (cachedStamp) {
		delete next.turnModel;
		delete next.turnEffort;
		delete next.turnSettingsSource;
		if (cached.turnModel) next.turnModel = cached.turnModel;
		if (cached.turnEffort) next.turnEffort = cached.turnEffort;
		if (cached.turnSettingsSource) next.turnSettingsSource = cached.turnSettingsSource;
	}
	return next;
}

/**
 * Whether two copies of an entry DRAW the same. The bare `nativeTranscript`
 * stamp is bookkeeping, so an old entry that differs only by lacking it is not
 * rewritten (and a refresh over an up-to-date tab stays `unchanged`). Of the
 * channels only `commentary` draws differently (a progress note); `analysis`
 * already shows as the entry's `thinking` source and `final` draws as before.
 */
function sameRenderedEntry(a: LogEntry, b: LogEntry): boolean {
	return (
		a.id === b.id &&
		a.source === b.source &&
		a.text === b.text &&
		(a.timestamp === b.timestamp || (Number.isNaN(a.timestamp) && Number.isNaN(b.timestamp))) &&
		JSON.stringify(a.images ?? null) === JSON.stringify(b.images ?? null) &&
		JSON.stringify(a.metadata ?? null) === JSON.stringify(b.metadata ?? null) &&
		isProgressNoteEntry(a) === isProgressNoteEntry(b) &&
		// The message info shows these, so a reply cached before the native record
		// carried them is filled in once.
		a.turnModel === b.turnModel &&
		a.turnEffort === b.turnEffort
	);
}

/**
 * Whether a tab's cached transcript still carries entries an older build
 * converted (tool stand-ins as text, app-shell envelopes), so opening it
 * should re-read the native file even when nothing new was written there.
 */
export function hasLegacyTranscriptEntries(logs: LogEntry[] | undefined): boolean {
	return (logs ?? []).some(
		(entry) =>
			!entry.nativeTranscript &&
			((entry.source === 'stdout' && !entry.metadata && /^Tool: \S+$/.test(entry.text.trim())) ||
				(entry.source === 'user' && isInternalDesktopEnvelope(entry.text)))
	);
}

/**
 * How far apart a live entry's renderer timestamp and the provider's own
 * timestamp for the same message can be. A streamed reply is stamped when its
 * first chunk arrives and written to disk when it completes, so it gets a wide
 * window. A user message is stamped at send and written on receipt, so it gets
 * a short one: the same words a minute later are a new turn, not this one.
 */
const LIVE_REPLY_CLOCK_WINDOW_MS = 10 * 60_000;
const LIVE_SEND_CLOCK_WINDOW_MS = 30_000;

function clockWindowMs(entry: LogEntry): number {
	return entry.source === 'user' ? LIVE_SEND_CLOCK_WINDOW_MS : LIVE_REPLY_CLOCK_WINDOW_MS;
}

/**
 * Whether the tab shows a reply of its OWN (a live entry, not one read back from
 * disk) after `tail[from]` and before the next user message.
 */
function tailHasLocalReply(tail: LogEntry[], from: number): boolean {
	for (let k = from + 1; k < tail.length; k++) {
		const entry = tail[k];
		if (isTurnBoundary(entry)) return false;
		if (
			!entry.nativeTranscript &&
			(entry.source === 'stdout' ||
				entry.source === 'ai' ||
				entry.source === 'thinking' ||
				entry.source === 'tool')
		) {
			return true;
		}
	}
	return false;
}

/**
 * Whether the turn containing `logs[at]` (from its user message to the next)
 * still shows a tool call of its own.
 */
function liveTurnShowsTools(logs: LogEntry[], at: number): boolean {
	let start = at;
	while (start > 0 && !isTurnBoundary(logs[start])) start--;
	for (let k = start + 1; k < logs.length; k++) {
		if (isTurnBoundary(logs[k])) return false;
		if (logs[k].source === 'tool') return true;
	}
	return false;
}

/** Same text AND written close enough in time to be the same live message. */
function sameLiveMessage(local: LogEntry, disk: LogEntry): boolean {
	return (
		sameTextEntry(local, disk) && Math.abs(local.timestamp - disk.timestamp) <= clockWindowMs(local)
	);
}

function findNewestSharedEntry(
	loaded: LogEntry[],
	visible: LogEntry[]
): { visibleIndex: number; loadedIndex: number } | null {
	if (loaded.length === 0) return null;
	const byId = new Map<string, number>();
	const byStamp = new Map<string, number>();
	loaded.forEach((entry, index) => {
		byId.set(entry.id, index);
		if (hasText(entry)) byStamp.set(stampKey(entry), index);
	});
	// Native ids first (a tab hydrated or imported from the file keeps them),
	// then the exact source + time + text a hydrated entry also keeps.
	for (let v = visible.length - 1; v >= 0; v--) {
		const byNativeId = byId.get(visible[v].id);
		if (byNativeId !== undefined) return { visibleIndex: v, loadedIndex: byNativeId };
	}
	// A never-hydrated Grok tab has only local ids and renderer times. NaN is
	// not timestamp evidence, even if both sides happen to have it. With no
	// shared id, require one unique alignment of the complete user sequence.
	if (loaded.every((entry) => !Number.isFinite(entry.timestamp))) {
		return findUniqueUntimedUserAnchor(loaded, visible);
	}
	for (let v = visible.length - 1; v >= 0; v--) {
		if (!hasText(visible[v])) continue;
		const byExactStamp = byStamp.get(stampKey(visible[v]));
		if (byExactStamp !== undefined) return { visibleIndex: v, loadedIndex: byExactStamp };
	}
	// Content fallback for live entries (local ids, renderer clock). A text match
	// alone is not evidence: the same words can recur hours later in another app,
	// and anchoring on that later repetition would silently skip everything
	// written in between. So a candidate must also be written within the live
	// clock window of the visible entry; the nearest one wins, and a tie is
	// ambiguous. With no compatible candidate anywhere the result is null, which
	// makes the caller widen its window until the real occurrence is in it.
	for (let v = visible.length - 1; v >= 0; v--) {
		const target = visible[v];
		const candidates: number[] = [];
		loaded.forEach((entry, index) => {
			if (sameLiveMessage(target, entry)) candidates.push(index);
		});
		if (candidates.length === 0) continue;
		const prev = visible[v - 1];
		const corroborated = candidates.filter(
			(index) => index > 0 && !!prev && sameLiveMessage(prev, loaded[index - 1])
		);
		const nearest = nearestInTime(
			corroborated.length > 0 ? corroborated : candidates,
			loaded,
			target
		);
		return nearest === null ? null : { visibleIndex: v, loadedIndex: nearest };
	}
	return null;
}

/**
 * The earliest and latest ordered user alignments must be identical. A failed
 * send missing from disk, an image-only prompt, or multiple possible matches
 * gives no anchor. Repeated text is allowed when the whole alignment is unique.
 */
function findUniqueUntimedUserAnchor(
	loaded: LogEntry[],
	visible: LogEntry[]
): { visibleIndex: number; loadedIndex: number } | null {
	const users = visible.flatMap((entry, index) => (entry.source === 'user' ? [index] : []));
	if (users.length === 0) return null;
	const earliest: number[] = [];
	let next = 0;
	for (let i = 0; i < loaded.length && next < users.length; i++) {
		if (sameTextEntry(visible[users[next]], loaded[i])) {
			earliest.push(i);
			next++;
		}
	}
	if (earliest.length !== users.length) return null;
	next = users.length - 1;
	for (let i = loaded.length - 1; i >= 0 && next >= 0; i--) {
		if (sameTextEntry(visible[users[next]], loaded[i])) {
			if (earliest[next] !== i) return null;
			next--;
		}
	}
	// Start at the first proven send so an external turn between two local
	// sends is still visited by the existing ordered merge.
	return { visibleIndex: users[0], loadedIndex: earliest[0] };
}

/** The candidate written closest to `target`, or null on a tie. */
function nearestInTime(candidates: number[], loaded: LogEntry[], target: LogEntry): number | null {
	let best = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	let tied = false;
	for (const index of candidates) {
		const distance = Math.abs(loaded[index].timestamp - target.timestamp);
		if (distance < bestDistance) {
			best = index;
			bestDistance = distance;
			tied = false;
		} else if (distance === bestDistance) {
			tied = true;
		}
	}
	return best < 0 || tied ? null : best;
}

function stampKey(entry: LogEntry): string {
	return JSON.stringify([entry.source, entry.timestamp, entry.text.trim()]);
}

/**
 * Whether the entry's text is CONTENT that identifies it. A tool card's text is
 * only the tool's name, so two `exec_command` calls written in the same second
 * would look identical; tool cards are matched by id alone.
 */
function hasText(entry: LogEntry): boolean {
	return entry.source !== 'tool' && !!entry.text && entry.text.trim().length > 0;
}

/**
 * Same message by content, for entries without a shared id. An entry with no
 * text (an image-only turn) never matches on content: two different
 * screenshots would otherwise look identical.
 */
function sameTextEntry(a: LogEntry, b: LogEntry): boolean {
	return hasText(a) && hasText(b) && a.source === b.source && a.text.trim() === b.text.trim();
}

const MATCH_TIER_ID = 1;
const MATCH_TIER_TIMESTAMP = 2;
const MATCH_TIER_SEQUENCE = 3;
const MATCH_TIER_TEXT = 4;

/**
 * How strongly `loaded[index]` looks like the splice boundary `visible[0]`.
 * Lower is stronger; `null` means it is not a candidate at all.
 */
function matchTier(loaded: LogEntry[], index: number, visible: LogEntry[]): number | null {
	const candidate = loaded[index];
	const boundary = visible[0];
	if (candidate.id === boundary.id) return MATCH_TIER_ID;
	if (!isSameEntry(candidate, boundary)) return null;
	if (candidate.timestamp === boundary.timestamp) return MATCH_TIER_TIMESTAMP;
	const nextLoaded = loaded[index + 1];
	const nextVisible = visible[1];
	if (nextLoaded && nextVisible && isSameEntry(nextLoaded, nextVisible)) {
		return MATCH_TIER_SEQUENCE;
	}
	return MATCH_TIER_TEXT;
}

function isSameEntry(a: LogEntry, b: LogEntry): boolean {
	if (a.id === b.id) return true;
	if (a.source === 'tool' || b.source === 'tool') return false;
	return a.source === b.source && a.text.trim() === b.text.trim();
}
