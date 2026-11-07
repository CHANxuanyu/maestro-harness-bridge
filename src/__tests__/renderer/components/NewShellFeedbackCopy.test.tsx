import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
	within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentErrorModal } from '../../../renderer/components/AgentErrorModal';
import { UpdatesChoiceModal } from '../../../renderer/components/UpdatesChoiceModal';
import { QuitConfirmModal } from '../../../renderer/components/QuitConfirmModal';
import { RetryStatusCard } from '../../../renderer/components/RetryStatusCard';
import { ToastContainer } from '../../../renderer/components/Toast';
import { useAgentErrorRecovery } from '../../../renderer/hooks/agent/useAgentErrorRecovery';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useNotificationStore } from '../../../renderer/stores/notificationStore';
import { useRetryStore } from '../../../renderer/stores/retryStore';
import { mockTheme } from '../../helpers/mockTheme';

const providerError = 'Provider diagnostic: Agent exited with code 1';
const error = {
	type: 'agent_crashed' as const,
	message: providerError,
	recoverable: true,
	agentId: 'codex',
	timestamp: 1,
	parsedJson: { message: providerError },
};

beforeEach(() => {
	vi.useFakeTimers();
	useSettingsStore.setState({ newShell: true, uiLanguage: 'zh-CN' });
	useRetryStore.setState({ retries: {}, outages: {} });
	useNotificationStore.setState({ toasts: [], history: [] });
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	useSettingsStore.setState({ newShell: false, uiLanguage: 'en' });
});

describe('new shell feedback copy', () => {
	it.each(['zh-CN', 'en'] as const)(
		'uses neutral update choices in %s without changing preferences',
		(uiLanguage) => {
			useSettingsStore.setState({ uiLanguage });
			const beta = vi.fn();
			render(
				<LayerStackProvider>
					<UpdatesChoiceModal
						theme={mockTheme}
						isOpen
						checkForUpdatesOnStartup
						onCheckForUpdatesOnStartupChange={vi.fn()}
						enableBetaUpdates={false}
						onEnableBetaUpdatesChange={beta}
						crashReportingEnabled
						onCrashReportingEnabledChange={vi.fn()}
						onDismiss={vi.fn()}
					/>
				</LayerStackProvider>
			);
			expect(
				screen.getByRole('heading', {
					name: uiLanguage === 'en' ? 'Update preferences' : '更新偏好',
				})
			).toBeVisible();
			const row = screen.getByTestId('updates-choice-beta');
			expect(row.textContent).not.toMatch(/推荐|Recommended|bleeding/i);
			expect(screen.getByTestId('updates-choice-crash-reports').textContent).toMatch(
				uiLanguage === 'en' ? /restart/ : /重启/
			);
			fireEvent.click(within(row).getByRole('switch'));
			expect(beta).toHaveBeenCalledExactlyOnceWith(true);
		}
	);

	it('localizes error details while keeping the provider diagnostic intact', () => {
		const dismiss = vi.fn();
		render(
			<LayerStackProvider>
				<AgentErrorModal theme={mockTheme} error={error} recoveryActions={[]} onDismiss={dismiss} />
			</LayerStackProvider>
		);
		expect(screen.getByRole('heading', { name: '对话中断' })).toBeVisible();
		expect(screen.getByText(providerError)).toBeVisible();
		fireEvent.click(screen.getByRole('button', { name: '错误详情（JSON）' }));
		expect(screen.getByText(JSON.stringify(providerError))).toBeVisible();
		fireEvent.click(screen.getByRole('button', { name: '关闭' }));
		expect(dismiss).toHaveBeenCalledOnce();
	});

	it('keeps legacy error details unchanged', () => {
		useSettingsStore.setState({ newShell: false });
		render(
			<LayerStackProvider>
				<AgentErrorModal theme={mockTheme} error={error} recoveryActions={[]} onDismiss={vi.fn()} />
			</LayerStackProvider>
		);
		expect(screen.getByRole('heading', { name: 'Agent Error' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Error Details (JSON)' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Dismiss' })).toBeVisible();
	});

	it('localizes recovery actions and keeps their callbacks and IDs', () => {
		const restart = vi.fn();
		const { result } = renderHook(() =>
			useAgentErrorRecovery({
				error,
				agentId: 'codex',
				sessionId: 's1',
				onRestartAgent: restart,
				onNewSession: vi.fn(),
			})
		);
		expect(result.current.recoveryActions.map(({ id, label }) => ({ id, label }))).toEqual([
			{ id: 'restart-agent', label: '重新启动对话' },
			{ id: 'new-session', label: '新建对话' },
		]);
		act(() => result.current.handleRecovery('restart-agent'));
		expect(restart).toHaveBeenCalledOnce();
		act(() => useSettingsStore.setState({ uiLanguage: 'en' }));
		expect(result.current.recoveryActions[0].label).toBe('Restart conversation');
	});

	it('names conversations in the quit warning', () => {
		render(
			<LayerStackProvider>
				<QuitConfirmModal
					theme={mockTheme}
					busyAgentCount={2}
					busyAgentNames={['Project A', 'Project B']}
					onConfirmQuit={vi.fn()}
					onCancel={vi.fn()}
				/>
			</LayerStackProvider>
		);
		expect(document.getElementById('quit-confirm-description')?.textContent).toBe(
			'有 2 条对话正在运行。 现在退出将中断正在进行的工作。'
		);
		expect(screen.getByText('运行中的对话')).toBeVisible();
		expect(screen.getByRole('dialog').textContent).not.toMatch(/智能体|Agent/);
	});

	it('localizes notification controls and conversation metadata', () => {
		useNotificationStore.setState({
			toasts: [
				{
					id: 'n1',
					type: 'info',
					color: 'theme',
					title: 'Test',
					message: providerError,
					timestamp: 1,
					dismissible: true,
					taskDuration: 3000,
					tabName: 'Review',
					agentSessionId: 'native-id',
				},
			],
		});
		render(<ToastContainer theme={mockTheme} />);
		act(() => vi.advanceTimersByTime(50));
		expect(screen.getByRole('button', { name: '关闭通知' })).toBeVisible();
		expect(screen.getByTitle('复制通知内容')).toBeVisible();
		expect(screen.getByTitle('对话 ID：native-id')).toBeVisible();
		expect(screen.getByText('已完成，用时 3s')).toBeVisible();
		expect(screen.getByText(providerError)).toBeVisible();
	});

	it.each(['active', 'recovered', 'stopped', 'failed'] as const)(
		'localizes the %s retry card without changing provider errors',
		(status) => {
			const now = Date.now();
			useRetryStore.setState({
				outages: {
					o1: {
						outageId: 'o1',
						sessionId: 's1',
						tabId: 't1',
						strategy: 'availability',
						startedAt: now - 3000,
						attempts: 2,
						nextRetryAt: now + 90000,
						status,
						resolvedAt: now,
						lastMessage: providerError,
						failureMessage: providerError,
					},
				},
			});
			render(<RetryStatusCard outageId="o1" theme={mockTheme} />);
			expect(screen.getByRole('status').textContent).not.toMatch(
				/Service overloaded|Auto-retry|Retries|Failing for|Try now|Stop|cleared after|was not resolved/
			);
			if (status === 'active')
				expect(screen.getByRole('button', { name: '立即重试' })).toBeEnabled();
			if (status === 'failed')
				expect(screen.getByText(providerError, { exact: false })).toBeVisible();
		}
	);
});
