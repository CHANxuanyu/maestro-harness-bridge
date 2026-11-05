import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	existsSync: vi.fn(() => true),
	realpathSync: vi.fn((value: string) => value),
	execGitReadOnly: vi.fn(),
}));
vi.mock('fs', () => ({ default: mocks }));
vi.mock('path', async (original) => {
	const actual = await original<typeof import('path')>();
	return { ...actual, default: actual.win32 };
});
vi.mock('../../../main/utils/remote-git', () => ({
	execGitReadOnly: mocks.execGitReadOnly,
}));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mocks.execGitReadOnly.mockImplementation(async (args: string[]) => ({
		exitCode: 0,
		stdout:
			args[0] === 'rev-parse'
				? 'C:/Projects/repo/.git\n'
				: [
						'worktree C:/Projects/repo',
						'branch refs/heads/main',
						'',
						'worktree C:/Linked/feature',
						'branch refs/heads/external-feature',
						'',
						'worktree C:/Projects/repo/.claude/worktrees/managed',
						'branch refs/heads/managed-feature',
						'',
					].join('\0'),
	}));
});

it('stores forward-slash Git registry paths in native Windows form', async () => {
	const { localProjectWorktrees } = await import('../../../main/storage/local-project-paths');
	expect(await localProjectWorktrees('C:\\Projects\\repo')).toEqual([
		{
			path: 'C:\\Projects\\repo',
			name: 'repo',
			commonDir: 'C:\\Projects\\repo\\.git',
			branch: 'main',
			isMain: true,
			missing: false,
		},
		{
			path: 'C:\\Linked\\feature',
			name: 'feature',
			commonDir: 'C:\\Projects\\repo\\.git',
			branch: 'external-feature',
			isMain: false,
			missing: false,
		},
		{
			path: 'C:\\Projects\\repo\\.claude\\worktrees\\managed',
			name: 'managed',
			commonDir: 'C:\\Projects\\repo\\.git',
			branch: 'managed-feature',
			isMain: false,
			missing: false,
		},
	]);
});

it.each(['C:\\Linked\\feature', 'c:\\Linked\\feature', 'c:/Linked/feature/'])(
	'matches an external worktree from forward-slash porcelain against %s',
	async (cwd) => {
		const { localProjectWorktree } = await import('../../../main/storage/local-project-paths');
		expect(await localProjectWorktree('C:\\Projects\\repo', cwd)).toMatchObject({
			path: 'C:\\Linked\\feature',
			branch: 'external-feature',
		});
	}
);

it('retains the registered branch for a managed child cwd with different drive case', async () => {
	const { localProjectWorktree } = await import('../../../main/storage/local-project-paths');
	expect(
		await localProjectWorktree(
			'C:\\Projects\\repo',
			'c:\\Projects\\repo\\.claude\\worktrees\\managed\\packages\\app'
		)
	).toMatchObject({
		path: 'C:\\Projects\\repo\\.claude\\worktrees\\managed',
		branch: 'managed-feature',
	});
});

it('excludes a sibling that only shares the managed worktree root prefix', async () => {
	const { localProjectWorktree } = await import('../../../main/storage/local-project-paths');
	expect(
		await localProjectWorktree(
			'C:\\Projects\\repo',
			'c:\\Projects\\repo\\.claude\\worktrees-other\\x'
		)
	).toBeUndefined();
});
