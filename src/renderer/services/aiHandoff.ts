import { useSessionStore, updateAiTab, updateSessionWith } from '../stores/sessionStore';
import { useUIStore } from '../stores/uiStore';
import { getLiveDraft, clearLiveDraft } from '../utils/liveDraftStore';
import { normalizeComposerCommandMode } from '../utils/shellCommandInput';
import { conversationDisplayTitle } from '../utils/conversationTitle';
import { getT } from '../i18n';
import { useSettingsStore } from '../stores/settingsStore';
import { useComposerInputStore } from '../stores/composerInputStore';
import { createTab, createMergedSession, focusAiTabInSession } from '../utils/tabHelpers';
import { extractTabContext } from '../utils/contextExtractor';
import { handoffLocation } from '../../shared/aiHandoff';
import { permissionModeFields } from '../utils/tabHelpers/focusFields';
import { gitService } from './git';
import { noteDesktopAiTabSelection } from '../utils/desktopTabSelectionSync';
import { captureException } from '../utils/sentry';
import { mergeDeferredItems } from '../../shared/deferredSessionContent';
import { createKeyedWriteQueue } from '../../shared/keyedWriteQueue';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { DEEPSEEK_PRESET, sessionProviderId } from '../../shared/agentPresets';
import { buildHandoffDraft } from './aiHandoffContext';
import { enqueuePromptForTab } from './queuedPrompt';
import type {
	HandoffDraftNote,
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
	if (!session || !tab) return null;
	if (session.deferredContent?.tabIds.includes(tab.id)) {
		const stored = await window.maestro.sessions.getDeferredContent(session.id, tab.id, false);
		session = useSessionStore.getState().sessions.find((item) => item.id === request.sourceAgentId);
		tab = session?.aiTabs.find((item) => item.id === request.sourceTabId);
		if (!session || !tab) return null;
		// Read a complete snapshot without hydrating or otherwise changing the
		// source tab, its composer draft, or the active selection.
		tab = { ...tab, logs: mergeDeferredItems(stored.logs, tab.logs, (entry) => entry.id) };
	}
	const location = handoffLocation(session);
	const ssh = session.sessionSshRemoteConfig;
	const changes =
		request.mode === 'review'
			? await gitService.getChanges(
					session.cwd,
					ssh?.enabled ? ssh.remoteId! : undefined,
					ssh?.enabled ? location.cwd : undefined
				)
			: undefined;
	const current = useSessionStore
		.getState()
		.sessions.find((item) => item.id === request.sourceAgentId);
	if (
		!current ||
		handoffLocation(current).key !== location.key ||
		!current.aiTabs.some((item) => item.id === request.sourceTabId)
	)
		return null;
	const source = extractTabContext(tab, session.name, session);
	return {
		cwd: location.cwd,
		sessionSshRemoteConfig: session.sessionSshRemoteConfig,
		sourceNativeSessionId: tab.agentSessionId ?? undefined,
		// A conversation that was itself handed off keeps the original title, so a
		// chain reads "Review: Fix cart" rather than "Review: Continued: Fix cart".
		sourceTitle:
			tab.origin?.sourceTitle?.trim() ||
			conversationDisplayTitle(tab) ||
			(sessionProviderId(session) === 'deepseek'
				? DEEPSEEK_PRESET.name
				: getAgentDisplayName(session.toolType)),
		sourceAgentId: session.id,
		sourceTabId: tab.id,
		projectPath: session.projectRoot || session.cwd,
		groupId: session.groupId,
		draft: buildHandoffDraft(source, { ...request, changes }),
	};
}

