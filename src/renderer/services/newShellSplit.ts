import { createKeyedWriteQueue } from '../../shared/keyedWriteQueue';
import {
	NEW_SHELL_SPLIT_MIN_WIDTH,
	NEW_SHELL_SPLIT_MIN_CONTENT_WIDTH,
	type NewShellSplit,
	type SplitConversationRef,
} from '../../shared/newShellSplit';
import { getT } from '../i18n';
import { getWindowContext } from '../contexts/WindowContext';
import { selectActiveSession, useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { jumpToAgent } from './agentNavigation';

export { readNewShellSplit } from '../../shared/newShellSplit';

const writes = createKeyedWriteQueue();

function requireNewShell(): void {
	if (!useSettingsStore.getState().newShell) throw new Error(getT()('workflows.split.disabled'));
}

export function splitConversationExists(ref: SplitConversationRef): boolean {
	return (
		(getWindowContext()?.ownsSession(ref.sessionId) ?? true) &&
		useSessionStore
			.getState()
			.sessions.some((s) => s.id === ref.sessionId && s.aiTabs.some((tab) => tab.id === ref.tabId))
	);
}

/** Focus is shared with the right panel and the existing send/stop handlers. */
export function focusSplitConversation(ref: SplitConversationRef): void {
	requireNewShell();
	if (!splitConversationExists(ref)) throw new Error(getT()('workflows.split.missing'));
	const state = useSessionStore.getState();
	const active = selectActiveSession(state);
	if (state.activeSessionId !== ref.sessionId || active?.activeTabId !== ref.tabId)
		jumpToAgent(ref.sessionId, { tabId: ref.tabId });
	useUIStore.getState().setActiveFocus('main');
}

/** UI and CLI share this transaction and wait for the same settings write. */
async function saveSplit(split: NewShellSplit | null): Promise<void> {
	await window.maestro.settings.set('newShellSplit', split);
	useSettingsStore.setState({ newShellSplit: split });
}

/** Validate before creating a conversation so an unavailable split leaves no extra tab. */
export function assertNewShellSplitAvailable(ratio?: number): void {
	requireNewShell();
	if (ratio !== undefined && (!Number.isFinite(ratio) || ratio < 0.2 || ratio > 0.8))
		throw new Error(getT()('workflows.split.invalidRatio'));
	const content = document.querySelector('[data-testid="new-shell-split-layout"]');
	const width = content?.getBoundingClientRect().width;
	if (
		window.innerWidth < NEW_SHELL_SPLIT_MIN_WIDTH ||
		(width !== undefined && width > 0 && width < NEW_SHELL_SPLIT_MIN_CONTENT_WIDTH)
	)
		throw new Error(getT()('workflows.split.narrow'));
}

export async function splitConversation(
	sessionId: string,
	tabId: string,
	ratio?: number
): Promise<void> {
	return writes.enqueue('split', async () => {
		assertNewShellSplitAvailable(ratio);
		const right = { sessionId, tabId };
		if (!splitConversationExists(right)) throw new Error(getT()('workflows.split.missing'));
		const saved = useSettingsStore.getState().newShellSplit;
		const active = selectActiveSession(useSessionStore.getState());
		const activeInSaved =
			saved &&
			active &&
			[saved.left, saved.right].some(
				(ref) => ref.sessionId === active.id && ref.tabId === active.activeTabId
			);
		const left =
			activeInSaved && splitConversationExists(saved.left)
				? saved.left
				: active && { sessionId: active.id, tabId: active.activeTabId };
		if (!left || !splitConversationExists(left)) throw new Error(getT()('workflows.split.missing'));
		if (left.tabId === right.tabId) throw new Error(getT()('workflows.split.same'));
		await saveSplit({ left, right, ratio: ratio ?? (activeInSaved ? saved.ratio : 0.5) });
		const resizing = ratio !== undefined && activeInSaved && saved.right.tabId === tabId;
		if (!resizing) focusSplitConversation(right);
	});
}

/** Closing a pane keeps the surviving conversation and never closes its provider process. */
export async function unsplitConversation(keep?: SplitConversationRef): Promise<void> {
	return writes.enqueue('split', async () => {
		requireNewShell();
		if (keep && splitConversationExists(keep)) focusSplitConversation(keep);
		await saveSplit(null);
	});
}
