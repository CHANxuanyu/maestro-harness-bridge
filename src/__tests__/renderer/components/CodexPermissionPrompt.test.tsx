import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PermissionPrompt } from '../../../renderer/components/PermissionPrompt/PermissionPrompt';
import { usePermissionRequestStore } from '../../../renderer/stores/permissionRequestStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { inputAreaTheme } from './InputArea/_fixtures';

afterEach(() => usePermissionRequestStore.setState({ queue: [] }));
it.each([
	['en', 'Codex wants to use'],
	['zh-CN', 'Codex 请求使用'],
])('identifies Codex and shows the approval scope in %s', (uiLanguage, label) => {
	useSettingsStore.setState({ uiLanguage: uiLanguage as 'en' | 'zh-CN' });
	usePermissionRequestStore.setState({
		queue: [
			{
				requestId: 'fixture',
				sessionId: 'owner-ai-tab',
				toolName: 'Bash',
				provider: 'codex',
				createdAt: 1,
				input: { command: 'pwd', cwd: '/tmp/synthetic-project', reason: 'Synthetic scope' },
			},
		],
	});
	render(
		<LayerStackProvider>
			<PermissionPrompt theme={inputAreaTheme} />
		</LayerStackProvider>
	);
	expect(screen.getByText(label, { exact: false })).toBeInTheDocument();
	expect(screen.getByText(/\/tmp\/synthetic-project/)).toHaveTextContent('Synthetic scope');
	act(() => usePermissionRequestStore.getState().resolve('fixture'));
	expect(screen.queryByRole('dialog')).toBeNull();
});
