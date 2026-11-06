import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useTabStore } from '../../../renderer/stores/tabStore';
import { createTab, permissionModeFields } from '../../../renderer/utils/tabHelpers';
import {
	snoozeTab,
	snoozeTabGroup,
	collectSnoozedAiTabs,
} from '../../../renderer/utils/snoozeHelpers';
import { createGroupFromDrop } from '../../../renderer/utils/panelLayout';
import { switchSessionProvider } from '../../../renderer/utils/providerTabSessions';
import { useSnoozeScheduler } from '../../../renderer/hooks/tabs/useSnoozeScheduler';
import { tileNewTabInSession } from '../../../renderer/services/tileNewTabAction';
import { conversationPermissionSnapshot } from '../../../renderer/utils/newConversationPermissions';
import { setCapabilitiesCache } from '../../../renderer/hooks/agent/useAgentCapabilities';
import { AGENT_CAPABILITIES } from '../../../main/agents/capabilities';
import { enqueuePromptForTab } from '../../../renderer/services/queuedPrompt';
import { buildAgentArgs } from '../../../main/utils/agent-args';
import { getAgentDefinition } from '../../../main/agents/definitions';
import type { AgentConfig } from '../../../main/agents';

vi.mock('../../../renderer/services/queuedPrompt', () => ({ enqueuePromptForTab: vi.fn() }));
vi.mock('../../../renderer/utils/snoozeTranscriptMirror', () => ({
	releaseSnoozedTranscript: vi.fn(),
}));
vi.mock('../../../renderer/stores/snoozeHistoryStore', () => ({ recordSnoozeResolution: vi.fn() }));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(enqueuePromptForTab).mockReset();
	useSettingsStore.setState({ newShell: true });
	useSessionStore.setState({ sessions: [], groups: [] });
	for (const [id, capabilities] of Object.entries(AGENT_CAPABILITIES))
		setCapabilitiesCache(id, capabilities);
	window.maestro.windows = {
		...window.maestro.windows,
		getConversationPermissions: vi.fn().mockResolvedValue([null, null]),
	};
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('creation boundary', () => {
	it('uses project recency only when this owner has no known conversations', () => {
		const target = createMockSession({ id: 'empty', aiTabs: [] });
		const peer = createMockSession({
			id: 'peer',
			aiTabs: [createMockAITab(permissionModeFields('standard'))],
		});
		useSessionStore.setState({ sessions: [target, peer] });
		expect(createTab(target)!.tab).toMatchObject(permissionModeFields('standard'));
		const withKnownFull = { ...target, aiTabs: [createMockAITab(permissionModeFields('full'))] };
		expect(createTab(withKnownFull)!.tab).toMatchObject(permissionModeFields('full'));
	});

	it('leaves classic creation and tiling permissions unchanged without owner queries', async () => {
		useSettingsStore.setState({ newShell: false });
		const source = createMockAITab({ id: 'source', ...permissionModeFields('readonly') });
		const session = createMockSession({ aiTabs: [source], activeTabId: source.id });
		useSessionStore.setState({ sessions: [session] });
		expect(createTab(session)!.tab.permissionMode).toBeUndefined();
		expect(await tileNewTabInSession(session.id, 'ai')).toBe(true);
		expect(window.maestro.windows.getConversationPermissions).not.toHaveBeenCalled();
		expect(useSessionStore.getState().sessions[0].aiTabs[1].permissionMode).toBeUndefined();
	});
	it.each([
		'open',
		'hidden',
		'closed',
		'unifiedClosed',
		'orphan',
		'snoozed',
		'snoozedGroup',
	] as const)(
		'uses the strictest known %s conversation even when full access was selected later',
		(location) => {
			const strict = createMockAITab({
				id: 'strict',
				createdAt: 1,
				...permissionModeFields('readonly'),
			});
			const recent = createMockAITab({
				id: 'recent',
				createdAt: 100,
				...permissionModeFields('full'),
			});
			let session = createMockSession({ aiTabs: [recent], activeTabId: recent.id });
			if (location === 'open') session.aiTabs.push(strict);
			if (location === 'hidden') session.aiTabs.push({ ...strict, hidden: true });
			if (location === 'closed')
				session.closedTabHistory = [{ tab: strict, index: 0, closedAt: 1 }];
			if (location === 'unifiedClosed')
				session.unifiedClosedTabHistory = [
					{ type: 'ai', tab: strict, unifiedIndex: 0, closedAt: 1 },
				];
			if (location === 'orphan') session.orphanedThinkingTabs = [strict];
			if (location === 'snoozed' || location === 'snoozedGroup') {
				session.aiTabs.push(strict);
				if (location === 'snoozed') session = snoozeTab(session, strict.id, 1)!.session;
				else {
					session = createGroupFromDrop(
						session,
						{ type: 'ai', id: strict.id },
						{ type: 'ai', id: recent.id },
						'bottom',
						'Group'
					);
					session = snoozeTabGroup(session, session.activeGroupId!, 1)!.session;
					session.aiTabs.push(recent);
				}
			}
			expect(createTab(session)!.tab).toMatchObject(permissionModeFields('readonly'));
		}
	);

	it('validates a new conversation with initial context, while native history retains its semantics', () => {
		const source = createMockAITab({ ...permissionModeFields('standard') });
		const session = createMockSession({ toolType: 'codex', aiTabs: [source] });
		const logs = [
			{ id: 'context', timestamp: 1, source: 'user' as const, text: 'Synthetic context' },
		];
		expect(createTab(session, { logs, permissionSource: source })!.tab).toMatchObject(
			permissionModeFields('readonly')
		);
		expect(
			createTab(session, { logs, agentSessionId: 'native-history' })!.tab.permissionMode
		).toBeUndefined();
	});

	it.each(['missing', 'live'] as const)(
		'tiling resolves the project owners when their reply is %s',
		async (reply) => {
			const tab = createMockAITab({ id: 'full', ...permissionModeFields('full') });
			const target = createMockSession({ id: 'target', aiTabs: [tab], activeTabId: tab.id });
			const peer = { ...target, id: 'peer' };
			useSessionStore.setState({ sessions: [target, peer] });
			if (reply === 'live')
				vi.mocked(window.maestro.windows.getConversationPermissions).mockResolvedValue([
					conversationPermissionSnapshot(target.id),
					{
						...conversationPermissionSnapshot(peer.id)!,
						tabs: [
							{
								id: 'tightened',
								lastActivity: Date.now() + 1,
								...permissionModeFields('readonly'),
							},
						],
					},
				]);
			expect(await tileNewTabInSession(target.id, 'ai')).toBe(true);
			expect(window.maestro.windows.getConversationPermissions).toHaveBeenCalledExactlyOnceWith([
				'target',
				'peer',
			]);
			expect(useSessionStore.getState().sessions[0].aiTabs[1]).toMatchObject(
				permissionModeFields('readonly')
			);
		}
	);
});

