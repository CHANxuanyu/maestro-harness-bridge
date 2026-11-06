import type { ProjectHistoryConversation } from './projectHistory';

export type ConversationArchiveAction = 'archive' | 'unarchive' | 'delete';
export interface ConversationArchiveTarget {
	worktree?: ProjectHistoryConversation['worktree'];
	ownerId?: string;
	provider?: string;
	nativeSessionId: string;
	projectPath?: string;
	accountDir?: string;
	sshRemoteId?: string;
	title?: string;
}
export interface ArchivedConversation extends ProjectHistoryConversation {
	permissionMode: 'full' | 'standard' | 'readonly';
	archivedAt: number;
	/** Recomputed from current account configuration, never trusted from disk. */
	ownerIds: string[];
}
export interface ConversationLifecycleRequest {
	ownerIds: string[];
	nativeSessionId: string;
	phase: 'check' | 'close';
	action: 'archive' | 'delete';
}
export interface ConversationLifecycleResult {
	error?: string;
	permissionMode?: 'full' | 'standard' | 'readonly';
	title?: string;
}
