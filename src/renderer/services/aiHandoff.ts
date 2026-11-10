import {
	projectConversationFields,
	projectSettingsForSession,
	projectSettingsScopeForSession,
} from '../utils/projectConversationDefaults';
import { useOperationStore } from '../stores/operationStore';
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
import {
	remoteConversationPermissionFields,
	resolveProjectConversationPermission,
} from '../utils/newConversationPermissions';
import {
	permissionModeFields,
	newConversationPermissionFields,
} from '../utils/tabHelpers/focusFields';
import { gitService } from './git';
import { noteDesktopAiTabSelection } from '../utils/desktopTabSelectionSync';
import { captureException } from '../utils/sentry';
import { mergeDeferredItems } from '../../shared/deferredSessionContent';
import { createKeyedWriteQueue } from '../../shared/keyedWriteQueue';
import { getAgentDisplayName, resolveTabPermissionMode } from '../../shared/agentMetadata';
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
import type { AITab, Session } from '../types';

// Main orders requests; this queue also orders work if a slow renderer outlives
// main's response timeout. Reuse the existing queue primitive at both boundaries.
const writes = createKeyedWriteQueue();

function canReplaceConversation(session: Session, tab: AITab): boolean {
	return (
		tab.state === 'idle' &&
		!tab.logs.length &&
		!tab.agentSessionId &&
		!tab.awaitingSessionId &&
		!tab.pendingMergedContext &&
		!tab.wizardState &&
		!session.deferredContent?.tabIds.includes(tab.id) &&
		!session.executionQueue?.some((item) => item.tabId === tab.id)
	);
}

function replacementDraft(tab: AITab) {
	const composer = useComposerInputStore.getState();
	return {
		text:
			composer.aiValueTabId === tab.id
				? composer.aiValue
				: (getLiveDraft(tab.id) ?? tab.inputValue),
		commandMode: normalizeComposerCommandMode(
			composer.aiValueTabId === tab.id ? composer.aiCommandMode : tab.commandMode
		),
		stagedImages: tab.stagedImages ? [...tab.stagedImages] : undefined,
	};
}

function replacementRevision(tab: AITab): string {
	return JSON.stringify({
		...replacementDraft(tab),
		stored: tab.inputValue,
		live: getLiveDraft(tab.id),
	});
}

