/** Native conversations visible under the user's existing project groups. */
export interface ProjectHistoryScope {
	projectKey: string;
	projectPath: string;
	sshRemoteId?: string;
	/** Existing Maestro runners are hints, never a required user selection. */
	ownerIds: string[];
}

export interface ProjectHistoryConversation {
	/** Provider + host + transcript pool + native ID, independent of open tabs. */
	key: string;
	projectKey: string;
	projectPath: string;
	provider: string;
	nativeSessionId: string;
	title: string;
	/** Provider-native title, retained as a search alias when display names differ. */
	nativeTitle?: string;
	preview: string;
	createdAt: number;
	modifiedAt: number;
	messageCount: number;
	starred: boolean;
	/** A compatible existing runner, when one exists. */
	ownerId?: string;
	/** Preserve the account that owns this transcript when creating a runner. */
	accountDir?: string;
	accountEnvVar?: string;
	sshRemoteId?: string;
}

export interface ProjectHistoryError {
	projectKey: string;
	provider: string;
	message: string;
}

export interface ProjectHistoryResult {
	conversations: ProjectHistoryConversation[];
	errors: ProjectHistoryError[];
}
