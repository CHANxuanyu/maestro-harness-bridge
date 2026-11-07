import { beforeEach, expect, it, vi } from 'vitest';
import { newProjectConversation } from '../../../renderer/services/newShellConversation';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { createMockSession } from '../../helpers/mockSession';

const session = createMockSession({
	id: 'owner',
	toolType: 'claude-code',
	cwd: '/project',
	projectRoot: '/project',
});
beforeEach(() => {
	useSettingsStore.setState({
		newShell: true,
		projectSettings: {
			'[null,"/project"]': { defaultProvider: 'codex', envVars: { PROJECT: 'value' } },
		},
	});
	window.maestro.context.conversation = vi
		.fn()
		.mockResolvedValue({ success: true, agentId: 'created', tabId: 'created-tab' });
});
it('routes project creation to its default tool through the UI and CLI service', async () => {
	expect(await newProjectConversation(session, undefined, true)).toMatchObject({
		agentId: 'created',
	});
	expect(window.maestro.context.conversation).toHaveBeenCalledWith({
		action: 'new-conversation',
		sourceAgentId: 'owner',
		targetProvider: 'codex',
		sourceTabId: undefined,
		background: true,
	});
});
it('keeps the current conversation tool above the project default', async () => {
	await newProjectConversation(session, 'current');
	expect(window.maestro.context.conversation).toHaveBeenCalledWith(
		expect.objectContaining({ targetProvider: 'claude-code', sourceTabId: 'current' })
	);
});
it('does not redirect classic creation or projects without defaults', async () => {
	useSettingsStore.setState({ newShell: false });
	expect(await newProjectConversation(session)).toBeNull();
	useSettingsStore.setState({ newShell: true, projectSettings: {} });
	expect(await newProjectConversation(session)).toBeNull();
	expect(window.maestro.context.conversation).not.toHaveBeenCalled();
});
