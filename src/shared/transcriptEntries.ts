import { stripTurnPrompt } from './turnPrompt';
import { stripEmbeddedSystemPrompt } from './embeddedSystemPrompt';
import { compactToolOutput } from './toolOutput';
import { toolInputWritePaths } from './gitChangeTurns';
import { generateId } from './uuid';
import type { NativeToolOutputTarget } from './nativeToolOutput';

/** The native converter's portable output, before any renderer-only fields are added. */
export interface TranscriptEntry {
	id: string;
	timestamp: number;
	source: 'user' | 'stdout' | 'thinking' | 'tool';
	text: string;
	images?: string[];
	nativeTranscript: { messageId: string; channel?: string };
	turnModel?: string;
	turnEffort?: string;
	turnSettingsSource?: 'native';
	metadata?: {
		toolCallId?: string;
		nativeToolCallId?: string;
		toolOutputSource?: NativeToolOutputTarget;
		toolState?: {
			status?: HistoricToolStatus;
			input?: unknown;
			output?: unknown;
			writePaths?: string[];
		};
	};
}

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

function toolEntryText(call: NormalizedToolCall): string {
	return call.name;
}

function capToolValue(value: unknown): unknown {
	return value === undefined ? undefined : compactToolOutput(value).output;
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
export function transcriptMessagesToLogEntries(
	messages: TranscriptMessage[],
	toolOutputSource?: NativeToolOutputTarget
): TranscriptEntry[] {
	const entries: TranscriptEntry[] = [];
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
			const text = stripTurnPrompt(stripEmbeddedSystemPrompt(msg.content ?? ''));
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
			const writePaths = toolInputWritePaths(call.name, call.input);
			const input = capToolValue(call.input);
			const output = capToolValue(call.output);
			entries.push({
				id,
				timestamp,
				source: 'tool',
				text: toolEntryText(call),
				metadata: {
					...(call.callId ? { toolCallId: call.callId } : {}),
					...(toolOutputSource ? { toolOutputSource, nativeToolCallId: call.callId } : {}),
					toolState: {
						...(call.status ? { status: call.status } : {}),
						...(input !== undefined ? { input } : {}),
						...(writePaths.length ? { writePaths } : {}),
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
