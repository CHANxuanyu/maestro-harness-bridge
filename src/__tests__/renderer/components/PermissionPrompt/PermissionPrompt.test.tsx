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
import { createMockAITab } from '../../../helpers/mockTab';
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
const stopTurn = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	stopTurn.mockResolvedValue({ success: true });
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
			<PermissionPrompt theme={mockTheme} onStopTurn={stopTurn} />
		</LayerStackProvider>
	);
}

describe('Claude approval prompt', () => {
	it('stops the approval conversation without answering deny and blocks duplicate clicks', async () => {
		let finish!: (value: { success: boolean }) => void;
		stopTurn.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		showPrompt();
		const stop = screen.getByRole('button', { name: '停止这一轮' });
		fireEvent.click(stop);
		fireEvent.click(stop);
		expect(stopTurn).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session', tabId: 'tab' });
		expect(respondPermission).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: '允许一次' })).toBeDisabled();
		await act(async () => {
			finish({ success: true });
		});
		act(() => resolved?.(request.requestId));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
	it('keeps Escape as deny without stopping the turn', async () => {
		showPrompt();
		await act(async () => {
			fireEvent.keyDown(document, { key: 'Escape' });
		});
		expect(stopTurn).not.toHaveBeenCalled();
		expect(respondPermission).toHaveBeenCalledExactlyOnceWith('approval-a', {
			behavior: 'deny',
			message: 'Denied by user.',
		});
	});
	it('shows a failed stop and keeps the request available', async () => {
		stopTurn.mockResolvedValue({ success: false, error: '停止失败' });
		showPrompt();
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: '停止这一轮' }));
		});
		expect(screen.getByRole('alert')).toHaveTextContent('停止失败');
		expect(screen.getByRole('button', { name: '拒绝' })).toBeEnabled();
	});
	it.each(['session-ai-tab', 'session-ai-tab-fp-1234'])(
		'finds the named background conversation when %s omits tabId',
		(sessionId) => {
			useSessionStore.setState({
				sessions: [
					createMockSession({
						id: 'session',
						activeTabId: 'other-tab',
						aiTabs: [
							createMockAITab({ id: 'tab', name: '等待审批的对话' }),
							createMockAITab({ id: 'other-tab', name: '正在查看的对话' }),
						],
					}),
				],
			});
			showPrompt({ ...request, sessionId, tabId: undefined });
			expect(screen.getByText('对话：等待审批的对话')).toBeInTheDocument();
			expect(screen.queryByText('对话：正在查看的对话')).not.toBeInTheDocument();
		}
	);
	it('keeps an explicit request tab ahead of the compatibility fallback', () => {
		useSessionStore.setState({
			sessions: [
				createMockSession({
					id: 'session',
					aiTabs: [
						createMockAITab({ id: 'tab', name: '推断的对话' }),
						createMockAITab({ id: 'explicit-tab', name: '指定的对话' }),
					],
				}),
			],
		});
		showPrompt({ ...request, tabId: 'explicit-tab' });
		expect(screen.getByText('对话：指定的对话')).toBeInTheDocument();
	});
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
		expect(screen.queryByRole('button', { name: 'Stop this turn' })).not.toBeInTheDocument();
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
