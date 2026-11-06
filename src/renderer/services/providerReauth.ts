import { getAgentLoginCommand } from '../../shared/agentMetadata';
import { reportAuthFailure, startManualReauth } from '../stores/authOutageStore';
import { getModalActions } from '../stores/modalStore';
import { selectSessionById, useSessionStore } from '../stores/sessionStore';

/**
 * Open the sign-in dialog for an agent's provider.
 *
 * "Not Now" drops the outage on purpose, so the next failure prompts again. That
 * leaves the failed tab's own error as the only record of the turn, so a caller
 * that knows the tab re-raises the failure and Resume replays that turn. With no
 * live failure on the tab this is a plain login with nothing to replay.
 */
export function openProviderReauth(sessionId: string, failedTabId?: string): void {
	const session = selectSessionById(sessionId)(useSessionStore.getState());
	if (!session || !getAgentLoginCommand(session.toolType, session.customPath)) return;
	const failure = session.aiTabs.find((tab) => tab.id === failedTabId)?.agentError;
	const { providerKey } =
		failure?.type === 'auth_expired'
			? reportAuthFailure({ sessionId, message: failure.message, tabId: failedTabId })
			: startManualReauth(sessionId);
	if (providerKey) getModalActions().openReauthModal({ providerKey });
}
