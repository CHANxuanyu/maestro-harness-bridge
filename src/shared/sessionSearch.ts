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
	for (const line of content.split('\n')) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line);
			const cwd =
				provider === 'codex'
					? entry.type === 'session_meta'
						? entry.payload?.cwd
						: undefined
					: entry.cwd;
			if (!projectPath && typeof cwd === 'string') projectPath = cwd;
			if (entry.type === 'session_meta' && typeof entry.payload?.id === 'string')
				sessionId = entry.payload.id;
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
					uuid = payload.id;
				} else if (entry.type === 'item.completed' && entry.item?.type === 'agent_message') {
					role = 'assistant';
					parts = entry.item.text;
					uuid = entry.item.id;
				}
			}
			if (role !== 'user' && role !== 'assistant') continue;
			const textContent =
				typeof parts === 'string'
					? parts
					: Array.isArray(parts)
						? parts
								.filter(
									(part) =>
										part &&
										(part.type === 'text' ||
											(provider === 'codex' &&
												(part.type === 'input_text' || part.type === 'output_text')))
								)
								.map((part) => (typeof part.text === 'string' ? part.text : ''))
								.filter((text) => text.trim())
								.join(' ')
						: '';
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
