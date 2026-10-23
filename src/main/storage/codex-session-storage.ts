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

import { app } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { logger } from '../utils/logger';
import { captureException } from '../utils/sentry';
import { isExpectedSessionReadError } from '../utils/session-read-errors';
import { fileFingerprint } from './session-info-cache';
import { readFileRemote, readDirRemote, statRemote } from '../utils/remote-fs';
import type {
	AgentSessionInfo,
	SessionMessagesResult,
	SessionReadOptions,
	SessionMessage,
} from '../agents';
import type { ToolType, SshRemoteConfig } from '../../shared/types';
import { BaseSessionStorage } from './base-session-storage';
import type { SearchableMessage } from './base-session-storage';
import { ModelUsageAccumulator } from '../../shared/modelUsage';
import { CodexTokenCounts } from '../../shared/codexTokenUsage';
import { compactToolOutput } from '../../shared/toolOutput';
import { extractReasoningSummaryText, codexToolResultStatus } from '../parsers/codex-output-parser';

const LOG_CONTEXT = '[CodexSessionStorage]';
const MAX_SESSION_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

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
const CODEX_SESSION_CACHE_VERSION = 7;
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
 * Codex session metadata structure (first line of JSONL)
 * Format: { type: 'session_meta', payload: { id, cwd, timestamp, ... } }
 */
interface CodexSessionMetadata {
	type?: string;
	timestamp?: string;
	payload?: {
		id: string;
		cwd?: string;
		timestamp?: string;
		originator?: string;
		source?: string | { subagent?: unknown };
		cli_version?: string;
		model_provider?: string;
		git?: {
			commit_hash?: string;
			branch?: string;
			repository_url?: string;
		};
	};
	// Legacy format (direct fields)
	id?: string;
	git?: {
		commit_hash?: string;
		branch?: string;
		repository_url?: string;
	};
}

/**
 * Codex message content structure
 */
interface CodexMessageContent {
	type: string;
	text?: string;
	image_url?: string | { url?: string };
	// Tool use fields
	tool?: string;
	args?: unknown;
	output?: string;
}

/**
 * Tool use entry shape used when building SessionMessage.toolUse arrays.
 * Provides type safety for the tool call / tool output merge logic.
 */
