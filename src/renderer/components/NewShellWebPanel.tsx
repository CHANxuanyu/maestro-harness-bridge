import { useT } from '../i18n';
import { selectNewShellEnabled, useSettingsStore } from '../stores/settingsStore';
import { useCallback, useState } from 'react';
import { BrowserTabView, type BrowserTabViewHandle } from './MainPanel/BrowserTabView';
import type { BrowserTab, Session, Theme } from '../types';
import {
	DEFAULT_BROWSER_TAB_URL,
	getBrowserTabPartition,
	isHttpBrowserTabUrl,
} from '../utils/browserTabPersistence';
import { updateAiTab } from '../stores/sessionStore';
import { patchNewShellPanel } from '../../shared/newShellPanel';
import { applyNewShellWebAction, isLocalWebUrl, newShellWebViews } from '../services/newShellWeb';

/** The existing browser engine, with durable metadata owned by one conversation. */
export function NewShellWebPanel({
	session,
	theme,
	visible,
}: {
	session: Session;
	theme: Theme;
	visible: boolean;
}) {
	const t = useT();
	const newShell = useSettingsStore(selectNewShellEnabled);
	const conversation = session.aiTabs.find((tab) => tab.id === session.activeTabId)!;
	const panel = conversation.newShellPanel;
	const key = JSON.stringify([session.id, conversation.id]);
	const [runtime, setRuntime] = useState<Partial<BrowserTab>>({});
	const register = useCallback(
		(handle: BrowserTabViewHandle | null) => {
			if (handle) newShellWebViews.set(key, handle);
			else newShellWebViews.delete(key);
		},
		[key]
	);
	const update = useCallback(
		(_id: string, updates: Partial<BrowserTab>) => {
			setRuntime((previous) => ({ ...previous, ...updates }));
			if (updates.url && isHttpBrowserTabUrl(updates.url)) {
				updateAiTab(session.id, conversation.id, (tab) => ({
					...tab,
					newShellPanel: patchNewShellPanel(tab.newShellPanel, { webUrl: updates.url }),
				}));
			}
		},
		[session.id, conversation.id]
	);
	const tab: BrowserTab = {
		id: key,
		title: '',
		createdAt: 0,
		canGoBack: false,
		canGoForward: false,
		isLoading: false,
		...runtime,
		url: panel?.webUrl ?? DEFAULT_BROWSER_TAB_URL,
		partition: getBrowserTabPartition(session.id),
	};
	return (
		<div className="h-full flex flex-col" data-testid="new-shell-web-panel">
			{newShell && session.sessionSshRemoteConfig?.enabled && isLocalWebUrl(tab.url) && (
				<p
					data-testid="web-preview-local-notice"
					className="shrink-0 truncate px-3 py-1 text-xs"
					style={{ color: theme.colors.textDim }}
					title={t('workflows.newShell.webLocalNotice')}
				>
					{t('workflows.newShell.webLocalNotice')}
				</p>
			)}
			<BrowserTabView
				key={panel?.webReload ?? 0}
				ref={register}
				tab={tab}
				theme={theme}
				onUpdateTab={update}
				isActive={visible}
				panelMode
				onPanelNavigate={(url) => applyNewShellWebAction(session.id, conversation.id, 'web', url)}
				onPanelReload={() => {
					void applyNewShellWebAction(session.id, conversation.id, 'web-reload');
				}}
				onPanelExternal={() => {
					void applyNewShellWebAction(session.id, conversation.id, 'web-external');
				}}
			/>
		</div>
	);
}
