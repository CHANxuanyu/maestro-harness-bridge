import path from 'path';
import fs from 'fs/promises';
import type { AgentSessionStorage } from '../agents/session-storage';
import type { SshRemoteConfig } from '../../shared/types';
import type {
	ProjectHistoryScope,
	ProjectHistoryResult,
	ProjectHistoryConversation,
} from '../../shared/projectHistory';
import { getProviderProfileConfig } from '../../shared/providerProfiles';

interface HistoryOwner {
	id?: string;
	toolType?: string;
	projectRoot?: string;
	cwd?: string;
	sshRemoteId?: string;
	sessionSshRemoteConfig?: { enabled?: boolean; remoteId?: string };
	aiTabs?: Array<{
		agentSessionId?: string | null;
		name?: string | null;
		starred?: boolean;
		hidden?: boolean;
	}>;
}
interface Origin {
	origin?: 'user' | 'auto';
	sessionName?: string;
	starred?: boolean;
}
export interface ProjectHistoryDependencies {
	archivedKeys?: ReadonlySet<string>;
	archivedOnly?: boolean;
	storages: AgentSessionStorage[];
	owners: HistoryOwner[];
	accountDirs: (provider: string) => Promise<string[]>;
	ownerAccountDir: (ownerId: string) => string | undefined;
	remote: (id: string) => SshRemoteConfig | undefined;
	origins?: Record<string, Record<string, Record<string, Origin>>>;
	/** Exact built-in utility prompts are implementation details, not conversations. */
	internalPromptPrefixes?: string[];
	onError: (error: unknown, provider: string) => void;
	/** Injected in tests; account aliases pointing at one transcript pool dedupe. */
	realpath?: (directory: string) => Promise<string>;
}

