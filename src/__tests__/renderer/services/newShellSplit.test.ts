import { beforeEach, expect, it, vi } from 'vitest';
import { createMockSession, createMockAITab, resetStores } from '../../helpers';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import {
	splitConversation,
	unsplitConversation,
	focusSplitConversation,
	readNewShellSplit,
} from '../../../renderer/services/newShellSplit';

beforeEach(() => {
	resetStores(useSettingsStore, useSessionStore);
	useSettingsStore.setState({ newShell: true });
	Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
	window.maestro.settings.set = vi.fn().mockResolvedValue(undefined);
	useSessionStore.setState({
		activeSessionId: 'a',
		sessions: ['a', 'b', 'c'].map((id) =>
			createMockSession({
				id,
				activeTabId: `${id}-tab`,
				aiTabs: [createMockAITab({ id: `${id}-tab`, permissionMode: 'readonly' })],
			})
		),
	});
});

it('opens existing cross-provider conversations equally and persists without creating tabs', async () => {
	await splitConversation('b', 'b-tab');
	expect(useSettingsStore.getState().newShellSplit).toEqual({
		left: { sessionId: 'a', tabId: 'a-tab' },
		right: { sessionId: 'b', tabId: 'b-tab' },
		ratio: 0.5,
	});
	expect(window.maestro.settings.set).toHaveBeenCalledWith(
		'newShellSplit',
		useSettingsStore.getState().newShellSplit
	);
	expect(useSessionStore.getState().activeSessionId).toBe('b');
	expect(useSessionStore.getState().sessions.every((s) => s.aiTabs.length === 1)).toBe(true);
	expect(useSessionStore.getState().sessions[1].aiTabs[0].permissionMode).toBe('readonly');
});

it('rejects the same conversation and disabled or narrow shell without changing focus', async () => {
	await expect(splitConversation('a', 'a-tab')).rejects.toThrow();
	useSettingsStore.setState({ newShell: false });
	await expect(splitConversation('b', 'b-tab')).rejects.toThrow();
	useSettingsStore.setState({ newShell: true });
	Object.defineProperty(window, 'innerWidth', { value: 900, configurable: true });
	await expect(splitConversation('b', 'b-tab')).rejects.toThrow();
	expect(window.maestro.settings.set).not.toHaveBeenCalled();
	expect(useSessionStore.getState().activeSessionId).toBe('a');
});

it('keeps the left pane when replacing the right, and changes ratio without duplicating it', async () => {
	await splitConversation('b', 'b-tab');
	await splitConversation('c', 'c-tab');
	await splitConversation('c', 'c-tab', 0.6);
	expect(useSettingsStore.getState().newShellSplit).toEqual({
		left: { sessionId: 'a', tabId: 'a-tab' },
		right: { sessionId: 'c', tabId: 'c-tab' },
		ratio: 0.6,
	});
	await expect(splitConversation('c', 'c-tab', NaN)).rejects.toThrow();
	await expect(splitConversation('c', 'c-tab', 0.01)).rejects.toThrow();
});

it('focuses a pane for the right panel and unsplits without deleting or stopping either tab', async () => {
	await splitConversation('b', 'b-tab');
	focusSplitConversation({ sessionId: 'a', tabId: 'a-tab' });
	expect(useSessionStore.getState().activeSessionId).toBe('a');
	await unsplitConversation();
	expect(useSettingsStore.getState().newShellSplit).toBeNull();
	expect(useSessionStore.getState().sessions).toHaveLength(3);
	expect(useSessionStore.getState().activeSessionId).toBe('a');
});

it('restores only well-formed references and sizes', () => {
	const saved = {
		left: { sessionId: 'a', tabId: 'a-tab' },
		right: { sessionId: 'b', tabId: 'b-tab' },
		ratio: 0.6,
	};
	expect(readNewShellSplit(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
	expect(readNewShellSplit({ ...saved, right: saved.left })).toBeNull();
	expect(readNewShellSplit({ ...saved, ratio: Infinity })).toBeNull();
	expect(readNewShellSplit({ left: {}, right: {}, ratio: 0.5 })).toBeNull();
});

it('resizes the pair without changing the focused conversation', async () => {
	await splitConversation('b', 'b-tab');
	focusSplitConversation({ sessionId: 'a', tabId: 'a-tab' });
	await splitConversation('b', 'b-tab', 0.6);
	expect(useSessionStore.getState().activeSessionId).toBe('a');
	expect(useSettingsStore.getState().newShellSplit?.ratio).toBe(0.6);
});

it('starts a fresh pair from a third conversation instead of reviving a hidden left pane', async () => {
	await splitConversation('b', 'b-tab');
	focusSplitConversation({ sessionId: 'c', tabId: 'c-tab' });
	await splitConversation('b', 'b-tab');
	expect(useSettingsStore.getState().newShellSplit?.left).toEqual({
		sessionId: 'c',
		tabId: 'c-tab',
	});
});

it('keeps the saved layout and focus when persistence rejects', async () => {
	await splitConversation('b', 'b-tab');
	const before = useSettingsStore.getState().newShellSplit;
	vi.mocked(window.maestro.settings.set).mockRejectedValueOnce(new Error('disk full'));
	await expect(splitConversation('c', 'c-tab')).rejects.toThrow('disk full');
	expect(useSettingsStore.getState().newShellSplit).toBe(before);
	expect(useSessionStore.getState().activeSessionId).toBe('b');
});

it('keeps SSH paths, account configuration and permissions unchanged when pairing existing conversations', async () => {
	useSessionStore.getState().setSessions((sessions) =>
		sessions.map((session) => ({
			...session,
			cwd: '~/remote/project',
			fullPath: '~/remote/project',
			projectRoot: '~/remote/project',
			sessionSshRemoteConfig: { enabled: true, remoteId: 'test-host' },
			customEnvVars: { TEST_ACCOUNT: '/remote/account' },
		}))
	);
	const before = useSessionStore.getState().sessions.map((session) => ({
		cwd: session.cwd,
		fullPath: session.fullPath,
		ssh: session.sessionSshRemoteConfig,
		env: session.customEnvVars,
		tabs: session.aiTabs,
	}));
	await splitConversation('b', 'b-tab');
	await unsplitConversation();
	expect(
		useSessionStore.getState().sessions.map((session) => ({
			cwd: session.cwd,
			fullPath: session.fullPath,
			ssh: session.sessionSshRemoteConfig,
			env: session.customEnvVars,
			tabs: session.aiTabs,
		}))
	).toEqual(before);
});

it('refuses splitting when the center is too narrow despite a wide window', async () => {
	const content = document.createElement('div');
	content.dataset.testid = 'new-shell-split-layout';
	document.body.append(content);
	vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ width: 600 } as DOMRect);
	try {
		await expect(splitConversation('b', 'b-tab')).rejects.toThrow('too narrow');
		expect(useSettingsStore.getState().newShellSplit).toBeNull();
	} finally {
		content.remove();
	}
});
