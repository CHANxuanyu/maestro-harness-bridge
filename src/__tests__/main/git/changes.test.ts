import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	getGitChanges,
	getGitChangeDiff,
	parseGitChanges,
	changesCommand,
} from '../../../main/git-changes';

vi.mock('../../../main/utils/logger', () => ({
	logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('combined changes on a real repository', () => {
	let cwd: string;
	const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
	beforeEach(() => {
		cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'maestro-changes-')));
		git('init', '-b', 'main');
		git('config', 'user.email', 'fixture@example.test');
		git('config', 'user.name', 'Fixture');
		git('config', 'commit.gpgsign', 'false');
		git('config', 'core.autocrlf', 'false');
	});
	afterEach(() => rmSync(cwd, { recursive: true, force: true }));

	it('combines index and worktree against HEAD, preserving renames and unusual untracked names', async () => {
		writeFileSync(path.join(cwd, 'a'), 'one\ntwo\n');
		writeFileSync(path.join(cwd, 'old'), 'renamed\n');
		git('add', '.');
		git('commit', '-m', 'initial');
		writeFileSync(path.join(cwd, 'a'), 'one\nstaged\n');
		git('add', 'a');
		writeFileSync(path.join(cwd, 'a'), 'one\nstaged\nworking\n');
		renameSync(path.join(cwd, 'old'), path.join(cwd, 'new'));
		git('add', '-A');
		const unusual = "space quote'file";
		writeFileSync(path.join(cwd, unusual), 'last line');
		const result = await getGitChanges(cwd);
		expect(result).toMatchObject({
			root: cwd.replace(/\\/g, '/'),
			branch: 'main',
			truncated: false,
			totals: { files: 3, additions: 3, deletions: 1 },
		});
		expect(result.files).toContainEqual({
			path: 'new',
			oldPath: 'old',
			status: 'renamed',
			staged: true,
			additions: 0,
			deletions: 0,
		});
		expect(result.files.find((file) => file.path === unusual)).toMatchObject({
			status: 'untracked',
			additions: 1,
			deletions: 0,
		});
		expect((await getGitChangeDiff(cwd, 'new')).diff).toContain('rename from old');
		expect((await getGitChangeDiff(cwd, unusual)).diff).toContain('+last line');
	});

	it('supports unborn HEAD, binaries, large files, subdirectories and complete truncated totals', async () => {
		writeFileSync(path.join(cwd, 'staged'), 'new\n');
		git('add', 'staged');
		writeFileSync(path.join(cwd, 'binary'), Buffer.from([0, 1, 2]));
		writeFileSync(path.join(cwd, 'large'), 'x'.repeat(1024 * 1024 + 1));
		mkdirSync(path.join(cwd, 'sub'));
		for (let index = 0; index < 501; index++)
			writeFileSync(path.join(cwd, `sub/${index}`), 'line\n');
		const result = await getGitChanges(path.join(cwd, 'sub'));
		expect(result.root).toBe(cwd.replace(/\\/g, '/'));
		expect(result.files).toHaveLength(500);
		expect(result).toMatchObject({
			truncated: true,
			totals: { files: 504, additions: 502, deletions: 0 },
		});
		expect(result.files.find((file) => file.path === 'binary')?.additions).toBeNull();
		expect(result.files.find((file) => file.path === 'large')?.additions).toBeNull();
		expect(await getGitChangeDiff(cwd, 'binary')).toMatchObject({ binary: true, diff: '' });
		expect(await getGitChangeDiff(cwd, 'large')).toMatchObject({ tooLarge: true, diff: '' });
	});

	it('counts large tracked files as null even with text attributes, and detects oversized patches', async () => {
		writeFileSync(path.join(cwd, '.gitattributes'), '* diff\n');
		writeFileSync(path.join(cwd, 'large'), 'base\n');
		writeFileSync(path.join(cwd, 'patch'), 'x'.repeat(600000) + '\n');
		git('add', '.');
		git('commit', '-m', 'initial');
		writeFileSync(path.join(cwd, 'large'), 'x'.repeat(1024 * 1024 + 1));
		writeFileSync(path.join(cwd, 'patch'), 'y'.repeat(600000) + '\n');
		expect(
			(await getGitChanges(cwd)).files.find((file) => file.path === 'large')?.additions
		).toBeNull();
		expect(await getGitChangeDiff(cwd, 'patch')).toMatchObject({ tooLarge: true, diff: '' });
	});

	it('returns staged deletions and net staged plus unstaged counts, including a clean diff', async () => {
		writeFileSync(path.join(cwd, 'deleted'), 'gone\n');
		writeFileSync(path.join(cwd, 'mixed'), 'base\n');
		git('add', '.');
		git('commit', '-m', 'initial');
		expect(await getGitChangeDiff(cwd, 'mixed')).toEqual({
			diff: '',
			binary: false,
			tooLarge: false,
		});
		git('rm', 'deleted');
		writeFileSync(path.join(cwd, 'mixed'), 'stage\n');
		git('add', 'mixed');
		writeFileSync(path.join(cwd, 'mixed'), 'work\ntwo\n');
		expect((await getGitChanges(cwd)).files.find((file) => file.path === 'mixed')).toMatchObject({
			staged: true,
			additions: 2,
			deletions: 1,
		});
		expect((await getGitChangeDiff(cwd, 'deleted')).diff).toContain('-gone');
	});

	it('reports conflicts and a detached branch', async () => {
		writeFileSync(path.join(cwd, 'conflict'), 'base\n');
		git('add', '.');
		git('commit', '-m', 'base');
		git('checkout', '-b', 'other');
		writeFileSync(path.join(cwd, 'conflict'), 'other\n');
		git('commit', '-am', 'other');
		git('checkout', 'main');
		writeFileSync(path.join(cwd, 'conflict'), 'main\n');
		git('commit', '-am', 'main');
		try {
			git('merge', 'other');
		} catch {
			/* The fixture deliberately conflicts. */
		}
		expect((await getGitChanges(cwd)).files[0]).toMatchObject({
			status: 'conflicted',
			staged: true,
		});
		git('merge', '--abort');
		git('checkout', '--detach');
		expect((await getGitChanges(cwd)).branch).toBeNull();
	});

	it('marks a non-repository and rejects invalid diff paths', async () => {
		rmSync(path.join(cwd, '.git'), { recursive: true });
		expect(await getGitChanges(cwd)).toMatchObject({ notARepo: true });
		await expect(getGitChangeDiff(cwd, '../escape')).rejects.toThrow('relative');
	});
});

describe('remote wire command and parser', () => {
	it('uses one git alias command with NUL records and no interpolated cwd', () => {
		const args = changesCommand();
		expect(args.at(-1)).toBe('maestro-changes');
		expect(args.join(' ')).toContain('status --porcelain=v2 -z');
		expect(args.join(' ')).toContain('diff');
		expect(args.join(' ')).toContain('--numstat -z');
	});

	it('normalizes Windows-style paths independently of the host platform', () => {
		const result = parseGitChanges(
			'C:\\repo\0# branch.head main\0' +
				'2 R. N... 100644 100644 100644 abc def R100 dir\\new\0dir\\old\0\0' +
				'0\t0\t\0dir\\old\0dir\\new\0\0'
		);
		expect(result.root).toBe('C:/repo');
		expect(result.files[0]).toMatchObject({ path: 'dir/new', oldPath: 'dir/old' });
	});
});