function normalize(directory: string, remote?: string): string {
	return remote ? path.posix.normalize(directory) : path.resolve(directory);
}
function ownerHost(owner: HistoryOwner): string | undefined {
	return owner.sessionSshRemoteConfig?.enabled
		? owner.sessionSshRemoteConfig.remoteId || owner.sshRemoteId
		: undefined;
}
function timestamp(value: string): number {
	const number = Date.parse(value);
	return Number.isFinite(number) ? number : 0;
}
function cleanTitle(value: string): string {
	return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Canonical transcript pool shared by discovery and Maestro archive identity. */
export async function nativeHistoryPool(
	provider: string,
	directory?: string,
	remote?: string,
	realpath: (directory: string) => Promise<string> = fs.realpath
): Promise<string> {
	if (!directory) return 'default';
	if (remote) return path.posix.normalize(directory);
	const subdir = getProviderProfileConfig(provider)?.sessionsSubdir;
	return realpath(subdir ? path.join(directory, subdir) : directory).catch(() =>
		path.resolve(directory)
	);
}

/** Read metadata through native adapters, never launch a model or copy its transcript. */
export async function discoverProjectHistory(
	scopes: ProjectHistoryScope[],
	deps: ProjectHistoryDependencies
): Promise<ProjectHistoryResult> {
	if (
		!Array.isArray(scopes) ||
		scopes.some(
			(scope) =>
				!scope ||
				typeof scope.projectKey !== 'string' ||
				!scope.projectKey ||
				typeof scope.projectPath !== 'string' ||
				!scope.projectPath ||
				!Array.isArray(scope.ownerIds) ||
				scope.ownerIds.some((id) => typeof id !== 'string') ||
				(scope.sshRemoteId !== undefined && typeof scope.sshRemoteId !== 'string')
		)
	)
		throw new Error('Invalid project history scope');
	const result: ProjectHistoryResult = { conversations: [], errors: [] };
	const owners = new Map(deps.owners.map((owner) => [owner.id, owner]));
	const rows = new Map<string, ProjectHistoryConversation>();
	const poolPromises = new Map<string, Promise<string>>();
	const poolKey = (
		provider: string,
		directory: string | undefined,
		remote?: string
	): Promise<string> => {
		const key = JSON.stringify([provider, remote, directory]);
		let pending = poolPromises.get(key);
		if (!pending) {
			pending = nativeHistoryPool(provider, directory, remote, deps.realpath);
			poolPromises.set(key, pending);
		}
		return pending;
	};
	// Prefer the most specific configured project when adapters include descendants.
	const orderedScopes = [...scopes].sort((a, b) => b.projectPath.length - a.projectPath.length);
	// Sequential per adapter: its on-disk metadata cache is shared across account roots.
	for (const storage of deps.storages) {
		const provider = storage.agentId;
		const profile = getProviderProfileConfig(provider);
		let localDirs: Array<string | undefined> | undefined;
		const reads = new Map<string, Awaited<ReturnType<AgentSessionStorage['listSessions']>>>();
		for (const scope of orderedScopes) {
			try {
				const remote = scope.sshRemoteId ? deps.remote(scope.sshRemoteId) : undefined;
				if (scope.sshRemoteId && (!remote || !remote.enabled)) {
					throw new Error('SSH remote is unavailable; local history was not substituted.');
				}
				if (remote && (provider === 'claude-code' || provider === 'codex'))
					result.errors.push({
						projectKey: scope.projectKey,
						provider,
						message:
							'Worktree history expansion is unavailable over SSH. Only project-path history is listed.',
					});
				const projectPath = normalize(scope.projectPath, scope.sshRemoteId);
				const candidates = scope.ownerIds
					.map((id) => owners.get(id))
					.filter(
						(owner): owner is HistoryOwner =>
							!!owner && owner.toolType === provider && ownerHost(owner) === scope.sshRemoteId
					);
				let directories: Array<string | undefined>;
				if (remote) {
					// Never use this Mac's accounts for an SSH project.
					directories = [
						...new Set([undefined, ...candidates.map((owner) => deps.ownerAccountDir(owner.id!))]),
					];
				} else {
					localDirs ??= profile ? await deps.accountDirs(provider) : [undefined];
					directories = localDirs;
				}
				for (const accountDir of directories) {
					try {
						const pool = await poolKey(provider, accountDir, scope.sshRemoteId);
						const readKey = JSON.stringify([scope.sshRemoteId, projectPath, pool]);
						let sessions = reads.get(readKey);
						if (!sessions) {
							sessions = await storage.listSessions(projectPath, remote, accountDir);
							reads.set(readKey, sessions);
						}
						for (const native of sessions) {
							if (!native.sessionId || !native.messageCount) continue;
							if (
								deps.internalPromptPrefixes?.some(
									(prefix) =>
										prefix.length >= 80 && native.firstUserMessage?.trim().startsWith(prefix)
								)
							)
								continue;
							const nativePath = normalize(native.projectPath || projectPath, scope.sshRemoteId);
							const exactScope = orderedScopes.find(
								(candidate) =>
									candidate.sshRemoteId === scope.sshRemoteId &&
									normalize(candidate.projectPath, candidate.sshRemoteId) === nativePath
							);
							const mainScope =
								!scope.sshRemoteId && native.worktree?.commonDir
									? orderedScopes.find(
											(candidate) =>
												!candidate.sshRemoteId &&
												normalize(candidate.projectPath) ===
													path.dirname(native.worktree!.commonDir!)
										)
									: undefined;
							const owningScope = exactScope || mainScope;
							if (owningScope && owningScope.projectKey !== scope.projectKey) continue;
							const origin =
								deps.origins?.[provider]?.[nativePath]?.[native.sessionId] ||
								deps.origins?.[provider]?.[projectPath]?.[native.sessionId];
							if ((origin?.origin || native.origin) === 'auto') continue;
							const key = JSON.stringify([
								provider,
								scope.sshRemoteId || 'local',
								pool,
								native.sessionId,
							]);
							if (rows.has(key)) continue;
							if (deps.archivedOnly ? !deps.archivedKeys?.has(key) : deps.archivedKeys?.has(key))
								continue;
							let compatible: HistoryOwner | undefined;
							const compatibleOwners = deps.owners
								.filter(
									(owner) => owner.toolType === provider && ownerHost(owner) === scope.sshRemoteId
								)
								.sort(
									(a, b) =>
										Number(normalize(b.cwd || '', scope.sshRemoteId) === nativePath) -
										Number(normalize(a.cwd || '', scope.sshRemoteId) === nativePath)
								);
							for (const owner of compatibleOwners) {
								if (
									normalize(owner.cwd || owner.projectRoot || '', scope.sshRemoteId) !==
										nativePath &&
									!(
										native.worktree &&
										normalize(owner.projectRoot || owner.cwd || '', scope.sshRemoteId) ===
											projectPath
									)
								)
									continue;
								if (
									(await poolKey(
										provider,
										profile ? deps.ownerAccountDir(owner.id!) : undefined,
										scope.sshRemoteId
									)) === pool
								) {
									compatible = owner;
									if (normalize(owner.cwd || '', scope.sshRemoteId) === nativePath) break;
									if (
										owner.aiTabs?.some(
											(tab) => !tab.hidden && tab.agentSessionId === native.sessionId
										)
									)
										break;
								}
							}
							const open = compatible?.aiTabs?.find(
								(tab) => !tab.hidden && tab.agentSessionId === native.sessionId
							);
							const title = cleanTitle(
								open?.name ||
									origin?.sessionName ||
									native.sessionName ||
									native.firstUserMessage ||
									native.firstMessage ||
									''
							);
							rows.set(key, {
								key,
								projectKey: scope.projectKey,
								projectPath: nativePath,
								worktree: native.worktree,
								provider,
								nativeSessionId: native.sessionId,
								title: title || native.sessionId.slice(0, 8),
								nativeTitle:
									cleanTitle(native.nativeTitle || native.sessionName || '') || undefined,
								preview: native.firstMessage || '',
								createdAt: timestamp(native.timestamp),
								modifiedAt: timestamp(native.modifiedAt),
								messageCount: native.messageCount,
								starred: open?.starred ?? origin?.starred ?? native.starred ?? false,
								ownerId: compatible?.id,
								accountDir,
								accountEnvVar: profile?.envVar,
								sshRemoteId: scope.sshRemoteId,
							});
						}
					} catch (error) {
						deps.onError(error, provider);
						result.errors.push({
							projectKey: scope.projectKey,
							provider,
							message: error instanceof Error ? error.message : String(error),
						});
					}
				}
			} catch (error) {
				deps.onError(error, provider);
				result.errors.push({
					projectKey: scope.projectKey,
					provider,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}
	result.conversations = [...rows.values()].sort(
		(a, b) => b.modifiedAt - a.modifiedAt || a.key.localeCompare(b.key)
	);
	return result;
}
