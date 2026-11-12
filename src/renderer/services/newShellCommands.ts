import { isHandoffProvider } from '../../shared/aiHandoff';
import type { NativeHistorySearchHit } from '../../shared/nativeHistorySearch';
import type { ResumeNativeSession } from './openNativeConversation';
import { getWindowContext } from '../contexts/WindowContext';
import { getT } from '../i18n';
import { useSessionStore, selectActiveSession } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore, type PendingLogJump } from '../stores/uiStore';
import { latestAgentTaskList } from '../utils/agentTaskList';
import { openUiSurface } from '../utils/openUiSurface';
import {
	getForceSendEligibility,
	getForceSendTitle,
	shouldOfferForceSend,
} from '../utils/executionQueue';
import { openNativeHistorySearchHit } from './openNativeHistorySearchHit';
import { refreshNativeConversation } from './refreshNativeConversation';
import { newProjectConversation, newShellConversation } from './newShellConversation';
import {
	splitConversation,
	assertNewShellSplitAvailable,
	splitConversationExists,
} from './newShellSplit';
import { flushPendingSessionSave } from './quitSave';
import { resolveProjectConversationPermission } from '../utils/newConversationPermissions';

export interface NewShellCommandDeps {
	handleResumeSession?: ResumeNativeSession;
	handleForceSendQueueItem?: (
		sessionId: string,
		itemId: string
	) => Promise<{ success: boolean; error?: string }>;
}

