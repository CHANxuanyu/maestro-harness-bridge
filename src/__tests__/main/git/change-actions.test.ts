import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
	renameSync,
	symlinkSync,
	existsSync,
	realpathSync,
	chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyGitChange, getGitChanges, parseGitChanges } from '../../../main/git-changes';

vi.mock('../../../main/utils/logger', () => ({
	logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('single file changes in isolated repositories', { timeout: 60_000 }, () => {
	let cwd: string;
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	const write = (name: string, text = 'before\n') => writeFileSync(path.join(cwd, name), text);
	const apply = (action: 'stage' | 'unstage' | 'revert', ...paths: string[]) =>
		applyGitChange(cwd, { action, paths, confirmed: true });
	beforeEach(() => {
		cwd = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'maestro-change-actions-')));
		vi.stubEnv('GIT_CONFIG_GLOBAL', path.join(cwd, 'global-config'));
		vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
		git('init', '-b', 'main');
		git('config', 'user.name', 'Fixture');
		git('config', 'user.email', 'fixture@example.invalid');
		git('config', 'commit.gpgsign', 'false');
		git('config', 'core.autocrlf', 'false');
		write('tracked');
		write('untouched');
		git('add', '.');
		git('commit', '-m', 'baseline');
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(cwd, { recursive: true, force: true });
	});

	it.each(['space file.txt', '中文.txt', '-leading.txt', '[literal].txt', "quote'$.txt"])(
		'stages and unstages exactly the literal file %s',
		async (name) => {
			write(name);
			write('other.txt');
			write('l.txt');
			expect(await apply('stage', name)).toMatchObject({ success: true });
			expect(git('diff', '--cached', '--name-only', '-z')).toBe(name + '\0');
			expect(await apply('unstage', name)).toMatchObject({ success: true });
			expect(git('diff', '--cached', '--name-only')).toBe('');
			expect(readFileSync(path.join(cwd, name), 'utf8')).toBe('before\n');
			expect(await apply('revert', name)).toMatchObject({ success: true });
			expect(existsSync(path.join(cwd, name))).toBe(false);
			expect(readFileSync(path.join(cwd, 'l.txt'), 'utf8')).toBe('before\n');
		}
	);

	it.each(['modified', 'deleted', 'renamed', 'added', 'untracked', 'typechange'] as const)(
		'reverts %s in index and worktree without touching another file',
		async (kind) => {
			let name = 'tracked';
			if (kind === 'modified') {
				write(name, 'after\n');
				git('add', name);
				write(name, 'later\n');
			}
			if (kind === 'deleted') {
				rmSync(path.join(cwd, name));
				git('add', name);
			}
			if (kind === 'renamed') {
				name = 'renamed 中文';
				renameSync(path.join(cwd, 'tracked'), path.join(cwd, name));
				git('add', '-A');
			}
			if (kind === 'added' || kind === 'untracked') {
				name = 'new';
				write(name);
				if (kind === 'added') git('add', name);
			}
			if (kind === 'typechange') {
				rmSync(path.join(cwd, name));
				symlinkSync('untouched', path.join(cwd, name));
				git('add', name);
			}
			write('untouched', 'keep this\n');
			expect((await getGitChanges(cwd)).files.find((f) => f.path === name)?.status).toBe(kind);
			expect(await apply('revert', name)).toMatchObject({ success: true });
			expect(readFileSync(path.join(cwd, 'tracked'), 'utf8')).toBe('before\n');
			if (name !== 'tracked') expect(existsSync(path.join(cwd, name))).toBe(false);
			expect(git('status', '--porcelain')).toBe(' M untouched\n');
		}
	);

	it('unstages both sides of a rename and preserves the renamed file', async () => {
		git('mv', 'tracked', 'new name');
		expect(await apply('unstage', 'new name')).toMatchObject({ success: true });
		expect(git('diff', '--cached', '--name-only')).toBe('');
		expect(existsSync(path.join(cwd, 'tracked'))).toBe(false);
		expect(readFileSync(path.join(cwd, 'new name'), 'utf8')).toBe('before\n');
	});

	it('stages a deletion and resolves conflict only through explicit staging', async () => {
		rmSync(path.join(cwd, 'untouched'));
		expect(await apply('stage', 'untouched')).toMatchObject({ success: true });
		git('commit', '-m', 'delete');
		git('checkout', '-b', 'other');
		write('tracked', 'other\n');
		git('commit', '-am', 'other');
		git('checkout', 'main');
		write('tracked', 'main\n');
		git('commit', '-am', 'main');
		try {
			git('merge', 'other');
		} catch {
			/* Expected conflict. */
		}
		expect((await getGitChanges(cwd)).files[0]).toMatchObject({
			status: 'conflicted',
			staged: false,
		});
		expect(await apply('revert', 'tracked')).toMatchObject({
			success: false,
			error: expect.stringMatching(/conflict/i),
		});
		expect(git('ls-files', '-u')).not.toBe('');
		write('tracked', 'resolved\n');
		expect(await apply('stage', 'tracked')).toMatchObject({ success: true });
		expect(git('ls-files', '-u')).toBe('');
	});

	it('handles an unborn index and commits only staged contents', async () => {
		git('checkout', '--orphan', 'unborn');
		git('rm', '-rf', '.');
		write('new');
		expect(await apply('stage', 'new')).toMatchObject({ success: true });
		expect(await apply('unstage', 'new')).toMatchObject({ success: true });
		expect(existsSync(path.join(cwd, 'new'))).toBe(true);
		expect(await apply('stage', 'new')).toMatchObject({ success: true });
		expect(await apply('revert', 'new')).toMatchObject({ success: true });
		expect(existsSync(path.join(cwd, 'new'))).toBe(false);
		write('new');
		await apply('stage', 'new');
		write('new', 'not staged\n');
		expect(
			await applyGitChange(cwd, { action: 'commit', message: '-literal 中文 message' })
		).toMatchObject({ success: true });
		expect(git('show', 'HEAD:new')).toBe('before\n');
		expect(git('log', '-1', '--format=%s').trim()).toBe('-literal 中文 message');
		expect(git('status', '--porcelain')).toBe(' M new\n');
	});

	it('returns original hook errors and keeps the staged changes', async () => {
		write('tracked', 'after\n');
		await apply('stage', 'tracked');
		const hooks = path.join(cwd, '.git', 'hooks');
		writeFileSync(
			path.join(hooks, 'pre-commit'),
			'#!/bin/sh\necho "fixture hook failed 中文" >&2\nexit 1\n'
		);
		chmodSync(path.join(hooks, 'pre-commit'), 0o755);
		expect(await applyGitChange(cwd, { action: 'commit', message: 'blocked' })).toMatchObject({
			success: false,
			error: expect.stringContaining('fixture hook failed 中文'),
		});
		expect(git('diff', '--cached', '--name-only')).toBe('tracked\n');
	});

	it('uses the selected worktree even when called inside its subdirectory', async () => {
		const tree = path.join(cwd, 'tree');
		git('worktree', 'add', '-b', 'topic', tree);
		mkdirSync(path.join(tree, 'sub'));
		writeFileSync(path.join(tree, 'tracked'), 'worktree\n');
		write('tracked', 'main tree\n');
		expect(
			await applyGitChange(path.join(tree, 'sub'), { action: 'stage', paths: ['tracked'] })
		).toMatchObject({ success: true });
		expect(git('diff', '--cached', '--name-only')).toBe('');
		expect(
			execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: tree, encoding: 'utf8' })
		).toBe('tracked\n');
	});

	it('requires confirmation, exact changed paths and validates the whole request before writing', async () => {
		write('new');
		expect(await applyGitChange(cwd, { action: 'revert', paths: ['new'] })).toMatchObject({
			success: false,
		});
		for (const name of ['../outside', '/absolute', '.', 'missing', 'new\0bad']) {
			expect(await apply('stage', 'new', name)).toMatchObject({ success: false });
			expect(git('diff', '--cached', '--name-only')).toBe('');
		}
		expect(existsSync(path.join(cwd, 'new'))).toBe(true);
		expect(await applyGitChange(cwd, { action: 'commit', message: '  ' })).toMatchObject({
			success: false,
		});
	});

	it('rejects reverting nested repositories', async () => {
		mkdirSync(path.join(cwd, 'nested'));
		git('-C', 'nested', 'init');
		writeFileSync(path.join(cwd, 'nested', 'keep'), 'keep');
		expect(await apply('revert', 'nested/')).toMatchObject({ success: false });
		expect(existsSync(path.join(cwd, 'nested', 'keep'))).toBe(true);
	});

	it('keeps copy identity and counts staged files outside the visible slice', () => {
		const copy = '2 C. N... 100644 100644 100644 abc abc C100 copy\0tracked\0';
		expect(parseGitChanges('/root\0' + copy + '\0\0').files[0]).toMatchObject({
			status: 'copied',
			oldPath: 'tracked',
			staged: true,
		});
		const records = Array.from(
			{ length: 501 },
			(_, i) => `1 M. N... 100644 100644 100644 abc abc file${i}\0`
		).join('');
		expect(parseGitChanges('/root\0' + records + '\0\0')).toMatchObject({
			stagedCount: 501,
			truncated: true,
		});
	});
});
