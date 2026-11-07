import { parseNativeSearchMessages } from '../../shared/sessionSearch';
/**
 * Codex CLI Session Storage Implementation
 *
 * This module implements the AgentSessionStorage interface for OpenAI Codex CLI.
 * Codex stores sessions as JSONL files in ~/.codex/sessions/YYYY/MM/DD/
 *
 * File structure:
 * - Each session is a .jsonl file named rollout-<timestamp>-<uuid>.jsonl
 * - First line contains session metadata (id, timestamp, git info)
 * - Subsequent lines contain message entries
 *
 * Session format (from Codex --json output):
 * ```json
 * // First line: session metadata
 * {"id":"uuid","timestamp":"ISO8601","git":{"commit_hash":"...","branch":"main","repository_url":"..."}}
 *
 * // Subsequent lines: conversation messages
 * {"type":"message","role":"user","content":[{"type":"input_text","text":"..."}]}
 * {"type":"message","role":"assistant","content":[...]}
 * ```
 */

import { localProjectWorktree } from './local-project-paths';
import { app } from 'electron';
import {
	MAX_CODEX_ROLLOUT_BYTES,
	codexRolloutSessionId,
	decodeCodexRollout,
	preferPlainCodexRollouts,
	readCodexRollout,
} from '../../shared/codexRollout';
import path from 'path';
import { hasEmbeddedSystemPrompt } from '../../shared/embeddedSystemPrompt';
import {
	extractTextFromContent,
	isSystemContextMessage,
	unwrapCodexUserReply,
	extractCodexImages,
	unwrapCodexImageRequest,
} from '../../shared/codexSessionText';
import {
	codexSessionMetadata,
	extractCwdFromText,
	parseCodexSessionTitles,
	type CodexSessionMetadata,
} from '../../shared/codexSessionMetadata';
import os from 'os';
import fs from 'fs/promises';
import { logger } from '../utils/logger';
import { captureException } from '../utils/sentry';
import { isExpectedSessionReadError } from '../utils/session-read-errors';
import { fileFingerprint } from './session-info-cache';
import { mapWithConcurrency, LOCAL_SESSION_READ_CONCURRENCY } from '../utils/concurrency';
import {
	readFileRemote,
	readBinaryFileRemoteAsBase64,
	deleteRemote,
	readDirRemote,
	statRemote,
} from '../utils/remote-fs';
import type {
	AgentSessionInfo,
	SessionMessagesResult,
	SessionReadOptions,
	SessionMessage,
	SessionSearchMode,
	SessionSearchResult,
} from '../agents';
import type { ToolType, SshRemoteConfig } from '../../shared/types';
import { BaseSessionStorage } from './base-session-storage';
import type { SearchableMessage } from './base-session-storage';
import { ModelUsageAccumulator } from '../../shared/modelUsage';
import { CodexTokenCounts } from '../../shared/codexTokenUsage';
import { codexToolOutputText as nativeCodexToolOutputText } from '../../shared/codexToolOutput';
import { readToolOutputFile } from './native-tool-output';
import { compactToolOutput } from '../../shared/toolOutput';
import { extractReasoningSummaryText, codexToolResultStatus } from '../parsers/codex-output-parser';

const LOG_CONTEXT = '[CodexSessionStorage]';
const MAX_SESSION_FILE_SIZE = MAX_CODEX_ROLLOUT_BYTES;

/**
 * Get Codex sessions base directory (platform-specific)
 * - Linux/macOS: ~/.codex/sessions
 * - Windows: %USERPROFILE%\.codex\sessions (Codex uses dotfile convention on all platforms)
 *
 * `accountDir` is the `CODEX_HOME` an agent was pointed at, not the `sessions`
 * subdir. It is a parameter rather than a module const because Maestro sets
 * `CODEX_HOME` per agent in `customEnvVars`, never in its own environment: the
 * value this process would read is never the value an agent's process received.
 */
function getCodexSessionsDir(accountDir?: string): string {
	// Codex CLI uses ~/.codex on all platforms (including Windows)
	return path.join(accountDir || path.join(os.homedir(), '.codex'), 'sessions');
}

// Bumped to 4: Codex's `total_token_usage` is a running session total and was
// being summed per event, so cached entries hold inflated token counts. Entries
// are reused whenever `fileMtimeMs` still covers the file, which a parsing fix
// does not change, so the old numbers would be served until a session is touched.
//
// Bumped to 5: pruning is now scoped to the account dir that was walked, so
// entries left behind by an account dir that no longer exists are unreachable.
// One clean slate here retires the ones that predate the scoped prune.
// Version 6 includes native source attribution and the first user request.
// Version 7 excludes native desktop control envelopes from conversation previews.
const CODEX_SESSION_CACHE_VERSION = 8;
const CODEX_SESSION_CACHE_FILENAME = 'codex-sessions-cache.json';

/**
 * Parse limits for session files
 */
const CODEX_SESSION_PARSE_LIMITS = {
	FIRST_MESSAGE_SCAN_LINES: 50,
	LAST_TIMESTAMP_SCAN_LINES: 20,
	FIRST_MESSAGE_PREVIEW_LENGTH: 200,
} as const;

/**
 * Tool use entry shape used when building SessionMessage.toolUse arrays.
 * Provides type safety for the tool call / tool output merge logic.
 */
interface CodexToolUseEntry {
	id?: string;
	tool?: string;
	name?: string;
	args?: unknown;
	state: {
		status: string;
		input?: unknown;
		output?: string;
	};
}

/**
 * Extract the session ID (UUID) from a Codex session filename
 * Format: rollout-TIMESTAMP-UUID.jsonl
 */
const extractSessionIdFromFilename = codexRolloutSessionId;

async function readRemoteRollout(filePath: string, sshConfig: SshRemoteConfig): Promise<string> {
	const stat = await statRemote(filePath, sshConfig);
	if (!stat.success || !stat.data) throw new Error(`Cannot stat Codex conversation: ${stat.error}`);
	if (stat.data.size > MAX_SESSION_FILE_SIZE)
		throw new RangeError('Codex rollout exceeds the read size limit');
	if (!filePath.endsWith('.zst')) {
		const result = await readFileRemote(filePath, sshConfig);
		if (!result.success || result.data === undefined)
			throw new Error(`Cannot read Codex conversation: ${result.error}`);
		if (Buffer.byteLength(result.data) > MAX_SESSION_FILE_SIZE)
			throw new RangeError('Codex rollout exceeds the read size limit');
		return result.data;
	}
	const result = await readBinaryFileRemoteAsBase64(filePath, sshConfig);
	if (!result.success || result.data === undefined)
		throw new Error(
			`Cannot transfer compressed Codex conversation for local zstd decompression: ${result.error}`
		);
	return decodeCodexRollout(Buffer.from(result.data, 'base64'), filePath);
}

/** Displayable text only: image/audio blobs in a tool result must not enter the cache. */
function codexToolOutputText(output: unknown): string {
	return compactToolOutput(nativeCodexToolOutputText(output)).output as string;
}

function normalizeProjectPath(projectPath: string): string {
	return path.resolve(projectPath);
}

function isSessionForProject(sessionProjectPath: string, projectPath: string): boolean {
	const normalizedSession = normalizeProjectPath(sessionProjectPath);
	const normalizedProject = normalizeProjectPath(projectPath);
	if (normalizedSession === normalizedProject) {
		return true;
	}
	const prefix = normalizedProject.endsWith(path.sep)
		? normalizedProject
		: `${normalizedProject}${path.sep}`;
	return normalizedSession.startsWith(prefix);
}

