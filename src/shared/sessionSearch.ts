import { hasEmbeddedSystemPrompt, stripEmbeddedSystemPrompt } from './embeddedSystemPrompt';
import { stripTurnPrompt } from './turnPrompt';
import { codexSessionMetadata, extractCwdFromText } from './codexSessionMetadata';
import {
	extractTextFromContent,
	isSystemContextMessage,
	unwrapCodexImageRequest,
	unwrapCodexUserReply,
	type CodexMessageContent,
} from './codexSessionText';

/** Shared by native history search and the session browser. */
export function extractMatchPreview(
	originalText: string,
	lowerText: string,
	searchLower: string,
	queryLength: number,
	leadChars: number = 20,
	trailChars: number = 120
): string {
	const idx = lowerText.indexOf(searchLower);
	if (idx < 0) return '';

	const start = Math.max(0, idx - leadChars);
	const end = Math.min(originalText.length, idx + queryLength + trailChars);
	return (
		(start > 0 ? '...' : '') +
		originalText.slice(start, end) +
		(end < originalText.length ? '...' : '')
	);
}

export interface SearchableNativeMessage {
	role: 'user' | 'assistant';
	textContent: string;
	uuid?: string;
	timestamp?: string;
}

/** The provider search adapters and bounded worker use the same text extraction. */
export function parseNativeSearchMessages(content: string, provider: 'claude-code' | 'codex') {
	const messages: SearchableNativeMessage[] = [];
	let projectPath: string | undefined;
	let sessionId: string | undefined;
	let title: string | undefined;
	for (const [lineIndex, line] of content
		.split('\n')
		.filter((line) => line.trim())
		.entries()) {
		try {
			const entry = JSON.parse(line);
			const metadata =
				provider === 'codex' && (lineIndex === 0 || entry.type === 'session_meta')
					? codexSessionMetadata(entry)
					: null;
			const cwd = provider === 'codex' ? metadata?.payload?.cwd : entry.cwd;
			if (!projectPath && typeof cwd === 'string') projectPath = cwd;
			const nativeId = metadata?.payload?.id ?? metadata?.id;
			if (typeof nativeId === 'string') sessionId = nativeId;
			if (typeof entry.customTitle === 'string') title = entry.customTitle;
			let role: unknown;
			let parts: unknown;
			let uuid: unknown;
			if (provider === 'claude-code' && (entry.type === 'user' || entry.type === 'assistant')) {
				role = entry.type;
				parts = entry.message?.content;
				uuid = entry.uuid;
			} else if (provider === 'codex') {
				if (
					entry.type === 'message' ||
					(entry.type === 'response_item' && entry.payload?.type === 'message')
				) {
					const payload = entry.type === 'message' ? entry : entry.payload;
					role = payload.role;
					parts = Array.isArray(payload.content) ? payload.content : undefined;
					uuid = entry.type === 'response_item' ? payload.id : undefined;
				} else if (entry.type === 'item.completed' && entry.item?.type === 'agent_message') {
					role = 'assistant';
					parts = entry.item.text;
					uuid = entry.item.id;
				}
			}
			if (role !== 'user' && role !== 'assistant') continue;
			let textContent =
				typeof parts === 'string'
					? parts
					: Array.isArray(parts)
						? provider === 'codex'
							? extractTextFromContent(parts)
							: parts
									.filter((part) => part && part.type === 'text')
									.map((part) => (typeof part.text === 'string' ? part.text : ''))
									.filter((text) => text.trim())
									.join(' ')
						: '';
			if (provider === 'codex' && role === 'user') {
				const rawText = textContent;
				if (!projectPath) projectPath = extractCwdFromText(rawText) ?? undefined;
				if (!hasEmbeddedSystemPrompt(rawText) && isSystemContextMessage(rawText)) continue;
				// Use the storage reader's desktop unwrapping and the renderer's prompt decoders.
				textContent = stripTurnPrompt(
					stripEmbeddedSystemPrompt(
						unwrapCodexUserReply(
							unwrapCodexImageRequest(parts as CodexMessageContent[] | undefined) ?? rawText
						)
					)
				);
			}
			if (textContent.trim())
				messages.push({
					role,
					textContent,
					...(typeof uuid === 'string' ? { uuid } : {}),
					...(typeof entry.timestamp === 'string' ? { timestamp: entry.timestamp } : {}),
				});
		} catch {
			/* Ignore incomplete native rows, as the session browser does. */
		}
	}
	return { messages, projectPath, sessionId, title };
}
