export interface NewShellPanelState {
	tab: 'changes' | 'files';
	fileTabId?: string;
	filter?: string;
	open?: boolean;
}
export const NEW_SHELL_PANEL_ACTIONS = [
	'changes',
	'files',
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
	action: NewShellPanelAction
): NewShellPanelState {
	return patchNewShellPanel(
		previous,
		action === 'back'
			? { tab: 'files', fileTabId: undefined }
			: action === 'open' || action === 'close'
				? { open: action === 'open' }
				: { tab: action === 'changes' ? 'changes' : 'files', open: true }
	);
}

/** Resolve the visible panel without overwriting the classic shell's preference. */
export function shellRightPanelTab(
	stored: 'files' | 'changes' | 'history' | 'autorun',
	newShell: boolean,
	panel?: NewShellPanelState
) {
	return newShell
		? (panel?.tab ?? stored) === 'files'
			? 'files'
			: 'changes'
		: stored === 'changes'
			? 'files'
			: stored;
}