interface CodexSessionCacheEntry {
	session: AgentSessionInfo;
	fileMtimeMs: number;
}

interface CodexSessionCache {
	version: number;
	lastProcessedAt: number;
	sessions: Record<string, CodexSessionCacheEntry>;
}

function getCodexSessionCachePath(): string {
	return path.join(app.getPath('userData'), 'stats-cache', CODEX_SESSION_CACHE_FILENAME);
}

async function loadCodexSessionCache(): Promise<CodexSessionCache | null> {
	try {
		const cachePath = getCodexSessionCachePath();
		const content = await fs.readFile(cachePath, 'utf-8');
		const cache = JSON.parse(content) as CodexSessionCache;
		if (cache.version !== CODEX_SESSION_CACHE_VERSION) {
			return null;
		}
		return cache;
	} catch {
		return null;
	}
}

async function saveCodexSessionCache(cache: CodexSessionCache): Promise<void> {
	try {
		const cachePath = getCodexSessionCachePath();
		const cacheDir = path.dirname(cachePath);
		await fs.mkdir(cacheDir, { recursive: true });
		await fs.writeFile(cachePath, JSON.stringify(cache), 'utf-8');
	} catch (error) {
		void captureException(error);
		logger.warn('Failed to save Codex session cache', LOG_CONTEXT, { error });
	}
}

/**
 * Parse a Codex session file and extract metadata
 */