export async function readHandoffSource(
	request: HandoffReadRequest
): Promise<HandoffSourceSnapshot | null> {
	let session = useSessionStore
		.getState()
		.sessions.find((item) => item.id === request.sourceAgentId);
	let tab = session?.aiTabs.find((item) => item.id === request.sourceTabId);
	if (!session) return null;
	if (request.permissionOnly) {
		if (request.sourceTabId && !tab) return null;
		const source = tab ?? (await resolveProjectConversationPermission(session));
		return {
			sourceAgentId: session.id,
			sourceTabId: tab?.id ?? '',
			sourcePermission: permissionModeFields(resolveTabPermissionMode(source)),
			sourceDefaults: tab
				? {
						customModel: tab.customModel ?? session.customModel,
						customEffort: tab.customEffort ?? session.customEffort,
						customEnvVars: session.customEnvVars,
					}
				: undefined,
			cwd: handoffLocation(session).cwd,
			projectPath: session.projectRoot || session.cwd,
			sessionSshRemoteConfig: session.sessionSshRemoteConfig,
			draft: {
				text: '',
				estimatedTokens: 0,
				budgetTokens: 8000,
				omittedEntries: 0,
				omittedCharacters: 0,
			},
		};
	}
	if (!tab) return null;
	if (
		request.automaticTurnId &&
		(!useSettingsStore.getState().newShell ||
			tab.origin?.automatic ||
			tab.autoHandoffAttemptedTurnId !== request.automaticTurnId ||
			[...tab.logs].reverse().find((entry) => entry.source === 'user')?.id !==
				request.automaticTurnId)
	)
		return null;
	if (request.emptyConversation) {
		if (!useSettingsStore.getState().newShell || !canReplaceConversation(session, tab)) return null;
		const draft = replacementDraft(tab);
		return {
			sourceAgentId: session.id,
			sourceTabId: tab.id,
			sourcePermission: permissionModeFields(resolveTabPermissionMode(tab)),
			cwd: handoffLocation(session).cwd,
			projectPath: session.projectRoot || session.cwd,
			sessionSshRemoteConfig: session.sessionSshRemoteConfig,
			emptyConversation: { stagedImages: draft.stagedImages, commandMode: draft.commandMode },
			draft: {
				text: draft.text,
				estimatedTokens: 0,
				budgetTokens: 8000,
				omittedEntries: 0,
				omittedCharacters: 0,
			},
		};
	}

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
	const failedMessage = request.automaticTurnId
		? tab.logs.find((entry) => entry.id === request.automaticTurnId && entry.source === 'user')
		: undefined;
	if (request.automaticTurnId && !failedMessage) return null;
	const source = extractTabContext(
		failedMessage
			? { ...tab, logs: tab.logs.filter((entry) => entry.id !== failedMessage.id) }
			: tab,
		session.name,
		session
	);
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
		sourcePermission: permissionModeFields(resolveTabPermissionMode(tab)),
		projectPath: session.projectRoot || session.cwd,
		groupId: session.groupId,
		images: failedMessage?.images,
		draft: buildHandoffDraft(source, {
			...request,
			changes,
			...(failedMessage
				? {
						instruction: failedMessage.text,
						budgetTokens: Math.max(
							request.budgetTokens ?? 8000,
							Math.ceil(failedMessage.text.length / 2) + 8000
						),
					}
				: {}),
		}),
	};
}

