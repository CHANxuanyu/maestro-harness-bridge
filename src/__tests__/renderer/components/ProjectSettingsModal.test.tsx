import { setCapabilitiesCache } from '../../../renderer/hooks/agent/useAgentCapabilities';
import { AGENT_CAPABILITIES } from '../../../main/agents/capabilities';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectSettingsModal } from '../../../renderer/components/ProjectSettingsModal';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import { mockTheme } from '../../helpers/mockTheme';
import { createMockSession } from '../../helpers';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';

const api = vi.fn();
const scope = { projectPath: '/projects/demo', sshRemoteId: 'server-a' };

function setup() {
	const onClose = vi.fn();
	render(
		<LayerStackProvider>
			<ProjectSettingsModal
				theme={mockTheme}
				name="Demo"
				scopes={[scope, { ...scope, sshRemoteId: 'server-b' }]}
				sessions={[
					createMockSession({
						toolType: 'codex',
						projectRoot: scope.projectPath,
						cwd: scope.projectPath,
						sessionSshRemoteConfig: { enabled: true, remoteId: 'server-a' },
					}),
				]}
				onClose={onClose}
			/>
		</LayerStackProvider>
	);
	return onClose;
}

beforeEach(() => {
	vi.clearAllMocks();
	useSettingsStore.setState({ newShell: false, uiLanguage: 'en' });
	for (const [id, caps] of Object.entries(AGENT_CAPABILITIES)) setCapabilitiesCache(id, caps);
	Object.assign(window.maestro.settings, { projectSettings: api });
	api.mockImplementation(async (command) => ({
		success: true,
		scope: command.scope,
		settings:
			command.action === 'show'
				? { defaultProvider: 'codex', envVars: { API_TOKEN: 'test-secret-value' } }
				: command.patch,
	}));
	vi.mocked(window.maestro.agents.getModels).mockResolvedValue(['test-model']);
	vi.mocked(window.maestro.agents.getConfigOptions).mockResolvedValue(['low', 'high']);
	vi.mocked(window.maestro.agents.getConfig).mockResolvedValue({});
});

describe('ProjectSettingsModal', () => {
	it('loads the selected host scope and saves only on explicit save', async () => {
		const onClose = setup();
		await screen.findByDisplayValue('test-secret-value');
		expect(screen.getByDisplayValue('test-secret-value')).toHaveAttribute('type', 'password');
		fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'test-model' } });
		expect(api.mock.calls.every(([command]) => command.action === 'show')).toBe(true);
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(api).toHaveBeenLastCalledWith(
			expect.objectContaining({
				action: 'set',
				scope,
				patch: expect.objectContaining({
					defaultModel: 'test-model',
					envVars: { API_TOKEN: 'test-secret-value' },
				}),
			})
		);
	});

	it('requires the full access explanation once and keeps cancel read only', async () => {
		const onClose = setup();
		await screen.findByDisplayValue('test-secret-value');
		fireEvent.change(screen.getByLabelText('Default permission'), { target: { value: 'full' } });
		expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
		fireEvent.click(screen.getByRole('checkbox'));
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(api).toHaveBeenLastCalledWith(expect.objectContaining({ acknowledgeFullAccess: true }));
	});

	it('isolates same-path settings on another host', async () => {
		setup();
		await screen.findByDisplayValue('test-secret-value');
		fireEvent.change(screen.getByLabelText('Project location'), { target: { value: '1' } });
		await waitFor(() =>
			expect(api).toHaveBeenLastCalledWith({
				action: 'show',
				scope: { ...scope, sshRemoteId: 'server-b' },
			})
		);
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(api.mock.calls.every(([command]) => command.action === 'show')).toBe(true);
	});
});

