import { beforeEach, describe, expect, it } from 'vitest';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { setCapabilitiesCache } from '../../../renderer/hooks/agent/useAgentCapabilities';
import { AGENT_CAPABILITIES } from '../../../main/agents/capabilities';
import { createTab } from '../../../renderer/utils/tabHelpers';

beforeEach(() => {
	useSettingsStore.setState({
		newShell: true,
		projectSettings: {
			'[null,"/test/project"]': {
				modelProvider: 'claude-code',
				defaultModel: 'project-model',
				defaultReasoningEffort: 'high',
				defaultPermissionMode: 'readonly',
			},
		},
	} as never);
	for (const [id, caps] of Object.entries(AGENT_CAPABILITIES)) setCapabilitiesCache(id, caps);
});

describe('project defaults for subsequent conversations', () => {
	it('snapshots project model and effort and tightens inherited permission', () => {
		const source = createMockAITab({ permissionMode: 'full' });
		const session = createMockSession({ customModel: 'global-model', aiTabs: [source] });
		const created = createTab(session, { permissionSource: { permissionMode: 'full' } })!;
		expect(created.tab).toMatchObject({
			customModel: 'project-model',
			customEffort: 'high',
			permissionMode: 'readonly',
		});
		expect(created.session.aiTabs[0]).toEqual(source);
		useSettingsStore.setState({ projectSettings: {} } as never);
		expect(created.tab.customModel).toBe('project-model');
	});
	it('inherits explicit current conversation choices above project defaults', () => {
		const source = createMockAITab({
			customModel: 'current-model',
			customEffort: 'low',
			permissionMode: 'readonly',
		});
		const created = createTab(createMockSession({ aiTabs: [source] }), {
			permissionSource: source,
		})!;
		expect(created.tab).toMatchObject({
			customModel: 'current-model',
			customEffort: 'low',
			permissionMode: 'readonly',
		});
	});
	it('keeps the classic shell and native history imports unchanged', () => {
		const session = createMockSession();
		useSettingsStore.setState({ newShell: false });
		expect(createTab(session)!.tab.customModel).toBeUndefined();
		useSettingsStore.setState({ newShell: true });
		expect(createTab(session, { agentSessionId: 'native' })!.tab.customModel).toBeUndefined();
	});
	it('isolates local defaults from the same project path on another SSH host', () => {
		const remote = createMockSession({
			sessionSshRemoteConfig: { enabled: true, remoteId: 'host-a' },
		});
		expect(
			createTab(remote, { permissionSource: { permissionMode: 'full' } })!.tab.customModel
		).toBeUndefined();
	});
});

it('does not apply inherited-tool project models or effort to a different tool', () => {
	const codex = createMockSession({ toolType: 'codex' });
	const created = createTab(codex, { permissionSource: { permissionMode: 'full' } })!;
	expect(created.tab.customModel).toBeUndefined();
	expect(created.tab.customEffort).toBeUndefined();
	expect(created.tab.permissionMode).toBe('readonly');
});

it('never treats legacy unbound model names as defaults for all tools', () => {
	useSettingsStore.setState({
		projectSettings: {
			'[null,"/test/project"]': { defaultModel: 'opus', defaultReasoningEffort: 'high' },
		},
	});
	const created = createTab(createMockSession({ toolType: 'codex' }), {
		permissionSource: { permissionMode: 'full' },
	})!;
	expect(created.tab.customModel).toBeUndefined();
	expect(created.tab.customEffort).toBeUndefined();
});
