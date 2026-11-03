import fs from 'fs';
import path from 'path';

/**
 * Read candidates for a local project, retaining its saved spelling as well
 * as the native process cwd. Missing or inaccessible projects keep their
 * saved path so archived history remains readable. Never use this for SSH.
 */
export function localProjectPathCandidates(projectPath: string): string[] {
	try {
		const physical = fs.realpathSync(projectPath);
		if (typeof physical === 'string' && physical !== projectPath) return [projectPath, physical];
	} catch {
		// Resolving a project must not make its existing history disappear.
	}
	return [projectPath];
}

/** Cached Git registry per distinct project cwd, shared by native adapters. */
const worktreeRegistries = new Map<
	string,
	{ expires: number; value: Promise<import('../../shared/projectHistory').NativeWorktree[]> }
>();

export async function localProjectWorktrees(
	projectPath: string
): Promise<import('../../shared/projectHistory').NativeWorktree[]> {
	const project = localProjectPathCandidates(projectPath).at(-1)!;
	let cached = worktreeRegistries.get(project);
	if (!cached || cached.expires < Date.now()) {
		const value = (async () => {
			if (!fs.existsSync(path.join(project, '.git'))) return [];
			const { execGitReadOnly } = await import('../utils/remote-git');
			const common = await execGitReadOnly(
				['rev-parse', '--path-format=absolute', '--git-common-dir'],
				project
			);
			if (common.exitCode !== 0) return [];
			const result = await execGitReadOnly(['worktree', 'list', '--porcelain', '-z'], project);
			if (result.exitCode !== 0) return [];
			const entries: import('../../shared/projectHistory').NativeWorktree[] = [];
			let entry: import('../../shared/projectHistory').NativeWorktree | undefined;
			for (const field of result.stdout.split('\0')) {
				if (field.startsWith('worktree ')) {
					entry = {
						path: field.slice(9),
						name: path.basename(field.slice(9)),
						commonDir: common.stdout.trim(),
						isMain: entries.length === 0,
					};
					entries.push(entry);
				} else if (entry && field.startsWith('branch '))
					entry.branch = field.slice(7).replace(/^refs\/heads\//, '');
			}
			return entries;
		})();
		cached = { expires: Date.now() + 30000, value };
		worktreeRegistries.delete(project);
		worktreeRegistries.set(project, cached);
		if (worktreeRegistries.size > 128)
			worktreeRegistries.delete(worktreeRegistries.keys().next().value!);
	}
	return (await cached.value).map((entry) => ({ ...entry, missing: !fs.existsSync(entry.path) }));
}

/** Confirm membership from Git's common-directory registry, never folder decoding. */
export async function localProjectWorktree(
	projectPath: string,
	cwd: string
): Promise<import('../../shared/projectHistory').NativeWorktree | undefined> {
	const paths = localProjectPathCandidates(cwd);
	return (await localProjectWorktrees(projectPath)).find((entry) => paths.includes(entry.path));
}

/** All desktop and CLI resume spawns keep the native conversation's cwd. */
export async function nativeSessionResumeCwd(
	storage: import('../agents/session-storage').AgentSessionStorage,
	projectPath: string,
	sessionId: string,
	accountDir?: string
): Promise<string | undefined> {
	const native = (await storage.listSessions(projectPath, undefined, accountDir)).find(
		(entry) => entry.sessionId === sessionId
	);
	if (!native?.projectPath) return undefined;
	const { unusableCwdReason } = await import('../process-manager/utils/spawnCwd');
	const reason = unusableCwdReason(native.projectPath);
	if (reason)
		throw new Error(`Worktree is gone or unavailable. This conversation is read-only. ${reason}`);
	return native.projectPath;
}
