import * as fs from 'fs/promises';
import path from 'path';
import { normalizeWorktreePath, isPathAtOrUnderRoot } from '../../shared/worktreePaths';
import type { CheckHost } from '../../shared/checkRun';
import { execFileNoThrow } from '../utils/execFile';
import { atomicWriteJson, createKeyedWriteQueue } from '../utils/atomic-json-store';

export interface TeamWorkspaceOptions {
	/** Exclusive app-owned directory for this team's worktrees and manifest. */
	root: string;
	projectRoot: string;
	slug: string;
	pushAuthorized: boolean;
	/** Remote implementation can implement the same interface later. Never falls back locally. */
	host?: CheckHost;
}

export interface TeamWorkspaceState {
	dev: string;
	qa: string;
	pm: string;
	branch: string;
	qaRevision: string;
	devGitFile: string;
	qaGitFile: string;
}

export interface TeamWorkspaces {
	initialize(): Promise<TeamWorkspaceState>;
	advanceQa(revision: string): Promise<void>;
	enforceQaBoundary(): Promise<string[]>;
	commitDevWork(message: string): Promise<string>;
	pushDevWork(remote?: string): Promise<boolean>;
}

const writes = createKeyedWriteQueue();

/** Local implementation. Every destructive operation is confined to owned seat trees. */
export function createTeamWorkspaces(options: TeamWorkspaceOptions): TeamWorkspaces {
	if (options.host?.kind === 'ssh') throw new Error('SSH team workspaces are not implemented');
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.slug))
		throw new Error('Invalid team branch slug');
	const root = path.resolve(options.root);
	const manifest = path.join(root, 'workspaces.json');
	let state: TeamWorkspaceState | undefined;
	const git = async (cwd: string, args: string[]) => {
		// A launch from a Git hook can inherit GIT_DIR or GIT_INDEX_FILE and
		// redirect even a cwd-scoped command into an unrelated repository.
		const env = Object.fromEntries(
			Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
		);
		const result = await execFileNoThrow(
			'git',
			['--literal-pathspecs', '-c', 'core.filemode=true', '-c', 'core.fsmonitor=false', ...args],
			cwd,
			{ env }
		);
		if (result.exitCode !== 0)
			throw new Error(`git ${args[0]}: ${result.stderr || result.exitCode}`);
		return result.stdout;
	};
	const assertOwned = async (seat: 'dev' | 'qa') => {
		if (!state) throw new Error('Initialize team workspaces first');
		const target = state[seat];
		const realRoot = await fs.realpath(root);
		const realTarget = await fs.realpath(target);
		if (
			normalizeWorktreePath(realRoot) !== normalizeWorktreePath(root) ||
			normalizeWorktreePath(realTarget) !== normalizeWorktreePath(path.join(root, seat)) ||
			!isPathAtOrUnderRoot(normalizeWorktreePath(realTarget), normalizeWorktreePath(realRoot))
		)
			throw new Error('Refusing a workspace outside the app-owned directory');
		const gitFile = path.join(target, '.git');
		if (
			!(await fs.lstat(gitFile)).isFile() ||
			(await fs.readFile(gitFile, 'utf8')) !== state[`${seat}GitFile`]
		)
			throw new Error('Workspace Git identity changed');
		return target;
	};
	const qaAllowed = (name: string) => name.startsWith('qa/');
	const safePath = (cwd: string, name: string) => {
		const absolute = path.resolve(cwd, name);
		if (
			name === '.git' ||
			name.startsWith('.git/') ||
			path.isAbsolute(name) ||
			!isPathAtOrUnderRoot(normalizeWorktreePath(absolute), normalizeWorktreePath(cwd)) ||
			absolute === cwd
		)
			throw new Error('Unsafe workspace path');
		return absolute;
	};
	const boundary = async (): Promise<string[]> => {
		const qa = await assertOwned('qa');
		const base = state!.qaRevision;
		const changed = (
			await git(qa, [
				'diff',
				'--no-ext-diff',
				'--no-textconv',
				'--no-renames',
				'--name-only',
				'-z',
				base,
				'--',
			])
		)
			.split('\0')
			.filter(Boolean);
		// Includes ignored files: .gitignore cannot authorize QA to write elsewhere.
		const others = (await git(qa, ['ls-files', '--others', '-z'])).split('\0').filter(Boolean);
		const violations = new Set([...changed, ...others].filter((name) => !qaAllowed(name)));
		const qaDir = await fs.lstat(path.join(qa, 'qa')).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== 'ENOENT') throw error;
			return undefined;
		});
		if (qaDir && !qaDir.isDirectory()) violations.add('qa');
		// A parent replaced with a symlink is a violation in its own right. Do
		// not follow it while deleting/restoring a tracked descendant.
		for (const name of [...violations]) {
			const parts = name.split('/');
			for (let i = 1; i < parts.length; i++) {
				const parent = parts.slice(0, i).join('/');
				const stat = await fs.lstat(safePath(qa, parent)).catch((error: NodeJS.ErrnoException) => {
					if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
					return undefined;
				});
				if (stat?.isSymbolicLink()) {
					violations.add(parent);
					break;
				}
			}
		}
		const names = [...violations].sort();
		const roots = names.filter(
			(name) => !names.some((other) => other !== name && name.startsWith(`${other}/`))
		);
		for (const name of roots) {
			await fs.rm(safePath(qa, name), { force: true, recursive: true });
			const tracked = await git(qa, ['ls-tree', '-r', '--name-only', '-z', base, '--', name]);
			// Remove unauthorized additions from the index as well as the tree.
			await git(qa, ['rm', '-r', '--cached', '--ignore-unmatch', '-f', '--', name]);
			if (tracked)
				await git(qa, ['restore', '--source', base, '--staged', '--worktree', '--', name]);
		}
		return names;
	};
	return {
		initialize: () =>
			writes.enqueue(root, async () => {
				if (state) return structuredClone(state);
				try {
					state = JSON.parse(await fs.readFile(manifest, 'utf8')) as TeamWorkspaceState;
					if (
						state.branch !== `team/${options.slug}` ||
						state.dev !== path.join(root, 'dev') ||
						state.qa !== path.join(root, 'qa') ||
						!/^[a-f0-9]{40,64}$/.test(state.qaRevision)
					)
						throw new Error('Invalid workspace manifest');
					await assertOwned('dev');
					await assertOwned('qa');
					return structuredClone(state);
				} catch (error) {
					state = undefined;
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				}
				await fs.mkdir(root, { recursive: true });
				if (normalizeWorktreePath(await fs.realpath(root)) !== normalizeWorktreePath(root))
					throw new Error('Workspace root must be a physical path');
				const branch = `team/${options.slug}`;
				const dev = path.join(root, 'dev');
				const qa = path.join(root, 'qa');
				const revision = (
					await git(options.projectRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
				).trim();
				// No --force: an existing directory or branch is never taken over.
				await git(options.projectRoot, ['worktree', 'add', '-b', branch, dev, revision]);
				await git(options.projectRoot, ['worktree', 'add', '--detach', qa, revision]);
				state = {
					dev,
					qa,
					pm: dev,
					branch,
					qaRevision: revision,
					devGitFile: await fs.readFile(path.join(dev, '.git'), 'utf8'),
					qaGitFile: await fs.readFile(path.join(qa, '.git'), 'utf8'),
				};
				await atomicWriteJson(manifest, state);
				return structuredClone(state);
			}),
		enforceQaBoundary: () => writes.enqueue(root, boundary),
		advanceQa: (revision) =>
			writes.enqueue(root, async () => {
				const qa = await assertOwned('qa');
				if (!/^[a-f0-9]{40,64}$/.test(revision))
					throw new Error('QA requires a submitted commit id');
				const resolved = (await git(qa, ['rev-parse', '--verify', `${revision}^{commit}`])).trim();
				await boundary();
				const backup = path.join(root, 'qa-preserved');
				// Refuse to overwrite a previous interrupted advance's preserved tests.
				if (
					await fs.lstat(backup).then(
						() => true,
						(error: NodeJS.ErrnoException) => {
							if (error.code !== 'ENOENT') throw error;
							return false;
						}
					)
				)
					throw new Error('An interrupted QA advance needs recovery from qa-preserved');
				let preserved = false;
				try {
					await fs.rename(path.join(qa, 'qa'), backup);
					preserved = true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				}
				try {
					// Detach first, so a branch QA may have checked out is never reset.
					await git(qa, ['checkout', '--detach', '--force', resolved]);
					const next = { ...state!, qaRevision: resolved };
					await atomicWriteJson(manifest, next);
					state = next;
				} finally {
					if (preserved) {
						await fs.rm(path.join(qa, 'qa'), { recursive: true, force: true });
						await fs.rename(backup, path.join(qa, 'qa'));
					}
				}
			}),
		commitDevWork: (message) =>
			writes.enqueue(root, async () => {
				if (!options.pushAuthorized)
					throw new Error('Committing requires the team push authorization');
				const dev = await assertOwned('dev');
				if ((await git(dev, ['symbolic-ref', '--short', 'HEAD'])).trim() !== state!.branch)
					throw new Error('Dev is no longer on the team task branch');
				await git(dev, ['add', '--all', '--', '.']);
				if ((await git(dev, ['diff', '--cached', '--name-only', '-z'])).length)
					await git(dev, ['commit', '-m', message]);
				return (await git(dev, ['rev-parse', 'HEAD'])).trim();
			}),
		pushDevWork: (remote = 'origin') =>
			writes.enqueue(root, async () => {
				if (!options.pushAuthorized) return false;
				const dev = await assertOwned('dev');
				if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(remote))
					throw new Error('Invalid Git remote name');
				await git(dev, ['push', remote, `refs/heads/${state!.branch}:refs/heads/${state!.branch}`]);
				return true;
			}),
	};
}
