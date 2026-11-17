import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
	createTeamWorkspaces,
	type TeamWorkspaces,
	type TeamWorkspaceState,
} from '../../../main/team/workspaces';
import { execFileNoThrow } from '../../../main/utils/execFile';

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
});
