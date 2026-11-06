import { useSettingsStore } from '../../../renderer/stores/settingsStore';
/**
 * Tests for ChangesPanel - the new shell's view of what a conversation's
 * working directory changed against HEAD, and its entry to a review.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChangesPanel } from '../../../renderer/components/ChangesPanel';
import { useModalStore } from '../../../renderer/stores/modalStore';
import type { GitChanges } from '../../../shared/gitChanges';
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
