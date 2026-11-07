import { beforeEach, expect, it, vi } from 'vitest';
import { conversationLifecycle } from '../../../renderer/services/conversationArchive';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';

beforeEach(() => {
	useSettingsStore.setState({ newShell: true });
	window.maestro.tabs = { ...window.maestro.tabs, closed: vi.fn() };
});
it('retains actual conversation activity so unarchive does not make an old permission most recent', () => {
	const tab = createMockAITab({
		id: 'old',
		agentSessionId: 'native',
		createdAt: 1,
		lastSelectedAt: 2,
		logs: [{ id: 'log', timestamp: 3, source: 'assistant', text: 'Synthetic reply' }],
	});
	useSessionStore.setState({ sessions: [createMockSession({ id: 'owner', aiTabs: [tab] })] });
	expect(
		conversationLifecycle({
			ownerIds: ['owner'],
			nativeSessionId: 'native',
			phase: 'close',
			action: 'archive',
		})
	).toMatchObject({ lastActivity: 3 });
});
it.each(['busy', 'queued', 'orphan'] as const)(
	'rejects a %s conversation without closing its tabs',
	(kind) => {
		const tab = createMockAITab({
			id: 'tab',
			agentSessionId: 'native',
			state: kind === 'queued' ? 'idle' : 'busy',
		});
		const owner = createMockSession({
			id: 'owner',
			aiTabs: kind === 'orphan' ? [] : [tab],
			orphanedThinkingTabs: kind === 'orphan' ? [tab] : [],
			executionQueue: kind === 'queued' ? ([{ tabId: tab.id }] as never) : [],
		});
		useSessionStore.setState({ sessions: [owner] });
		expect(
			conversationLifecycle({
				ownerIds: ['owner'],
				nativeSessionId: 'native',
				phase: 'close',
				action: 'archive',
			})
		).toEqual({ error: 'conversation-running' });
		expect(useSessionStore.getState().sessions[0]).toBe(owner);
	}
);
it('closes all matching tabs, leaves other native IDs alone and retains the strictest permission', () => {
	const one = createMockAITab({ id: 'one', agentSessionId: 'native', permissionMode: 'full' });
	const two = createMockAITab({ id: 'two', agentSessionId: 'native', permissionMode: 'readonly' });
	const other = createMockAITab({ id: 'other', agentSessionId: 'other' });
	useSessionStore.setState({
		sessions: [createMockSession({ id: 'owner', aiTabs: [one, two, other], activeTabId: one.id })],
	});
	expect(
		conversationLifecycle({
			ownerIds: ['owner'],
			nativeSessionId: 'native',
			phase: 'close',
			action: 'archive',
		}).permissionMode
	).toBe('readonly');
	expect(useSessionStore.getState().sessions[0].aiTabs).toEqual([other]);
});
it('keeps an intentionally empty project and removes reopen history', () => {
	const tab = createMockAITab({ id: 'tab', agentSessionId: 'native', permissionMode: 'readonly' });
	useSessionStore.setState({
		sessions: [
			createMockSession({
				id: 'owner',
				aiTabs: [tab],
				activeTabId: tab.id,
				closedTabHistory: [{ tab, index: 0, closedAt: 1 }],
			}),
		],
	});
	conversationLifecycle({
		ownerIds: ['owner'],
		nativeSessionId: 'native',
		phase: 'close',
		action: 'archive',
	});
	expect(useSessionStore.getState().sessions[0]).toMatchObject({
		aiTabs: [],
		closedTabHistory: [],
		conversationArchiveEmpty: true,
	});
});
it('refuses an unavailable owner window', () => {
	useSessionStore.setState({ sessions: [] });
	expect(
		conversationLifecycle({
			ownerIds: ['missing'],
			nativeSessionId: 'native',
			phase: 'check',
			action: 'archive',
		})
	).toEqual({ error: 'conversation-owner-unavailable' });
});
