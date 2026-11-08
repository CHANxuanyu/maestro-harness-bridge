import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
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

it('lets the native Codex stop scenario pass its initial approval using its exact button locator', async () => {
	// Exercise the scenario's locator against the real prompt so an earlier
	// approval timeout cannot masquerade as a stop failure during app.close().
	const scenario = fs.readFileSync(path.resolve('e2e/native-codex-app-server.spec.ts'), 'utf8');
	const action = scenario.match(
		/await dialog\.getByRole\('button', \{ name: '([^']+)', exact: true \}\)\.click\(\);/
	);
	expect(action).not.toBeNull();
	useSettingsStore.setState({ newShell: true, uiLanguage: 'en' });
	const originalProcess = window.maestro.process;
	const respond = vi.fn().mockResolvedValue(true);
	window.maestro.process = { ...originalProcess, respondPermission: respond };
	usePermissionRequestStore.setState({
		queue: [
			{
				requestId: 'initial-file-approval',
				sessionId: 'owner-ai-tab',
				provider: 'codex',
				toolName: 'apply_patch',
				createdAt: 1,
				input: { changes: [{ path: '/tmp/synthetic-project/approved.txt', diff: '+synthetic' }] },
			},
		],
	});
	const view = render(
		<LayerStackProvider>
			<PermissionPrompt theme={inputAreaTheme} />
		</LayerStackProvider>
	);
	try {
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: action![1], exact: true }));
		});
		expect(respond).toHaveBeenCalledExactlyOnceWith('initial-file-approval', { behavior: 'allow' });
		expect(screen.queryByRole('dialog')).toBeNull();
	} finally {
		view.unmount();
		window.maestro.process = originalProcess;
		useSettingsStore.setState({ newShell: false });
	}
});
