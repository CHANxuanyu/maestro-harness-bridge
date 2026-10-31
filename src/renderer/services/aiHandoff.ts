import { useSessionStore, updateAiTab, updateSessionWith } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useComposerInputStore } from '../stores/composerInputStore';
import { createTab, createMergedSession, focusAiTabInSession } from '../utils/tabHelpers';
import { extractTabContext } from '../utils/contextExtractor';
import { isSameDirectory } from '../utils/agentWorkingDirectory';
import { noteDesktopAiTabSelection } from '../utils/desktopTabSelectionSync';
import { captureException } from '../utils/sentry';
import { mergeDeferredItems } from '../../shared/deferredSessionContent';
import { createKeyedWriteQueue } from '../../shared/keyedWriteQueue';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { isDeepSeekAgent, DEEPSEEK_PRESET } from '../../shared/agentPresets';
import { buildHandoffDraft } from './aiHandoffContext';
import { enqueuePromptForTab } from './queuedPrompt';
import type {
	HandoffReadRequest,
	HandoffSourceSnapshot,
	HandoffOpenRequest,
	HandoffResult,
} from '../../shared/aiHandoff';
import type { Session } from '../types';

// Main orders requests; this queue also orders work if a slow renderer outlives
// main's response timeout. Reuse the existing queue primitive at both boundaries.
const writes = createKeyedWriteQueue();

export async function readHandoffSource(
	request: HandoffReadRequest
): Promise<HandoffSourceSnapshot | null> {
	let session = useSessionStore
		.getState()
		.sessions.find((item) => item.id === request.sourceAgentId);
	let tab = session?.aiTabs.find((item) => item.id === request.sourceTabId);
	if (!session || !tab || session.sessionSshRemoteConfig?.enabled) return null;
	if (session.deferredContent?.tabIds.includes(tab.id)) {
		const stored = await window.maestro.sessions.getDeferredContent(session.id, tab.id, false);
		session = useSessionStore.getState().sessions.find((item) => item.id === request.sourceAgentId);
		tab = session?.aiTabs.find((item) => item.id === request.sourceTabId);
		if (!session || !tab) return null;
		// Read a complete snapshot without hydrating or otherwise changing the
		// source tab, its composer draft, or the active selection.
		tab = { ...tab, logs: mergeDeferredItems(stored.logs, tab.logs, (entry) => entry.id) };
	}
	const source = extractTabContext(tab, session.name, session);
	return {
		sourceAgentId: session.id,
		sourceTabId: tab.id,
		projectPath: session.projectRoot || session.cwd,
		groupId: session.groupId,
		draft: buildHandoffDraft(source, request),
	};
}

export async function openHandoffTarget(request: HandoffOpenRequest): Promise<HandoffResult> {
	return writes.enqueue(`${request.projectPath}:${request.provider}`, async () => {
		const state = useSessionStore.getState();
		const matches = (session: Session) =>
			!session.sessionSshRemoteConfig?.enabled &&
			isSameDirectory(session.projectRoot || session.cwd, request.projectPath) &&
			session.toolType === request.config.toolType;
		let target = request.runnerId
			? state.sessions.find((session) => session.id === request.runnerId)
			: state.sessions.find(
					(session) =>
						matches(session) &&
						(isDeepSeekAgent(session.toolType, session.customEnvVars)
							? 'deepseek'
							: session.toolType) === request.provider
				);
		if (request.runnerId && (!target || !matches(target)))
			return {
				success: false,
				code: 'unavailable',
				error: 'The selected target runner is no longer available in this project',
			};
		const createdAgent = !target;
		const settings = useSettingsStore.getState();
		let tabId: string;
		if (!target) {
			const created = createMergedSession({
				name:
					request.provider === 'deepseek'
						? DEEPSEEK_PRESET.name
						: getAgentDisplayName(request.config.toolType),
				projectRoot: request.projectPath,
				toolType: request.config.toolType,
				groupId: request.groupId,
				mergedLogs: [],
				saveToHistory: settings.defaultSaveToHistory,
				showThinking: settings.defaultShowThinking,
			});
			tabId = created.tabId;
			target = {
				...created.session,
				...request.config,
				shellLogs: [],
				aiTabs: created.session.aiTabs.map((tab) => ({ ...tab, inputValue: request.draft.text })),
			};
			state.addSession(target);
		} else {
			const created = createTab(target, {
				activate: false,
				saveToHistory: settings.defaultSaveToHistory,
				showThinking: settings.defaultShowThinking,
			});
			if (!created)
				return { success: false, code: 'unavailable', error: 'Could not create a handoff tab' };
			tabId = created.tab.id;
			target = {
				...created.session,
				aiTabs: created.session.aiTabs.map((tab) =>
					tab.id === tabId ? { ...tab, inputValue: request.draft.text } : tab
				),
			};
			const updated = target;
			updateSessionWith(target.id, () => updated);
		}
		const agentId = target.id;
		const result: HandoffResult = {
			success: true,
			agentId,
			tabId,
			createdAgent,
			state: 'draft',
			draft: request.draft,
		};
		try {
			// Claim a new runner in its creating window without changing focus.
			// Otherwise secondary-window creation falls into the primary catch-all.
			if (createdAgent && !(await window.maestro.windows.registerSession(agentId)).registered)
				return {
					...result,
					success: false,
					code: 'unavailable',
					error: 'The new handoff runner could not be assigned to its window',
				};
			if ((await window.maestro.sessions.setMany([target], [])) !== true)
				return {
					...result,
					success: false,
					code: 'persistence-failed',
					error: 'The handoff draft could not be saved',
				};
		} catch (error) {
			captureException(error, { tags: { context: 'aiHandoffPersistence' } });
			return {
				...result,
				success: false,
				code: 'persistence-failed',
				error: 'The handoff draft could not be saved',
			};
		}
		const current = useSessionStore.getState().sessions.find((session) => session.id === agentId);
		if (!current?.aiTabs.some((tab) => tab.id === tabId))
			return {
				...result,
				success: false,
				code: 'unavailable',
				error: 'The handoff tab was closed before it could be used',
			};
		if (!request.background) {
			updateSessionWith(agentId, (session) => focusAiTabInSession(session, tabId));
			useSessionStore.getState().setActiveSessionId(agentId);
			noteDesktopAiTabSelection(agentId, tabId);
		}
		if (request.send) {
			const queued = enqueuePromptForTab({ sessionId: agentId, tabId, text: request.draft.text });
			if (!queued)
				return {
					...result,
					success: false,
					code: 'queue-failed',
					error: 'The saved handoff draft could not be queued',
				};
			updateAiTab(agentId, tabId, (tab) =>
				tab.inputValue === request.draft.text ? { ...tab, inputValue: '' } : tab
			);
			const composer = useComposerInputStore.getState();
			if (composer.aiValueTabId === tabId && composer.aiValue === request.draft.text)
				composer.loadAiDraft(tabId, '', 'off');
			result.state = 'queued';
		}
		return result;
	});
}