async function parseSessionFile(
	filePath: string,
	sessionId: string,
	stats: { size: number; mtimeMs: number }
): Promise<AgentSessionInfo | null> {
	try {
		if (stats.size > MAX_SESSION_FILE_SIZE) {
			logger.warn('Skipping oversized Codex session file', LOG_CONTEXT, {
				filePath,
				size: stats.size,
			});
			return null;
		}

		const content = await readCodexRollout(filePath);
		const lines = content.split('\n').filter((l) => l.trim());

		if (lines.length === 0) {
			return null;
		}

		// Parse first line as metadata
		let metadata: CodexSessionMetadata | null = null;
		let timestamp = new Date(stats.mtimeMs).toISOString();
		let sessionProjectPath: string | null = null;

		try {
			metadata = codexSessionMetadata(JSON.parse(lines[0]));
			timestamp = metadata?.payload?.timestamp || metadata?.timestamp || timestamp;
			sessionProjectPath = metadata?.payload?.cwd || null;
		} catch {
			// First line may not be metadata, continue parsing
		}

		// Count messages and find first assistant response (preferred) or user message (fallback)
		let firstAssistantMessage = '';
		let firstUserMessage = '';
		let userMessageCount = 0;
		let assistantMessageCount = 0;
		const tokenCounts = new CodexTokenCounts();
		let firstTimestamp = timestamp;
		let lastTimestamp = timestamp;
		// Codex is single-model per session; the model id lives on turn_context /
		// session_meta entries rather than on the usage events. Capture the last
		// seen one so per-model token attribution has a real model to key on.
		let capturedModel: string | undefined =
			metadata?.payload && 'model' in metadata.payload
				? (metadata.payload as { model?: string }).model
				: undefined;

		for (let i = 0; i < lines.length; i++) {
			try {
				const entry = JSON.parse(lines[i]);

				// Capture the model id from turn_context entries (current Codex format)
				if (entry.type === 'turn_context' && entry.payload?.model) {
					capturedModel = entry.payload.model;
				}

				// Handle turn.completed for usage stats (already per-turn)
				if (entry.type === 'turn.completed' && entry.usage) {
					tokenCounts.addTurn(entry.usage);
				}

				// Handle Codex "event_msg" usage stats
				if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
					tokenCounts.addTokenCountEvent(entry.payload.info);
				}

				// Handle message entries (legacy format)
				if (entry.type === 'message') {
					if (entry.role === 'user') {
						userMessageCount++;
						// Extract text and check for system context
						if (entry.content) {
							const text = extractTextFromContent(entry.content);
							// Capture first user message as fallback preview (skip system context)
							if (!firstUserMessage && text.trim() && !isSystemContextMessage(text)) {
								firstUserMessage = text;
							}
							// Fallback: extract cwd from message content if not in session_meta
							if (!sessionProjectPath) {
								const cwd = extractCwdFromText(text);
								if (cwd) {
									sessionProjectPath = cwd;
								}
							}
						}
					} else if (entry.role === 'assistant') {
						assistantMessageCount++;
						// Capture first assistant message as preferred preview
						if (!firstAssistantMessage && entry.content) {
							const text = extractTextFromContent(entry.content);
							if (text.trim()) {
								firstAssistantMessage = text;
							}
						}
					}
				}

				// Handle response_item entries (current Codex format)
				if (entry.type === 'response_item' && entry.payload?.type === 'message') {
					if (entry.payload.role === 'user') {
						userMessageCount++;
						// Extract text and check for system context
						if (entry.payload.content) {
							const text = extractTextFromContent(entry.payload.content);
							// Capture first user message as fallback preview (skip system context)
							if (!firstUserMessage && text.trim() && !isSystemContextMessage(text)) {
								firstUserMessage = text;
							}
							// Fallback: extract cwd from message content if not in session_meta
							if (!sessionProjectPath) {
								const cwd = extractCwdFromText(text);
								if (cwd) {
									sessionProjectPath = cwd;
								}
							}
						}
					} else if (entry.payload.role === 'assistant') {
						assistantMessageCount++;
						// Capture first assistant message as preferred preview
						if (!firstAssistantMessage && entry.payload.content) {
							const text = extractTextFromContent(entry.payload.content);
							if (text.trim()) {
								firstAssistantMessage = text;
							}
						}
					}
				}

				// Handle item.completed for agent messages
				if (entry.type === 'item.completed' && entry.item) {
					if (entry.item.type === 'agent_message') {
						assistantMessageCount++;
						// Capture first agent message as preferred preview
						if (!firstAssistantMessage && entry.item.text) {
							firstAssistantMessage = entry.item.text;
						}
					}
				}

				// Track timestamps for duration
				if (entry.timestamp) {
					const entryTime = new Date(entry.timestamp).getTime();
					const firstTime = new Date(firstTimestamp).getTime();
					const lastTime = new Date(lastTimestamp).getTime();

					if (entryTime < firstTime) {
						firstTimestamp = entry.timestamp;
					}
					if (entryTime > lastTime) {
						lastTimestamp = entry.timestamp;
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		// Use assistant response as preview if available, otherwise fall back to user message
		const previewMessage = firstAssistantMessage || firstUserMessage;

		const messageCount = userMessageCount + assistantMessageCount;

		const startTime = new Date(firstTimestamp).getTime();
		const endTime = new Date(lastTimestamp).getTime();
		const durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));

		// Extract session ID from metadata (new format uses payload.id, legacy uses id)
		const metadataSessionId = metadata?.payload?.id || metadata?.id || sessionId;

		const modelAcc = new ModelUsageAccumulator();
		if (!tokenCounts.isEmpty) {
			modelAcc.add(capturedModel, {
				inputTokens: tokenCounts.inputTokens,
				outputTokens: tokenCounts.outputTokens,
				cacheReadTokens: tokenCounts.cachedTokens,
				cacheCreationTokens: 0,
			});
		}

		return {
			sessionId: metadataSessionId,
			origin:
				typeof metadata?.payload?.source === 'object' && metadata.payload.source?.subagent
					? 'auto'
					: undefined,
			firstUserMessage: firstUserMessage.slice(
				0,
				CODEX_SESSION_PARSE_LIMITS.FIRST_MESSAGE_PREVIEW_LENGTH
			),
			projectPath: sessionProjectPath ? normalizeProjectPath(sessionProjectPath) : '',
			timestamp: firstTimestamp,
			modifiedAt: new Date(stats.mtimeMs).toISOString(),
			firstMessage: previewMessage.slice(
				0,
				CODEX_SESSION_PARSE_LIMITS.FIRST_MESSAGE_PREVIEW_LENGTH
			),
			messageCount,
			sizeBytes: stats.size,
			// Note: costUsd omitted - Codex doesn't provide cost and pricing varies by model
			inputTokens: tokenCounts.inputTokens,
			outputTokens: tokenCounts.outputTokens,
			cacheReadTokens: tokenCounts.cachedTokens,
			cacheCreationTokens: 0, // Codex doesn't report cache creation separately
			durationSeconds,
			byModel: modelAcc.isEmpty ? undefined : modelAcc.finalize(),
		};
	} catch (error) {
		// RangeError: Invalid string length occurs when the file is too large for V8
		// string allocation (e.g., under MAX_SESSION_FILE_SIZE but system memory is low).
		// This is expected and not worth reporting to Sentry.
		if (error instanceof RangeError) {
			logger.warn('Codex session file too large to parse', LOG_CONTEXT, { filePath });
			return null;
		}
		logger.error(`Error reading Codex session file: ${filePath}`, LOG_CONTEXT, error);
		captureException(error, { operation: 'codexStorage:readSessionFile', filePath });
		return null;
	}
}

/**
 * Codex CLI Session Storage Implementation
 *
 * Provides access to Codex CLI's local session storage at ~/.codex/sessions/
 */
interface CodexTranscriptParseState {
	messages: SessionMessage[];
	messageIndex: number;
	lineIndex: number;
	turnContext: Pick<SessionMessage, 'model' | 'effort'>;
}

interface CodexTranscriptCursor extends CodexTranscriptParseState {
	dev: number;
	ino: number;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
	offset: number;
	head: Buffer;
	boundary: Buffer;
	visibleMessages: SessionMessage[];
}

/** One canonical conversion for cold reads and append-only catch-up. */
function parseCodexTranscript(
	content: string,
	initial?: CodexTranscriptParseState
): CodexTranscriptParseState {
	const lines = content.split('\n').filter((l) => l.trim());

	const messages: SessionMessage[] = [...(initial?.messages ?? [])];
	// Index this parse's existing and appended cards once. Repeated result pairing
	// must not rescan every prior message in a long, tool-heavy conversation.
	const toolCalls = new Map<string, number>();
	for (const [index, message] of messages.entries()) {
		if (message.toolUse && !toolCalls.has(message.uuid)) toolCalls.set(message.uuid, index);
	}
	const appendMessage = (message: SessionMessage) => {
		if (message.toolUse && !toolCalls.has(message.uuid))
			toolCalls.set(message.uuid, messages.length);
		messages.push(message);
	};
	let messageIndex = initial?.messageIndex ?? 0;
	let turnContext = initial?.turnContext ?? {};

	for (const [relativeIndex, line] of lines.entries()) {
		const lineIndex = (initial?.lineIndex ?? 0) + relativeIndex;
		try {
			const entry = JSON.parse(line);
			const payload = entry.type === 'response_item' ? entry.payload : entry;
			if (entry.type === 'turn_context') {
				turnContext = {
					...(typeof entry.payload?.model === 'string' ? { model: entry.payload.model } : {}),
					...(typeof entry.payload?.effort === 'string' ? { effort: entry.payload.effort } : {}),
				};
				continue;
			}

			if (
				payload?.type === 'message' &&
				(payload.role === 'user' || payload.role === 'assistant')
			) {
				const rawText = extractTextFromContent(payload.content);
				// Keep the old counter even for hidden envelopes, so cached native IDs still align.
				const oldIndex = messageIndex;
				if (rawText || (payload.role === 'user' && isSystemContextMessage(rawText))) messageIndex++;
				// Maestro embeds its system prompt and the first user request in one
				// native message. Only a pure system envelope may be discarded.
				if (
					payload.role === 'user' &&
					!hasEmbeddedSystemPrompt(rawText) &&
					isSystemContextMessage(rawText)
				)
					continue;
				const images = extractCodexImages(payload.content);
				const text =
					payload.role === 'user'
						? unwrapCodexUserReply(unwrapCodexImageRequest(payload.content) ?? rawText)
						: rawText;
				if (text || images.length > 0) {
					const phase = payload.phase ?? payload.channel;
					appendMessage({
						type: payload.role,
						role: payload.role,
						...(payload.role === 'assistant' ? turnContext : {}),
						content: text,
						timestamp: entry.timestamp || '',
						uuid:
							(entry.type === 'response_item' && payload.id) ||
							(rawText ? `codex-msg-${oldIndex}` : `codex-image-${lineIndex}`),
						...(typeof phase === 'string'
							? { channel: phase === 'final_answer' ? 'final' : phase }
							: {}),
						...(images.length > 0 ? { images } : {}),
					});
				}
			}

			// Reasoning summaries are displayable; encrypted reasoning is never decoded.
			if (entry.type === 'response_item' && payload?.type === 'reasoning') {
				const summary = extractReasoningSummaryText(payload.summary);
				if (summary)
					appendMessage({
						type: 'thinking',
						role: 'assistant',
						channel: 'analysis',
						...turnContext,
						content: summary,
						timestamp: entry.timestamp || '',
						uuid: payload.id || `codex-reasoning-${lineIndex}`,
					});
			}

			if (
				entry.type === 'response_item' &&
				(payload?.type === 'function_call' || payload?.type === 'custom_tool_call')
			) {
				const input = payload.arguments ?? payload.input ?? {};
				let parsedInput: unknown = input;
				if (typeof input === 'string') {
					try {
						parsedInput = JSON.parse(input);
					} catch {
						/* Custom tool input is plain text. */
					}
				}
				const toolInfo: CodexToolUseEntry = {
					id: payload.call_id,
					tool: payload.name || 'unknown',
					args: input,
					state: { status: 'running', input: parsedInput },
				};
				appendMessage({
					type: 'assistant',
					role: 'assistant',
					content: `Tool: ${payload.name || 'unknown'}`,
					timestamp: entry.timestamp || '',
					uuid: payload.call_id || `codex-msg-${messageIndex}`,
					toolUse: [toolInfo],
					...turnContext,
				});
				messageIndex++;
			}

			const legacyResult = entry.type === 'item.completed' && entry.item?.type === 'tool_result';
			if (
				legacyResult ||
				(entry.type === 'response_item' &&
					(payload?.type === 'function_call_output' || payload?.type === 'custom_tool_call_output'))
			) {
				const result = legacyResult ? entry.item : payload;
				const callId = result.call_id ?? result.tool_call_id ?? result.id;
				const outputText = codexToolOutputText(result.output);
				const matchingIdx = callId ? (toolCalls.get(callId) ?? -1) : -1;
				const toolName =
					matchingIdx >= 0
						? (messages[matchingIdx].toolUse as CodexToolUseEntry[])[0].tool
						: undefined;
				const status = codexToolResultStatus(result, toolName);
				if (matchingIdx >= 0) {
					const matchingMsg = messages[matchingIdx];
					const toolEntries = matchingMsg.toolUse as CodexToolUseEntry[];
					messages[matchingIdx] = {
						...matchingMsg,
						toolUse: [
							{
								...toolEntries[0],
								state: { ...toolEntries[0].state, status, output: outputText },
							},
							...toolEntries.slice(1),
						],
					};
					// Preserve the legacy counter used by following messages without native IDs.
					if (legacyResult) messageIndex++;
				} else {
					// Even an orphan result is a tool card, never an assistant answer.
					appendMessage({
						type: 'assistant',
						role: 'assistant',
						content: `Tool: ${result.name || result.tool || 'unknown'}`,
						timestamp: entry.timestamp || '',
						uuid: callId || `codex-msg-${messageIndex}`,
						toolUse: [
							{
								id: callId,
								tool: result.name || result.tool || 'unknown',
								state: { status, output: outputText },
							},
						],
						...turnContext,
					});
					messageIndex++;
				}
			}

			if (entry.type === 'item.completed' && entry.item?.type === 'agent_message') {
				appendMessage({
					type: 'assistant',
					role: 'assistant',
					content: entry.item.text || '',
					...turnContext,
					timestamp: entry.timestamp || '',
					uuid: entry.item.id || `codex-msg-${messageIndex}`,
					...(entry.item.phase
						? { channel: entry.item.phase === 'final_answer' ? 'final' : entry.item.phase }
						: {}),
				});
				messageIndex++;
			}

			if (entry.type === 'item.completed' && entry.item?.type === 'file_change') {
				appendMessage({
					type: 'assistant',
					role: 'assistant',
					content: 'Tool: file_change',
					...turnContext,
					timestamp: entry.timestamp || '',
					uuid: entry.item.id || `codex-msg-${messageIndex}`,
					toolUse: [
						{
							id: entry.item.id,
							tool: 'file_change',
							state: {
								status:
									entry.item.status === 'completed'
										? 'completed'
										: entry.item.status === 'failed'
											? 'failed'
											: 'unknown',
								input: { changes: entry.item.changes },
							},
						},
					],
				});
				messageIndex++;
			}

			if (entry.type === 'item.completed' && entry.item?.type === 'tool_call') {
				appendMessage({
					type: 'assistant',
					role: 'assistant',
					content: `Tool: ${entry.item.tool}`,
					...turnContext,
					timestamp: entry.timestamp || '',
					uuid: entry.item.call_id || entry.item.id || `codex-msg-${messageIndex}`,
					toolUse: [
						{
							id: entry.item.call_id || entry.item.id,
							tool: entry.item.tool,
							args: entry.item.args,
							// Completing the call envelope does not prove execution succeeded.
							state: { status: 'unknown', input: entry.item.args },
						},
					],
				});
				messageIndex++;
			}
		} catch {
			// Skip malformed lines without changing IDs for later valid messages.
		}
	}
	return {
		messages,
		messageIndex,
		lineIndex: (initial?.lineIndex ?? 0) + lines.length,
		turnContext,
	};
}

export class CodexSessionStorage extends BaseSessionStorage {
	readonly agentId: ToolType = 'codex';

	// Two active views at most; no history is copied to disk. The provider owns
	// append-only rollouts. Replacements, shrinkage and same-size writes reset.
	private readonly transcriptCursors = new Map<string, CodexTranscriptCursor>();

	private async readLocalTranscriptIncrementally(
		filePath: string,
		options?: SessionReadOptions
	): Promise<SessionMessagesResult> {
		const file = await fs.open(filePath, 'r');
		try {
			const stat = await file.stat();
			if (stat.size > MAX_SESSION_FILE_SIZE)
				throw new RangeError('Codex rollout exceeds the read size limit');
			let prior = this.transcriptCursors.get(filePath);
			if (
				prior &&
				(prior.dev !== stat.dev ||
					prior.ino !== stat.ino ||
					stat.size < prior.size ||
					(stat.size === prior.size &&
						(stat.mtimeMs !== prior.mtimeMs || stat.ctimeMs !== prior.ctimeMs)))
			)
				prior = undefined;
			if (prior && stat.size === prior.size)
				return BaseSessionStorage.applyMessagePagination(prior.visibleMessages, options);
			// A truncate-and-regrow or in-place edit is not an append. Check both the
			// file prefix and the committed boundary before extending the cursor.
			if (prior) {
				const head = Buffer.alloc(prior.head.length);
				await file.read(head, 0, head.length, 0);
				const boundary = Buffer.alloc(prior.boundary.length);
				await file.read(boundary, 0, boundary.length, prior.offset - boundary.length);
				if (!head.equals(prior.head) || !boundary.equals(prior.boundary)) prior = undefined;
			}
			const start = prior?.offset ?? 0;
			const bytes = Buffer.alloc(stat.size - start);
			let read = 0;
			while (read < bytes.length) {
				const { bytesRead } = await file.read(bytes, read, bytes.length - read, start + read);
				if (bytesRead === 0) {
					this.transcriptCursors.delete(filePath);
					throw new Error('Codex transcript changed during read; retry on the next refresh');
				}
				read += bytesRead;
			}
			const completeLength = bytes.lastIndexOf(10) + 1;
			const committed = parseCodexTranscript(
				bytes.subarray(0, completeLength).toString('utf8'),
				prior
			);
			// A final complete JSON row without a newline is visible, but not committed
			// to the cursor. A partial UTF-8/JSON row is re-read intact on the next tick.
			const visible =
				completeLength < bytes.length
					? parseCodexTranscript(bytes.subarray(completeLength).toString('utf8'), committed)
							.messages
					: committed.messages;
			const offset = start + completeLength;
			const head = Buffer.alloc(Math.min(256, offset));
			await file.read(head, 0, head.length, 0);
			const boundary = Buffer.alloc(Math.min(256, offset));
			await file.read(boundary, 0, boundary.length, offset - boundary.length);
			this.transcriptCursors.delete(filePath);
			// Bound retained parsed content; oversized histories still use the same
			// correct converter, but do not become a permanent main-process cache.
			if (Buffer.byteLength(JSON.stringify(visible)) <= 32 * 1024 * 1024) {
				this.transcriptCursors.set(filePath, {
					...committed,
					dev: stat.dev,
					ino: stat.ino,
					size: stat.size,
					mtimeMs: stat.mtimeMs,
					ctimeMs: stat.ctimeMs,
					offset,
					head,
					boundary,
					visibleMessages: visible,
				});
				if (this.transcriptCursors.size > 2)
					this.transcriptCursors.delete(this.transcriptCursors.keys().next().value!);
			}
			return BaseSessionStorage.applyMessagePagination(visible, options);
		} finally {
			await file.close();
		}
	}

	// A bounded account-scoped path cache, not a transcript/content cache.
	private readonly revisionPaths = new Map<
		string,
		{ filePath: string | null; checkedAt: number }
	>();

	/**
	 * Visible-tab refresh probes one file with stat after initial discovery. It
	 * never parses history, restores a mirror, or reads another account/host.
	 * Legacy filenames without a native UUID use the existing slow history scan.
	 */
	async getTranscriptRevision(
		_projectPath: string,
		sessionId: string,
		options?: SessionReadOptions,
		sshConfig?: SshRemoteConfig
	): Promise<string | null> {
		if (!sessionId) return null;
		if (sshConfig) {
			const key = JSON.stringify(['ssh', sshConfig.id, options?.configDir, sessionId]);
			let entry = this.revisionPaths.get(key);
			if (!entry || (!entry.filePath && Date.now() - entry.checkedAt >= 10000)) {
				entry = {
					filePath: await this.findSessionFileRemote(sessionId, sshConfig, options?.configDir),
					checkedAt: Date.now(),
				};
			}
			if (entry.filePath?.endsWith('.zst')) {
				const plain = entry.filePath.slice(0, -4);
				const stat = await statRemote(plain, sshConfig);
				if (stat.success && stat.data && !stat.data.isDirectory)
					entry = { ...entry, filePath: plain };
			}
			this.revisionPaths.delete(key);
			this.revisionPaths.set(key, entry);
			if (this.revisionPaths.size > 128)
				this.revisionPaths.delete(this.revisionPaths.keys().next().value!);
			const file = entry.filePath;
			if (!file) return null;
			const stat = await statRemote(file, sshConfig);
			if (!stat.success || !stat.data) {
				this.revisionPaths.delete(key);
				throw new Error(`Cannot stat Codex conversation: ${stat.error}`);
			}
			return `${file}:${fileFingerprint(stat.data.size, stat.data.mtime)}`;
		}
		const key = JSON.stringify([this.getSessionsDir(options?.configDir), sessionId]);
		let entry = this.revisionPaths.get(key);
		if (!entry || (!entry.filePath && Date.now() - entry.checkedAt >= 10_000)) {
			const files = await this.findAllSessionFiles(options?.configDir);
			entry = {
				filePath:
					files.find((file) => extractSessionIdFromFilename(file.filename) === sessionId)
						?.filePath ?? null,
				checkedAt: Date.now(),
			};
		}
		if (entry.filePath?.endsWith('.zst')) {
			const plain = entry.filePath.slice(0, -4);
			try {
				if ((await fs.stat(plain)).isFile()) entry = { ...entry, filePath: plain };
			} catch (error) {
				if (!isExpectedSessionReadError(error)) throw error;
			}
		}
		this.revisionPaths.delete(key);
		this.revisionPaths.set(key, entry);
		if (this.revisionPaths.size > 128) {
			this.revisionPaths.delete(this.revisionPaths.keys().next().value!);
		}
		if (!entry.filePath) return null;
		try {
			const stat = await fs.stat(entry.filePath);
			if (!stat.isFile()) return null;
			// Include file identity and ctime to notice replacement and same-size rewrites.
			return `${stat.dev}:${stat.ino}:${stat.ctimeMs}:${fileFingerprint(stat.size, stat.mtimeMs)}`;
		} catch (error) {
			if (!isExpectedSessionReadError(error)) throw error;
			this.revisionPaths.delete(key);
			return null;
		}
	}

	/**
	 * Get the Codex sessions directory path for an account (`CODEX_HOME`), or
	 * the default account when `accountDir` is undefined.
	 */
	private getSessionsDir(accountDir?: string): string {
		return getCodexSessionsDir(accountDir);
	}

	/**
	 * Get the Codex sessions directory path (remote via SSH)
	 * On remote Linux hosts, ~ expands to the user's home directory
	 */
	private getRemoteSessionsDir(accountDir?: string): string {
		return path.posix.join(accountDir || '~/.codex', 'sessions');
	}

	/**
	 * Find active date-organized rollouts and native archived rollouts
	 */
	private async findAllSessionFiles(
		accountDir?: string,
		preferPlain = true
	): Promise<Array<{ filePath: string; filename: string }>> {
		const sessionsDir = this.getSessionsDir(accountDir);
		const sessionFiles: Array<{ filePath: string; filename: string }> = [];

		const archiveDir = path.join(path.dirname(sessionsDir), 'archived_sessions');
		for (const directory of [archiveDir, sessionsDir]) {
			try {
				await fs.access(directory);
			} catch {
				continue;
			}

			// Active rollouts use date directories; native archives also store files at the root.
			const years = await fs.readdir(directory);
			for (const year of years) {
				if (directory === archiveDir && /\.jsonl(?:\.zst)?$/i.test(year)) {
					sessionFiles.push({ filePath: path.join(directory, year), filename: year });
					continue;
				}
				if (!/^\d{4}$/.test(year)) continue;

				const yearDir = path.join(directory, year);
				try {
					const yearStat = await fs.stat(yearDir);
					if (!yearStat.isDirectory()) continue;
				} catch {
					continue;
				}

				// Scan MM directories
				const months = await fs.readdir(yearDir);
				for (const month of months) {
					if (!/^\d{2}$/.test(month)) continue;

					const monthDir = path.join(yearDir, month);
					try {
						const monthStat = await fs.stat(monthDir);
						if (!monthStat.isDirectory()) continue;
					} catch {
						continue;
					}

					// Scan DD directories
					const days = await fs.readdir(monthDir);
					for (const day of days) {
						if (!/^\d{2}$/.test(day)) continue;

						const dayDir = path.join(monthDir, day);
						try {
							const dayStat = await fs.stat(dayDir);
							if (!dayStat.isDirectory()) continue;

							// Find session files
							const files = await fs.readdir(dayDir);
							for (const file of files) {
								if (/\.jsonl(?:\.zst)?$/i.test(file)) {
									sessionFiles.push({
										filePath: path.join(dayDir, file),
										filename: file,
									});
								}
							}
						} catch {
							continue;
						}
					}
				}
			}
		}

		return preferPlain
			? preferPlainCodexRollouts(sessionFiles, (file) => file.filename)
			: sessionFiles;
	}

	/**
	 * Find all session files on a remote host via SSH, organized by date directories
	 * Recursively scans the YYYY/MM/DD directory structure
	 */
	private async findAllSessionFilesRemote(
		sshConfig: SshRemoteConfig,
		accountDir?: string,
		preferPlain = true
	): Promise<Array<{ filePath: string; filename: string }>> {
		const sessionsDir = this.getRemoteSessionsDir(accountDir);
		const sessionFiles: Array<{ filePath: string; filename: string }> = [];

		// List YYYY directories
		const yearsResult = await readDirRemote(sessionsDir, sshConfig);
		if (!yearsResult.success || !yearsResult.data) {
			return [];
		}

		for (const yearEntry of yearsResult.data) {
			if (!yearEntry.isDirectory || !/^\d{4}$/.test(yearEntry.name)) continue;

			const yearDir = `${sessionsDir}/${yearEntry.name}`;

			// List MM directories
			const monthsResult = await readDirRemote(yearDir, sshConfig);
			if (!monthsResult.success || !monthsResult.data) continue;

			for (const monthEntry of monthsResult.data) {
				if (!monthEntry.isDirectory || !/^\d{2}$/.test(monthEntry.name)) continue;

				const monthDir = `${yearDir}/${monthEntry.name}`;

				// List DD directories
				const daysResult = await readDirRemote(monthDir, sshConfig);
				if (!daysResult.success || !daysResult.data) continue;

				for (const dayEntry of daysResult.data) {
					if (!dayEntry.isDirectory || !/^\d{2}$/.test(dayEntry.name)) continue;

					const dayDir = `${monthDir}/${dayEntry.name}`;

					// List session files
					const filesResult = await readDirRemote(dayDir, sshConfig);
					if (!filesResult.success || !filesResult.data) continue;

					for (const fileEntry of filesResult.data) {
						if (!fileEntry.isDirectory && /\.jsonl(?:\.zst)?$/i.test(fileEntry.name)) {
							sessionFiles.push({
								filePath: `${dayDir}/${fileEntry.name}`,
								filename: fileEntry.name,
							});
						}
					}
				}
			}
		}

		return preferPlain
			? preferPlainCodexRollouts(sessionFiles, (file) => file.filename)
			: sessionFiles;
	}

	/**
	 * Parse a session file and extract metadata from remote via SSH
	 */
	private async parseSessionFileRemote(
		filePath: string,
		sessionId: string,
		stats: { size: number; mtimeMs: number },
		sshConfig: SshRemoteConfig
	): Promise<AgentSessionInfo | null> {
		try {
			if (stats.size > MAX_SESSION_FILE_SIZE) {
				logger.warn('Skipping oversized remote Codex session file', LOG_CONTEXT, {
					filePath,
					size: stats.size,
				});
				return null;
			}

			const content = await readRemoteRollout(filePath, sshConfig);
			const lines = content.split('\n').filter((l) => l.trim());

			if (lines.length === 0) {
				return null;
			}

			// Parse first line as metadata
			let metadata: CodexSessionMetadata | null = null;
			let timestamp = new Date(stats.mtimeMs).toISOString();
			let sessionProjectPath: string | null = null;

			try {
				metadata = codexSessionMetadata(JSON.parse(lines[0]));
				timestamp = metadata?.payload?.timestamp || metadata?.timestamp || timestamp;
				sessionProjectPath = metadata?.payload?.cwd || null;
			} catch {
				// First line may not be metadata, continue parsing
			}

			// Count messages and find first assistant response (preferred) or user message (fallback)
			let firstAssistantMessage = '';
			let firstUserMessage = '';
			let userMessageCount = 0;
			let assistantMessageCount = 0;
			const tokenCounts = new CodexTokenCounts();
			let firstTimestamp = timestamp;
			let lastTimestamp = timestamp;

			for (let i = 0; i < lines.length; i++) {
				try {
					const entry = JSON.parse(lines[i]);

					// Handle turn.completed for usage stats (already per-turn)
					if (entry.type === 'turn.completed' && entry.usage) {
						tokenCounts.addTurn(entry.usage);
					}

					// Handle Codex "event_msg" usage stats
					if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
						tokenCounts.addTokenCountEvent(entry.payload.info);
					}

					// Handle message entries (legacy format)
					if (entry.type === 'message') {
						if (entry.role === 'user') {
							userMessageCount++;
							if (entry.content) {
								const text = extractTextFromContent(entry.content);
								if (!firstUserMessage && text.trim() && !isSystemContextMessage(text)) {
									firstUserMessage = text;
								}
								if (!sessionProjectPath) {
									const cwd = extractCwdFromText(text);
									if (cwd) {
										sessionProjectPath = cwd;
									}
								}
							}
						} else if (entry.role === 'assistant') {
							assistantMessageCount++;
							if (!firstAssistantMessage && entry.content) {
								const text = extractTextFromContent(entry.content);
								if (text.trim()) {
									firstAssistantMessage = text;
								}
							}
						}
					}

					// Handle response_item entries (current Codex format)
					if (entry.type === 'response_item' && entry.payload?.type === 'message') {
						if (entry.payload.role === 'user') {
							userMessageCount++;
							if (entry.payload.content) {
								const text = extractTextFromContent(entry.payload.content);
								if (!firstUserMessage && text.trim() && !isSystemContextMessage(text)) {
									firstUserMessage = text;
								}
								if (!sessionProjectPath) {
									const cwd = extractCwdFromText(text);
									if (cwd) {
										sessionProjectPath = cwd;
									}
								}
							}
						} else if (entry.payload.role === 'assistant') {
							assistantMessageCount++;
							if (!firstAssistantMessage && entry.payload.content) {
								const text = extractTextFromContent(entry.payload.content);
								if (text.trim()) {
									firstAssistantMessage = text;
								}
							}
						}
					}

					// Handle item.completed for agent messages
					if (entry.type === 'item.completed' && entry.item) {
						if (entry.item.type === 'agent_message') {
							assistantMessageCount++;
							if (!firstAssistantMessage && entry.item.text) {
								firstAssistantMessage = entry.item.text;
							}
						}
					}

					// Track timestamps for duration
					if (entry.timestamp) {
						const entryTime = new Date(entry.timestamp).getTime();
						const firstTime = new Date(firstTimestamp).getTime();
						const lastTime = new Date(lastTimestamp).getTime();

						if (entryTime < firstTime) {
							firstTimestamp = entry.timestamp;
						}
						if (entryTime > lastTime) {
							lastTimestamp = entry.timestamp;
						}
					}
				} catch {
					// Skip malformed lines
				}
			}

			// Use assistant response as preview if available, otherwise fall back to user message
			const previewMessage = firstAssistantMessage || firstUserMessage;

			const messageCount = userMessageCount + assistantMessageCount;

			const startTime = new Date(firstTimestamp).getTime();
			const endTime = new Date(lastTimestamp).getTime();
			const durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));

			// Extract session ID from metadata (new format uses payload.id, legacy uses id)
			const metadataSessionId = metadata?.payload?.id || metadata?.id || sessionId;

			return {
				sessionId: metadataSessionId,
				origin:
					typeof metadata?.payload?.source === 'object' && metadata.payload.source?.subagent
						? 'auto'
						: undefined,
				firstUserMessage: firstUserMessage.slice(
					0,
					CODEX_SESSION_PARSE_LIMITS.FIRST_MESSAGE_PREVIEW_LENGTH
				),
				projectPath: sessionProjectPath ? normalizeProjectPath(sessionProjectPath) : '',
				timestamp: firstTimestamp,
				modifiedAt: new Date(stats.mtimeMs).toISOString(),
				firstMessage: previewMessage.slice(
					0,
					CODEX_SESSION_PARSE_LIMITS.FIRST_MESSAGE_PREVIEW_LENGTH
				),
				messageCount,
				sizeBytes: stats.size,
				inputTokens: tokenCounts.inputTokens,
				outputTokens: tokenCounts.outputTokens,
				cacheReadTokens: tokenCounts.cachedTokens,
				cacheCreationTokens: 0,
				durationSeconds,
			};
		} catch (error) {
			logger.error(`Error reading remote Codex session file: ${filePath}`, LOG_CONTEXT, error);
			captureException(error, { operation: 'codexStorage:readRemoteSessionFile', filePath });
			return null;
		}
	}

	/**
	 * List sessions for a project.
	 *
	 * `accountDir` selects which `CODEX_HOME` account's rollouts to read;
	 * undefined reads the default account. See {@link AgentSessionStorage}.
	 */
	async listSessions(
		projectPath: string,
		sshConfig?: SshRemoteConfig,
		accountDir?: string
	): Promise<AgentSessionInfo[]> {
		// Use SSH remote access if config provided
		if (sshConfig) {
			return this.listSessionsRemote(projectPath, sshConfig, accountDir);
		}
		const sessionsDir = this.getSessionsDir(accountDir);
		const allSessionFiles = await this.findAllSessionFiles(accountDir);

		const cache = (await loadCodexSessionCache()) || {
			version: CODEX_SESSION_CACHE_VERSION,
			lastProcessedAt: 0,
			sessions: {},
		};

		const sessions: AgentSessionInfo[] = [];
		const currentFilePaths = new Set(allSessionFiles.map(({ filePath }) => filePath));
		let cacheUpdated = false;
		// Many transcripts share a cwd. Resolve its membership once for this list,
		// including negative results, without retaining filesystem state across calls.
		const worktrees = new Map<string, Awaited<ReturnType<typeof localProjectWorktree>>>();
		const worktreeFor = async (cwd: string) => {
			if (!worktrees.has(cwd)) worktrees.set(cwd, await localProjectWorktree(projectPath, cwd));
			return worktrees.get(cwd);
		};

		// Overlap metadata I/O only. Whole transcripts are still read and parsed
		// one at a time so large histories cannot multiply the memory budget.
		const sessionFiles = await mapWithConcurrency(
			allSessionFiles,
			LOCAL_SESSION_READ_CONCURRENCY,
			async ({ filePath, filename }) => {
				try {
					const stat = await fs.stat(filePath);
					return stat.size === 0
						? null
						: { filePath, filename, stats: { size: stat.size, mtimeMs: stat.mtimeMs } };
				} catch (error) {
					logger.error(`Error stating Codex session file: ${filename}`, LOG_CONTEXT, error);
					captureException(error, { operation: 'codexStorage:statSessionFile', filename });
					return null;
				}
			}
		);
		for (const file of sessionFiles) {
			if (!file) continue;
			const { filePath, filename, stats } = file;

			const cached = cache.sessions[filePath];
			if (cached && cached.fileMtimeMs >= stats.mtimeMs) {
				if (
					cached.session.projectPath &&
					(isSessionForProject(cached.session.projectPath, projectPath) ||
						(await worktreeFor(cached.session.projectPath)))
				) {
					sessions.push(cached.session);
				}
				continue;
			}

			const sessionId = extractSessionIdFromFilename(filename) || filename;
			const session = await parseSessionFile(filePath, sessionId, {
				size: stats.size,
				mtimeMs: stats.mtimeMs,
			});

			if (session) {
				cache.sessions[filePath] = { session, fileMtimeMs: stats.mtimeMs };
				cacheUpdated = true;
				if (
					session.projectPath &&
					(isSessionForProject(session.projectPath, projectPath) ||
						(await worktreeFor(session.projectPath)))
				) {
					sessions.push(session);
				}
			}
		}

		// Prune only entries under the account we just walked. Cache keys are
		// absolute rollout paths, so two accounts never collide, but a blind
		// prune would delete the OTHER account's entries on every pass: with
		// multiple accounts the two calls would take turns evicting each other
		// and every dashboard refresh would reparse every transcript.
		// Entries under an account dir the user has since deleted are no longer
		// reachable by any prefix, so they survive until the cache version is
		// bumped. They are a handful of stale records, not stale numbers: every
		// session served to a caller comes from the account it just walked.
		const accountPrefixes = [
			sessionsDir,
			path.join(path.dirname(sessionsDir), 'archived_sessions'),
		].map((directory) => `${directory}${path.sep}`);
		for (const cachedPath of Object.keys(cache.sessions)) {
			if (!accountPrefixes.some((prefix) => cachedPath.startsWith(prefix))) continue;
			if (!currentFilePaths.has(cachedPath)) {
				delete cache.sessions[cachedPath];
				cacheUpdated = true;
			}
		}

		if (cacheUpdated) {
			cache.lastProcessedAt = Date.now();
			await saveCodexSessionCache(cache);
		}

		for (let i = 0; i < sessions.length; i++) {
			const worktree = await worktreeFor(sessions[i].projectPath);
			if (worktree && !worktree.isMain) sessions[i] = { ...sessions[i], worktree: { ...worktree } };
		}

		// Titles are indexed separately from rollouts and can change without transcript writes.
		try {
			const index = await fs.readFile(
				path.join(path.dirname(sessionsDir), 'session_index.jsonl'),
				'utf-8'
			);
			const titles = parseCodexSessionTitles(index);
			for (let i = 0; i < sessions.length; i++) {
				const name = titles.get(sessions[i].sessionId);
				if (name) sessions[i] = { ...sessions[i], sessionName: name, nativeTitle: name };
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
				logger.warn('Codex session titles unavailable', LOG_CONTEXT);
		}

		// Sort by modified date (newest first)
		sessions.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

		if (allSessionFiles.length === 0) {
			logger.info(`No Codex sessions found`, LOG_CONTEXT);
		} else {
			logger.info(
				`Found ${sessions.length} Codex sessions for project: ${projectPath}`,
				LOG_CONTEXT
			);
		}

		return sessions;
	}

	/**
	 * List sessions from remote host via SSH
	 */
	private async listSessionsRemote(
		projectPath: string,
		sshConfig: SshRemoteConfig,
		accountDir?: string
	): Promise<AgentSessionInfo[]> {
		const allSessionFiles = await this.findAllSessionFilesRemote(sshConfig, accountDir);

		if (allSessionFiles.length === 0) {
			logger.info(`No Codex sessions found on remote`, LOG_CONTEXT);
			return [];
		}

		const sessions: AgentSessionInfo[] = [];

		for (const { filePath, filename } of allSessionFiles) {
			// Get file stats via SSH
			const statResult = await statRemote(filePath, sshConfig);
			if (!statResult.success || !statResult.data) {
				logger.error(`Error stating remote Codex session file: ${filename}`, LOG_CONTEXT);
				continue;
			}

			const stats = { size: statResult.data.size, mtimeMs: statResult.data.mtime };
			if (stats.size === 0) continue;

			const sessionId = extractSessionIdFromFilename(filename) || filename;
			const session = await this.parseSessionFileRemote(filePath, sessionId, stats, sshConfig);

			if (session) {
				if (session.projectPath && isSessionForProject(session.projectPath, projectPath)) {
					sessions.push(session);
				}
			}
		}

		// Sort by modified date (newest first)
		sessions.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

		logger.info(
			`Found ${sessions.length} Codex sessions for project: ${projectPath} (remote via SSH)`,
			LOG_CONTEXT
		);

		return sessions;
	}

	async readToolOutput(
		projectPath: string,
		sessionId: string,
		toolCallId: string,
		options?: SessionReadOptions
	) {
		void projectPath;
		const file = await this.findSessionFile(sessionId, options?.configDir, true);
		return file
			? readToolOutputFile(file, 'codex', toolCallId, options?.toolOutputLookup)
			: { status: 'not-found' as const };
	}

	async readSessionMessages(
		_projectPath: string,
		sessionId: string,
		options?: SessionReadOptions,
		sshConfig?: SshRemoteConfig
	): Promise<SessionMessagesResult> {
		if (options?.configDir && !sshConfig) await fs.access(options.configDir);
		// Get session file content either locally or via SSH
		let content: string;

		if (sshConfig) {
			// For SSH, find the session file remotely
			const sessionFilePath = await this.findSessionFileRemote(
				sessionId,
				sshConfig,
				options?.configDir
			);
			if (!sessionFilePath) {
				logger.warn(`Codex session file not found on remote: ${sessionId}`, LOG_CONTEXT);
				return { messages: [], total: 0, hasMore: false };
			}
			content = await readRemoteRollout(sessionFilePath, sshConfig);
		} else {
			// Find the session file by sessionId locally
			const sessionFilePath = await this.findSessionFile(sessionId, options?.configDir);

			if (!sessionFilePath) {
				logger.warn(`Codex session file not found: ${sessionId}`, LOG_CONTEXT);
				return { messages: [], total: 0, hasMore: false };
			}

			if (options?.readOnly && !sessionFilePath.endsWith('.zst'))
				return this.readLocalTranscriptIncrementally(sessionFilePath, options);
			content = await readCodexRollout(sessionFilePath);
		}

		try {
			const { messages } = parseCodexTranscript(content);
			return BaseSessionStorage.applyMessagePagination(messages, options);
		} catch (error) {
			logger.error(`Error reading Codex session: ${sessionId}`, LOG_CONTEXT, error);
			captureException(error, { operation: 'codexStorage:readSessionMessages', sessionId });
			return { messages: [], total: 0, hasMore: false };
		}
	}

	async searchSessions(
		projectPath: string,
		query: string,
		searchMode: SessionSearchMode,
		sshConfig?: SshRemoteConfig,
		accountDir?: string
	): Promise<SessionSearchResult[]> {
		if (sshConfig || searchMode === 'title')
			return super.searchSessions(projectPath, query, searchMode, sshConfig, accountDir);
		if (!query.trim()) return [];
		if (accountDir) await fs.access(accountDir);
		const sessions = await this.listSessions(projectPath, undefined, accountDir);
		const files = await this.findAllSessionFiles(accountDir);
		// Operation-local paths, not another cache. Concurrent searches own their
		// lists; legacy filenames still use the existing metadata lookup below.
		const paths = new Map<string, string>();
		for (const file of files) {
			const id = extractSessionIdFromFilename(file.filename);
			if (id && !paths.has(id)) paths.set(id, file.filePath);
		}
		return this.searchSessionMessages(sessions, query, searchMode, (sessionId) =>
			this.getSearchableMessages(
				sessionId,
				projectPath,
				undefined,
				accountDir,
				paths.get(sessionId)
			)
		);
	}

	protected async getSearchableMessages(
		sessionId: string,
		_projectPath: string,
		sshConfig?: SshRemoteConfig,
		accountDir?: string,
		localFilePath?: string
	): Promise<SearchableMessage[]> {
		let content: string;

		try {
			if (sshConfig) {
				const sessionFilePath = await this.findSessionFileRemote(sessionId, sshConfig, accountDir);
				if (!sessionFilePath) return [];
				content = await readRemoteRollout(sessionFilePath, sshConfig);
			} else {
				const sessionFilePath =
					localFilePath ?? (await this.findSessionFile(sessionId, accountDir));
				if (!sessionFilePath) return [];
				content = await readCodexRollout(sessionFilePath);
			}
		} catch {
			return [];
		}

		return parseNativeSearchMessages(content, 'codex').messages;
	}

	getSessionPath(
		_projectPath: string,
		_sessionId: string,
		_sshConfig?: SshRemoteConfig
	): string | null {
		// Synchronous version - returns null since we need async file search
		// Use findSessionFile for async access
		// Note: For SSH, would need to use findSessionFileRemote which is async
		return null;
	}

	/**
	 * Find the file path for a session by ID (async)
	 */
	private async findSessionFile(
		sessionId: string,
		accountDir?: string,
		boundedLookup = false
	): Promise<string | null> {
		const allFiles = await this.findAllSessionFiles(accountDir);

		// Resolve modern filenames before inspecting any legacy transcript. Otherwise
		// refreshing one tab reads every unrelated file preceding it in the listing.
		const namedFile = allFiles.find(
			(file) => extractSessionIdFromFilename(file.filename) === sessionId
		);
		if (namedFile) return namedFile.filePath;
		for (const { filePath } of allFiles) {
			// Also check by reading first line for session ID
			try {
				const content = await readCodexRollout(
					filePath,
					undefined,
					boundedLookup ? { prefixBytes: 65536 } : undefined
				);
				const firstLine = content.split('\n')[0];
				if (firstLine) {
					const metadata = JSON.parse(firstLine) as CodexSessionMetadata;
					const metadataId = metadata?.payload?.id || metadata.id;
					if (metadataId === sessionId) {
						return filePath;
					}
				}
			} catch {
				// Skip files that can't be read
			}
		}

		return null;
	}

	/**
	 * Find the file path for a session by ID on a remote host via SSH
	 */
	private async findSessionFileRemote(
		sessionId: string,
		sshConfig: SshRemoteConfig,
		accountDir?: string
	): Promise<string | null> {
		const allFiles = await this.findAllSessionFilesRemote(sshConfig, accountDir);
		const named = allFiles.find(
			(file) => extractSessionIdFromFilename(file.filename) === sessionId
		);
		if (named) return named.filePath;

		for (const { filePath, filename } of allFiles) {
			const fileSessionId = extractSessionIdFromFilename(filename);
			if (fileSessionId === sessionId) {
				return filePath;
			}

			// Also check by reading first line for session ID
			try {
				const content = await readRemoteRollout(filePath, sshConfig);
				if (content) {
					const firstLine = content.split('\n')[0];
					if (firstLine) {
						const metadata = JSON.parse(firstLine) as CodexSessionMetadata;
						const metadataId = metadata?.payload?.id || metadata.id;
						if (metadataId === sessionId) {
							return filePath;
						}
					}
				}
			} catch {
				// Skip files that can't be read
			}
		}

		return null;
	}

	/** Remove whole native rollouts only on an explicit conversation deletion. */
	async deleteSession(
		sessionId: string,
		accountDir?: string,
		sshConfig?: SshRemoteConfig
	): Promise<{ success: boolean }> {
		if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sessionId))
			throw new Error('Invalid Codex session ID');
		const files = sshConfig
			? await this.findAllSessionFilesRemote(sshConfig, accountDir, false)
			: await this.findAllSessionFiles(accountDir, false);
		for (const file of files) {
			if (extractSessionIdFromFilename(file.filename) !== sessionId) continue;
			if (sshConfig) {
				const result = await deleteRemote(file.filePath, sshConfig, false);
				if (!result.success) throw new Error(`Cannot delete Codex conversation: ${result.error}`);
				continue;
			}
			await fs.unlink(file.filePath).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== 'ENOENT') throw error;
			});
		}
		return { success: true };
	}

	async deleteMessagePair(
		_projectPath: string,
		sessionId: string,
		_userMessageUuid: string,
		_fallbackContent?: string,
		sshConfig?: SshRemoteConfig
	): Promise<{ success: boolean; error?: string; linesRemoved?: number }> {
		if (sshConfig)
			return {
				success: false,
				error: 'Delete not supported for remote sessions. Native Codex history is read-only.',
			};
		if (!(await this.findSessionFile(sessionId)))
			return { success: false, error: 'Session file not found' };
		return {
			success: false,
			error: 'Native Codex history is read-only. Delete the whole conversation instead.',
		};
	}
}
