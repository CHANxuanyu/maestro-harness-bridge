/**
 * Thinking-item construction for the ThinkingStatusPill.
 *
 * A "thinking item" is one (session, tab) pair representing a single busy AI
 * tab. The pill renders one entry per busy tab across the agents it should
 * surface, plus closed-but-still-thinking ("orphaned") tabs that are kept on the
 * pill until the underlying process actually exits.
 *
 * Multi-window scoping: the main process BROADCASTS every agent's state to every
 * window (see the MULTI-WINDOW INVARIANT in `safe-send.ts`), so each renderer's
 * session store holds ALL agents regardless of which window owns them. Pass
 * `ownsSession` (from `WindowContext.ownsSession`) to drop agents whose tab strip
 * lives in another window - otherwise a window's pill would surface another
 * window's running/AutoRun agent. Omit it (single-window app / web / isolation
 * tests, where there is no WindowProvider) to include every session unchanged.
 */

import type { Session, ThinkingItem } from '../types';
import { getBusyTabs } from './tabHelpers';

/**
 * Build the flat list of thinking items that drives the ThinkingStatusPill.
 *
 * @param sessions All agents known to this renderer.
 * @param ownsSession Optional ownership predicate; when provided, only agents it
 *   accepts contribute thinking items (window scoping). When omitted, every
 *   session is included.
 */
export function buildThinkingItems(
	sessions: Session[],
	ownsSession?: (sessionId: string) => boolean
): ThinkingItem[] {
	const items: ThinkingItem[] = [];
	for (const session of sessions) {
		// Multi-window: skip agents whose tab strip lives in another window so this
		// window's pill never surfaces an agent it does not own.
		if (ownsSession && !ownsSession(session.id)) continue;

		// Closed tabs count only while BUSY. A closed tab also stays parked in
		// `orphanedThinkingTabs` (idle) when it still owns queued items, so it
		// survives as a dispatch target: items waiting on another tab, or items the
		// user HELD. No process runs for it, so listing it here would show
		// "Thinking..." (and a Stop button) for a tab that is doing nothing - and a
		// held item parks it indefinitely.
		const busyOrphans = (session.orphanedThinkingTabs ?? []).filter((tab) => tab.state === 'busy');
		if (session.state === 'busy' && session.busySource === 'ai') {
			const busyTabs = getBusyTabs(session);
			for (const tab of busyTabs) {
				items.push({ session, tab });
			}
			// Legacy: the agent is busy but no tab carries the state.
			if (busyTabs.length === 0 && busyOrphans.length === 0) {
				items.push({ session, tab: null });
			}
		}
		// Closed-but-still-thinking tabs stay on the pill until their process
		// exits, independent of the agent-level state. The exit/error listeners
		// remove entries from orphanedThinkingTabs when the underlying process is gone.
		for (const orphan of busyOrphans) {
			items.push({ session, tab: orphan });
		}
	}
	return items;
}

/**
 * Whether this thinking item is the turn the user is looking at: the active tab
 * of the active agent. That turn says it is running in its own transcript and
 * is stopped from the composer's send key, so the pill leaves it out. A legacy
 * item (no tab) is never on screen: no transcript row can describe it.
 */
export function isThinkingItemOnScreen(
	item: ThinkingItem,
	activeSessionId: string | undefined,
	activeTabId: string | undefined
): boolean {
	return !!activeTabId && item.session.id === activeSessionId && item.tab?.id === activeTabId;
}

/**
 * The one surface that draws Stop. Stop is an agent-level action (it signals
 * every process the ACTIVE agent has in flight, see `useInterruptHandler`), so
 * exactly one control may offer it, and only for work it can reach:
 *  - `composer`: the conversation on screen is running; the send key is Stop.
 *  - `pill`: another conversation of this agent is running; the thinking pill
 *    that names it carries Stop.
 *  - `consults`: nothing of this agent is thinking. Another agent's turn gets no
 *    Stop (this one cannot reach it); the cross-agent pill carries it for the
 *    consults this agent fanned out.
 *  - `none`: an Auto Run owns the pill, and its own Stop ends the run.
 */
export type StopPlacement = 'composer' | 'pill' | 'consults' | 'none';

export function resolveStopPlacement(
	thinkingItems: ThinkingItem[],
	activeSessionId: string | undefined,
	activeTabId: string | undefined,
	autoRunRunning: boolean
): StopPlacement {
	if (thinkingItems.some((item) => isThinkingItemOnScreen(item, activeSessionId, activeTabId))) {
		return 'composer';
	}
	if (autoRunRunning) return 'none';
	if (thinkingItems.some((item) => item.session.id === activeSessionId)) return 'pill';
	return 'consults';
}
