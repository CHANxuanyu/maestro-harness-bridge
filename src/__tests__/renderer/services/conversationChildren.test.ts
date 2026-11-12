import { beforeEach, expect, it, vi } from 'vitest';
import { conversationChildren } from '../../../renderer/services/conversationChildren';
import { captureConversationSourceNativeId } from '../../../renderer/services/agentDelegation';
import { conversationDisclosureKey } from '../../../shared/conversationChildren';
import { buildProjectSessionTree } from '../../../renderer/utils/projectSessionTree';
import { sidebarSessionEquality } from '../../../renderer/stores/sessionEquality';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';

const record = {
	key: 'record',
	projectKey: 'path:local:/project',
	projectPath: '/project',
	provider: 'codex' as const,
	nativeSessionId: 'native',
	accountDir: '/synthetic/account',
	title: 'Parent',
	preview: '',
	createdAt: 1,
	modifiedAt: 2,
	messageCount: 1,
	starred: false,
};

beforeEach(() => {
	useSettingsStore.setState({ newShell: true });
	useSessionStore.setState({
		groups: [],
		sessions: [
			createMockSession({
				id: 'owner',
				toolType: 'codex',
				projectRoot: '/project',
				customEnvVars: { CODEX_HOME: '/synthetic/account' },
				aiTabs: [createMockAITab({ id: 'parent', agentSessionId: 'native' })],
			}),
		],
	});
	window.maestro.sessions.setMany = vi.fn().mockResolvedValue(true);
	window.maestro.agentSessions.archives = vi.fn().mockResolvedValue([]);
	window.maestro.agentSessions.listProjectHistory = vi
		.fn()
		.mockResolvedValue({ conversations: [record], errors: [] });
});

it.each([true, false])(
	'persists disclosure %s across tab closure, completion and restart',
	async (expanded) => {
		const before = useSessionStore.getState().sessions;
		expect(
			await conversationChildren({ sessionId: 'owner', tabId: 'parent', expanded })
		).toMatchObject({ expanded });
		expect(sidebarSessionEquality(before, useSessionStore.getState().sessions)).toBe(false);
		const saved = vi.mocked(window.maestro.sessions.setMany).mock.calls[0][0];
		const sessions = JSON.parse(JSON.stringify(saved));
		sessions[0].aiTabs = [];
		useSessionStore.setState({ sessions, activeSessionId: 'another' });
		expect(
			await conversationChildren({ sessionId: 'owner', nativeSessionId: 'native' })
		).toMatchObject({ parent: { key: 'history:record', tabId: null }, expanded });
		const child = createMockSession({
			id: 'child-owner',
			aiTabs: [
				createMockAITab({
					id: 'child',
					state: 'idle',
					origin: {
						kind: 'handoff',
						sourceSessionId: 'owner',
						sourceTabId: 'parent',
						sourceNativeSessionId: 'native',
						sourceProvider: 'codex',
						createdAt: 1,
					},
				}),
			],
		});
		const tree = buildProjectSessionTree({
			sessions: [...sessions, child],
			groups: [],
			newShell: true,
			history: [record],
		});
		expect(tree[0].conversations[0]).toMatchObject({
			ownerId: 'owner',
			expanded,
			children: [expect.objectContaining({ tabId: 'child' })],
		});
		expect(window.maestro.sessions.setMany).toHaveBeenCalledTimes(1);
	}
);

it('migrates a choice made before native identity arrives and never overwrites it on repeats', async () => {
	useSessionStore.getState().sessions[0].aiTabs[0].agentSessionId = null;
	await conversationChildren({ sessionId: 'owner', tabId: 'parent', expanded: true });
	captureConversationSourceNativeId('owner', 'parent', 'native', 'codex', false);
	expect(
		useSessionStore.getState().sessions[0].conversationTreeExpanded?.[
			conversationDisclosureKey(null, 'native')
		]
	).toBe(true);
	useSessionStore.getState().sessions[0].aiTabs[0].agentSessionId = 'native';
	await conversationChildren({ sessionId: 'owner', tabId: 'parent', expanded: false });
	captureConversationSourceNativeId('owner', 'parent', 'native', 'codex', false);
	expect((await conversationChildren({ sessionId: 'owner', tabId: 'parent' })).expanded).toBe(
		false
	);
});

it.each([{ accountDir: '/different' }, { sshRemoteId: 'different-host' }])(
	'refuses native lookup outside its account or host: %j',
	async (patch) => {
		useSessionStore.getState().sessions[0].aiTabs = [];
		vi.mocked(window.maestro.agentSessions.listProjectHistory).mockResolvedValue({
			conversations: [{ ...record, ...patch }],
			errors: [],
		} as never);
		await expect(
			conversationChildren({ sessionId: 'owner', nativeSessionId: 'native' })
		).rejects.toThrow('account and host');
		expect(window.maestro.sessions.setMany).not.toHaveBeenCalled();
	}
);

it('refuses classic shell mutations and reports persistence failure', async () => {
	useSettingsStore.setState({ newShell: false });
	await expect(
		conversationChildren({ sessionId: 'owner', tabId: 'parent', expanded: true })
	).rejects.toThrow('disabled');
	expect(window.maestro.sessions.setMany).not.toHaveBeenCalled();
	useSettingsStore.setState({ newShell: true });
	vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(false as never);
	await expect(
		conversationChildren({ sessionId: 'owner', tabId: 'parent', expanded: true })
	).rejects.toThrow('save');
});

it('resolves an archived closed source through the same account matcher without unarchiving it', async () => {
	useSessionStore.getState().sessions[0].aiTabs = [];
	vi.mocked(window.maestro.agentSessions.listProjectHistory).mockResolvedValue({
		conversations: [],
		errors: [],
	} as never);
	window.maestro.agentSessions.archives = vi
		.fn()
		.mockResolvedValue([
			{ ...record, archivedAt: 1, ownerIds: ['owner'], permissionMode: 'readonly' },
		]);
	expect(
		await conversationChildren({ sessionId: 'owner', nativeSessionId: 'native' })
	).toMatchObject({ parent: { nativeSessionId: 'native', tabId: null } });
	expect(window.maestro.sessions.setMany).not.toHaveBeenCalled();
});