export async function openHandoffTarget(request: HandoffOpenRequest): Promise<HandoffResult> {
	return writes.enqueue(
		request.newConversation
			? `new:${request.sourceAgentId}:${request.newConversation.replaceTabId ?? request.provider}`
			: `${handoffLocation(request).key}:${request.provider}`,
		async () => {
			const replacementId = request.newConversation?.replaceTabId;
			const sourceSession = useSessionStore
				.getState()
				.sessions.find((s) => s.id === request.sourceAgentId);
			const replacement = sourceSession?.aiTabs.find((tab) => tab.id === replacementId);
			if (
				request.newConversation &&
				(!useSettingsStore.getState().newShell ||
					!sourceSession ||
					(replacementId &&
						(!replacement ||
							replacement.logs.length ||
							replacement.agentSessionId ||
							replacement.state !== 'idle')))
			)
				return {
					success: false,
					code: 'unavailable',
					error: 'Only an empty conversation in the new shell can change tools',
				};
			if (request.newConversation) {
				const composer = useComposerInputStore.getState();
				request = {
					...request,
					send: false,
					draft: {
						...request.draft,
						text: replacement
							? composer.aiValueTabId === replacementId
								? composer.aiValue
								: (getLiveDraft(replacement.id) ?? replacement.inputValue)
							: '',
					},
				};
			}
			const agent =
				request.mode === 'review'
					? await window.maestro.agents.get(
							request.config.toolType,
							request.sessionSshRemoteConfig?.enabled
								? request.sessionSshRemoteConfig.remoteId!
								: undefined
						)
					: undefined;
			const sourceTitle =
				request.origin.sourceTitle?.trim() ||
				conversationDisplayTitle(
					sourceSession?.aiTabs.find((tab) => tab.id === request.origin.sourceTabId)
				) ||
				(request.origin.sourceProvider === 'deepseek'
					? DEEPSEEK_PRESET.name
					: getAgentDisplayName(request.origin.sourceProvider));
			const title = request.newConversation
				? undefined
				: getT()(
						request.mode === 'review'
							? 'workflows.handoff.reviewTitle'
							: 'workflows.handoff.continuedTitle',
						{ title: sourceTitle }
					);
			const tabFields = {
				...(title ? { name: title } : {}),
				origin: request.newConversation ? undefined : { ...request.origin, sourceTitle },
				...(request.mode === 'review' && agent?.capabilities?.supportsReadOnlyMode
					? permissionModeFields('readonly')
					: {}),
			};
			const state = useSessionStore.getState();
			const matches = (session: Session) =>
				handoffLocation(session).key === handoffLocation(request).key &&
				session.toolType === request.config.toolType;
			let target = request.runnerId
				? state.sessions.find((session) => session.id === request.runnerId)
				: state.sessions.find(
						(session) => matches(session) && sessionProviderId(session) === request.provider
					);
			if (request.runnerId && (!target || !matches(target)))
				return {
					success: false,
					code: 'unavailable',
					error: 'The selected target runner is no longer available in this project',
				};
			const createdAgent = !target;
			const settings = useSettingsStore.getState();
			const source = state.sessions.find((session) => session.id === request.sourceAgentId);
			// The note above the draft's composer. The draft text stays in the
			// composer only; the source is named when this window knows the agent.
			const handoffDraft: HandoffDraftNote = {
				sourceAgentId: request.sourceAgentId,
				...(source ? { sourceName: source.name, sourceProvider: sessionProviderId(source) } : {}),
				estimatedTokens: request.draft.estimatedTokens,
				budgetTokens: request.draft.budgetTokens,
				omittedEntries: request.draft.omittedEntries,
				omittedCharacters: request.draft.omittedCharacters,
			};
			let tabId: string;
			if (!target) {
				const created = createMergedSession({
					name:
						request.provider === 'deepseek'
							? DEEPSEEK_PRESET.name
							: getAgentDisplayName(request.config.toolType),
					projectRoot: request.cwd,
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
					projectRoot: request.projectPath,
					sessionSshRemoteConfig: request.sessionSshRemoteConfig
						? { ...request.sessionSshRemoteConfig }
						: undefined,
					shellLogs: [],
					aiTabs: created.session.aiTabs.map((tab) => ({
						...tab,
						...tabFields,
						inputValue: request.draft.text,
						handoffDraft: request.newConversation ? undefined : handoffDraft,
					})),
				};
				state.addSession(target);
			} else {
				const empty =
					!request.newConversation && target.aiTabs.length === 1 ? target.aiTabs[0] : undefined;
				const composer = useComposerInputStore.getState();
				// Check every draft layer: whitespace and a not-yet-flushed composer
				// are still user content. Deferred history and queued work are not empty.
				const reusable =
					empty &&
					empty.state === 'idle' &&
					empty.logs.length === 0 &&
					!empty.agentSessionId &&
					!empty.awaitingSessionId &&
					!empty.inputValue &&
					!getLiveDraft(empty.id) &&
					!(composer.aiValueTabId === empty.id && composer.aiValue) &&
					!empty.stagedImages?.length &&
					!empty.pendingMergedContext &&
					!empty.wizardState &&
					!target.deferredContent?.tabIds.includes(empty.id) &&
					!target.executionQueue?.some((item) => item.tabId === empty.id);
				const created = reusable
					? { tab: empty, session: target }
					: createTab(target, {
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
						tab.id === tabId
							? {
									...tab,
									...tabFields,
									inputValue: request.draft.text,
									handoffDraft: request.newConversation ? undefined : handoffDraft,
								}
							: tab
					),
				};
				const updated = target;
				updateSessionWith(target.id, () => updated);
			}
			const agentId = target.id;
			const result: HandoffResult = {
				success: true,
				mode: request.mode,
				agentId,
				tabId,
				title,
				createdAgent,
				state: 'draft',
				draft: request.draft,
			};
			if (replacement) {
				const sourceFile = sourceSession?.filePreviewTabs?.find(
					(file) => file.id === replacement.newShellPanel?.fileTabId
				);
				const existingFile =
					sourceFile && target.filePreviewTabs?.find((file) => file.path === sourceFile.path);
				const panel = replacement.newShellPanel && {
					...replacement.newShellPanel,
					fileTabId: existingFile?.id ?? sourceFile?.id,
				};
				target = {
					...target,
					...(sourceFile && !existingFile
						? {
								filePreviewTabs: [...(target.filePreviewTabs ?? []), sourceFile],
								unifiedTabOrder: [
									...(target.unifiedTabOrder ?? []),
									{ type: 'file' as const, id: sourceFile.id },
								],
							}
						: {}),
					aiTabs: target.aiTabs.map((tab) =>
						tab.id === tabId
							? {
									...tab,
									stagedImages: replacement.stagedImages,
									commandMode: replacement.commandMode,
									newShellPanel: panel,
									handoffDraft: undefined,
								}
							: tab
					),
				};
				useSessionStore.getState().updateSession(target.id, target);
			}
			const changedSource =
				replacement && sourceSession
					? {
							...sourceSession,
							aiTabs: sourceSession.aiTabs.filter((tab) => tab.id !== replacement.id),
							activeTabId: sourceSession.aiTabs.find((tab) => tab.id !== replacement.id)?.id ?? '',
							unifiedTabOrder: sourceSession.unifiedTabOrder?.filter(
								(ref) => ref.type !== 'ai' || ref.id !== replacement.id
							),
						}
					: undefined;

			// An empty runner would acquire a fresh default tab during restart. Remove
			// it only when no other conversation, file, terminal or browser needs it.
			const removeEmptySource =
				!!changedSource &&
				changedSource.aiTabs.length === 0 &&
				!changedSource.filePreviewTabs?.length &&
				!changedSource.terminalTabs?.length &&
				!changedSource.browserTabs?.length;

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
				if (
					(await window.maestro.sessions.setMany(
						changedSource && !removeEmptySource ? [target, changedSource] : [target],
						removeEmptySource ? [changedSource!.id] : []
					)) !== true
				)
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
			if (changedSource) {
				if (removeEmptySource) useSessionStore.getState().removeSession(changedSource.id);
				else
					updateSessionWith(changedSource.id, (currentSource) => ({
						...currentSource,
						aiTabs: currentSource.aiTabs.filter((tab) => tab.id !== replacementId),
						activeTabId:
							currentSource.activeTabId === replacementId
								? (currentSource.aiTabs.find((tab) => tab.id !== replacementId)?.id ?? '')
								: currentSource.activeTabId,
						unifiedTabOrder: currentSource.unifiedTabOrder?.filter(
							(ref) => ref.type !== 'ai' || ref.id !== replacementId
						),
					}));
				clearLiveDraft(replacementId!);
			}

			if (!request.background) {
				updateSessionWith(agentId, (session) => focusAiTabInSession(session, tabId));
				useSessionStore.getState().setActiveSessionId(agentId);
				noteDesktopAiTabSelection(agentId, tabId);
				if (request.newConversation) {
					useComposerInputStore
						.getState()
						.loadAiDraft(
							tabId,
							request.draft.text,
							normalizeComposerCommandMode(replacement?.commandMode)
						);
					useUIStore.getState().requestTabFocus({ type: 'ai', id: tabId });
				}
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
		}
	);
}
