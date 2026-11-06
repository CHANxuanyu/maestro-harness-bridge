import { useSettingsStore } from '../../../renderer/stores/settingsStore';
/**
 * Tests for ChangesPanel - the new shell's view of what a conversation's
 * working directory changed against HEAD, and its entry to a review.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChangesPanel } from '../../../renderer/components/ChangesPanel';
import { useModalStore } from '../../../renderer/stores/modalStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import * as turnGrouping from '../../../shared/gitChangeTurns';
import type { GitChangedFile, GitChanges } from '../../../shared/gitChanges';
import type { Session } from '../../../renderer/types';
import { createMockAITab, createMockSession } from '../../helpers';
import { mockTheme } from '../../helpers/mockTheme';

const changes = vi.fn();
const changeDiff = vi.fn();

const twoFiles: GitChanges = {
	root: '/project',
	branch: 'main',
	files: [
		{ path: 'src/app.ts', status: 'modified', staged: false, additions: 3, deletions: 1 },
		{
			path: '.claude/worktrees/wt/',
			status: 'untracked',
			staged: false,
			additions: null,
			deletions: null,
		},
	],
	totals: { files: 2, additions: 3, deletions: 1 },
	truncated: false,
};

const clean: GitChanges = {
	root: '/project',
	branch: 'main',
	files: [],
	totals: { files: 0, additions: 0, deletions: 0 },
	truncated: false,
};

const patch = [
	'diff --git a/src/app.ts b/src/app.ts',
	'index 1111111..2222222 100644',
	'--- a/src/app.ts',
	'+++ b/src/app.ts',
	'@@ -1,2 +1,4 @@',
	' keep',
	'-old line',
	'+new line one',
	'+new line two',
	'+new line three',
	'',
].join('\n');

function session(overrides: Partial<Session> = {}): Session {
	return createMockSession({
		id: 'agent-1',
		cwd: '/project',
		aiTabs: [
			createMockAITab({
				id: 'tab-1',
				logs: [{ id: 'u', timestamp: 1, source: 'user', text: 'Fix the app' }],
			}),
		],
		activeTabId: 'tab-1',
		...overrides,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(window.maestro.git, { changes, changeDiff });
	useModalStore.getState().closeModal('aiHandoff');
});

describe('ChangesPanel', () => {
	it('reuses the tool index while Git and commit input change', async () => {
		useSettingsStore.setState({ newShell: true });
		const collect = vi.spyOn(turnGrouping, 'collectTurnWrites');
		const source = session();
		changes.mockResolvedValue(twoFiles);
		const { unmount } = render(<ChangesPanel theme={mockTheme} session={source} />);
		try {
			await screen.findByText('app.ts');
			const reads = collect.mock.calls.length;
			fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), {
				target: { value: 'Draft' },
			});
			fireEvent.click(screen.getByRole('button', { name: 'Refresh changes' }));
			await waitFor(() => expect(changes).toHaveBeenCalledTimes(2));
			expect(collect).toHaveBeenCalledTimes(reads);
		} finally {
			unmount();
			collect.mockRestore();
			useSettingsStore.setState({ newShell: false });
		}
	});
	it.each(['en', 'zh-CN'] as const)(
		'uses localized grouping controls and guidance in %s',
		async (locale) => {
			useSettingsStore.setState({ newShell: true, uiLanguage: locale });
			const source = session();
			source.aiTabs[0].newShellPanel = { tab: 'changes', changesView: 'turn' };
			changes.mockResolvedValue(twoFiles);
			const { unmount } = render(<ChangesPanel theme={mockTheme} session={source} />);
			try {
				expect(
					screen.getByRole('radio', { name: locale === 'en' ? 'By turn' : '按回合' })
				).toHaveAttribute('aria-checked', 'true');
				expect(
					await screen.findByText(
						locale === 'en'
							? 'No recorded file writes in this conversation. Switch to By file to see workspace changes.'
							: '这条对话还没有文件写入记录。切回“按文件”可查看工作区改动。'
					)
				).toBeInTheDocument();
			} finally {
				unmount();
				useSettingsStore.setState({ newShell: false, uiLanguage: 'en' });
			}
		}
	);
	it('remembers the turn view on this conversation and shows current diffs under each recorded turn', async () => {
		useSettingsStore.setState({ newShell: true });
		const source = session();
		source.aiTabs[0].logs.push(
			{
				id: 't1',
				timestamp: 2,
				source: 'tool',
				text: 'Edit',
				metadata: {
					toolState: { status: 'completed', input: { file_path: '/project/src/app.ts' } },
				},
			},
			{ id: 'u2', timestamp: 3, source: 'user', text: 'Polish the app\nDetails' },
			{
				id: 't2',
				timestamp: 4,
				source: 'tool',
				text: 'Write',
				metadata: { toolState: { status: 'completed', input: { file_path: 'src/app.ts' } } },
			}
		);
		useSessionStore.setState({ sessions: [source], activeSessionId: source.id });
		changes.mockResolvedValue(twoFiles);
		changeDiff.mockResolvedValue({ diff: patch, binary: false, tooLarge: false });
		const { rerender } = render(<ChangesPanel theme={mockTheme} session={source} />);
		await screen.findByText('app.ts');
		expect(screen.getByRole('radio', { name: 'By file' })).toHaveAttribute('aria-checked', 'true');
		fireEvent.click(screen.getByRole('radio', { name: 'By turn' }));
		const updated = useSessionStore.getState().sessions[0];
		expect(updated.aiTabs[0].newShellPanel?.changesView).toBe('turn');
		rerender(<ChangesPanel theme={mockTheme} session={updated} />);
		expect(screen.getAllByTestId('changes-group-title').map((el) => el.textContent)).toEqual([
			expect.stringContaining('Polish the app'),
			expect.stringContaining('Fix the app'),
			'Other changes',
		]);
		expect(screen.getAllByText('app.ts')).toHaveLength(2);
		expect(
			screen.getByText('Each file shows its current diff, not a diff for that turn.')
		).toBeInTheDocument();
		fireEvent.click(screen.getAllByRole('button', { name: 'Diff src/app.ts' })[0]);
		await screen.findAllByText('new line two');
		expect(changeDiff).toHaveBeenCalledWith('/project', 'src/app.ts', undefined, undefined);
		useSettingsStore.setState({ newShell: false });
	});

	it('explains missing write records and gates the view behind newShell', async () => {
		useSettingsStore.setState({ newShell: true });
		const source = session();
		source.aiTabs[0].newShellPanel = { tab: 'changes', changesView: 'turn' };
		changes.mockResolvedValue(twoFiles);
		const { rerender } = render(<ChangesPanel theme={mockTheme} session={source} />);
		expect(
			await screen.findByText(
				'No recorded file writes in this conversation. Switch to By file to see workspace changes.'
			)
		).toBeInTheDocument();
		useSettingsStore.setState({ newShell: false });
		rerender(<ChangesPanel theme={mockTheme} session={source} />);
		expect(screen.queryByRole('radio', { name: 'By turn' })).not.toBeInTheDocument();
		expect(await screen.findByText('app.ts')).toBeInTheDocument();
	});
	it.each([false, true])(
		'opens the file name while preserving diff disclosure, new shell %s',
		async (newShell) => {
			useSettingsStore.setState({ newShell });
			changes.mockResolvedValue(twoFiles);
			changeDiff.mockResolvedValue({ diff: patch, binary: false, tooLarge: false });
			const onFileClick = vi.fn();
			render(<ChangesPanel theme={mockTheme} session={session()} onFileClick={onFileClick} />);
			fireEvent.click(await screen.findByText('app.ts'));
			if (newShell) {
				expect(onFileClick).toHaveBeenCalledWith('/project/src/app.ts');
				expect(changeDiff).not.toHaveBeenCalled();
				fireEvent.click(screen.getByRole('button', { name: 'Diff src/app.ts' }));
			}
			expect(await screen.findByText('new line two')).toBeInTheDocument();
			useSettingsStore.setState({ newShell: false });
		}
	);

	it('lists each change with its status and counts, and the totals', async () => {
		changes.mockResolvedValue(twoFiles);
		render(<ChangesPanel theme={mockTheme} session={session()} />);

		expect(await screen.findByText('app.ts')).toBeInTheDocument();
		expect(screen.getByText('src/')).toBeInTheDocument();
		expect(screen.getByLabelText('Modified')).toHaveTextContent('M');
		expect(screen.getByLabelText('Untracked')).toHaveTextContent('U');
		// A nested repository has no line counts; it says so instead of showing zeros.
		expect(screen.getByText('no line count')).toBeInTheDocument();
		expect(screen.getByTestId('changes-summary')).toHaveTextContent('2 files changed +3 -1');
		expect(changes).toHaveBeenCalledWith('/project', undefined, undefined);
	});

	it('loads a file diff on demand and renders its lines', async () => {
		changes.mockResolvedValue(twoFiles);
		changeDiff.mockResolvedValue({ diff: patch, binary: false, tooLarge: false });
		render(<ChangesPanel theme={mockTheme} session={session()} />);

		const row = await screen.findByRole('button', { name: /app\.ts/ });
		expect(row).toHaveAttribute('aria-expanded', 'false');
		fireEvent.click(row);
		expect(await screen.findByText('new line two')).toBeInTheDocument();
		expect(changeDiff).toHaveBeenCalledWith('/project', 'src/app.ts', undefined, undefined);
		expect(row).toHaveAttribute('aria-expanded', 'true');

		fireEvent.click(row);
		expect(screen.queryByText('new line two')).not.toBeInTheDocument();
	});

	it('says why a file has no diff instead of showing an empty box', async () => {
		changes.mockResolvedValue(twoFiles);
		changeDiff.mockResolvedValue({ diff: '', binary: false, tooLarge: true });
		render(<ChangesPanel theme={mockTheme} session={session()} />);

		fireEvent.click(await screen.findByRole('button', { name: /app\.ts/ }));
		expect(await screen.findByText(/over 1 MiB/)).toBeInTheDocument();
	});

	it('opens the review dialog for the conversation on screen', async () => {
		changes.mockResolvedValue(twoFiles);
		render(<ChangesPanel theme={mockTheme} session={session()} />);

		const review = await screen.findByTestId('changes-review');
		await waitFor(() => expect(review).toBeEnabled());
		fireEvent.click(review);
		expect(useModalStore.getState().modals.get('aiHandoff')).toMatchObject({
			open: true,
			data: { sessionId: 'agent-1', tabId: 'tab-1', mode: 'review' },
		});
	});

	it('offers no review when there is nothing to review', async () => {
		changes.mockResolvedValue(clean);
		render(<ChangesPanel theme={mockTheme} session={session()} />);

		expect(await screen.findByText('No changes against the last commit.')).toBeInTheDocument();
		expect(screen.getByTestId('changes-review')).toBeDisabled();
	});

	it('refreshes when the turn ends', async () => {
		changes.mockResolvedValue(clean);
		const { rerender } = render(
			<ChangesPanel theme={mockTheme} session={session({ state: 'busy' })} />
		);
		await waitFor(() => expect(changes).toHaveBeenCalledTimes(1));

		changes.mockResolvedValue(twoFiles);
		rerender(<ChangesPanel theme={mockTheme} session={session({ state: 'idle' })} />);
		expect(await screen.findByText('app.ts')).toBeInTheDocument();
		expect(changes).toHaveBeenCalledTimes(2);
	});

	it('keeps the last list when git times out', async () => {
		changes.mockResolvedValue(twoFiles);
		render(<ChangesPanel theme={mockTheme} session={session()} />);
		expect(await screen.findByText('app.ts')).toBeInTheDocument();

		changes.mockResolvedValue({ ...clean, timedOut: true });
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Refresh changes' }));
		});
		await waitFor(() => expect(changes).toHaveBeenCalledTimes(2));
		expect(screen.getByText('app.ts')).toBeInTheDocument();
	});

	it('reads an SSH agent through its remote', async () => {
		changes.mockResolvedValue(clean);
		render(
			<ChangesPanel
				theme={mockTheme}
				session={session({
					cwd: '/srv/app',
					sessionSshRemoteConfig: { enabled: true, remoteId: 'remote-1' },
				})}
			/>
		);
		await waitFor(() => expect(changes).toHaveBeenCalledWith('/srv/app', 'remote-1', undefined));
	});

	it('says when the folder is not a repository', async () => {
		changes.mockResolvedValue({ ...clean, notARepo: true });
		render(<ChangesPanel theme={mockTheme} session={session()} />);
		expect(await screen.findByText('This folder is not a git repository.')).toBeInTheDocument();
	});
});

describe('new shell single file actions', () => {
	const applyChange = vi.fn();
	it.each(['file', 'turn'] as const)(
		'uses identical stage, unstage, revert and commit actions in the %s view',
		async (changesView) => {
			const source = session();
			source.aiTabs[0].newShellPanel = { tab: 'changes', changesView };
			source.aiTabs[0].logs.push({
				id: 'write',
				source: 'tool',
				timestamp: 2,
				text: 'Edit',
				metadata: { toolState: { status: 'completed', input: { file_path: 'src/app.ts' } } },
			});
			changes.mockResolvedValue(twoFiles);
			render(<ChangesPanel theme={mockTheme} session={source} />);
			changes.mockResolvedValue({ ...twoFiles, files: [{ ...twoFiles.files[0], staged: true }] });
			fireEvent.click(await screen.findByRole('button', { name: 'Stage src/app.ts' }));
			await screen.findByRole('button', { name: 'Unstage src/app.ts' });
			expect(applyChange).toHaveBeenLastCalledWith(
				'/project',
				{ action: 'stage', paths: ['src/app.ts'] },
				undefined,
				undefined
			);
			changes.mockResolvedValue(twoFiles);
			fireEvent.click(screen.getByRole('button', { name: 'Unstage src/app.ts' }));
			await screen.findByRole('button', { name: 'Stage src/app.ts' });
			expect(applyChange).toHaveBeenLastCalledWith(
				'/project',
				{ action: 'unstage', paths: ['src/app.ts'] },
				undefined,
				undefined
			);
			changes.mockResolvedValue({ ...twoFiles, files: [{ ...twoFiles.files[0], staged: true }] });
			fireEvent.click(screen.getByRole('button', { name: 'Revert src/app.ts' }));
			const confirmation = useModalStore.getState().getData('confirm')!;
			await act(async () => confirmation.onConfirm());
			expect(applyChange).toHaveBeenLastCalledWith(
				'/project',
				{ action: 'revert', paths: ['src/app.ts'], confirmed: true },
				undefined,
				undefined
			);
			const input = screen.getByRole('textbox', { name: 'Commit message' });
			fireEvent.change(input, { target: { value: 'Commit changes' } });
			changes.mockResolvedValue(clean);
			fireEvent.click(screen.getByRole('button', { name: 'Commit 1 file' }));
			await waitFor(() => expect(input).toHaveValue(''));
			expect(applyChange).toHaveBeenLastCalledWith(
				'/project',
				{ action: 'commit', message: 'Commit changes' },
				undefined,
				undefined
			);
		}
	);
	beforeEach(() => {
		useSettingsStore.setState({ newShell: true });
		useModalStore.getState().closeModal('confirm');
		Object.assign(window.maestro.git, { applyChange });
		applyChange.mockReset().mockResolvedValue({ success: true, output: '' });
		changes.mockResolvedValue(twoFiles);
	});

	it('has a disabled commit row until files are staged and hides group headings', async () => {
		render(<ChangesPanel theme={mockTheme} session={session()} />);
		await screen.findByText('app.ts');
		expect(screen.getByPlaceholderText('Stage files before committing')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled();
		expect(screen.queryByText(/^Staged \(/)).not.toBeInTheDocument();
	});

	it.each([false, true])(
		'counts a staged deletion with a replacement once, another staged file %s',
		async (anotherStaged) => {
			changes.mockResolvedValue({
				...twoFiles,
				files: [
					{
						path: 'tracked.txt',
						status: 'deleted',
						staged: true,
						unstaged: true,
						additions: 1,
						deletions: 1,
					},
					{ ...twoFiles.files[0], staged: anotherStaged },
				],
			});
			render(<ChangesPanel theme={mockTheme} session={session()} />);
			expect(await screen.findByText(`Staged (${anotherStaged ? 2 : 1})`)).toBeInTheDocument();
			expect(screen.getByText(`Unstaged (${anotherStaged ? 0 : 1})`)).toBeInTheDocument();
			expect(screen.getAllByText('tracked.txt')).toHaveLength(1);
			expect(screen.getByLabelText('Also has unstaged changes')).toBeInTheDocument();
			fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), {
				target: { value: 'commit staged deletion' },
			});
			expect(
				screen.getByRole('button', {
					name: anotherStaged ? 'Commit 2 files' : 'Commit 1 file',
				})
			).toBeEnabled();
			await act(async () => {
				fireEvent.click(screen.getByRole('button', { name: 'Unstage tracked.txt' }));
			});
			expect(applyChange).toHaveBeenCalledWith(
				'/project',
				{ action: 'unstage', paths: ['tracked.txt'] },
				undefined,
				undefined
			);
		}
	);

	it.each(['en', 'zh-CN'] as const)(
		'names the destructive confirmation action in %s',
		async (locale) => {
			useSettingsStore.setState({ uiLanguage: locale });
			const files: GitChangedFile[] = [
				{ path: 'tracked.txt', status: 'modified', staged: false, additions: 1, deletions: 1 },
				{
					path: 'renamed.txt',
					oldPath: 'old.txt',
					status: 'renamed',
					staged: true,
					additions: 0,
					deletions: 0,
				},
				{
					path: 'recreated.txt',
					status: 'deleted',
					staged: true,
					unstaged: true,
					additions: 1,
					deletions: 1,
				},
				{ path: 'new.txt', status: 'untracked', staged: false, additions: 1, deletions: 0 },
				{ path: 'added.txt', status: 'added', staged: true, additions: 1, deletions: 0 },
				{
					path: 'copy.txt',
					oldPath: 'tracked.txt',
					status: 'copied',
					staged: true,
					additions: 1,
					deletions: 0,
				},
			];
			changes.mockResolvedValue({
				...twoFiles,
				files,
				totals: { files: files.length, additions: 5, deletions: 2 },
			});
			const { unmount } = render(<ChangesPanel theme={mockTheme} session={session()} />);
			try {
				await screen.findByText('tracked.txt');
				for (const file of files) {
					fireEvent.click(
						screen.getByRole('button', {
							name: `${locale === 'en' ? 'Revert' : '撤销'} ${file.path}`,
						})
					);
					const data = useModalStore.getState().getData('confirm');
					const deletesFile = ['untracked', 'added', 'copied'].includes(file.status);
					expect(data?.confirmLabel).toBe(
						locale === 'en'
							? deletesFile
								? 'Delete file'
								: 'Revert changes'
							: deletesFile
								? '删除文件'
								: '撤销改动'
					);
					expect(data?.message).toContain(file.path);
					expect(data?.destructive).toBe(true);
				}
				expect(applyChange).not.toHaveBeenCalled();
			} finally {
				unmount();
				useSettingsStore.setState({ uiLanguage: 'en' });
			}
		}
	);

	it.each([
		['en', 1, '1 file changed'],
		['en', 2, '2 files changed'],
		['zh-CN', 1, '1 个文件有改动'],
		['zh-CN', 2, '2 个文件有改动'],
	] as const)('shows the %s summary for %s files', async (locale, count, summary) => {
		useSettingsStore.setState({ uiLanguage: locale });
		changes.mockResolvedValue({
			...twoFiles,
			files: twoFiles.files.slice(0, count),
			totals: { ...twoFiles.totals, files: count },
		});
		const { unmount } = render(<ChangesPanel theme={mockTheme} session={session()} />);
		try {
			await screen.findByText('app.ts');
			expect(screen.getByTestId('changes-summary')).toHaveTextContent(`${summary} +3 -1`);
		} finally {
			unmount();
			useSettingsStore.setState({ uiLanguage: 'en' });
		}
	});

	it('stages once while pending and shows staged and unstaged groups after refresh', async () => {
		let finish!: (result: { success: boolean }) => void;
		applyChange.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			})
		);
		render(<ChangesPanel theme={mockTheme} session={session()} />);
		const button = await screen.findByRole('button', { name: 'Stage src/app.ts' });
		fireEvent.click(button);
		fireEvent.click(button);
		expect(button).toBeDisabled();
		expect(applyChange).toHaveBeenCalledTimes(1);
		expect(applyChange).toHaveBeenCalledWith(
			'/project',
			{ action: 'stage', paths: ['src/app.ts'] },
			undefined,
			undefined
		);
		changes.mockResolvedValue({
			...twoFiles,
			files: twoFiles.files.map((f, i) => ({ ...f, staged: i === 0 })),
		});
		await act(async () => finish({ success: true }));
		expect(await screen.findByText('Staged (1)')).toBeInTheDocument();
		expect(screen.getByText('Unstaged (1)')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Unstage src/app.ts' }));
		expect(applyChange).toHaveBeenLastCalledWith(
			'/project',
			{ action: 'unstage', paths: ['src/app.ts'] },
			undefined,
			undefined
		);
	});

	it('confirms destructive deletion by name and never offers conflict revert', async () => {
		changes.mockResolvedValue({
			...twoFiles,
			files: [
				{ path: '新文件.txt', status: 'untracked', staged: false, additions: 1, deletions: 0 },
				{ path: 'conflict', status: 'conflicted', staged: false, additions: 1, deletions: 0 },
			],
		});
		render(<ChangesPanel theme={mockTheme} session={session()} />);
		fireEvent.click(await screen.findByRole('button', { name: 'Revert 新文件.txt' }));
		expect(applyChange).not.toHaveBeenCalled();
		const data = useModalStore.getState().getData('confirm');
		expect(data?.message).toContain('新文件.txt');
		expect(data?.message).toContain('delete this new file');
		expect(screen.queryByRole('button', { name: 'Revert conflict' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Stage conflict' })).toBeInTheDocument();
		await act(async () => data?.onConfirm());
		expect(applyChange).toHaveBeenCalledWith(
			'/project',
			{ action: 'revert', paths: ['新文件.txt'], confirmed: true },
			undefined,
			undefined
		);
	});

	it.each([{}, { metaKey: true }, { ctrlKey: true }])(
		'commits with Enter %j and clears only on success',
		async (modifiers) => {
			changes.mockResolvedValue({
				...twoFiles,
				files: [{ ...twoFiles.files[0], staged: true }],
				totals: { files: 1, additions: 3, deletions: 1 },
			});
			render(<ChangesPanel theme={mockTheme} session={session()} />);
			const input = await screen.findByRole('textbox', { name: 'Commit message' });
			await screen.findByRole('button', { name: 'Commit 1 file' });
			fireEvent.change(input, { target: { value: 'Ship this' } });
			applyChange.mockResolvedValueOnce({
				success: false,
				error: 'pre-commit: exact hook failure',
			});
			fireEvent.keyDown(input, { key: 'Enter', ...modifiers });
			expect(await screen.findByRole('alert')).toHaveTextContent('pre-commit: exact hook failure');
			expect(input).toHaveValue('Ship this');
			changes.mockResolvedValue(clean);
			fireEvent.keyDown(input, { key: 'Enter', ...modifiers });
			await waitFor(() => expect(input).toHaveValue(''));
			expect(applyChange).toHaveBeenLastCalledWith(
				'/project',
				{ action: 'commit', message: 'Ship this' },
				undefined,
				undefined
			);
		}
	);

	it('uses the SSH working directory override for reads and writes', async () => {
		render(
			<ChangesPanel
				theme={mockTheme}
				session={session({
					cwd: '/local',
					sessionSshRemoteConfig: {
						enabled: true,
						remoteId: 'remote',
						workingDirOverride: '~/remote tree',
					},
				})}
			/>
		);
		fireEvent.click(await screen.findByRole('button', { name: 'Stage src/app.ts' }));
		expect(changes).toHaveBeenCalledWith('/local', 'remote', '~/remote tree');
		expect(applyChange).toHaveBeenCalledWith(
			'/local',
			{ action: 'stage', paths: ['src/app.ts'] },
			'remote',
			'~/remote tree'
		);
	});

	it('does not add actions to the old shell', async () => {
		useSettingsStore.setState({ newShell: false });
		render(<ChangesPanel theme={mockTheme} session={session()} />);
		await screen.findByText('app.ts');
		expect(screen.queryByRole('textbox', { name: 'Commit message' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Stage src/app.ts' })).not.toBeInTheDocument();
	});
});

describe('changes action lifetime', () => {
	it('does not let a confirmation from an unmounted panel modify the previous conversation', async () => {
		useSettingsStore.setState({ newShell: true });
		const applyChange = vi.fn().mockResolvedValue({ success: true, output: '' });
		Object.assign(window.maestro.git, { applyChange });
		changes.mockResolvedValue(twoFiles);
		const { unmount } = render(<ChangesPanel theme={mockTheme} session={session()} />);
		fireEvent.click(await screen.findByRole('button', { name: 'Revert src/app.ts' }));
		const confirmation = useModalStore.getState().getData('confirm')!;
		unmount();
		await act(async () => confirmation.onConfirm());
		expect(applyChange).not.toHaveBeenCalled();
	});

	it('does not clear the next conversation draft when the previous commit finishes', async () => {
		useSettingsStore.setState({ newShell: true });
		let finish!: (result: { success: true; output: string }) => void;
		Object.assign(window.maestro.git, {
			applyChange: vi.fn(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					})
			),
		});
		changes.mockResolvedValue({ ...twoFiles, files: [{ ...twoFiles.files[0], staged: true }] });
		const { rerender } = render(<ChangesPanel theme={mockTheme} session={session()} />);
		const input = await screen.findByRole('textbox', { name: 'Commit message' });
		await screen.findByRole('button', { name: 'Commit 1 file' });
		fireEvent.change(input, { target: { value: 'first' } });
		fireEvent.keyDown(input, { key: 'Enter' });
		rerender(<ChangesPanel theme={mockTheme} session={session({ id: 'other', cwd: '/other' })} />);
		await waitFor(() => expect(changes).toHaveBeenCalledWith('/other', undefined, undefined));
		fireEvent.change(input, { target: { value: 'next draft' } });
		await act(async () => finish({ success: true, output: '' }));
		expect(input).toHaveValue('next draft');
		expect(changes).toHaveBeenCalledTimes(2);
	});
});

it('uses the conversation directory even when the old terminal changed directory', async () => {
	useSettingsStore.setState({ newShell: true });
	const applyChange = vi.fn().mockResolvedValue({ success: true, output: '' });
	Object.assign(window.maestro.git, { applyChange });
	changes.mockResolvedValue(twoFiles);
	render(
		<ChangesPanel
			theme={mockTheme}
			session={session({ inputMode: 'terminal', shellCwd: '/unrelated' })}
		/>
	);
	fireEvent.click(await screen.findByRole('button', { name: 'Stage src/app.ts' }));
	expect(changes).toHaveBeenCalledWith('/project', undefined, undefined);
	expect(applyChange).toHaveBeenCalledWith(
		'/project',
		{ action: 'stage', paths: ['src/app.ts'] },
		undefined,
		undefined
	);
});

it('localizes application refusals in Chinese while leaving Git errors raw', async () => {
	useSettingsStore.setState({ newShell: true, uiLanguage: 'zh-CN' });
	const applyChange = vi.fn().mockResolvedValue({
		success: false,
		error: 'File is no longer changed: src/app.ts',
		reason: 'notChanged',
		file: 'src/app.ts',
	});
	Object.assign(window.maestro.git, { applyChange });
	changes.mockResolvedValue(twoFiles);
	const { unmount } = render(<ChangesPanel theme={mockTheme} session={session()} />);
	try {
		fireEvent.click(await screen.findByRole('button', { name: '暂存 src/app.ts' }));
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'“src/app.ts”已经没有改动，请刷新列表。'
		);
	} finally {
		unmount();
		useSettingsStore.setState({ uiLanguage: 'en' });
	}
});
