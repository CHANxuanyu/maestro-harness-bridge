import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProjectSessionTree } from '../../../renderer/components/SessionList/ProjectSessionTree';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { mockTheme } from '../../helpers/mockTheme';

const originalSettings = useSettingsStore.getState();
afterEach(() => {
	cleanup();
	useSettingsStore.setState({
		newShell: originalSettings.newShell,
		uiLanguage: originalSettings.uiLanguage,
	});
});

describe('new shell navigation copy', () => {
	it.each([
		['en', 'Could not load conversation history', 'Retry'],
		['zh-CN', '无法加载历史对话', '重试'],
	] as const)('localizes %s history failures', (uiLanguage, message, retry) => {
		useSettingsStore.setState({ newShell: true, uiLanguage });
		render(
			<ProjectSessionTree
				theme={mockTheme}
				projects={[]}
				providers={[]}
				activeKey={null}
				search=""
				onSearchChange={vi.fn()}
				onSelectConversation={vi.fn()}
				onToggleProject={vi.fn()}
				onNewConversation={vi.fn()}
				onRenameConversation={vi.fn()}
				onCloseConversation={vi.fn()}
				onAddAgent={vi.fn()}
				historyStatus="error"
				historyFailure="read failed"
				onRetryHistory={vi.fn()}
			/>
		);
		expect(screen.getByRole('status')).toHaveTextContent(message);
		expect(screen.getByRole('button', { name: retry })).toBeVisible();
	});
	it.each([
		[true, '搜索对话…', '还没有对话'],
		[false, '搜索会话...', '暂无会话'],
	] as const)(
		'keeps new and classic Chinese navigation separate: %s',
		(newShell, search, empty) => {
			useSettingsStore.setState({ newShell, uiLanguage: 'zh-CN' });
			render(
				<ProjectSessionTree
					theme={mockTheme}
					projects={[]}
					providers={[]}
					activeKey={null}
					search=""
					onSearchChange={vi.fn()}
					onSelectConversation={vi.fn()}
					onToggleProject={vi.fn()}
					onNewConversation={vi.fn()}
					onRenameConversation={vi.fn()}
					onCloseConversation={vi.fn()}
					onAddAgent={vi.fn()}
					historyStatus="ready"
				/>
			);
			expect(screen.getByPlaceholderText(search)).toBeInTheDocument();
			expect(screen.getByText(empty)).toBeInTheDocument();
		}
	);
});
