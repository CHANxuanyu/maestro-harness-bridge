export interface NewShellPanelState {
	tab: 'changes' | 'files' | 'terminal' | 'tasks';
	terminalTabId?: string;
	fileTabId?: string;
	filter?: string;
	open?: boolean;
}
export const NEW_SHELL_PANEL_ACTIONS = [
	'changes',
	'files',
	'terminal',
	'tasks',
	'terminal-select',
	'terminal-close',
	'terminal-restart',
	'back',
	'open',
	'close',
	'edit',
	'preview',
	'save',
] as const;
export type NewShellPanelAction = (typeof NEW_SHELL_PANEL_ACTIONS)[number];

export function patchNewShellPanel(
	previous: NewShellPanelState | undefined,
	patch: Partial<NewShellPanelState>
): NewShellPanelState {
	return { tab: 'changes', ...previous, ...patch };
}
export function changeNewShellPanel(
	previous: NewShellPanelState | undefined,
	action: NewShellPanelAction,
	terminalId?: string
): NewShellPanelState {
	if (action === 'terminal-close')
		return patchNewShellPanel(
			previous,
			!terminalId || previous?.terminalTabId === terminalId ? { terminalTabId: undefined } : {}
		);
	if (action === 'terminal-restart') return patchNewShellPanel(previous, {});
	return patchNewShellPanel(
		previous,
		action === 'back'
			? { tab: 'files', fileTabId: undefined }
			: action === 'open' || action === 'close'
				? { open: action === 'open' }
				: {
						tab:
							action === 'changes' || action === 'tasks'
								? action
								: action.startsWith('terminal')
									? 'terminal'
									: 'files',
						open: true,
					}
	);
}

/** Resolve the visible panel without overwriting the classic shell's preference. */
export function shellRightPanelTab(
	stored: 'files' | 'changes' | 'history' | 'autorun' | 'terminal' | 'tasks',
	newShell: boolean,
	panel?: NewShellPanelState
) {
	return newShell
		? (panel?.tab ?? (stored === 'files' ? 'files' : 'changes'))
		: ['changes', 'terminal', 'tasks'].includes(stored)
			? 'files'
			: stored;
}