/** Acknowledged commands run in the window that owns the addressed conversation. */
export async function runNewShellCommand(
	sessionId: string,
	raw: unknown,
	deps: NewShellCommandDeps
) {
	if (!useSettingsStore.getState().newShell) throw new Error(getT()('workflows.split.disabled'));
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		throw new Error(getT()('workflows.cliParity.invalidRequest'));
	const request = raw as Record<string, unknown>;
	const state = useSessionStore.getState();
	const session =
		sessionId === 'active'
			? selectActiveSession(state)
			: state.sessions.find((s) => s.id === sessionId);
	if (session && getWindowContext()?.ownsSession(session.id) === false)
		throw new Error(getT()('workflows.cliParity.wrongWindow'));
	const text = (key: string) => {
		if (typeof request[key] !== 'string')
			throw new Error(getT()('workflows.cliParity.missingField', { field: key }));
		return request[key] as string;
	};
	const only = (...keys: string[]) => {
		if (Object.keys(request).some((key) => !['action', ...keys].includes(key)))
			throw new Error(getT()('workflows.cliParity.invalidRequest'));
	};
	switch (request.action) {
		case 'locate-queue': {
			only('itemId');
			const itemId = text('itemId');
			return {
				sessionIds: state.sessions
					.filter(
						(s) =>
							getWindowContext()?.ownsSession(s.id) !== false &&
							s.executionQueue.some((item) => item.id === itemId)
					)
					.map((s) => s.id),
			};
		}
		case 'flush-inventory': {
			only();
			await flushPendingSessionSave();
			const active = selectActiveSession(useSessionStore.getState());
			return { activeSessionId: active?.id, activeTabId: active?.activeTabId };
		}
		case 'sidebar-search': {
			only('text');
			useUIStore.getState().setNewShellSidebarSearch(text('text'));
			return { query: useUIStore.getState().newShellSidebarSearch };
		}
		case 'project-settings': {
			only('path', 'close');
			if (request.path !== undefined) text('path');
			if (request.close !== undefined && typeof request.close !== 'boolean')
				throw new Error(getT()('workflows.cliParity.invalidRequest'));
			const result = openUiSurface('project-settings', undefined, {
				path: request.path as string | undefined,
				close: request.close === true,
				sessionId: session?.id,
			});
			if (!result.ok) throw new Error(result.error);
			return {
				open: request.close !== true,
				project: useUIStore.getState().newShellSettingsProjectKey,
				scope: useUIStore.getState().newShellSettingsScopeKey,
			};
		}
	}
	if (!session) throw new Error(getT()('workflows.cliParity.ownerMissing'));
	switch (request.action) {
		case 'tasks':
		case 'refresh': {
			only('tabId');
			const tabId = text('tabId') === 'active' ? session.activeTabId : text('tabId');
			const tab = session.aiTabs.find((item) => item.id === tabId);
			if (!tab) throw new Error(getT()('workflows.cliParity.conversationMissing'));
			if (request.action === 'tasks') {
				const list = latestAgentTaskList(tab.logs);
				return {
					tabId,
					list,
					empty: !list?.tasks.length,
					emptyText: list?.tasks.length ? '' : getT()('workflows.newShell.tasksEmpty'),
				};
			}
			const result = await refreshNativeConversation({ sessionId: session.id, tabId });
			if (result.status === 'failed') throw new Error(result.error);
			if (result.status === 'skipped')
				throw new Error(getT()('workflows.cliParity.refreshSkipped', { reason: result.reason }));
			return { tabId, ...result };
		}
		case 'open-hit': {
			only('hit');
			const hit = request.hit as NativeHistorySearchHit | undefined;
			if (
				!hit?.conversation?.nativeSessionId ||
				!hit.conversation.projectPath ||
				!hit.conversation.provider ||
				!hit.message ||
				(!hit.message.uuid && !hit.message.text) ||
				!['user', 'assistant'].includes(hit.message.role)
			)
				throw new Error(getT()('workflows.cliParity.invalidHit'));
			if (!deps.handleResumeSession)
				throw new Error(getT()('workflows.cliParity.historyUnavailable'));
			const located: { target?: PendingLogJump } = {};
			if (
				!(await openNativeHistorySearchHit(hit, deps.handleResumeSession, (target) => {
					located.target = target;
				}))
			)
				throw new Error(getT()('workflows.cliParity.hitMissing'));
			const jump = located.target;
			if (!jump) throw new Error(getT()('workflows.cliParity.hitMissing'));
			return { agentId: jump.sessionId, tabId: jump.tabId, logId: jump.logId };
		}
		case 'new-split': {
			only('ratio', 'prompt', 'provider');
			const provider = request.provider;
			if (provider !== undefined && (typeof provider !== 'string' || !isHandoffProvider(provider)))
				throw new Error(getT()('workflows.cliParity.unknownProvider'));
			const ratio = request.ratio;
			if (
				ratio !== undefined &&
				(typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0.2 || ratio > 0.8)
			)
				throw new Error(getT()('workflows.split.invalidRatio'));
			if (request.prompt !== undefined) text('prompt');
			assertNewShellSplitAvailable(ratio as number | undefined);
			const active = selectActiveSession(useSessionStore.getState());
			if (!active || !splitConversationExists({ sessionId: active.id, tabId: active.activeTabId }))
				throw new Error(getT()('workflows.split.missing'));
			const permission = await resolveProjectConversationPermission(session);
			const created =
				(await newProjectConversation(
					session,
					undefined,
					true,
					permission,
					request.prompt as string | undefined,
					undefined,
					provider
				)) ??
				(await newShellConversation(session.id, provider, undefined, {
					background: true,
					sourcePermission: permission,
					prompt: request.prompt as string | undefined,
				}));
			if (
				!created.success ||
				!('agentId' in created) ||
				!created.agentId ||
				!('tabId' in created) ||
				!created.tabId
			)
				throw new Error(created.error || getT()('workflows.shell.newConversationFailed'));
			await splitConversation(created.agentId, created.tabId, ratio as number | undefined);
			return { agentId: created.agentId, tabId: created.tabId };
		}
		case 'force-send': {
			only('itemId');
			const itemId = text('itemId');
			const item = session.executionQueue.find((item) => item.id === itemId);
			if (!item) throw new Error(getT()('workflows.cliParity.itemMissing'));
			const eligibility = getForceSendEligibility(session, item, {
				forcedParallelEnabled: useSettingsStore.getState().forcedParallelExecution,
			});
			if (!shouldOfferForceSend(eligibility) || !eligibility.canForce)
				throw new Error(getForceSendTitle(eligibility, getT()));
			if (!deps.handleForceSendQueueItem)
				throw new Error(getT()('workflows.cliParity.queueUnavailable'));
			const result = await deps.handleForceSendQueueItem(session.id, itemId);
			if (!result.success)
				throw new Error(result.error || getT()('workflows.cliParity.queueFailed'));
			return { agentId: session.id, itemId, tabId: item.tabId };
		}
		default:
			throw new Error(getT()('workflows.cliParity.unknownCommand'));
	}
}