it('hides unsupported model and standard permission choices', async () => {
	setCapabilitiesCache('codex', {
		...AGENT_CAPABILITIES.codex,
		supportsModelSelection: false,
		supportsStandardPermissionMode: false,
	});
	setup();
	await screen.findByDisplayValue('test-secret-value');
	expect(screen.queryByLabelText('Default model')).not.toBeInTheDocument();
	expect(screen.queryByRole('option', { name: 'Standard' })).not.toBeInTheDocument();
});
it('does not save an invalid environment draft or close after a failed save', async () => {
	const close = setup();
	await screen.findByDisplayValue('test-secret-value');
	fireEvent.change(screen.getByDisplayValue('API_TOKEN'), { target: { value: 'INVALID-KEY' } });
	expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
	fireEvent.change(screen.getByDisplayValue('INVALID-KEY'), { target: { value: 'API_TOKEN' } });
	api.mockResolvedValueOnce({ success: false, code: 'persistence-failed', settings: {} });
	fireEvent.click(screen.getByRole('button', { name: 'Save' }));
	await screen.findByRole('alert');
	expect(close).not.toHaveBeenCalled();
	expect(screen.getByDisplayValue('test-secret-value')).toBeInTheDocument();
});

it('preserves hidden environment values when saving other settings from a browser', async () => {
	api.mockResolvedValue({
		success: true,
		scope,
		settings: { defaultProvider: 'codex', envVars: {} },
		environmentRedacted: true,
	});
	const close = setup();
	await screen.findByText('View and edit environment variables in the desktop app.');
	fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'test-model' } });
	fireEvent.click(screen.getByRole('button', { name: 'Save' }));
	await waitFor(() => expect(close).toHaveBeenCalled());
	expect(api.mock.calls.at(-1)![0].patch).not.toHaveProperty('envVars');
});

it('edits every project tool through the shared panel without changing conversations or another host', async () => {
	useSettingsStore.setState({ newShell: true });
	const owners = [
		createMockSession({
			id: 'claude-a',
			name: 'Primary Claude',
			toolType: 'claude-code',
			projectRoot: '/projects/demo',
			customPath: '/fixture/claude-old',
			enableMaestroP: true,
			maestroPMode: 'interactive',
			customEnvVars: { CLAUDE_CONFIG_DIR: '/fixture/account-a' },
		}),
		createMockSession({
			id: 'claude-b',
			name: 'Second Claude',
			toolType: 'claude-code',
			projectRoot: '/projects/demo',
			customPath: '/fixture/claude-other',
		}),
		createMockSession({
			id: 'remote',
			name: 'Remote Claude',
			projectRoot: '/projects/demo',
			sessionSshRemoteConfig: { enabled: true, remoteId: 'remote' },
		}),
	];
	useSessionStore.setState({ sessions: owners });
	vi.mocked(window.maestro.agents.detect).mockResolvedValue([
		{
			id: 'claude-code',
			name: 'Claude Code',
			binaryName: 'claude',
			available: true,
			path: '/fixture/claude',
			configOptions: [],
		},
	] as never);
	vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(true);
	vi.mocked(window.maestro.agents.getMaestroPDetectedPath).mockResolvedValue('/fixture/maestro-p');
	const close = vi.fn();
	render(
		<LayerStackProvider>
			<ProjectSettingsModal
				theme={mockTheme}
				name="Demo"
				scopes={[{ projectPath: '/projects/demo' }]}
				sessions={owners}
				onClose={close}
			/>
		</LayerStackProvider>
	);
	await screen.findByText('Tool configurations');
	expect(screen.getByText('New conversation defaults')).toBeInTheDocument();
	fireEvent.click(screen.getByText('Primary Claude', { exact: true }));
	await screen.findByDisplayValue('/fixture/claude-old');
	expect(screen.getByPlaceholderText('/fixture/maestro-p')).toBeInTheDocument();
	expect(screen.getByText('Second Claude', { exact: true })).toBeInTheDocument();
	expect(screen.queryByText('Remote Claude', { exact: true })).not.toBeInTheDocument();
	expect(
		screen.getAllByText('Changes affect all conversations using this tool configuration.').length
	).toBeGreaterThan(0);
	fireEvent.change(screen.getByDisplayValue('/fixture/claude-old'), {
		target: { value: '/fixture/claude-new' },
	});
	fireEvent.change(screen.getByDisplayValue('/fixture/account-a'), {
		target: { value: '/fixture/account-b' },
	});
	fireEvent.click(screen.getByRole('button', { name: 'claude -p', exact: true }));
	expect(window.maestro.sessions.setMany).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
	await waitFor(() => expect(close).toHaveBeenCalled());
	const saved = useSessionStore.getState().sessions;
	expect(saved[0]).toMatchObject({
		customPath: '/fixture/claude-new',
		customEnvVars: { CLAUDE_CONFIG_DIR: '/fixture/account-b' },
		enableMaestroP: false,
		maestroPMode: 'dynamic',
	});
	expect(saved[0].aiTabs).toEqual(owners[0].aiTabs);
	expect(saved.slice(1)).toEqual(owners.slice(1));
	expect(window.maestro.sessions.setMany).toHaveBeenCalledWith([saved[0]], []);
});