describe.each(['single', 'group'] as const)('%s snooze permissions', (kind) => {
	function parkedSession() {
		const tabs = ['first', 'second'].map((id) =>
			createMockAITab({ id, ...permissionModeFields('standard') })
		);
		let session = createMockSession({ aiTabs: tabs, activeTabId: tabs[0].id });
		if (kind === 'group')
			session = createGroupFromDrop(
				session,
				{ type: 'ai', id: 'first' },
				{ type: 'ai', id: 'second' },
				'bottom',
				'Group'
			);
		const parked =
			kind === 'single'
				? snoozeTab(session, 'first', 1, { wakePrompt: 'Synthetic wake' })!
				: snoozeTabGroup(session, session.activeGroupId!, 1, { wakePrompt: 'Synthetic wake' })!;
		return switchSessionProvider(parked.session, 'codex', AGENT_CAPABILITIES.codex)!;
	}

	it('validates an already open duplicate before a wake prompt can use it', () => {
		const session = parkedSession();
		const entry = session.snoozedTabs![0];
		session.aiTabs = collectSnoozedAiTabs(entry);
		if (entry.type === 'group') session.tabGroups = [entry.group];
		useSessionStore.setState({ sessions: [session] });
		expect(useTabStore.getState().unsnoozeTab(session.id, entry.id)).not.toBeNull();
		for (const tab of useSessionStore.getState().sessions[0].aiTabs)
			expect(tab).toMatchObject(permissionModeFields('readonly'));
		expect(enqueuePromptForTab).toHaveBeenCalledTimes(1);
	});

	it('keeps classic restoration fields even when the current tool cannot preserve the restriction', () => {
		const session = parkedSession();
		useSettingsStore.setState({ newShell: false });
		setCapabilitiesCache('codex', { ...AGENT_CAPABILITIES.codex, supportsReadOnlyMode: false });
		useSessionStore.setState({ sessions: [session] });
		expect(
			useTabStore.getState().unsnoozeTab(session.id, session.snoozedTabs![0].id)
		).not.toBeNull();
		expect(
			useSessionStore.getState().sessions[0].aiTabs.find((tab) => tab.id === 'first')
		).toMatchObject(permissionModeFields('standard'));
		expect(enqueuePromptForTab).toHaveBeenCalledTimes(1);
	});

	it.each(['manual', 'scheduled'] as const)(
		'%s wake tightens standard to readonly before queueing',
		(route) => {
			const session = parkedSession();
			useSessionStore.setState({ sessions: [session] });
			vi.mocked(enqueuePromptForTab).mockImplementation(() => {
				const tab = useSessionStore
					.getState()
					.sessions[0].aiTabs.find((tab) => tab.id === 'first')!;
				expect(tab).toMatchObject(permissionModeFields('readonly'));
				const args = buildAgentArgs(
					{
						...getAgentDefinition('codex')!,
						capabilities: AGENT_CAPABILITIES.codex,
						available: true,
					} as AgentConfig,
					{
						baseArgs: [],
						prompt: 'Synthetic wake',
						permissionMode: tab.permissionMode,
						readOnlyMode: tab.readOnlyMode,
					}
				);
				expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
				expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
				return null;
			});
			if (route === 'manual')
				useTabStore.getState().unsnoozeTab(session.id, session.snoozedTabs![0].id);
			else renderHook(() => useSnoozeScheduler());
			expect(enqueuePromptForTab).toHaveBeenCalledTimes(1);
			expect(useSessionStore.getState().sessions[0].snoozedTabs).toEqual([]);
		}
	);

	it.each(['manual', 'scheduled'] as const)(
		'%s wake retains the whole snooze and queues nothing when the target cannot preserve permissions',
		(route) => {
			const session = parkedSession();
			setCapabilitiesCache('codex', { ...AGENT_CAPABILITIES.codex, supportsReadOnlyMode: false });
			useSessionStore.setState({ sessions: [session] });
			if (route === 'manual')
				expect(
					useTabStore.getState().unsnoozeTab(session.id, session.snoozedTabs![0].id)
				).toBeNull();
			else renderHook(() => useSnoozeScheduler());
			expect(useSessionStore.getState().sessions[0]).toEqual(session);
			expect(enqueuePromptForTab).not.toHaveBeenCalled();
		}
	);
});
