import { changeNewShellPanel, patchNewShellPanel } from '../../shared/newShellPanel';
import { useSettingsStore } from '../stores/settingsStore';
import { updateAiTab, useSessionStore } from '../stores/sessionStore';
import { isHttpBrowserTabUrl } from '../utils/browserTabPersistence';
import type { BrowserTabViewHandle } from '../components/MainPanel/BrowserTabView';

// Live handles only. URLs and panel selection use the existing conversation persistence.
export const newShellWebViews = new Map<string, BrowserTabViewHandle>();

export async function applyNewShellWebAction(
	sessionId: string,
	tabId: string,
	action: 'web' | 'web-reload' | 'web-external',
	url?: string
): Promise<void> {
	if (!useSettingsStore.getState().newShell) throw new Error('This panel requires the new shell');
	const tab = useSessionStore
		.getState()
		.sessions.find((s) => s.id === sessionId)
		?.aiTabs.find((t) => t.id === tabId);
	if (!tab) throw new Error('Conversation not found');
	if (url !== undefined && !isHttpBrowserTabUrl(url)) throw new Error('Enter an HTTP or HTTPS URL');
	if (action === 'web-external') {
		if (!isHttpBrowserTabUrl(tab.newShellPanel?.webUrl)) throw new Error('No web page is open');
		await window.maestro.shell.openExternal(tab.newShellPanel!.webUrl!);
		return;
	}
	if (url !== undefined) newShellWebViews.get(JSON.stringify([sessionId, tabId]))?.navigate(url);
	updateAiTab(sessionId, tabId, (current) => ({
		...current,
		newShellPanel: patchNewShellPanel(
			changeNewShellPanel(current.newShellPanel, action),
			url === undefined ? {} : { webUrl: url }
		),
	}));
}

/** Local URLs in output follow the active conversation; external links retain their routing. */
export function openLocalWebPanel(url: string): boolean {
	if (!useSettingsStore.getState().newShell || !isHttpBrowserTabUrl(url)) return false;
	const host = new URL(url).hostname;
	if (
		!(
			host === 'localhost' ||
			host === '[::1]' ||
			host === '0.0.0.0' ||
			/^127\.\d+\.\d+\.\d+$/.test(host)
		)
	)
		return false;
	const state = useSessionStore.getState();
	const session = state.sessions.find((s) => s.id === state.activeSessionId);
	if (!session?.aiTabs.some((tab) => tab.id === session.activeTabId)) return false;
	void applyNewShellWebAction(session.id, session.activeTabId, 'web', url);
	return true;
}
