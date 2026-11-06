import { beforeEach, expect, it, vi } from 'vitest';
import {
	chooseProject,
	openProject,
	openProjectTarget,
} from '../../../renderer/services/openProject';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useUIStore } from '../../../renderer/stores/uiStore';
import { useGroupChatStore } from '../../../renderer/stores/groupChatStore';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';

beforeEach(() => {
	useSettingsStore.setState({
		newShell: true,
		collapsedConversationProjects: ['path:local:/fixture'],
	});
	useSessionStore.setState({ sessions: [], groups: [], activeSessionId: '' });
	useUIStore.setState({ leftSidebarOpen: false, leftSidebarHidden: true, focusRequest: null });
	useGroupChatStore.setState({ activeGroupChatId: 'chat' });
	Object.assign(window.maestro.agentSessions, {
		openProject: vi.fn().mockResolvedValue({ success: true, sessionId: 'owner' }),
	});
	window.maestro.dialog.selectFolder = vi.fn().mockResolvedValue('/fixture');
	window.maestro.sessions.setMany = vi.fn().mockResolvedValue(undefined);
});
it.each([false, true])('gates the picker and shared IPC on the new shell %s', async (newShell) => {
	useSettingsStore.setState({ newShell });
	await chooseProject();
	expect(window.maestro.dialog.selectFolder).toHaveBeenCalledTimes(newShell ? 1 : 0);
	expect(window.maestro.agentSessions.openProject).toHaveBeenCalledTimes(newShell ? 1 : 0);
});
it('selects an existing agent, expands its project and requests its composer focus without creating', async () => {
	const tab = createMockAITab({ id: 'tab' });
	const session = createMockSession({
		id: 'owner',
		cwd: '/fixture',
		projectRoot: '/fixture',
		aiTabs: [tab],
		activeTabId: tab.id,
	});
	useSessionStore.setState({ sessions: [session] });
	const create = vi.fn();
	expect(await openProjectTarget({ path: '/fixture', sessionId: 'owner' }, create)).toEqual({
		success: true,
		sessionId: 'owner',
	});
	expect(create).not.toHaveBeenCalled();
	expect(useSessionStore.getState().activeSessionId).toBe('owner');
	expect(useSettingsStore.getState().collapsedConversationProjects).toEqual([]);
	expect(useGroupChatStore.getState().activeGroupChatId).toBeNull();
	expect(useUIStore.getState()).toMatchObject({
		leftSidebarOpen: true,
		leftSidebarHidden: false,
		activeFocus: 'main',
		focusRequest: { tab: { type: 'ai', id: 'tab' } },
	});
});
it('creates through the GUI callback once for concurrent requests and persists before acknowledging', async () => {
	const create = vi.fn(async () => {
		useSessionStore.setState({
			sessions: [createMockSession({ id: 'owner', cwd: '/fixture', projectRoot: '/fixture' })],
		});
	});
	const target = { path: '/fixture', toolType: 'codex', name: 'fixture' };
	const results = await Promise.all([
		openProjectTarget(target, create),
		openProjectTarget(target, create),
	]);
	expect(create).toHaveBeenCalledExactlyOnceWith('codex', '/fixture', 'fixture');
	expect(results.every((result) => result.success)).toBe(true);
	expect(window.maestro.sessions.setMany).toHaveBeenCalledTimes(2);
});
it('does nothing in the classic shell and surfaces a no-tools result without sending content', async () => {
	useSettingsStore.setState({ newShell: false });
	const create = vi.fn();
	expect(
		(await openProjectTarget({ path: '/fixture', toolType: 'codex', name: 'fixture' }, create))
			.success
	).toBe(false);
	expect(create).not.toHaveBeenCalled();
	useSettingsStore.setState({ newShell: true });
	window.maestro.agentSessions.openProject = vi
		.fn()
		.mockResolvedValue({ success: false, code: 'no-tools', error: 'Install a tool' });
	expect(await openProject('/fixture')).toMatchObject({ success: false, code: 'no-tools' });
});