it('keeps tool configuration hidden in the classic shell', async () => {
	useSettingsStore.setState({ newShell: false, uiLanguage: 'en' });
	setup();
	await screen.findByDisplayValue('test-secret-value');
	expect(screen.queryByText('Tool configurations')).not.toBeInTheDocument();
});

it('explains why an active conversation prevents changing its SSH host', async () => {
	useSettingsStore.setState({ newShell: true });
	const owner = createMockSession({
		id: 'running-owner',
		name: 'Running Claude',
		projectRoot: '/projects/demo',
		toolType: 'claude-code',
	});
	useSessionStore.setState({ sessions: [owner] });
	vi.mocked(window.maestro.agents.detect).mockResolvedValue([
		{ id: 'claude-code', name: 'Claude Code', binaryName: 'claude', available: true },
	] as never);
	vi.mocked(window.maestro.sshRemote.getConfigs).mockResolvedValue({
		success: true,
		configs: [
			{
				id: 'remote',
				name: 'Remote host',
				host: 'fixture.invalid',
				username: 'fixture',
				enabled: true,
			},
		],
	} as never);
	vi.mocked(window.maestro.process.getActiveProcesses).mockResolvedValue([
		{ sessionId: 'running-owner-ai-tab', isTerminal: false },
	] as never);
	const close = vi.fn();
	render(
		<LayerStackProvider>
			<ProjectSettingsModal
				theme={mockTheme}
				name="Demo"
				scopes={[{ projectPath: '/projects/demo' }]}
				sessions={[owner]}
				onClose={close}
			/>
		</LayerStackProvider>
	);
	fireEvent.click(await screen.findByText('Running Claude', { exact: true }));
	const row = screen.getByTestId('project-tool-running-owner');
	await within(row).findByRole('option', { name: /Remote host/ });
	fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'remote' } });
	fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
	await screen.findByText(
		'Stop all conversations using this configuration before changing its SSH host.'
	);
	expect(close).not.toHaveBeenCalled();
	expect(window.maestro.sessions.setMany).not.toHaveBeenCalled();
	expect(useSessionStore.getState().sessions[0]).toEqual(owner);
});

it('uses project wording in Chinese and discards tool edits on Cancel', async () => {
	useSettingsStore.setState({ newShell: true, uiLanguage: 'zh-CN' });
	const owner = createMockSession({
		id: 'cancel-owner',
		name: 'Claude 配置',
		projectRoot: '/projects/demo',
		toolType: 'claude-code',
		customPath: '/fixture/original',
	});
	useSessionStore.setState({ sessions: [owner] });
	vi.mocked(window.maestro.agents.detect).mockResolvedValue([
		{ id: 'claude-code', name: 'Claude Code', binaryName: 'claude', available: true },
	] as never);
	vi.mocked(window.maestro.sshRemote.getConfigs).mockResolvedValue({ success: true, configs: [] });
	const close = vi.fn();
	render(
		<LayerStackProvider>
			<ProjectSettingsModal
				theme={mockTheme}
				name="Demo"
				scopes={[{ projectPath: '/projects/demo' }]}
				sessions={[owner]}
				onClose={close}
			/>
		</LayerStackProvider>
	);
	fireEvent.click(await screen.findByText('Claude 配置', { exact: true }));
	await screen.findByDisplayValue('/fixture/original');
	expect(screen.getByRole('dialog').textContent).not.toContain('智能体');
	fireEvent.change(screen.getByDisplayValue('/fixture/original'), {
		target: { value: '/fixture/discarded' },
	});
	fireEvent.click(screen.getByRole('button', { name: '取消', exact: true }));
	expect(close).toHaveBeenCalled();
	expect(window.maestro.sessions.setMany).not.toHaveBeenCalled();
	expect(api.mock.calls.every(([command]) => command.action === 'show')).toBe(true);
	expect(useSessionStore.getState().sessions[0]).toEqual(owner);
});
