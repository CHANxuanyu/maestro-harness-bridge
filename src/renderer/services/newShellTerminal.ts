import { handoffLocation } from '../../shared/aiHandoff';
import { patchNewShellPanel } from '../../shared/newShellPanel';
import { useSessionStore, updateAiTab, updateSessionWith } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { addTerminalTab, createTerminalTab } from '../utils/terminalTabHelpers';
import type { Session } from '../types';

/** Same effective directory and host rules as handoff, including legacy SSH sessions. */
export function panelTerminalLocation(session: Session, cwd?: string) {
	const ssh = session.sessionSshRemoteConfig?.enabled
		? session.sessionSshRemoteConfig
		: session.sshRemoteId
			? { enabled: true, remoteId: session.sshRemoteId, workingDirOverride: session.remoteCwd }
			: undefined;
	return handoffLocation({
		cwd: cwd || session.cwd,
		sessionSshRemoteConfig: ssh
			? {
					...ssh,
					workingDirOverride: cwd || ssh.workingDirOverride || session.remoteCwd || session.cwd,
				}
			: undefined,
	});
}

/** Terminals stay owned by their original agent so process IDs and CLI addressing remain stable. */
export function panelTerminals(sessions: Session[], source: Session, cwd?: string) {
	const location = panelTerminalLocation(source, cwd);
	return sessions.flatMap((session) =>
		(session.terminalTabs || []).flatMap((tab) => {
			try {
				return (tab.panelLocationKey ||
					panelTerminalLocation(session, tab.cwd || undefined).key) === location.key
					? [{ session, tab }]
					: [];
			} catch {
				return [];
			}
		})
	);
}

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
	if (!source) return null;
	const location = panelTerminalLocation(source, options.cwd);
	const pool = panelTerminals(sessions, source);
	const selected = source.aiTabs?.find((t) => t.id === source.activeTabId)?.newShellPanel
		?.terminalTabId;
	let target = options.additional
		? undefined
		: pool.find((item) => item.tab.id === selected) || pool[0];
	if (!target) {
		const owner = pool[0]?.session || source;
		const tab = {
			...createTerminalTab(options.shell, location.cwd, options.name),
			panelLocationKey: panelTerminalLocation(source).key,
			...(options.command?.trim() ? { startupCommand: options.command.trim() } : {}),
		};
		updateSessionWith(owner.id, (s) => addTerminalTab(s, tab, { activate: false }));
		target = { session: owner, tab };
	}
	if (!target.tab.panelLocationKey) {
		updateSessionWith(target.session.id, (s) => ({
			...s,
			terminalTabs: s.terminalTabs.map((tab) =>
				tab.id === target.tab.id
					? { ...tab, panelLocationKey: panelTerminalLocation(source).key }
					: tab
			),
		}));
	}
	if (!options.background) selectPanelTerminal(source.id, target.tab.id);
	return {
		...target,
		session: useSessionStore.getState().sessions.find((s) => s.id === target.session.id)!,
	};
}
