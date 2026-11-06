import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StoredFilePreview } from '../../../../renderer/components/FilePreview/StoredFilePreview';
import { useFilePreviewTabHandlers } from '../../../../renderer/hooks/tabs/internal/useFilePreviewTabHandlers';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { createMockSession, createMockFileTab } from '../../../helpers';
import { mockTheme } from '../../../helpers/mockTheme';

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
	useSessionStore.setState({ sessions: [session], activeSessionId: 'owner' });
	vi.mocked(window.maestro.fs.stat).mockResolvedValue({
		modifiedAt: '2026-11-06T00:00:00Z',
	} as any);
	vi.mocked(window.maestro.fs.writeFile).mockResolvedValue(true);
});
describe('stored FilePreview binding', () => {
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