export async function openHandoffTarget(request: HandoffOpenRequest): Promise<HandoffResult> {
	const replacementId = request.newConversation?.source
		? undefined
		: request.newConversation?.replaceTabId;
	const unlock = replacementId
		? useOperationStore.getState().lockTabReplacement(replacementId)
		: undefined;
	const pending = writes.enqueue(
		request.newConversation
			? `new:${request.sourceAgentId}:${request.newConversation.replaceTabId ?? request.provider}`
			: `${handoffLocation(request).key}:${request.provider}`,
		async (): Promise<HandoffResult> => {
			if (
				(request.targetConfigId || request.origin.automatic) &&
				!useSettingsStore.getState().newShell
			)
				return {
					success: false,
					code: 'unavailable',
					error: getT()('workflows.autoHandoff.disabled'),
				};
			const sourceSession = useSessionStore
				.getState()
				.sessions.find((s) => s.id === request.sourceAgentId);
			const replacement = sourceSession?.aiTabs.find((tab) => tab.id === replacementId);
			if (
				request.newConversation &&
				(!useSettingsStore.getState().newShell ||
					(replacementId &&
						(!sourceSession ||
							!replacement ||
							!canReplaceConversation(sourceSession, replacement))))
			)
				return {
					success: false,
					code: 'unavailable',
					error: 'Only an empty conversation in the new shell can change tools',
				};
			if (request.newConversation) {
				request = {
					...request,
					send: !!request.newConversation.prompt,
					draft: {
						...request.draft,
						text:
							request.newConversation.prompt ??
							(request.newConversation.source
								? request.draft.text
								: replacement
									? replacementDraft(replacement).text
									: ''),
					},
				};
			}
			const sourceRevision = replacement ? replacementRevision(replacement) : undefined;
			const sourceInputValue = replacement?.inputValue;
			const sourceLiveValue = replacement ? getLiveDraft(replacement.id) : undefined;
			const transferredDraft =
				request.newConversation?.source ??
				(replacement ? replacementDraft(replacement) : undefined);
			const newShell = useSettingsStore.getState().newShell;
			const capabilities = newShell
				? await window.maestro.agents.getCapabilities(request.config.toolType)
				: request.mode === 'review'
					? (
							await window.maestro.agents.get(
								request.config.toolType,
								request.sessionSshRemoteConfig?.enabled
									? request.sessionSshRemoteConfig.remoteId!
									: undefined
							)
						)?.capabilities
					: undefined;
			const inheritedTab = request.newConversation?.sourceTabId
				? sourceSession?.aiTabs.find((tab) => tab.id === request.newConversation?.sourceTabId)
				: undefined;
			if (request.newConversation?.sourceTabId && !inheritedTab && !request.sourceDefaults)
				return {
					success: false,
					code: 'unavailable',
					error: getT()('workflows.shell.permissionUnavailable'),
				};
			const inherited =
				request.sourceDefaults ??
				(inheritedTab && sourceSession
					? {
							customModel: inheritedTab.customModel ?? sourceSession.customModel,
							customEffort: inheritedTab.customEffort ?? sourceSession.customEffort,
							customEnvVars: sourceSession.customEnvVars,
						}
					: undefined);
			const resolvedSourcePermission =
				request.sourcePermission ??
				inheritedTab ??
				replacement ??
				(request.newConversation
					? sourceSession && (await resolveProjectConversationPermission(sourceSession))
					: sourceSession?.aiTabs.find((tab) => tab.id === request.origin.sourceTabId));
			const sourcePermission = request.permissionCeiling
				? remoteConversationPermissionFields(
						resolvedSourcePermission,
						request.permissionCeiling.permissionMode
					)
				: resolvedSourcePermission;
			const permissions = newShell
				? newConversationPermissionFields(
						sourcePermission,
						capabilities,
						!!request.sessionSshRemoteConfig?.enabled,
						request.config
					)
				: {};
			if (
				!permissions ||
				(newShell && !sourcePermission && (!request.newConversation || !sourceSession))
			)
				return {
					success: false,
					code: 'unavailable',
					error: getT()('workflows.shell.permissionUnavailable'),
				};
			const sourceTitle =
				request.origin.sourceTitle?.trim() ||
				conversationDisplayTitle(
					sourceSession?.aiTabs.find((tab) => tab.id === request.origin.sourceTabId)
				) ||
				(request.origin.sourceProvider === 'deepseek'
					? DEEPSEEK_PRESET.name
					: getAgentDisplayName(request.origin.sourceProvider));
			const title =
				request.newConversation || !useSettingsStore.getState().newShell
					? undefined
					: getT()(
							request.mode === 'review'
								? 'workflows.handoff.reviewTitle'
								: 'workflows.handoff.continuedTitle',
							{ title: sourceTitle }
						);
			const projectOwner = {
				...request.config,
				cwd: request.cwd,
				projectRoot: request.projectPath,
				sessionSshRemoteConfig: request.sessionSshRemoteConfig,
			};
			let project = projectSettingsForSession(projectOwner);
			if (project?.envVars && !request.targetConfigId) {
				const response = await window.maestro.settings.projectSettings({
					action: 'show',
					scope: projectSettingsScopeForSession(projectOwner),
				});
				if (!response.success || response.environmentRedacted)
					return {
						success: false,
						code: 'unavailable',
						error: getT()('workflows.projectSettings.failed'),
					};
				project = response.settings;
			}
			const projectFields = newShell
				? projectConversationFields(
						projectOwner,
						{ ...permissionModeFields(resolveTabPermissionMode(sourcePermission)), ...inherited },
						capabilities
					)
				: {};
			if (!projectFields)
				return {
					success: false,
					code: 'unavailable',
					error: getT()('workflows.shell.permissionUnavailable'),
				};
			const tabFields = {
				...permissions,
				...projectFields,
				...(title ? { name: title } : {}),
				...(transferredDraft
					? {
							stagedImages: transferredDraft.stagedImages ?? [],
							commandMode: transferredDraft.commandMode,
						}
					: {}),
				origin: request.newConversation ? undefined : { ...request.origin, sourceTitle },
				...(request.mode === 'review' && capabilities?.supportsReadOnlyMode
					? permissionModeFields('readonly')
					: {}),
			};
			const state = useSessionStore.getState();
			const matches = (session: Session) =>
				handoffLocation(session).key === handoffLocation(request).key &&
				session.toolType === request.config.toolType;
			let target = request.runnerId
				? state.sessions.find((session) => session.id === request.runnerId)
				: request.targetConfigId
					? undefined
					: state.sessions.find(
							(session) => matches(session) && sessionProviderId(session) === request.provider
						);
			if (request.runnerId && (!target || !matches(target)))
				return {
					success: false,
					code: 'unavailable',
					error: 'The selected target runner is no longer available in this project',
				};
			const baseEnvironment =
				target?.projectSettingsBaseEnv ??
				target?.customEnvVars ??
				request.config.customEnvVars ??
				{};
			const hasProjectEnvironment =
				newShell &&
				!request.targetConfigId &&
				(!!project?.envVars || !!target?.projectSettingsBaseEnv);
			if (hasProjectEnvironment) {
				const env = { ...baseEnvironment, ...project?.envVars, ...inherited?.customEnvVars };
				request = { ...request, config: { ...request.config, customEnvVars: env } };
				if (
					target &&
					Object.keys({ ...target.customEnvVars, ...env }).some(
						(key) => target!.customEnvVars?.[key] !== env[key]
					)
				) {
					// Keep old native conversations attached to their original account.
					target = undefined;
				}
			}
			// Recheck the actual target: its mode may have changed since preparation.
			if (newShell) {
				const targetPermissions = newConversationPermissionFields(
					tabFields,
					capabilities,
					!!request.sessionSshRemoteConfig?.enabled,
					target ?? request.config
				);
				if (!targetPermissions)
					return {
						success: false,
						code: 'unavailable',
						error: getT()('workflows.shell.permissionUnavailable'),
					};
				Object.assign(tabFields, targetPermissions);
			}
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
					...(hasProjectEnvironment ? { projectSettingsBaseEnv: { ...baseEnvironment } } : {}),
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
							permissionSource: permissions,
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
			// Reuse can leave the selected tab id unchanged, so the tab-switch effect
			// will not load this draft. Update its live owner before any save awaits.
			const composer = useComposerInputStore.getState();
			if (composer.aiValueTabId === tabId) composer.loadAiDraft(tabId, request.draft.text, 'off');
			const agentId = target.id;
			const result: HandoffResult = {
				success: true,
				mode: request.mode,
				agentId,
				tabId,
				title,
				createdAgent,
				...(newShell
					? {
							permissionMode: target.aiTabs.find((tab) => tab.id === tabId)?.permissionMode,
							readOnlyMode: target.aiTabs.find((tab) => tab.id === tabId)?.readOnlyMode,
						}
					: {}),
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
									stagedImages: transferredDraft?.stagedImages ?? [],
									commandMode: transferredDraft?.commandMode,
									newShellPanel: panel,
									handoffDraft: undefined,
								}
							: tab
					),
				};
				useSessionStore.getState().updateSession(target.id, target);
			}
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
			let removeSourceId: string | undefined;
			if (replacement && sourceSession) {
				const currentSource = useSessionStore
					.getState()
					.sessions.find((s) => s.id === sourceSession.id);
				const currentTab = currentSource?.aiTabs.find((tab) => tab.id === replacementId);
				if (
					!currentSource ||
					!currentTab ||
					!canReplaceConversation(currentSource, currentTab) ||
					replacementRevision(currentTab) !== sourceRevision
				)
					return result;
				const changedSource = {
					...currentSource,
					aiTabs: currentSource.aiTabs.filter((tab) => tab.id !== replacementId),
					activeTabId:
						currentSource.activeTabId === replacementId
							? (currentSource.aiTabs.find((tab) => tab.id !== replacementId)?.id ?? '')
							: currentSource.activeTabId,
					unifiedTabOrder: currentSource.unifiedTabOrder?.filter(
						(ref) => ref.type !== 'ai' || ref.id !== replacementId
					),
				};
				const removeEmptySource =
					!changedSource.aiTabs.length &&
					!changedSource.filePreviewTabs?.length &&
					!changedSource.terminalTabs?.length &&
					!changedSource.browserTabs?.length;
				try {
					// Keep the runner addressable until the post-save check. Removing it
					// here would create a tombstone that rejects a later draft restore.
					const saved = await window.maestro.sessions.setMany([changedSource], []);
					const latestSource = useSessionStore
						.getState()
						.sessions.find((s) => s.id === currentSource.id);
					const latestTab = latestSource?.aiTabs.find((tab) => tab.id === replacementId);
					if (
						latestSource &&
						latestTab &&
						(latestSource !== currentSource ||
							!canReplaceConversation(latestSource, latestTab) ||
							replacementRevision(latestTab) !== sourceRevision)
					) {
						// A draft edit can race the source save too. Restore it durably and
						// leave its live owner selected; never remove it from memory.
						const latestDraft = replacementDraft(latestTab);
						const liveValue = getLiveDraft(latestTab.id);
						// An unchanged composer must not overwrite a newer per-tab draft.
						if (latestDraft.text === request.draft.text) {
							if (liveValue !== undefined && liveValue !== sourceLiveValue)
								latestDraft.text = liveValue;
							else if (latestTab.inputValue !== sourceInputValue)
								latestDraft.text = latestTab.inputValue;
						}
						const restoredSource = {
							...latestSource,
							aiTabs: latestSource.aiTabs.map((tab) =>
								tab.id === replacementId
									? { ...tab, inputValue: latestDraft.text, commandMode: latestDraft.commandMode }
									: tab
							),
						};
						useSessionStore.getState().updateSession(restoredSource.id, restoredSource);
						if (!(await window.maestro.sessions.setMany([restoredSource], [])))
							return {
								...result,
								success: false,
								code: 'persistence-failed',
								error: 'The updated source draft could not be saved',
							};
						return result;
					}
					if (!saved)
						return {
							...result,
							success: false,
							code: 'persistence-failed',
							error: 'The source conversation could not be saved',
						};
				} catch (error) {
					captureException(error, { tags: { context: 'aiHandoffSourcePersistence' } });
					return {
						...result,
						success: false,
						code: 'persistence-failed',
						error: 'The source conversation could not be saved',
					};
				}

				if (removeEmptySource) {
					useSessionStore.getState().removeSession(changedSource.id);
					removeSourceId = changedSource.id;
				} else
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
							normalizeComposerCommandMode(transferredDraft?.commandMode)
						);
					useUIStore.getState().requestTabFocus({ type: 'ai', id: tabId });
				}
			}
			if (request.send) {
				if (request.origin.automatic && !useSettingsStore.getState().newShell)
					return {
						...result,
						success: false,
						code: 'unavailable',
						error: getT()('workflows.autoHandoff.disabled'),
					};
				const queued = enqueuePromptForTab({
					sessionId: agentId,
					tabId,
					text: request.draft.text,
					...(request.images?.length ? { images: request.images } : {}),
				});
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
			if (removeSourceId) {
				try {
					if (!(await window.maestro.sessions.setMany([], [removeSourceId])))
						return {
							...result,
							success: false,
							code: 'persistence-failed',
							error: 'The empty source runner could not be removed',
						};
				} catch (error) {
					captureException(error, { tags: { context: 'aiHandoffSourceCleanup' } });
					return {
						...result,
						success: false,
						code: 'persistence-failed',
						error: 'The empty source runner could not be removed',
					};
				}
			}
			return result;
		}
	);
	return pending.finally(() => unlock?.());
}
