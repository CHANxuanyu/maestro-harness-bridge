import * as fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { normalizeWorktreePath, isPathAtOrUnderRoot } from '../../shared/worktreePaths';
import { DURATION_MS } from '../../shared/duration';
import { resolveGhPath, getExpandedEnv } from '../utils/cliDetection';
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
	baseRevision?: string;
	devGitFile: string;
	qaGitFile: string;
}

export interface TeamWorkspaces {
	initialize(): Promise<TeamWorkspaceState>;
	advanceQa(revision: string): Promise<void>;
	enforceQaBoundary(): Promise<string[]>;
	commitDevWork(message: string): Promise<string>;
	pushDevWork(remote?: string): Promise<boolean>;
	createDraftPr(title: string, body: string): Promise<string>;
	inspect(
		seat?: 'dev' | 'qa'
	): Promise<{ revision: string; status: string; recentCommits: string }>;
	/** Content identity against the initial revision, including untracked files. */
	diffHash(): Promise<string>;
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
	const destination = async () => {
		const current = (await git(options.projectRoot, ['branch', '--show-current'])).trim();
		const config = async (key: string) =>
			(
				await execFileNoThrow('git', ['config', '--get', key], options.projectRoot, {
					env: Object.fromEntries(
						Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
					),
				})
			).stdout.trim();
		const remotes = (await git(options.projectRoot, ['remote'])).trim().split('\n').filter(Boolean);
		const remote =
			(await config(`branch.${current}.pushRemote`)) ||
			(await config('remote.pushDefault')) ||
			(await config(`branch.${current}.remote`)) ||
			(remotes.length === 1 ? remotes[0] : '');
		if (!remote || remote === '.' || !remotes.includes(remote))
			throw new Error(
				'Configure an unambiguous project push remote before publishing the task branch'
			);
		const url = (await git(options.projectRoot, ['remote', 'get-url', '--push', remote])).trim();
		const base = (await config(`branch.${current}.merge`)).replace(/^refs\/heads\//, '') || current;
		return { remote, url, base };
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
					baseRevision: revision,
					devGitFile: await fs.readFile(path.join(dev, '.git'), 'utf8'),
					qaGitFile: await fs.readFile(path.join(qa, '.git'), 'utf8'),
				};
				await atomicWriteJson(manifest, state);
				return structuredClone(state);
			}),
		diffHash: () =>
			writes.enqueue(root, async () => {
				const dev = await assertOwned('dev');
				const hash = createHash('sha256');
				const changed = (
					await git(dev, [
						'diff',
						'--name-only',
						'-z',
						'--no-renames',
						'--no-ext-diff',
						'--no-textconv',
						state!.baseRevision ?? state!.qaRevision,
						'--',
					])
				).split('\0');
				const untracked = (
					await git(dev, ['ls-files', '--others', '--exclude-standard', '-z'])
				).split('\0');
				const names = [...new Set([...changed, ...untracked].filter(Boolean))].sort();
				// Hash the same representation before and after a new file is staged or committed.
				// A patch for tracked files plus raw untracked bytes would change without an edit.
				for (const name of names) {
					const file = safePath(dev, name);
					const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
						if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
						return undefined;
					});
					const content = createHash('sha256');
					if (!stat) content.update('deleted');
					else if (stat.isSymbolicLink()) content.update(await fs.readlink(file));
					else if (stat.isDirectory())
						content.update(await git(file, ['rev-parse', '--verify', 'HEAD']));
					else {
						const handle = await fs.open(file);
						try {
							for await (const chunk of handle.createReadStream()) content.update(chunk);
						} finally {
							await handle.close();
						}
					}
					hash.update(
						JSON.stringify([name, stat ? stat.mode & 0o170111 : 0, content.digest('hex')])
					);
				}
				return hash.digest('hex');
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
		inspect: (seat = 'dev') =>
			writes.enqueue(root, async () => {
				const dev = await assertOwned(seat);
				return {
					revision: (await git(dev, ['rev-parse', 'HEAD'])).trim(),
					status: await git(dev, ['status', '--porcelain']),
					recentCommits: await git(dev, ['log', '-5', '--format=%H %s']),
				};
			}),
		createDraftPr: (title, body) =>
			writes.enqueue(root, async () => {
				if (!options.pushAuthorized)
					throw new Error('Draft PR publication requires task branch authorization');
				const dev = await assertOwned('dev');
				const { url, base } = await destination();
				const gh = await resolveGhPath();
				const env = getExpandedEnv();
				const run = async (args: string[], input?: string) => {
					const result = await execFileNoThrow(gh, args, dev, {
						env,
						input,
						timeout: 60 * DURATION_MS.second,
					});
					if (result.exitCode !== 0)
						throw new Error(`GitHub CLI: ${result.stderr || result.exitCode}`);
					return result.stdout.trim();
				};
				await run(['--version']);
				await run(['auth', 'status']);
				// Query before creating: a restart after an external success must not create another PR.
				const existing = JSON.parse(
					await run([
						'pr',
						'list',
						'--repo',
						url,
						'--head',
						state!.branch,
						'--state',
						'open',
						'--json',
						'url,isDraft',
					])
				);
				if (existing.length) {
					if (!existing[0].isDraft)
						throw new Error('The task branch already has a non-draft PR; owner review required');
					return existing[0].url as string;
				}
				return run(
					[
						'pr',
						'create',
						'--draft',
						'--repo',
						url,
						'--head',
						state!.branch,
						'--base',
						base,
						'--title',
						title,
						'--body-file',
						'-',
					],
					body
				);
			}),
		pushDevWork: (remote) =>
			writes.enqueue(root, async () => {
				if (!options.pushAuthorized) return false;
				const dev = await assertOwned('dev');
				remote ??= (await destination()).remote;
				if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(remote))
					throw new Error('Invalid Git remote name');
				await git(dev, ['push', remote, `refs/heads/${state!.branch}:refs/heads/${state!.branch}`]);
				return true;
			}),
	};
}
