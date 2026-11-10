import type { AgentError } from '../../shared/types';
import { classifyRetryableError } from '../../shared/retryClassification';
import { isHandoffProvider } from '../../shared/aiHandoff';
import { sessionProviderId } from '../../shared/agentPresets';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { projectSettingsKey } from '../../shared/projectSettings';
import {
	projectSettingsForSession,
	projectSettingsScopeForSession,
} from '../utils/projectConversationDefaults';
import { updateAiTab, useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { cancelRetry } from '../stores/retryStore';
import { generateId } from '../utils/ids';
import { getT } from '../i18n';
import { captureException } from '../utils/sentry';

/** Also used before retry scheduling, so only one recovery owns a failed turn. */
export function automaticHandoffCandidate(sessionId: string, tabId: string, error?: AgentError) {
	if (!useSettingsStore.getState().newShell) return null;
	const sessions = useSessionStore.getState().sessions;
	const source = sessions.find((session) => session.id === sessionId);
	const tab = source?.aiTabs.find((item) => item.id === tabId);
	const failure = error ?? tab?.agentError;
	if (!source || !tab || !failure || tab.origin?.automatic) return null;
	// token_exhaustion is a full context window in the provider taxonomy.
	// Quota exhaustion has its own canonical retry classification.
	if (failure.type !== 'rate_limited' && classifyRetryableError(failure) !== 'token-exhaustion')
		return null;
	if (source.sessionSshRemoteConfig?.enabled && !source.sessionSshRemoteConfig.remoteId)
		return null;
	const targetId = projectSettingsForSession(source)?.autoHandoffTarget;
	const target = sessions.find((session) => session.id === targetId);
	if (!target || target.id === source.id) return null;
	if (target.sessionSshRemoteConfig?.enabled && !target.sessionSshRemoteConfig.remoteId)
		return null;
	if (
		projectSettingsKey(projectSettingsScopeForSession(source)) !==
		projectSettingsKey(projectSettingsScopeForSession(target))
	)
		return null;
	const provider = sessionProviderId(target);
	if (!isHandoffProvider(provider)) return null;
	const message = [...tab.logs].reverse().find((entry) => entry.source === 'user');
	if (!message || (!message.text.trim() && !message.images?.length)) return null;
	return { source, tab, target, provider, message };
}

/** Called only by the desktop owner after process exit. A failed attempt is never replayed. */
export async function maybeAutoHandoff(sessionId: string, tabId: string): Promise<void> {
	const candidate = automaticHandoffCandidate(sessionId, tabId);
	if (!candidate || candidate.tab.autoHandoffAttemptedTurnId === candidate.message.id) return;
	const { message, target, provider } = candidate;
	// Claim synchronously before any I/O, then persist before creating or sending.
	updateAiTab(sessionId, tabId, (tab) => ({ ...tab, autoHandoffAttemptedTurnId: message.id }));
	cancelRetry(sessionId, tabId);
	const t = getT();
	try {
		const source = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
		if (!source || (await window.maestro.sessions.setMany([source], [])) !== true) return;
		const current = automaticHandoffCandidate(sessionId, tabId);
		if (!current || current.message.id !== message.id || current.target.id !== target.id) return;
		const result = await window.maestro.context.handoff({
			sourceAgentId: sessionId,
			sourceTabId: tabId,
			targetProvider: provider,
			targetConfigId: target.id,
			automaticTurnId: message.id,
			send: true,
			background: true,
		});
		const sent = result.success && result.state === 'queued' && result.agentId && result.tabId;
		updateAiTab(sessionId, tabId, (tab) => ({
			...tab,
			logs: [
				...tab.logs,
				{
					id: generateId(),
					timestamp: Date.now(),
					source: 'system',
					text: sent
						? t('workflows.autoHandoff.sent', {
								tool: getAgentDisplayName(provider),
								account: result.targetAccount || t('workflows.autoHandoff.defaultAccount'),
							})
						: t('workflows.autoHandoff.failed'),
					...(sent ? { autoHandoff: { sessionId: result.agentId!, tabId: result.tabId! } } : {}),
				},
			],
		}));
		const updated = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
		if (updated) await window.maestro.sessions.setMany([updated], []);
	} catch (error) {
		captureException(error, { tags: { context: 'autoHandoff' } });
		updateAiTab(sessionId, tabId, (tab) => ({
			...tab,
			logs: [
				...tab.logs,
				{
					id: generateId(),
					timestamp: Date.now(),
					source: 'system',
					text: t('workflows.autoHandoff.failed'),
				},
			],
		}));
	}
}
