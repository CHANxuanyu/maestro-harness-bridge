import { getT } from '../i18n';
import { projectSettingsScopeForSession } from './projectConversationDefaults';
import { projectSettingsKey } from '../../shared/projectSettings';
import { sessionProjectKey } from './nativeConversationMatch';
import { getWindowContext } from '../contexts/WindowContext';
/**
 * Open one of the app's registered UI surfaces by id (see
 * `shared/uiSurfaces.ts`). This is the renderer end of `maestro-cli open`,
 * and the single place that knows how a surface id becomes a modal-store call.
 *
 * Everything routes through `getModalActions()`, so a surface opened from the
 * CLI lands in exactly the state a hotkey or command-palette entry would
 * produce - including the modal layer stack and Escape handling.
 */

import { selectActiveSession, useSessionStore } from '../stores/sessionStore';
import type { CueModalData, ModalId } from '../stores/modalStore';
import { getModalActions, useModalStore } from '../stores/modalStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { useFeedbackDraftStore } from '../stores/feedbackDraftStore';
import { notifyToast, useNotificationStore } from '../stores/notificationStore';
import { resolveUiSurface, resolveUiSurfaceTab } from '../../shared/uiSurfaces';
import type { SettingsTab, UsageDashboardViewMode } from '../types';

export interface OpenUiSurfaceResult {
	ok: boolean;
	/** Why the open was refused. Present only when `ok` is false. */
	error?: string;
}

/**
 * Open `surfaceId`, optionally deep-linking to `tabId`.
 *
 * Refuses (with a toast) when the surface is behind an Encore Feature the user
 * has turned off: silently opening nothing would look like the CLI lied, and
 * silently enabling the feature would change a setting the user never touched.
 */
export function openUiSurface(
	surfaceId: string,
	tabId?: string,
	options?: { path?: string; close?: boolean; sessionId?: string; projectKey?: string }
): OpenUiSurfaceResult {
	const surface = resolveUiSurface(surfaceId);
	if (!surface) return { ok: false, error: `Unknown surface "${surfaceId}"` };

	const tab = tabId ? resolveUiSurfaceTab(surface, tabId) : null;
	if (tabId && !tab) return { ok: false, error: `Unknown tab "${tabId}" for ${surface.label}` };

	if (surface.encore) {
		const enabled = useSettingsStore.getState().encoreFeatures[surface.encore];
		if (!enabled) {
			const message = `${surface.label} is an Encore Feature and is currently off. Turn it on in Settings → General → Encore Features.`;
			notifyToast({ color: 'yellow', title: `${surface.label} is disabled`, message });
			return { ok: false, error: message };
		}
	}

	const actions = getModalActions();

	switch (surface.id) {
		case 'project-settings': {
			if (!useSettingsStore.getState().newShell)
				return { ok: false, error: getT()('workflows.split.disabled') };
			if (options?.close) {
				useUIStore.getState().setNewShellSettingsProjectKey(null);
				return { ok: true };
			}
			const state = useSessionStore.getState();
			const owners = new Map(state.sessions.map((s) => [s.id, s]));
			const groups = new Map(state.groups.map((g) => [g.id, g]));
			const candidates = state.sessions.filter(
				(s) => s.toolType !== 'terminal' && getWindowContext()?.ownsSession(s.id) !== false
			);
			const session = options?.projectKey
				? candidates.find((s) => sessionProjectKey(s, owners, groups).key === options.projectKey)
				: options?.path
					? candidates.find((s) => (s.projectRoot || s.cwd) === options.path)
					: candidates.find((s) => s.id === (options?.sessionId || state.activeSessionId));
			if (!session) return { ok: false, error: getT()('workflows.cliParity.projectWindowMissing') };
			useUIStore
				.getState()
				.setNewShellSettingsProjectKey(
					sessionProjectKey(session, owners, groups).key,
					projectSettingsKey(projectSettingsScopeForSession(session))
				);
			return { ok: true };
		}
		case 'worktree-cleanup': {
			const session = selectActiveSession(useSessionStore.getState());
			if (!session?.parentSessionId || !session.worktreeBranch)
				return { ok: false, error: 'The active agent is not a worktree' };
			actions.setDeleteWorktreeSession(session);
			return { ok: true };
		}
		case 'terminal-panel':
		case 'tasks-panel':
			if (!useSettingsStore.getState().newShell)
				return { ok: false, error: 'This panel requires the new shell' };
			useUIStore
				.getState()
				.setActiveRightTab(surface.id === 'terminal-panel' ? 'terminal' : 'tasks');
			useUIStore.getState().setRightPanelOpen(true);
			useUIStore.getState().setActiveFocus('right');
			return { ok: true };
		case 'notification-center':
			useNotificationStore.getState().setNotificationCenterOpen(true);
			return { ok: true };
		case 'settings':
			actions.openSettings(tab ? (tab.id as SettingsTab) : undefined);
			return { ok: true };
		case 'cue':
			if (tab) actions.openCueModalWithTab(tab.id as NonNullable<CueModalData['initialTab']>);
			else actions.setCueModalOpen(true);
			return { ok: true };
		case 'usage-dashboard':
			// The dashboard reads its initial tab from the UI store on mount, so
			// setting it first is the deep-link - no prop threading required.
			if (tab) {
				useUIStore.getState().setUsageDashboardViewMode(tab.id as UsageDashboardViewMode);
			}
			actions.setUsageDashboardOpen(true);
			return { ok: true };
		case 'quick-actions':
			actions.setQuickActionOpen(true, 'main');
			return { ok: true };
		case 'feedback': {
			// Same as the Feedback button: a parked draft is restored, not replaced
			// by a fresh modal that would throw the conversation away.
			const draft = useFeedbackDraftStore.getState();
			if (draft.isMinimized) draft.setMinimized(false);
			else useModalStore.getState().openModal('feedback');
			return { ok: true };
		}
		default:
			// Surfaces with no data payload open generically - one line here beats
			// a switch arm per modal that would drift as the registry grows.
			useModalStore.getState().openModal(surface.modal as ModalId);
			return { ok: true };
	}
}
