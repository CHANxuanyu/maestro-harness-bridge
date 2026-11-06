import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { StoredFilePreview } from '../../../../renderer/components/FilePreview/StoredFilePreview';
import { useFilePreviewTabHandlers } from '../../../../renderer/hooks/tabs/internal/useFilePreviewTabHandlers';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { createMockSession, createMockFileTab } from '../../../helpers';
import { mockTheme } from '../../../helpers/mockTheme';
import { saveFilePreview } from '../../../../renderer/hooks/mainPanel/useFilePreviewHandlers';
import { useAppHandlers } from '../../../../renderer/hooks/ui/useAppHandlers';
import { useCenterFlashStore } from '../../../../renderer/stores/centerFlashStore';
import { useUIStore } from '../../../../renderer/stores/uiStore';

let preview: any;
vi.mock('../../../../renderer/components/FilePreview', () => ({
	FilePreview: (props: any) => {
		preview = props;
		return (
			<div>
				<span>{props.file.name}</span>
				<button onClick={() => props.onSave(props.file.path, 'saved content')}>Save fixture</button>
				<button onClick={props.onPanelBack}>Back fixture</button>
			</div>
		);
	},
}));
const file = createMockFileTab({
	id: 'file',
	path: '/project/a.md',
	name: 'a',
	extension: '.md',
	content: '# original',
	pendingScrollToLine: 12,
});
const session = createMockSession({ id: 'owner', filePreviewTabs: [file] });
function Harness({ onBack }: { onBack?: () => void }) {
	const h = useFilePreviewTabHandlers();
	return (
		<StoredFilePreview
			session={session}
			fileTabId="file"
			theme={mockTheme}
			onBack={onBack}
			actions={{
				onFileTabEditModeChange: h.handleFileTabEditModeChange,
				onFileTabEditContentChange: h.handleFileTabEditContentChange,
				onFileTabScrollPositionChange: h.handleFileTabScrollPositionChange,
				onFileTabSearchQueryChange: h.handleFileTabSearchQueryChange,
			}}
		/>
	);
}
beforeEach(() => {
	vi.clearAllMocks();
	window.maestro.fs.cancelReadFile = vi.fn().mockResolvedValue(true);
	useSettingsStore.setState({ newShell: false, uiLanguage: 'en' });
	useSessionStore.setState({ sessions: [session], activeSessionId: 'owner' });
	vi.mocked(window.maestro.fs.stat).mockResolvedValue({
		modifiedAt: '2026-11-06T00:00:00Z',
	} as any);
	vi.mocked(window.maestro.fs.writeFile).mockResolvedValue(true);
});
afterEach(() => {
	useSettingsStore.setState({ newShell: false, uiLanguage: 'en' });
});
describe('stored FilePreview binding', () => {
	it('keeps the classic tiled missing-tab message when the live file tab disappears', async () => {
		render(<Harness />);
		expect(await screen.findByText('a.md')).toBeInTheDocument();
		act(() => useSessionStore.getState().updateSession('owner', { filePreviewTabs: [] }));
		expect(screen.getByText('This tab is no longer available')).toBeInTheDocument();
	});

	it.each([
		[false, 'en', undefined],
		[false, 'zh-CN', undefined],
		[false, 'en', 'remote'],
		[false, 'zh-CN', 'remote'],
		[true, 'en', undefined],
		[true, 'zh-CN', undefined],
		[true, 'en', 'remote'],
		[true, 'zh-CN', 'remote'],
	] as const)(
		'reports missing files in shell %s, locale %s, host %s',
		async (newShell, uiLanguage, sshRemoteId) => {
			useSettingsStore.setState({ newShell, uiLanguage });
			useCenterFlashStore.setState({ active: null });
			useSessionStore.getState().updateSession('owner', {
				cwd: '/project',
				fullPath: '/project',
				filePreviewTabs: [],
				sshRemoteId,
			});
			vi.mocked(window.maestro.fs.readFile).mockResolvedValue(null);
			const { result } = renderHook(() => {
				const tabs = useFilePreviewTabHandlers();
				return useAppHandlers({
					setSessions: useSessionStore.getState().setSessions,
					setActiveFocus: useUIStore.getState().setActiveFocus,
					setConfirmModalMessage: vi.fn(),
					setConfirmModalOnConfirm: vi.fn(),
					setConfirmModalOpen: vi.fn(),
					onOpenFileTab: tabs.handleOpenFileTab,
				});
			});
			await act(() => result.current.handleFileClick({ name: 'a.md', type: 'file' }, 'a.md'));
			expect(useCenterFlashStore.getState().active?.message).toBe(
				uiLanguage === 'zh-CN' ? '读不到文件：a.md' : 'Could not read file: a.md'
			);
			expect(useSessionStore.getState().sessions[0].filePreviewTabs).toEqual([]);
		}
	);

	it.each([false, true])(
		'silences cancelled SSH reads even after the same path is reopened, new shell %s',
		async (newShell) => {
			useSettingsStore.setState({ newShell });
			useCenterFlashStore.setState({ active: null });
			useSessionStore.getState().updateSession('owner', {
				cwd: '/project',
				fullPath: '/project',
				filePreviewTabs: [],
				sshRemoteId: 'remote',
			});
			let finishRead!: (content: null) => void;
			vi.mocked(window.maestro.fs.readFile).mockReturnValue(
				new Promise((resolve) => {
					finishRead = resolve;
				})
			);
			const { result } = renderHook(() => {
				const tabs = useFilePreviewTabHandlers();
				const handlers = useAppHandlers({
					setSessions: useSessionStore.getState().setSessions,
					setActiveFocus: useUIStore.getState().setActiveFocus,
					setConfirmModalMessage: vi.fn(),
					setConfirmModalOnConfirm: vi.fn(),
					setConfirmModalOpen: vi.fn(),
					onOpenFileTab: tabs.handleOpenFileTab,
				});
				return { tabs, handlers };
			});
			let pending!: Promise<void>;
			act(() => {
				pending = result.current.handlers.handleFileClick({ name: 'a.md', type: 'file' }, 'a.md');
			});
			const loading = useSessionStore.getState().sessions[0].filePreviewTabs[0];
			expect(loading.isLoading).toBe(true);
			act(() => result.current.tabs.handleCloseFileTab(loading.id));
			expect(useSessionStore.getState().sessions[0].filePreviewTabs).toEqual([]);
			act(() =>
				result.current.tabs.handleOpenFileTab({
					path: '/project/a.md',
					name: 'a.md',
					content: '',
					sshRemoteId: 'remote',
					isLoading: true,
					loadRequestId: 'reopened-request',
				})
			);
			await act(async () => {
				finishRead(null);
				await pending;
			});
			expect(useCenterFlashStore.getState().active).toBeNull();
			expect(useSessionStore.getState().sessions[0].filePreviewTabs).toEqual([
				expect.objectContaining({
					path: '/project/a.md',
					isLoading: true,
					loadRequestId: 'reopened-request',
				}),
			]);
		}
	);
	it.each([undefined, 'remote'])(
		'blocks loading previews and saves on host %s',
		async (sshRemoteId) => {
			useSessionStore.getState().updateSession('owner', {
				filePreviewTabs: [{ ...file, content: '', isLoading: true, sshRemoteId }],
			});
			render(<Harness />);
			expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
			expect(screen.queryByText('Save fixture')).not.toBeInTheDocument();
			expect(
				await saveFilePreview({
					path: file.path,
					content: 'must not overwrite',
					activeSession: session,
					activeFileTabId: file.id,
					filePreviewSshRemoteId: sshRemoteId,
				})
			).toBe(false);
			expect(window.maestro.fs.writeFile).not.toHaveBeenCalled();
		}
	);

	it.each([undefined, 'remote'])(
		'refuses a direct save of a loading tab on host %s',
		async (sshRemoteId) => {
			useSessionStore
				.getState()
				.updateSession('owner', { filePreviewTabs: [{ ...file, content: '', isLoading: true }] });
			expect(
				await saveFilePreview({
					path: file.path,
					content: 'unsafe',
					activeSession: session,
					activeFileTabId: file.id,
					filePreviewSshRemoteId: sshRemoteId,
				})
			).toBe(false);
			expect(window.maestro.fs.stat).not.toHaveBeenCalled();
			expect(window.maestro.fs.writeFile).not.toHaveBeenCalled();
		}
	);

	it.each([undefined, 'remote'])(
		'reports failed reads without leaving an editable empty file on host %s',
		async (sshRemoteId) => {
			useSettingsStore.setState({ newShell: true });
			useCenterFlashStore.setState({ active: null });
			useSessionStore.getState().updateSession('owner', {
				cwd: '/project',
				fullPath: '/project',
				filePreviewTabs: [],
				sshRemoteId,
			});
			vi.mocked(window.maestro.fs.readFile).mockRejectedValue(new Error('fixture read failed'));
			const { result } = renderHook(() => {
				const tabs = useFilePreviewTabHandlers();
				return useAppHandlers({
					setSessions: useSessionStore.getState().setSessions,
					setActiveFocus: useUIStore.getState().setActiveFocus,
					setConfirmModalMessage: vi.fn(),
					setConfirmModalOnConfirm: vi.fn(),
					setConfirmModalOpen: vi.fn(),
					onOpenFileTab: tabs.handleOpenFileTab,
				});
			});
			await act(() => result.current.handleFileClick({ name: 'a.md', type: 'file' }, 'a.md'));
			expect(useSessionStore.getState().sessions[0].filePreviewTabs).toEqual([]);
			expect(useCenterFlashStore.getState().active?.message).toContain('fixture read failed');
			expect(window.maestro.fs.writeFile).not.toHaveBeenCalled();
		}
	);
	it.each([false, true])(
		'shares line jumps, edits and save in tiled and panel views, panel %s',
		async (panel) => {
			useSettingsStore.setState({ newShell: panel });
			const back = vi.fn();
			render(<Harness onBack={panel ? back : undefined} />);
			expect(await screen.findByText('a.md')).toBeInTheDocument();
			expect(preview.pendingScrollToLine).toBe(12);
			fireEvent.click(screen.getByText('Save fixture'));
			await waitFor(() =>
				expect(useSessionStore.getState().sessions[0].filePreviewTabs[0].content).toBe(
					'saved content'
				)
			);
			expect(window.maestro.fs.writeFile).toHaveBeenCalledWith(
				'/project/a.md',
				'saved content',
				undefined
			);
			expect(useSessionStore.getState().sessions[0].filePreviewTabs[0].editContent).toBeUndefined();
			if (panel) {
				fireEvent.click(screen.getByText('Back fixture'));
				expect(back).toHaveBeenCalledOnce();
			}
		}
	);
});
