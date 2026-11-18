import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
	createTeamWorkspaces,
	type TeamWorkspaces,
	type TeamWorkspaceState,
} from '../../../main/team/workspaces';
import { execFileNoThrow } from '../../../main/utils/execFile';
import * as execTools from '../../../main/utils/execFile';
vi.mock('../../../main/utils/cliDetection', () => ({
	resolveGhPath: async () => 'synthetic-gh',
	getExpandedEnv: () => ({ ...process.env }),
}));

describe('team workspaces', () => {
	let root: string;
	let project: string;
	let owned: string;
	let workspaces: TeamWorkspaces;
	let state: TeamWorkspaceState;
	const git = async (cwd: string, ...args: string[]) => {
		const result = await execFileNoThrow('git', args, cwd);
		if (result.exitCode !== 0) throw new Error(result.stderr);
		return result.stdout.trim();
	};
	beforeEach(async () => {
		root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'team-workspaces-')));
		project = path.join(root, 'project');
		owned = path.join(root, 'owned');
		await fs.mkdir(project);
		await git(project, 'init');
		await git(project, 'config', 'user.name', 'Fixture');
		await git(project, 'config', 'user.email', 'fixture@example.invalid');
		await git(project, 'config', 'commit.gpgsign', 'false');
		await git(project, 'config', 'core.hooksPath', path.join(root, 'no-hooks'));
		await fs.mkdir(path.join(project, 'src'));
		await fs.writeFile(path.join(project, 'src/code.txt'), 'original\n');
		await fs.writeFile(path.join(project, 'deleted.txt'), 'keep\n');
		await fs.writeFile(path.join(project, 'mode.txt'), 'mode\n');
		await fs.writeFile(path.join(project, '.gitignore'), 'ignored*\n');
		await git(project, 'add', '.');
		await git(project, 'commit', '-m', 'Initial');
		workspaces = createTeamWorkspaces({
			root: owned,
			projectRoot: project,
			slug: 'task',
			pushAuthorized: true,
		});
		state = await workspaces.initialize();
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(root, { recursive: true, force: true });
	});

	it('isolates dev and QA at current HEAD, with PM sharing the dev read location', async () => {
		expect(state.pm).toBe(state.dev);
		expect(state.dev).not.toBe(state.qa);
		expect(await git(state.dev, 'branch', '--show-current')).toBe('team/task');
		expect(await git(state.qa, 'branch', '--show-current')).toBe('');
		await fs.writeFile(path.join(state.dev, 'src/code.txt'), 'unfinished');
		expect(await fs.readFile(path.join(state.qa, 'src/code.txt'), 'utf8')).toBe('original\n');
		expect(await fs.readFile(path.join(project, 'src/code.txt'), 'utf8')).toBe('original\n');
		const reopened = createTeamWorkspaces({
			root: owned,
			projectRoot: project,
			slug: 'task',
			pushAuthorized: true,
		});
		expect(await reopened.initialize()).toEqual(state);
	});

	it('restores tracked, staged, untracked, ignored, deleted, renamed and mode changes outside qa/', async () => {
		await fs.mkdir(path.join(state.qa, 'qa'));
		await fs.writeFile(path.join(state.qa, 'qa/test.txt'), 'QA evidence');
		await fs.writeFile(path.join(state.qa, 'src/code.txt'), 'bad');
		await fs.rm(path.join(state.qa, 'deleted.txt'));
		await fs.rename(path.join(state.qa, 'mode.txt'), path.join(state.qa, 'renamed.txt'));
		await fs.writeFile(path.join(state.qa, 'ignored-output'), 'not allowed');
		await fs.writeFile(path.join(state.qa, 'new file\nwith newline'), 'not allowed');
		await git(state.qa, 'add', '-A');
		const restored = await workspaces.enforceQaBoundary();
		expect(restored).toEqual(
			expect.arrayContaining([
				'src/code.txt',
				'deleted.txt',
				'mode.txt',
				'renamed.txt',
				'ignored-output',
				'new file\nwith newline',
			])
		);
		expect(await fs.readFile(path.join(state.qa, 'src/code.txt'), 'utf8')).toBe('original\n');
		expect(await fs.readFile(path.join(state.qa, 'deleted.txt'), 'utf8')).toBe('keep\n');
		expect(await fs.readFile(path.join(state.qa, 'qa/test.txt'), 'utf8')).toBe('QA evidence');
		expect(await workspaces.enforceQaBoundary()).toEqual([]);
		if (process.platform !== 'win32') {
			await fs.chmod(path.join(state.qa, 'mode.txt'), 0o755);
			expect(await workspaces.enforceQaBoundary()).toContain('mode.txt');
			expect((await fs.stat(path.join(state.qa, 'mode.txt'))).mode & 0o111).toBe(0);
		}
	});

	it.skipIf(process.platform === 'win32')(
		'restores symlinks without traversing their targets',
		async () => {
			const outside = path.join(root, 'outside');
			await fs.mkdir(outside);
			await fs.writeFile(path.join(outside, 'code.txt'), 'must survive');
			await fs.rm(path.join(state.qa, 'src'), { recursive: true });
			await fs.symlink(outside, path.join(state.qa, 'src'));
			await fs.symlink(outside, path.join(state.qa, 'untracked-link'));
			const restored = await workspaces.enforceQaBoundary();
			expect(restored).toEqual(expect.arrayContaining(['src', 'untracked-link']));
			expect(await fs.readFile(path.join(outside, 'code.txt'), 'utf8')).toBe('must survive');
			expect((await fs.lstat(path.join(state.qa, 'src'))).isDirectory()).toBe(true);
			expect(await fs.readFile(path.join(state.qa, 'src/code.txt'), 'utf8')).toBe('original\n');
		}
	);

	it('compares to the submitted revision even when QA commits a violation', async () => {
		await fs.writeFile(path.join(state.qa, 'src/code.txt'), 'committed violation');
		await git(state.qa, 'add', '.');
		await git(state.qa, 'commit', '-m', 'Unauthorized');
		expect(await workspaces.enforceQaBoundary()).toContain('src/code.txt');
		expect(await fs.readFile(path.join(state.qa, 'src/code.txt'), 'utf8')).toBe('original\n');
	});

	it('commits dev work and advances QA while preserving its tests, symlinks and deletions', async () => {
		await fs.mkdir(path.join(state.qa, 'qa'));
		await fs.writeFile(path.join(state.qa, 'qa/test.txt'), 'independent evidence');
		await fs.writeFile(path.join(state.dev, 'src/code.txt'), 'submitted\n');
		const revision = await workspaces.commitDevWork('Submit dev work');
		expect(revision).not.toBe(state.qaRevision);
		await workspaces.advanceQa(revision);
		expect(await git(state.qa, 'rev-parse', 'HEAD')).toBe(revision);
		expect(await git(state.qa, 'branch', '--show-current')).toBe('');
		expect(await fs.readFile(path.join(state.qa, 'qa/test.txt'), 'utf8')).toBe(
			'independent evidence'
		);
		expect(await fs.readFile(path.join(state.qa, 'src/code.txt'), 'utf8')).toBe('submitted\n');
		expect(await fs.readFile(path.join(project, 'src/code.txt'), 'utf8')).toBe('original\n');
		expect(await workspaces.enforceQaBoundary()).toEqual([]);
	});

	it('enforces authorization and rejects remote or replaced workspaces', async () => {
		const denied = createTeamWorkspaces({
			root: owned,
			projectRoot: project,
			slug: 'task',
			pushAuthorized: false,
		});
		await denied.initialize();
		await expect(denied.commitDevWork('No')).rejects.toThrow('authorization');
		expect(await denied.pushDevWork()).toBe(false);
		expect(() =>
			createTeamWorkspaces({
				root: owned,
				projectRoot: project,
				slug: 'task',
				pushAuthorized: true,
				host: { kind: 'ssh', remoteId: 'remote' },
			})
		).toThrow('SSH');
		await fs.writeFile(path.join(state.qa, '.git'), `gitdir: ${path.join(project, '.git')}\n`);
		await expect(workspaces.enforceQaBoundary()).rejects.toThrow('Git identity changed');
		expect(await fs.readFile(path.join(project, 'src/code.txt'), 'utf8')).toBe('original\n');
	});

	it('pushes the task branch to the selected project remote, preserving its base branch', async () => {
		const remote = path.join(root, 'remote.git');
		await git(root, 'init', '--bare', remote);
		await git(project, 'remote', 'add', 'fork', remote);
		await git(project, 'remote', 'add', 'upstream', path.join(root, 'unused.git'));
		const base = await git(project, 'branch', '--show-current');
		await git(project, 'config', `branch.${base}.pushRemote`, 'fork');
		await fs.writeFile(path.join(state.dev, 'src/code.txt'), 'Published task');
		const revision = await workspaces.commitDevWork('Authorized task result');
		expect(await workspaces.pushDevWork()).toBe(true);
		expect(await git(remote, 'rev-parse', 'refs/heads/team/task')).toBe(revision);
		expect(await git(project, 'rev-parse', 'HEAD')).toBe(state.baseRevision);
		expect(await workspaces.inspect()).toMatchObject({ revision, status: '' });
	});

	it.each(['create', 'existing', 'missing', 'login'] as const)(
		'draft PR %s uses gh against the project remote with a body on stdin',
		async (mode) => {
			await git(project, 'remote', 'add', 'fork', 'https://github.example/synthetic/project.git');
			const realExec = execTools.execFileNoThrow;
			const calls: Array<{ args: string[]; input?: string }> = [];
			vi.spyOn(execTools, 'execFileNoThrow').mockImplementation(
				async (file, args, cwd, options) => {
					if (file !== 'synthetic-gh') return realExec(file, args, cwd, options);
					calls.push({ args: [...args], input: options?.input });
					const failed = mode === 'missing' || (mode === 'login' && args[0] === 'auth');
					return {
						exitCode: failed ? 1 : 0,
						stderr: failed
							? mode === 'missing'
								? 'spawn gh ENOENT'
								: 'not logged in to github.example'
							: '',
						stdout:
							args[0] === 'pr' && args[1] === 'list'
								? JSON.stringify(
										mode === 'existing'
											? [{ url: 'https://github.example/synthetic/project/pull/1', isDraft: true }]
											: []
									)
								: 'https://github.example/synthetic/project/pull/1',
					};
				}
			);
			if (mode === 'missing' || mode === 'login') {
				await expect(workspaces.createDraftPr('Task result', 'Line one\nLine two')).rejects.toThrow(
					mode === 'missing' ? 'ENOENT' : 'logged in'
				);
				expect(calls.some((c) => c.args[1] === 'create')).toBe(false);
			} else {
				expect(await workspaces.createDraftPr('Task result', 'Line one\nLine two')).toContain(
					'/pull/1'
				);
				const create = calls.find((c) => c.args[1] === 'create');
				if (mode === 'existing') expect(create).toBeUndefined();
				else
					expect(create).toEqual({
						args: [
							'pr',
							'create',
							'--draft',
							'--repo',
							'https://github.example/synthetic/project.git',
							'--head',
							'team/task',
							'--base',
							await git(project, 'branch', '--show-current'),
							'--title',
							'Task result',
							'--body-file',
							'-',
						],
						input: 'Line one\nLine two',
					});
			}
			expect(calls.some((c) => c.args.includes('merge'))).toBe(false);
		}
	);

	it('fingerprints actual content across staging and commits, including untracked files', async () => {
		const initial = await workspaces.diffHash();
		await fs.writeFile(path.join(state.dev, 'src/code.txt'), 'changed');
		const changed = await workspaces.diffHash();
		expect(changed).not.toBe(initial);
		await git(state.dev, 'add', '.');
		expect(await workspaces.diffHash()).toBe(changed);
		await workspaces.commitDevWork('Submitted');
		expect(await workspaces.diffHash()).toBe(changed);
		await fs.writeFile(path.join(state.dev, 'new.txt'), 'new observation');
		const added = await workspaces.diffHash();
		expect(added).not.toBe(changed);
		await git(state.dev, 'add', '.');
		expect(await workspaces.diffHash()).toBe(added);
		await workspaces.commitDevWork('Add evidence');
		expect(await workspaces.diffHash()).toBe(added);
		await fs.rm(path.join(state.dev, 'src/code.txt'));
		const deleted = await workspaces.diffHash();
		expect(deleted).not.toBe(added);
		await workspaces.commitDevWork('Remove code');
		expect(await workspaces.diffHash()).toBe(deleted);
	});
});
