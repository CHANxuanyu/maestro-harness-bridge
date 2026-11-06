import { getWindowContext } from '../contexts/WindowContext';
import { patchNewShellPanel } from '../../shared/newShellPanel';
import { useSessionStore, updateAiTab, updateSessionWith } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import {
	addTerminalTab,
	createTerminalTab,
	panelTerminalLocation,
	panelTerminals,
} from '../utils/terminalTabHelpers';

export { panelTerminalLocation, panelTerminals } from '../utils/terminalTabHelpers';

export function selectPanelTerminal(sessionId: string, tabId: string, conversationId?: string) {
	const { sessions } = useSessionStore.getState();
	const source = sessions.find((s) => s.id === sessionId);
	if (!source || !useSettingsStore.getState().newShell) return false;
	const target = panelTerminals(sessions, source).find((item) => item.tab.id === tabId);
	if (!target) return false;
	updateSessionWith(target.session.id, (s) => ({ ...s, activeTerminalTabId: tabId }));
	updateAiTab(source.id, conversationId || source.activeTabId, (tab) => ({
		...tab,
		newShellPanel: patchNewShellPanel(tab.newShellPanel, {
			tab: 'terminal',
			terminalTabId: tabId,
			open: true,
		}),
	}));
	if (useSessionStore.getState().activeSessionId === source.id) {
		useUIStore.getState().setRightPanelOpen(true);
		useUIStore.getState().setActiveFocus('right');
	}
	return true;
}

export function openPanelTerminal(
	sessionId: string,
	options: {
		additional?: boolean;
		background?: boolean;
		cwd?: string;
		shell?: string;
		name?: string | null;
		command?: string;
	} = {}
) {
	if (!useSettingsStore.getState().newShell) return null;
	const { sessions } = useSessionStore.getState();
	const source = sessions.find((s) => s.id === sessionId);
	if (!source || getWindowContext()?.ownsSession(source.id, true) === false) return null;
	const location = panelTerminalLocation(source, options.cwd);
	const pool = panelTerminals(sessions, source, options.cwd);
	const selected = source.aiTabs?.find((t) => t.id === source.activeTabId)?.newShellPanel
		?.terminalTabId;
	let target = options.additional
		? undefined
		: pool.find((item) => item.tab.id === selected) || pool[0];
	if (!target) {
		const owner = source;
		const tab = {
			...createTerminalTab(options.shell, location.cwd, options.name),
			panelLocationKey: location.key,
			...(options.command?.trim() ? { startupCommand: options.command.trim() } : {}),
		};
		updateSessionWith(owner.id, (s) => addTerminalTab(s, tab, { activate: false }));
		target = { session: owner, tab };
	}
	if (!target.tab.panelLocationKey) {
		updateSessionWith(target.session.id, (s) => ({
			...s,
			terminalTabs: s.terminalTabs.map((tab) =>
				tab.id === target.tab.id ? { ...tab, panelLocationKey: location.key } : tab
			),
		}));
	}
	if (!options.background) selectPanelTerminal(source.id, target.tab.id);
	return {
		...target,
		session: useSessionStore.getState().sessions.find((s) => s.id === target.session.id)!,
	};
}
