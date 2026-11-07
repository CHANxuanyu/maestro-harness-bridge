/**
 * Codex session metadata structure (first line of JSONL)
 * Format: { type: 'session_meta', payload: { id, cwd, timestamp, ... } }
 */
export interface CodexSessionMetadata {
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

export function extractCwdFromText(text: string): string | null {
	const match = text.match(/<cwd>([^<]+)<\/cwd>/i);
	return match ? match[1].trim() : null;
}

/** Accept the current header and the legacy top-level header. */
export function codexSessionMetadata(
	entry: CodexSessionMetadata | null | undefined
): CodexSessionMetadata | null {
	return entry &&
		((entry.type === 'session_meta' && entry.payload) || (entry.id && entry.timestamp))
		? entry
		: null;
}

/** The native index is append-only; the last complete name for an ID wins. */
export function parseCodexSessionTitles(index: string): Map<string, string> {
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
	return titles;
}
