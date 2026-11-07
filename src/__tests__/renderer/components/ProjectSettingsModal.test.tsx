import { setCapabilitiesCache } from '../../../renderer/hooks/agent/useAgentCapabilities';
import { AGENT_CAPABILITIES } from '../../../main/agents/capabilities';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectSettingsModal } from '../../../renderer/components/ProjectSettingsModal';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import { mockTheme } from '../../helpers/mockTheme';
import { createMockSession } from '../../helpers';

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