interface CodexToolUseEntry {
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
function extractSessionIdFromFilename(filename: string): string | null {
	// Current Codex uses an ISO-like timestamp with hyphens and a literal T.
	const native = filename.match(
		/-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.jsonl$/i
	);
	if (native) return native[1];
	// Match older rollout-YYYYMMDD_HHMMSS_MMM-UUID.jsonl names.
	const match = filename.match(/rollout-[\d_]+-([a-f0-9-]+)\.jsonl$/i);
	if (match) {
		return match[1];
	}
	// Fallback: use filename without extension
	return filename.replace('.jsonl', '');
}

/**
 * Extract text from Codex message content array
 */
function extractTextFromContent(content: CodexMessageContent[] | undefined): string {
	if (!content || !Array.isArray(content)) {
		return '';
	}

	const textParts = content
		.filter(
			(part) => part.type === 'input_text' || part.type === 'text' || part.type === 'output_text'
		)
		.map((part) => part.text || '')
		.filter((text) => text.trim());

	return textParts.join(' ');
}

/**
 * Check if text is a system/environment context message that should be skipped for preview
 */
function isSystemContextMessage(text: string): boolean {
	if (!text) return false;
	const trimmed = text.trim();
	// Skip messages that start with environment/system context XML tags
	if (
		trimmed.startsWith('<environment_context>') ||
		trimmed.startsWith('<cwd>') ||
		trimmed.startsWith('<system>') ||
		trimmed.startsWith('<approval_policy>') ||
		/^<external_codex_apps_open_page(?:\s[^>]*)?>[\s\S]*<\/external_codex_apps_open_page>$/.test(
			trimmed
		) ||
		(/^<heartbeat(?:\s[^>]*)?>[\s\S]*<\/heartbeat>$/.test(trimmed) &&
			!trimmed.slice(0, -'</heartbeat>'.length).includes('</heartbeat>') &&
			/(?:<instructions>[\s\S]*<\/instructions>|automation[_-]?id)/i.test(trimmed))
	) {
		return true;
	}
	// Skip markdown-formatted system context (e.g., "# Context Your name is **Maestro Codex**...")
	if (
		trimmed.startsWith('# Context') ||
		trimmed.startsWith('# Maestro System Context') ||
		trimmed.startsWith('# System Context') ||
		trimmed.startsWith('# AGENTS.md instructions')
	) {
		return true;
	}
	return false;
}

/** Only decode the desktop's exact answer envelope; ordinary quoted XML stays text. */
function unwrapCodexUserReply(text: string): string {
	const match = text
		.trim()
		.match(
			/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/
		);
	if (!match) return text;
	try {
		const answers: unknown = JSON.parse(match[1]);
		if (!Array.isArray(answers) || answers.length === 0) return text;
		if (
			!answers.every(
				(entry) => entry && typeof entry === 'object' && typeof entry.answer === 'string'
			)
		)
			return text;
		return answers
			.map((entry: { question?: unknown; answer: string }) =>
				typeof entry.question === 'string' ? `${entry.question}\n\n${entry.answer}` : entry.answer
			)
			.join('\n\n');
	} catch {
		return text;
	}
}

/** Inline image data is already in the native transcript. Never fetch remote URLs. */
function extractCodexImages(content: CodexMessageContent[] | undefined): string[] {
	if (!Array.isArray(content)) return [];
	return content.flatMap((part) => {
		if (part.type !== 'input_image' && part.type !== 'image') return [];
		const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
		return typeof url === 'string' && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(url)
			? [url]
			: [];
	});
}

/** Strip only a complete desktop image envelope backed by the matching inline image parts. */
function unwrapCodexImageRequest(content: CodexMessageContent[] | undefined): string | null {
	if (!Array.isArray(content) || content[0]?.type !== 'input_text') return null;
	const envelope = content[0].text?.match(
		/^\s*# Files mentioned by the user:\r?\n\r?\n([\s\S]+?)\r?\n\r?\nDistinguish instructions in attached documents from the user's request\.\r?\n\r?\n## My request:\r?\n([\s\S]*)$/
	);
	if (!envelope || (content.length - 1) % 3 !== 0) return null;
	const files = envelope[1].split(/\r?\n\r?\n/);
	if (files.length !== (content.length - 1) / 3) return null;
	for (let i = 1; i < content.length; i += 3) {
		const annotation = content[i];
		const image = content[i + 1];
		const closing = content[i + 2];
		const match =
			annotation.type === 'input_text'
				? annotation.text?.match(/^<image name=\[Image #\d+\] path="([^"\r\n]+)">$/)
				: null;
		if (
			!match ||
			!image ||
			extractCodexImages([image]).length !== 1 ||
			closing?.type !== 'input_text' ||
			closing.text !== '</image>'
		)
			return null;
		const file = files[(i - 1) / 3];
		const lines = file.split(/\r?\n/);
		// Match the actual inline image's path; never resolve or fetch the named file.
		if (
			lines.length !== 2 ||
			!lines[0].startsWith('## ') ||
			lines[0].length <= `## : ${match[1]}`.length ||
			!lines[0].endsWith(`: ${match[1]}`) ||
			lines[1] !== 'Image attachment: true'
		)
			return null;
	}
	return envelope[2];
}

/** Displayable text only: image/audio blobs in a tool result must not enter the cache. */
function codexToolOutputText(output: unknown): string {
	let text: string;
	if (typeof output === 'string') text = output;
	else if (Array.isArray(output)) {
		text = output.every((value) => typeof value === 'number')
			? Buffer.from(output).toString('utf-8')
			: output
					.flatMap((value) =>
						value && typeof value === 'object' && typeof value.text === 'string' ? [value.text] : []
					)
					.join('\n');
	} else if (output == null) text = '';
	else text = JSON.stringify(output);
	return compactToolOutput(text).output as string;
}

function extractCwdFromText(text: string): string | null {
	const match = text.match(/<cwd>([^<]+)<\/cwd>/i);
	return match ? match[1].trim() : null;
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

		const content = await fs.readFile(filePath, 'utf-8');
		const lines = content.split('\n').filter((l) => l.trim());

		if (lines.length === 0) {
			return null;
		}

		// Parse first line as metadata
		let metadata: CodexSessionMetadata | null = null;
		let timestamp = new Date(stats.mtimeMs).toISOString();
		let sessionProjectPath: string | null = null;

		try {
			const firstLine = JSON.parse(lines[0]);
			// New format: { type: 'session_meta', payload: { id, cwd, timestamp, ... } }
			if (firstLine.type === 'session_meta' && firstLine.payload) {
				metadata = firstLine as CodexSessionMetadata;
				timestamp = firstLine.payload.timestamp || firstLine.timestamp || timestamp;
				// Get project path directly from session_meta
				if (firstLine.payload.cwd) {
					sessionProjectPath = firstLine.payload.cwd;
				}
			}
			// Legacy format: { id, timestamp, ... } at top level
			else if (firstLine.id && firstLine.timestamp) {
				metadata = firstLine as CodexSessionMetadata;
				timestamp = firstLine.timestamp || timestamp;
			}
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
	let messageIndex = initial?.messageIndex ?? 0;

	for (const [relativeIndex, line] of lines.entries()) {
		const lineIndex = (initial?.lineIndex ?? 0) + relativeIndex;
		try {
			const entry = JSON.parse(line);
			const payload = entry.type === 'response_item' ? entry.payload : entry;

			if (
				payload?.type === 'message' &&
				(payload.role === 'user' || payload.role === 'assistant')
			) {
				const rawText = extractTextFromContent(payload.content);
				// Keep the old counter even for hidden envelopes, so cached native IDs still align.
				const oldIndex = messageIndex;
				if (rawText || (payload.role === 'user' && isSystemContextMessage(rawText))) messageIndex++;
				if (payload.role === 'user' && isSystemContextMessage(rawText)) continue;
				const images = extractCodexImages(payload.content);
				const text =
					payload.role === 'user'
						? unwrapCodexUserReply(unwrapCodexImageRequest(payload.content) ?? rawText)
						: rawText;
				if (text || images.length > 0) {
					const phase = payload.phase ?? payload.channel;
					messages.push({
						type: payload.role,
						role: payload.role,
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
					messages.push({
						type: 'thinking',
						role: 'assistant',
						channel: 'analysis',
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
					tool: payload.name || 'unknown',
					args: input,
					state: { status: 'running', input: parsedInput },
				};
				messages.push({
					type: 'assistant',
					role: 'assistant',
					content: `Tool: ${payload.name || 'unknown'}`,
					timestamp: entry.timestamp || '',
					uuid: payload.call_id || `codex-msg-${messageIndex}`,
					toolUse: [toolInfo],
				});
				messageIndex++;
			}

			if (
				entry.type === 'response_item' &&
				(payload?.type === 'function_call_output' || payload?.type === 'custom_tool_call_output')
			) {
				const callId = payload.call_id;
				const outputText = codexToolOutputText(payload.output);
				const matchingIdx = callId ? messages.findIndex((m) => m.uuid === callId && m.toolUse) : -1;
				const status = codexToolResultStatus(payload);
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
				} else {
					// Even an orphan result is a tool card, never an assistant answer.
					messages.push({
						type: 'assistant',
						role: 'assistant',
						content: `Tool: ${payload.name || 'unknown'}`,
						timestamp: entry.timestamp || '',
						uuid: callId || `codex-msg-${messageIndex}`,
						toolUse: [{ tool: payload.name || 'unknown', state: { status, output: outputText } }],
					});
					messageIndex++;
				}
			}

			if (entry.type === 'item.completed' && entry.item?.type === 'agent_message') {
				messages.push({
					type: 'assistant',
					role: 'assistant',
					content: entry.item.text || '',
					timestamp: entry.timestamp || '',
					uuid: entry.item.id || `codex-msg-${messageIndex}`,
					...(entry.item.phase
						? { channel: entry.item.phase === 'final_answer' ? 'final' : entry.item.phase }
						: {}),
				});
				messageIndex++;
			}

			if (entry.type === 'item.completed' && entry.item?.type === 'tool_call') {
				messages.push({
					type: 'assistant',
					role: 'assistant',
					content: `Tool: ${entry.item.tool}`,
					timestamp: entry.timestamp || '',
					uuid: entry.item.id || `codex-msg-${messageIndex}`,
					toolUse: [
						{
							tool: entry.item.tool,
							args: entry.item.args,
							state: { status: 'completed', input: entry.item.args },
						},
					],
				});
				messageIndex++;
			}

			if (entry.type === 'item.completed' && entry.item?.type === 'tool_result') {
				const output = codexToolOutputText(entry.item.output);
				messages.push({
					type: 'assistant',
					role: 'assistant',
					content: `Tool: ${entry.item.tool || 'unknown'}`,
					timestamp: entry.timestamp || '',
					uuid: entry.item.id || `codex-msg-${messageIndex}`,
					toolUse: [
						{
							tool: entry.item.tool || 'unknown',
							state: { status: entry.item.is_error ? 'failed' : 'completed', output },
						},
					],
				});
				messageIndex++;
			}
		} catch {
			// Skip malformed lines without changing IDs for later valid messages.
		}
	}
	return { messages, messageIndex, lineIndex: (initial?.lineIndex ?? 0) + lines.length };
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
		if (sshConfig || !sessionId) return null;
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
	 * Find all session files, organized by date directories
	 */
	private async findAllSessionFiles(
		accountDir?: string
	): Promise<Array<{ filePath: string; filename: string }>> {
		const sessionsDir = this.getSessionsDir(accountDir);
		const sessionFiles: Array<{ filePath: string; filename: string }> = [];

		try {
			await fs.access(sessionsDir);
		} catch {
			return [];
		}

		// Scan YYYY directories
		const years = await fs.readdir(sessionsDir);
		for (const year of years) {
			if (!/^\d{4}$/.test(year)) continue;

			const yearDir = path.join(sessionsDir, year);
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
							if (file.endsWith('.jsonl')) {
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

		return sessionFiles;
	}

	/**
	 * Find all session files on a remote host via SSH, organized by date directories
	 * Recursively scans the YYYY/MM/DD directory structure
	 */
	private async findAllSessionFilesRemote(
		sshConfig: SshRemoteConfig,
		accountDir?: string
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
						if (!fileEntry.isDirectory && fileEntry.name.endsWith('.jsonl')) {
							sessionFiles.push({
								filePath: `${dayDir}/${fileEntry.name}`,
								filename: fileEntry.name,
							});
						}
					}
				}
			}
		}

		return sessionFiles;
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

			const result = await readFileRemote(filePath, sshConfig);
			if (!result.success || !result.data) {
				logger.error(
					`Failed to read remote Codex session file: ${filePath} - ${result.error}`,
					LOG_CONTEXT
				);
				return null;
			}

			const content = result.data;
			const lines = content.split('\n').filter((l) => l.trim());

			if (lines.length === 0) {
				return null;
			}

			// Parse first line as metadata
			let metadata: CodexSessionMetadata | null = null;
			let timestamp = new Date(stats.mtimeMs).toISOString();
			let sessionProjectPath: string | null = null;

			try {
				const firstLine = JSON.parse(lines[0]);
				// New format: { type: 'session_meta', payload: { id, cwd, timestamp, ... } }
				if (firstLine.type === 'session_meta' && firstLine.payload) {
					metadata = firstLine as CodexSessionMetadata;
					timestamp = firstLine.payload.timestamp || firstLine.timestamp || timestamp;
					if (firstLine.payload.cwd) {
						sessionProjectPath = firstLine.payload.cwd;
					}
				}
				// Legacy format: { id, timestamp, ... } at top level
				else if (firstLine.id && firstLine.timestamp) {
					metadata = firstLine as CodexSessionMetadata;
					timestamp = firstLine.timestamp || timestamp;
				}
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
		const currentFilePaths = new Set<string>();
		let cacheUpdated = false;

		for (const { filePath, filename } of allSessionFiles) {
			currentFilePaths.add(filePath);
			let stats: { size: number; mtimeMs: number };

			try {
				const fileStat = await fs.stat(filePath);
				if (fileStat.size === 0) continue;
				stats = { size: fileStat.size, mtimeMs: fileStat.mtimeMs };
			} catch (error) {
				logger.error(`Error stating Codex session file: ${filename}`, LOG_CONTEXT, error);
				captureException(error, { operation: 'codexStorage:statSessionFile', filename });
				continue;
			}

			const cached = cache.sessions[filePath];
			if (cached && cached.fileMtimeMs >= stats.mtimeMs) {
				if (
					cached.session.projectPath &&
					isSessionForProject(cached.session.projectPath, projectPath)
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
				if (session.projectPath && isSessionForProject(session.projectPath, projectPath)) {
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
		const accountPrefix = sessionsDir.endsWith(path.sep)
			? sessionsDir
			: `${sessionsDir}${path.sep}`;
		for (const cachedPath of Object.keys(cache.sessions)) {
			if (!cachedPath.startsWith(accountPrefix)) continue;
			if (!currentFilePaths.has(cachedPath)) {
				delete cache.sessions[cachedPath];
				cacheUpdated = true;
			}
		}

		if (cacheUpdated) {
			cache.lastProcessedAt = Date.now();
			await saveCodexSessionCache(cache);
		}

		// Titles are indexed separately from rollouts and can change without transcript writes.
		try {
			const index = await fs.readFile(
				path.join(path.dirname(sessionsDir), 'session_index.jsonl'),
				'utf-8'
			);
			const titles = new Map<string, string>();
			for (const line of index.split('\n')) {
				try {
					const entry = JSON.parse(line);
					if (typeof entry.id === 'string' && typeof entry.thread_name === 'string')
						titles.set(entry.id, entry.thread_name);
				} catch {
					/* An interrupted final index line is not a corrupt transcript. */
				}
			}
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

	async readSessionMessages(
		_projectPath: string,
		sessionId: string,
		options?: SessionReadOptions,
		sshConfig?: SshRemoteConfig
	): Promise<SessionMessagesResult> {
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
			const result = await readFileRemote(sessionFilePath, sshConfig);
			if (!result.success || !result.data) {
				logger.error(
					`Failed to read remote Codex session: ${sessionId} - ${result.error}`,
					LOG_CONTEXT
				);
				return { messages: [], total: 0, hasMore: false };
			}
			content = result.data;
		} else {
			// Find the session file by sessionId locally
			const sessionFilePath = await this.findSessionFile(sessionId, options?.configDir);

			if (!sessionFilePath) {
				logger.warn(`Codex session file not found: ${sessionId}`, LOG_CONTEXT);
				return { messages: [], total: 0, hasMore: false };
			}

			if (options?.readOnly) return this.readLocalTranscriptIncrementally(sessionFilePath, options);
			content = await fs.readFile(sessionFilePath, 'utf-8');
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

	protected async getSearchableMessages(
		sessionId: string,
		_projectPath: string,
		sshConfig?: SshRemoteConfig
	): Promise<SearchableMessage[]> {
		let content: string;

		try {
			if (sshConfig) {
				const sessionFilePath = await this.findSessionFileRemote(sessionId, sshConfig);
				if (!sessionFilePath) return [];
				const result = await readFileRemote(sessionFilePath, sshConfig);
				if (!result.success || !result.data) return [];
				content = result.data;
			} else {
				const sessionFilePath = await this.findSessionFile(sessionId);
				if (!sessionFilePath) return [];
				content = await fs.readFile(sessionFilePath, 'utf-8');
			}
		} catch {
			return [];
		}

		const lines = content.split('\n').filter((l) => l.trim());
		const searchableMessages: SearchableMessage[] = [];

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);

				let textContent = '';
				let role: 'user' | 'assistant' | null = null;

				// Handle message entries (legacy format)
				if (entry.type === 'message') {
					role = entry.role;
					textContent = extractTextFromContent(entry.content);
				}

				// Handle response_item messages (current Codex format)
				if (entry.type === 'response_item' && entry.payload?.type === 'message') {
					role = entry.payload.role;
					textContent = extractTextFromContent(entry.payload.content);
				}

				// Handle item.completed agent_message
				if (entry.type === 'item.completed' && entry.item?.type === 'agent_message') {
					role = 'assistant';
					textContent = entry.item.text || '';
				}

				if (role && (role === 'user' || role === 'assistant') && textContent.trim()) {
					searchableMessages.push({ role, textContent });
				}
			} catch {
				// Skip malformed lines
			}
		}

		return searchableMessages;
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
	private async findSessionFile(sessionId: string, accountDir?: string): Promise<string | null> {
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
				const content = await fs.readFile(filePath, 'utf-8');
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

		for (const { filePath, filename } of allFiles) {
			const fileSessionId = extractSessionIdFromFilename(filename);
			if (fileSessionId === sessionId) {
				return filePath;
			}

			// Also check by reading first line for session ID
			try {
				const result = await readFileRemote(filePath, sshConfig);
				if (result.success && result.data) {
					const firstLine = result.data.split('\n')[0];
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

	async deleteMessagePair(
		_projectPath: string,
		sessionId: string,
		userMessageUuid: string,
		fallbackContent?: string,
		sshConfig?: SshRemoteConfig
	): Promise<{ success: boolean; error?: string; linesRemoved?: number }> {
		// Delete operations on remote sessions are not supported
		if (sshConfig) {
			logger.warn('Delete message pair not supported for SSH remote sessions', LOG_CONTEXT);
			return { success: false, error: 'Delete not supported for remote sessions' };
		}
		const sessionFilePath = await this.findSessionFile(sessionId);

		if (!sessionFilePath) {
			logger.warn('Codex session file not found for deletion', LOG_CONTEXT, { sessionId });
			return { success: false, error: 'Session file not found' };
		}

		try {
			const content = await fs.readFile(sessionFilePath, 'utf-8');
			const lines = content.split('\n').filter((l) => l.trim());

			interface ParsedLine {
				line: string;
				entry: {
					type?: string;
					role?: string;
					content?: CodexMessageContent[];
					payload?: {
						id?: string;
						type?: string;
						role?: string;
						content?: CodexMessageContent[];
						call_id?: string;
						name?: string;
					};
					item?: {
						id?: string;
						type?: string;
						tool?: string;
						tool_call_id?: string;
					};
				} | null;
				remove?: boolean;
			}

			/**
			 * Check if an entry is a user message in either format:
			 * - Legacy: { type: 'message', role: 'user' }
			 * - v0.111.0: { type: 'response_item', payload: { type: 'message', role: 'user' } }
			 */
			function isUserMessage(entry: ParsedLine['entry']): boolean {
				if (!entry) return false;
				if (entry.type === 'message' && entry.role === 'user') return true;
				if (
					entry.type === 'response_item' &&
					entry.payload?.type === 'message' &&
					entry.payload?.role === 'user'
				) {
					return true;
				}
				return false;
			}

			/**
			 * Extract text content from a user message entry (either format)
			 */
			function getUserMessageContent(entry: ParsedLine['entry']): string {
				if (!entry) return '';
				if (entry.type === 'message' && entry.role === 'user' && entry.content) {
					return extractTextFromContent(entry.content);
				}
				if (
					entry.type === 'response_item' &&
					entry.payload?.type === 'message' &&
					entry.payload?.role === 'user' &&
					entry.payload?.content
				) {
					return extractTextFromContent(entry.payload.content);
				}
				return '';
			}

			const parsedLines: ParsedLine[] = [];
			let userMessageIndex = -1;

			// Build a message-index counter that mirrors readSessionMessages logic.
			// readSessionMessages increments messageIndex only for actual displayable messages,
			// so we must do the same here to match UUIDs like "codex-msg-N".
			let messageIndex = 0;

			// Parse all lines and find the target user message
			for (let i = 0; i < lines.length; i++) {
				try {
					const entry = JSON.parse(lines[i]);
					parsedLines.push({ line: lines[i], entry });

					// Match user messages in both legacy and v0.111.0 formats
					if (isUserMessage(entry)) {
						// Check payload.id first (v0.111.0 format uses real IDs)
						if (
							entry.type === 'response_item' &&
							entry.payload?.id &&
							userMessageUuid === entry.payload.id
						) {
							userMessageIndex = parsedLines.length - 1;
						}
						const text = getUserMessageContent(entry);
						if (text) {
							// Fallback: match by sequential message UUID (codex-msg-N)
							if (
								userMessageIndex !== parsedLines.length - 1 &&
								userMessageUuid === `codex-msg-${messageIndex}`
							) {
								userMessageIndex = parsedLines.length - 1;
							}
							messageIndex++;
						}
					}
					// Match by payload.id for non-user v0.111.0 entries (e.g. tool calls referenced by id)
					else if (
						entry.type === 'response_item' &&
						entry.payload?.id &&
						userMessageUuid === entry.payload.id
					) {
						userMessageIndex = parsedLines.length - 1;
					}

					// Count assistant messages to keep messageIndex in sync with readSessionMessages
					if (entry.type === 'message' && entry.role === 'assistant') {
						const text = extractTextFromContent(entry.content);
						if (text) messageIndex++;
					} else if (
						entry.type === 'response_item' &&
						entry.payload?.type === 'message' &&
						entry.payload?.role === 'assistant'
					) {
						const text = extractTextFromContent(entry.payload?.content);
						if (text) messageIndex++;
					} else if (entry.type === 'item.completed' && entry.item?.type === 'agent_message') {
						messageIndex++;
					} else if (entry.type === 'item.completed' && entry.item?.type === 'tool_call') {
						messageIndex++;
					} else if (entry.type === 'item.completed' && entry.item?.type === 'tool_result') {
						messageIndex++;
					} else if (
						entry.type === 'response_item' &&
						(entry.payload?.type === 'function_call' || entry.payload?.type === 'custom_tool_call')
					) {
						messageIndex++;
					}
					// function_call_output / custom_tool_call_output normally merges into a preceding tool call
					// in readSessionMessages. But when no matching call_id is found, readSessionMessages creates
					// a standalone assistant message and increments messageIndex. Mirror that here.
					if (
						entry.type === 'response_item' &&
						(entry.payload?.type === 'function_call_output' ||
							entry.payload?.type === 'custom_tool_call_output')
					) {
						const callId = entry.payload.call_id;
						// Check if any prior parsed line has a matching call_id
						const hasMatchingCall = callId
							? parsedLines.some(
									(p) =>
										p.entry &&
										p.entry.type === 'response_item' &&
										(p.entry.payload?.type === 'function_call' ||
											p.entry.payload?.type === 'custom_tool_call') &&
										p.entry.payload?.call_id === callId
								)
							: false;
						if (!hasMatchingCall) {
							messageIndex++;
						}
					}
				} catch {
					parsedLines.push({ line: lines[i], entry: null });
				}
			}

			// Fallback: try content match if UUID didn't work
			if (userMessageIndex === -1 && fallbackContent) {
				const normalizedFallback = fallbackContent.trim().toLowerCase();

				for (let i = parsedLines.length - 1; i >= 0; i--) {
					const entry = parsedLines[i].entry;
					if (isUserMessage(entry)) {
						const textContent = getUserMessageContent(entry);
						if (textContent.trim().toLowerCase() === normalizedFallback) {
							userMessageIndex = i;
							logger.info('Found Codex message by content match', LOG_CONTEXT, {
								sessionId,
								index: i,
							});
							break;
						}
					}
				}
			}

			if (userMessageIndex === -1) {
				logger.warn('User message not found for deletion in Codex session', LOG_CONTEXT, {
					sessionId,
					userMessageUuid,
					hasFallback: !!fallbackContent,
				});
				return { success: false, error: 'User message not found' };
			}

			// Find the end of the response (next user message) and collect tool_call IDs being deleted
			let endIndex = parsedLines.length;
			const deletedToolCallIds = new Set<string>();
			const deletedCallIds = new Set<string>();

			for (let i = userMessageIndex + 1; i < parsedLines.length; i++) {
				const entry = parsedLines[i].entry;

				// Stop at the next user message (either format)
				if (isUserMessage(entry)) {
					endIndex = i;
					break;
				}

				// Collect tool_call IDs from item.completed events being deleted (legacy)
				if (
					entry?.type === 'item.completed' &&
					entry?.item?.type === 'tool_call' &&
					entry?.item?.id
				) {
					deletedToolCallIds.add(entry.item.id);
				}

				// Collect call_ids from response_item function_call events being deleted (v0.111.0)
				if (
					entry?.type === 'response_item' &&
					(entry?.payload?.type === 'function_call' ||
						entry?.payload?.type === 'custom_tool_call') &&
					entry?.payload?.call_id
				) {
					deletedCallIds.add(entry.payload.call_id);
				}
			}

			// Remove the message pair
			let linesToKeep = [...parsedLines.slice(0, userMessageIndex), ...parsedLines.slice(endIndex)];

			// If we deleted any tool_call blocks, clean up orphaned tool_result/output blocks
			if (deletedToolCallIds.size > 0 || deletedCallIds.size > 0) {
				linesToKeep = linesToKeep.filter((item) => {
					const entry = item.entry;

					// Remove tool_result events that reference deleted tool_call IDs (legacy)
					if (entry?.type === 'item.completed' && entry?.item?.type === 'tool_result') {
						// tool_result items reference tool_call via tool_call_id or the item.id pattern
						const toolCallId = entry.item.tool_call_id || entry.item.id;
						if (toolCallId && deletedToolCallIds.has(toolCallId)) {
							return false;
						}
					}

					// Remove function_call_output events that reference deleted call_ids (v0.111.0)
					if (
						entry?.type === 'response_item' &&
						(entry?.payload?.type === 'function_call_output' ||
							entry?.payload?.type === 'custom_tool_call_output') &&
						entry?.payload?.call_id &&
						deletedCallIds.has(entry.payload.call_id)
					) {
						return false;
					}

					return true;
				});

				const allDeletedIds = [...Array.from(deletedToolCallIds), ...Array.from(deletedCallIds)];
				logger.info('Cleaned up orphaned tool output blocks in Codex session', LOG_CONTEXT, {
					sessionId,
					deletedToolCallIds: allDeletedIds,
				});
			}

			const newContent = linesToKeep.map((p) => p.line).join('\n') + '\n';
			this.transcriptCursors.delete(sessionFilePath);
			await fs.writeFile(sessionFilePath, newContent, 'utf-8');

			const linesRemoved = parsedLines.length - linesToKeep.length;
			logger.info('Deleted message pair from Codex session', LOG_CONTEXT, {
				sessionId,
				userMessageUuid,
				linesRemoved,
			});

			return { success: true, linesRemoved };
		} catch (error) {
			logger.error('Error deleting message pair from Codex session', LOG_CONTEXT, {
				sessionId,
				error,
			});
			captureException(error, { operation: 'codexStorage:deleteMessagePair', sessionId });
			return { success: false, error: String(error) };
		}
	}
}
