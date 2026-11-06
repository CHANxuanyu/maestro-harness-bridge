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
