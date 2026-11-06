import { useCallback } from 'react';
import { useModalStore } from '../../../stores/modalStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useTabStore } from '../../../stores/tabStore';
import { getTerminalSessionId } from '../../../utils/terminalTabHelpers';
import { captureMessage } from '../../../utils/sentry';
import { getT } from '../../../i18n';
import type { TerminalTabHandlersReturn } from './types';

export function useTerminalTabHandlers(): TerminalTabHandlersReturn {
	const { createTerminalTab, closeTerminalTab, selectTerminalTab, renameTerminalTab } =
		useTabStore();

	const handleOpenTerminalTab = useCallback(
		(options?: { shell?: string; cwd?: string; name?: string | null }) => {
			createTerminalTab(options);
		},
		[createTerminalTab]
	);

	const handleCloseTerminalTab = useCallback(
		(tabId: string | string[]) => {
			const tabIds = Array.isArray(tabId) ? tabId : [tabId];
			const close = () => tabIds.forEach((id) => closeTerminalTab(id));
			const checks = tabIds.map((id) => {
				const session = useSessionStore
					.getState()
					.sessions.find((s) => s.terminalTabs?.some((tab) => tab.id === id));
				if (!session) return Promise.resolve(false);
				const ptySessionId = getTerminalSessionId(session.id, id);
				return window.maestro.process.isTerminalBusy(ptySessionId).catch((err) => {
					captureMessage('isTerminalBusy IPC failed, closing tab without prompt', {
						level: 'warning',
						extra: { ptySessionId, tabId: id, err: String(err) },
					});
					return false;
				});
			});
			void Promise.all(checks).then((busy) => {
				if (busy.some(Boolean)) {
					useModalStore.getState().openModal('confirm', {
						message: getT()(
							tabIds.length > 1
								? 'workflows.shell.closeRunningTerminals'
								: 'workflows.shell.closeRunningTerminal'
						),
						onConfirm: close,
						destructive: true,
					});
				} else close();
			});
		},
		[closeTerminalTab]
	);

	const handleSelectTerminalTab = useCallback(
		(tabId: string) => {
			selectTerminalTab(tabId);
		},
		[selectTerminalTab]
	);

	const handleRenameTerminalTab = useCallback(
		(tabId: string, name: string) => {
			renameTerminalTab(tabId, name);
		},
		[renameTerminalTab]
	);

	return {
		handleOpenTerminalTab,
		handleCloseTerminalTab,
		handleSelectTerminalTab,
		handleRenameTerminalTab,
	};
}
