import type { ProjectHistoryConversation } from './projectHistory';

export interface NativeHistorySearchRequest {
	query: string;
	projectPath?: string;
	requestId?: string;
}
export interface NativeHistorySearchHit {
	conversation: ProjectHistoryConversation;
	matchPreview: string;
	message: { uuid?: string; timestamp?: string; role: 'user' | 'assistant'; text: string };
}
export interface NativeHistorySearchResult {
	hits: NativeHistorySearchHit[];
	truncated: boolean;
	/** A scan budget or unreadable file left coverage incomplete. */
	limited?: boolean;
	cancelled?: boolean;
	unavailable?: boolean;
}
export interface NativeHistorySearchAccount {
	provider: 'claude-code' | 'codex';
	accountDir: string;
}
