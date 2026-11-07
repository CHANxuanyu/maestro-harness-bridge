import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
	renameSync,
	realpathSync,
	symlinkSync,
	chmodSync,
	readFileSync,
	promises as fs,
} from 'node:fs';
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

// Each case spawns git a dozen times, which takes well over the default 10 s on
// the Windows runner.
describe('combined changes on a real repository', { timeout: 60_000 }, () => {
	let cwd: string;
	const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
	const shellChanges = () => {
		const result = parseGitChanges(git(...changesCommand()));
		result.root = path.normalize(result.root);
		return result;
	};
	beforeEach(() => {
		// .native, because only it expands a Windows 8.3 name like RUNNER~1, which
		// is how the temp directory arrives on the runner and not how git reports it.
		cwd = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'maestro-changes-')));
		git('init', '-b', 'main');
		git('config', 'user.email', 'fixture@example.test');
		git('config', 'user.name', 'Fixture');
		git('config', 'commit.gpgsign', 'false');
		git('config', 'core.autocrlf', 'false');
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	});
	it('reports the actual subdirectory from Git for local and remote command forms', async () => {
		mkdirSync(path.join(cwd, 'sub'));
		writeFileSync(path.join(cwd, 'sub', 'a.ts'), 'ok');
		const sub = path.join(cwd, 'sub');
		const local = await getGitChanges(sub);
		const shell = parseGitChanges(
			execFileSync('git', changesCommand(), { cwd: sub, encoding: 'utf8' })
		);
		for (const changes of [local, shell]) {
			expect(changes).toMatchObject({ executionCwd: path.join(cwd, 'sub').replace(/\\/g, '/') });
		}
	});

	it.each(['untracked', 'tracked'] as const)(
		'uses a bounded number of git processes for many %s files',
		async (kind) => {
			for (let index = 0; index < 32; index++)
				writeFileSync(path.join(cwd, `file-${index}`), 'before\n');
			if (kind === 'tracked') {
				git('add', '.');
				git('commit', '-m', 'initial');
				for (let index = 0; index < 32; index++)
					writeFileSync(path.join(cwd, `file-${index}`), 'after\n');
			}
			const trace = path.join(cwd, '.git', 'changes-trace.jsonl');
			vi.stubEnv('GIT_TRACE2_EVENT', trace);
			const result = await getGitChanges(cwd);
			expect(result.totals.files).toBe(32);
			const starts = readFileSync(trace, 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line))
				.filter((event) => event.event === 'start');
			// Count real child invocations instead of depending on runner speed.
			expect(starts.length).toBeLessThanOrEqual(12);
		}
	);

	it('bounds concurrent asynchronous file reads and closes every handle', async () => {
		for (let index = 0; index < 40; index++)
			writeFileSync(path.join(cwd, `file-${index}`), 'line\n'.repeat(20000));
		const open = fs.open.bind(fs);
		let active = 0;
		let peak = 0;
		vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
			const handle = await open(...args);
			peak = Math.max(peak, ++active);
			const close = handle.close.bind(handle);
			vi.spyOn(handle, 'close').mockImplementation(async () => {
				try {
					await close();
				} finally {
					active--;
				}
			});
			return handle;
		});
		expect((await getGitChanges(cwd)).totals.additions).toBe(800000);
		expect(peak).toBeGreaterThan(1);
		expect(peak).toBeLessThanOrEqual(16);
		expect(active).toBe(0);
	});

	it.each(['open', 'read'] as const)(
		'keeps unknown counts when an asynchronous %s fails',
		async (operation) => {
			writeFileSync(path.join(cwd, 'file'), 'line\n');
			const open = fs.open.bind(fs);
			const failure = new Error('unreadable file');
			let closed = false;
			vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
				if (operation === 'open') throw failure;
				const handle = await open(...args);
				vi.spyOn(handle, 'read').mockRejectedValueOnce(failure);
				const close = handle.close.bind(handle);
				vi.spyOn(handle, 'close').mockImplementation(async () => {
					await close();
					closed = true;
				});
				return handle;
			});
			expect((await getGitChanges(cwd)).files).toEqual([
				{ path: 'file', status: 'untracked', staged: false, additions: null, deletions: null },
			]);
			if (operation === 'read') expect(closed).toBe(true);
		}
	);

	it('matches shell counts for empty, unterminated, binary-prefix and size-boundary files', async () => {
		const contents = {
			empty: '',
			terminated: 'one\ntwo\n',
			unterminated: 'one\ntwo',
			crlf: 'one\r\ntwo\r\n',
			'chunk-boundary': 'x'.repeat(65535) + '\nlast',
			"quote'file": 'last line',
			binary: Buffer.from([0, 10, 1]),
			'prefix-nul': 'x'.repeat(7999) + '\0\n',
			'late-nul': 'x'.repeat(8000) + '\0\nlast',
			'limit-exact': 'x'.repeat(1024 * 1024),
			'limit-over': 'x'.repeat(1024 * 1024 + 1),
		};
		for (const [file, content] of Object.entries(contents))
			writeFileSync(path.join(cwd, file), content);
		const result = await getGitChanges(cwd);
		expect(result).toEqual(shellChanges());
		expect(Object.fromEntries(result.files.map((file) => [file.path, file.additions]))).toEqual({
			empty: 0,
			terminated: 2,
			unterminated: 2,
			crlf: 2,
			'chunk-boundary': 2,
			"quote'file": 1,
			binary: null,
			'prefix-nul': null,
			'late-nul': 2,
			'limit-exact': 1,
			'limit-over': null,
		});
	});

	it('matches shell size overrides for tracked additions, modifications, renames and deletions', async () => {
		writeFileSync(path.join(cwd, '.gitattributes'), '* diff\n');
		for (const file of ['shrunk', 'deleted', 'renamed'])
			writeFileSync(path.join(cwd, file), file[0].repeat(1024 * 1024 + 1));
		writeFileSync(path.join(cwd, 'grown'), 'small\n');
		git('add', '.');
		git('commit', '-m', 'initial');
		writeFileSync(path.join(cwd, 'shrunk'), 'small\n');
		writeFileSync(path.join(cwd, 'grown'), 'x'.repeat(1024 * 1024 + 1));
		writeFileSync(path.join(cwd, 'added'), 'y'.repeat(3 * 1024 * 1024 + 1));
		git('mv', 'renamed', "new'file");
		git('rm', 'deleted');
		git('add', 'added');
		const result = await getGitChanges(cwd);
		expect(result).toEqual(shellChanges());
		expect(result.files.map((file) => file.path)).toEqual([
			'added',
			'deleted',
			'grown',
			"new'file",
			'shrunk',
		]);
		for (const file of result.files) {
			expect(file.additions).toBeNull();
			expect(file.deletions).toBeNull();
		}
	});

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
		expect(result).toEqual(shellChanges());
		expect(result).toMatchObject({
			root: cwd,
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
		expect(result.root).toBe(cwd);
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
			staged: false,
		});
		git('merge', '--abort');
		git('checkout', '--detach');
		expect((await getGitChanges(cwd)).branch).toBeNull();
	});

	it('marks a non-repository and rejects invalid diff paths', async () => {
		rmSync(path.join(cwd, '.git'), {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
		expect(await getGitChanges(cwd)).toMatchObject({ notARepo: true });
		await expect(getGitChangeDiff(cwd, '../escape')).rejects.toThrow('relative');
	});

	it.each(['snapshot', 'diff'] as const)(
		'tolerates an untracked nested repository in a %s',
		async (read) => {
			writeFileSync(path.join(cwd, 'normal'), 'base\n');
			git('add', 'normal');
			git('commit', '-m', 'initial');
			mkdirSync(path.join(cwd, 'inner'));
			git('-C', 'inner', 'init');
			writeFileSync(path.join(cwd, 'inner/f'), 'nested\n');
			writeFileSync(path.join(cwd, 'top'), 'top\n');
			if (read === 'diff') {
				expect(await getGitChangeDiff(cwd, 'inner/')).toEqual({
					diff: '',
					binary: false,
					tooLarge: false,
				});
			} else {
				expect((await getGitChanges(cwd)).files).toEqual([
					{ path: 'inner/', status: 'untracked', staged: false, additions: null, deletions: null },
					{ path: 'top', status: 'untracked', staged: false, additions: 1, deletions: 0 },
				]);
			}
		}
	);

	// POSIX permissions and file symlinks require a native POSIX filesystem.
	describe.skipIf(process.platform === 'win32')('odd untracked filesystem entries', () => {
		it('preserves newlines, tabs and quotes in tracked and untracked names', async () => {
			const tracked = 'tracked\n\t"quote\'';
			const untracked = 'untracked\n\t"quote\'';
			writeFileSync(path.join(cwd, tracked), 'x'.repeat(1024 * 1024 + 1));
			git('add', '.');
			git('commit', '-m', 'initial');
			writeFileSync(path.join(cwd, tracked), 'small\n');
			writeFileSync(path.join(cwd, untracked), 'first\nlast');
			const result = await getGitChanges(cwd);
			expect(result).toEqual(shellChanges());
			expect(result.files.map((file) => [file.path, file.additions])).toEqual([
				[tracked, null],
				[untracked, 2],
			]);
		});

		it.each(['dangling', 'symlink', 'unreadable'] as const)(
			'keeps a %s entry in the snapshot',
			async (kind) => {
				writeFileSync(path.join(cwd, 'normal'), 'base\n');
				git('add', 'normal');
				git('commit', '-m', 'initial');
				const file = path.join(cwd, 'odd');
				if (kind === 'unreadable') {
					writeFileSync(file, 'secret\n');
					chmodSync(file, 0);
				} else symlinkSync(kind === 'dangling' ? 'missing' : 'normal', file);
				writeFileSync(path.join(cwd, 'top'), 'top\n');
				const result = await getGitChanges(cwd);
				expect(result).toEqual(shellChanges());
				expect(result.files).toEqual([
					{ path: 'odd', status: 'untracked', staged: false, additions: null, deletions: null },
					{ path: 'top', status: 'untracked', staged: false, additions: 1, deletions: 0 },
				]);
			}
		);

		it.each(['dangling', 'symlink', 'unreadable'] as const)(
			'returns an empty diff for a %s entry',
			async (kind) => {
				writeFileSync(path.join(cwd, 'normal'), 'base\n');
				git('add', 'normal');
				git('commit', '-m', 'initial');
				const file = path.join(cwd, 'odd');
				if (kind === 'unreadable') {
					writeFileSync(file, 'secret\n');
					chmodSync(file, 0);
				} else symlinkSync(kind === 'dangling' ? 'missing' : 'normal', file);
				expect(await getGitChangeDiff(cwd, 'odd')).toEqual({
					diff: '',
					binary: false,
					tooLarge: false,
				});
			}
		);

		it('preserves normal counts beside several odd entries in the same snapshot', async () => {
			writeFileSync(path.join(cwd, 'normal'), 'base\n');
			git('add', 'normal');
			git('commit', '-m', 'initial');
			writeFileSync(path.join(cwd, 'normal'), 'changed\nsecond\n');
			mkdirSync(path.join(cwd, 'inner'));
			git('-C', 'inner', 'init');
			writeFileSync(path.join(cwd, 'inner/f'), 'nested\n');
			symlinkSync('missing', path.join(cwd, 'dangling'));
			symlinkSync('normal', path.join(cwd, 'link'));
			writeFileSync(path.join(cwd, 'unreadable'), 'secret\n');
			chmodSync(path.join(cwd, 'unreadable'), 0);
			writeFileSync(path.join(cwd, 'top'), 'top\n');
			const snapshot = await getGitChanges(cwd);
			expect(snapshot.files).toEqual([
				{ path: 'dangling', status: 'untracked', staged: false, additions: null, deletions: null },
				{ path: 'inner/', status: 'untracked', staged: false, additions: null, deletions: null },
				{ path: 'link', status: 'untracked', staged: false, additions: null, deletions: null },
				{ path: 'normal', status: 'modified', staged: false, additions: 2, deletions: 1 },
				{ path: 'top', status: 'untracked', staged: false, additions: 1, deletions: 0 },
				{
					path: 'unreadable',
					status: 'untracked',
					staged: false,
					additions: null,
					deletions: null,
				},
			]);
			expect(snapshot.totals).toEqual({ files: 6, additions: 3, deletions: 1 });
			expect((await getGitChangeDiff(cwd, 'normal')).diff).toContain('+second');
		});
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

	it('preserves the root spelling and normalizes file separators independently of the host', () => {
		const result = parseGitChanges(
			'C:\\repo\0# branch.head main\0' +
				'2 R. N... 100644 100644 100644 abc def R100 dir\\new\0dir\\old\0\0' +
				'0\t0\t\0dir\\old\0dir\\new\0\0'
		);
		expect(result.root).toBe('C:\\repo');
		expect(result.files[0]).toMatchObject({ path: 'dir/new', oldPath: 'dir/old' });
	});
});
