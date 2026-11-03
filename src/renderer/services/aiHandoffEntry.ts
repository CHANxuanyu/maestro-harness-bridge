/**
 * Where "Continue with another AI" may be offered, and how every entry point
 * opens it. The tab menu, the command palette, the error modal, a limit or
 * login error in the transcript, and a live outage card all ask the same
 * questions here, so they cannot disagree about which tabs can hand off.
 *
 * Kept free of the handoff service itself (`aiHandoff.ts`), which the tab bar
 * and transcript rows have no reason to load.
 */

import { useSessionStore } from '../stores/sessionStore';
import { useModalStore } from '../stores/modalStore';
import type { AgentErrorType } from '../../shared/types';
import type { HandoffDraftNote } from '../../shared/aiHandoff';
import type { AITab, Session } from '../types';

/**
 * A handoff carries the tab's text, so a tab with no exchange has nothing to
 * hand over. An SSH agent's history belongs to the remote host, and the
 * service refuses to read it, so it is not offered there either. A tab whose
 * transcript is still deferred (a browser client) does hold a conversation;
 * the service reads it without hydrating the tab.
 */
export function canHandOffTab(session: Session | undefined, tab: AITab | undefined): boolean {
	if (!session || !tab || session.sessionSshRemoteConfig?.enabled) return false;
	if (session.deferredContent?.tabIds.includes(tab.id)) return true;
	return tab.logs.some(
		(entry) =>
			(entry.source === 'user' || entry.source === 'stdout' || entry.source === 'ai') &&
			!!entry.text.trim()
	);
}

/** {@link canHandOffTab} for a row that only knows the ids. Re-renders on a flip only. */
export function useCanHandOffTab(sessionId?: string, tabId?: string): boolean {
	return useSessionStore((state) => {
		if (!sessionId || !tabId) return false;
		const session = state.sessions.find((item) => item.id === sessionId);
		return canHandOffTab(
			session,
			session?.aiTabs.find((tab) => tab.id === tabId)
		);
	});
}

/**
 * The errors that leave the user waiting on THIS provider: a plan or rate
 * limit (quota exhaustion is classified as `rate_limited`), or a lost login.
 * Context exhaustion has its own remedy (compact), and a crash or a network
 * failure is not solved by changing provider.
 */
export function errorOffersHandoff(type: AgentErrorType | undefined): boolean {
	return type === 'rate_limited' || type === 'auth_expired';
}

/** Open the "Continue with another AI" dialog for one tab. */
export function requestAiHandoff(sessionId: string, tabId: string): void {
	useModalStore.getState().openModal('aiHandoff', { sessionId, tabId });
}

/**
 * The draft note to draw above a tab's composer. Only while the tab has no
 * conversation: sending the draft writes its first entry, which retires it.
 */
export function handoffDraftNoteFor(tab: AITab | undefined): HandoffDraftNote | null {
	return tab?.handoffDraft && tab.logs.length === 0 ? tab.handoffDraft : null;
}
