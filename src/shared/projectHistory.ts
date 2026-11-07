import { getParentDir } from './formatters';
import { isPathAtOrUnderRoot, normalizeWorktreePath } from './worktreePaths';

/** A native conversation's recorded Git worktree. */
export interface NativeWorktree {
	path: string;
	name?: string;
	branch?: string;
	commonDir?: string;
	isMain?: boolean;
	missing?: boolean;
}

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
	worktree?: NativeWorktree;
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

/** Shared project membership for discovery, archive display and permission inheritance. */
export function projectHistoryScopeFor(
	scopes: readonly ProjectHistoryScope[],
	record: Pick<ProjectHistoryConversation, 'projectPath' | 'sshRemoteId' | 'worktree'> & {
		projectKey?: string;
	}
): ProjectHistoryScope | undefined {
	const remote = !!record.sshRemoteId;
	const nativePath = normalizeWorktreePath(record.projectPath, remote);
	const candidates = scopes
		.filter((scope) => scope.sshRemoteId === record.sshRemoteId)
		.map((scope) => ({ scope, path: normalizeWorktreePath(scope.projectPath, remote) }))
		.sort((a, b) => b.path.length - a.path.length);
	const exact = candidates.find((candidate) => candidate.path === nativePath);
	const mainPath =
		!remote && record.worktree?.commonDir
			? normalizeWorktreePath(getParentDir(record.worktree.commonDir))
			: undefined;
	return (
		exact?.scope ??
		candidates.find((candidate) => candidate.path === mainPath)?.scope ??
		candidates.find((candidate) => isPathAtOrUnderRoot(nativePath, candidate.path))?.scope ??
		// Native adapters can recognize local aliases that the renderer cannot resolve.
		candidates.find((candidate) => candidate.scope.projectKey === record.projectKey)?.scope
	);
}
