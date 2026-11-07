import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionPrompt } from '../../../../renderer/components/PermissionPrompt';
import { LayerStackProvider } from '../../../../renderer/contexts/LayerStackContext';
import { usePermissionRequestStore } from '../../../../renderer/stores/permissionRequestStore';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import type { PermissionRequestUI } from '../../../../renderer/stores/permissionRequestStore';
import { resetStores } from '../../../helpers/resetStores';
import { createMockSession } from '../../../helpers/mockSession';
import { mockTheme } from '../../../helpers/mockTheme';

const request = {
	requestId: 'approval-a',
	sessionId: 'session-ai-tab',
	tabId: 'tab',
	toolName: 'Write',
	input: { file_path: '/tmp/fixture.txt', content: '待审批内容' },
	createdAt: 1,
};
let resolved: ((id: string) => void) | undefined;
const respondPermission = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	resolved = undefined;
	useSettingsStore.setState({ newShell: true, uiLanguage: 'zh-CN' });
	resetStores(usePermissionRequestStore, useSessionStore);
	useSessionStore.setState({
		sessions: [createMockSession({ id: 'session', cwd: '/temporary-project' })],
	});
	Object.assign(window.maestro.process, {
		onPermissionRequest: vi.fn(() => vi.fn()),
		onPermissionResolved: vi.fn((cb) => {
			resolved = cb;
			return vi.fn();
		}),
		onExit: vi.fn(() => vi.fn()),
		respondPermission,
	});
	respondPermission.mockResolvedValue(true);
});
afterEach(() => {
	cleanup();
	resetStores(usePermissionRequestStore, useSettingsStore, useSessionStore);
	vi.restoreAllMocks();
});

function showPrompt(payload: PermissionRequestUI = request) {
	usePermissionRequestStore.getState().enqueue(payload);
	return render(
		<LayerStackProvider>
			<PermissionPrompt theme={mockTheme} />
		</LayerStackProvider>
	);
}

describe('Claude approval prompt', () => {
	it('shows the actual worktree cwd instead of the owning project record', () => {
		const cwd = '/temporary-project/.claude/worktrees/approval';
		showPrompt({ ...request, cwd });
		expect(screen.getByText(cwd, { exact: true })).toBeInTheDocument();
		expect(screen.queryByText('/temporary-project', { exact: true })).not.toBeInTheDocument();
	});
	it('does not claim a project directory when older requests omit execution context', () => {
		showPrompt();
		expect(screen.queryByText('/temporary-project', { exact: true })).not.toBeInTheDocument();
	});
	it('shows the complete proposed file input before allowing once in the new shell', () => {
		showPrompt();
		expect(screen.getByRole('dialog', { name: '权限请求' })).toHaveTextContent('待审批内容');
		expect(screen.getByRole('button', { name: '允许一次' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: '拒绝' })).toHaveFocus();
	});
	it('removes an expired request without sending a second decision', () => {
		showPrompt();
		expect(resolved).toBeTypeOf('function');
		act(() => resolved?.(request.requestId));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(respondPermission).not.toHaveBeenCalled();
	});
	it('keeps a failed decision visible so the user can answer again', async () => {
		respondPermission.mockRejectedValue(new Error('IPC unavailable'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		showPrompt();
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
		});
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByRole('alert')).toHaveTextContent('未能送达');
	});
	it('waits for acknowledgement and prevents duplicate decisions', async () => {
		let acknowledge!: (accepted: boolean) => void;
		respondPermission.mockImplementation(
			() =>
				new Promise<boolean>((resolve) => {
					acknowledge = resolve;
				})
		);
		showPrompt();
		const deny = screen.getByRole('button', { name: '拒绝' });
		fireEvent.click(deny);
		fireEvent.click(deny);
		expect(deny).toBeDisabled();
		expect(respondPermission).toHaveBeenCalledTimes(1);
		await act(async () => acknowledge(true));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
	it('keeps the classic prompt presentation', () => {
		useSettingsStore.setState({ newShell: false, uiLanguage: 'en' });
		showPrompt();
		expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
		expect(screen.getByRole('dialog')).not.toHaveTextContent('待审批内容');
	});
	it('sends exactly one allow for the displayed request', async () => {
		useSettingsStore.setState({ uiLanguage: 'en' });
		showPrompt();
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
		});
		expect(respondPermission).toHaveBeenCalledExactlyOnceWith('approval-a', { behavior: 'allow' });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
});
