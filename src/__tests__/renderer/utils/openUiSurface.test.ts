import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useUIStore } from '../../../renderer/stores/uiStore';
import { projectSettingsKey } from '../../../shared/projectSettings';
/**
 * @file openUiSurface.test.ts
 * @description `maestro-cli open feedback` must behave like the Feedback
 * button: open the modal fresh, or restore a parked draft instead of replacing
 * it (which would throw the running conversation away).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockSession } from '../../helpers/mockSession';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { openUiSurface } from '../../../renderer/utils/openUiSurface';
import { selectModalOpen, useModalStore } from '../../../renderer/stores/modalStore';
import { useFeedbackDraftStore } from '../../../renderer/stores/feedbackDraftStore';

describe('openUiSurface - feedback', () => {
	beforeEach(() => {
		useModalStore.getState().closeModal('feedback');
		useFeedbackDraftStore.getState().reset();
	});

	it('opens the Send Feedback modal', () => {
		expect(openUiSurface('feedback')).toEqual({ ok: true });
		expect(selectModalOpen('feedback')(useModalStore.getState())).toBe(true);
	});

	it('restores a minimized draft rather than opening a fresh modal', () => {
		useModalStore.getState().openModal('feedback');
		useFeedbackDraftStore.getState().setMinimized(true);

		expect(openUiSurface('feedback')).toEqual({ ok: true });

		expect(useFeedbackDraftStore.getState().isMinimized).toBe(false);
		expect(selectModalOpen('feedback')(useModalStore.getState())).toBe(true);
	});
});

it('opens worktree cleanup confirmation only for a worktree owner', () => {
	const session = createMockSession({
		id: 'wt',
		parentSessionId: 'parent',
		worktreeBranch: 'feature',
	});
	useSessionStore.setState({ sessions: [session], activeSessionId: session.id });
	expect(openUiSurface('worktree-cleanup')).toEqual({ ok: true });
	expect(useModalStore.getState().getData('deleteWorktree')?.session).toBe(session);
	useModalStore.getState().closeModal('deleteWorktree');
	useSessionStore.setState({ sessions: [{ ...session, parentSessionId: undefined }] });
	expect(openUiSurface('worktree-cleanup').ok).toBe(false);
	expect(selectModalOpen('deleteWorktree')(useModalStore.getState())).toBe(false);
});

it('opens the requested path inside a grouped project and closes through the registry', () => {
	useSettingsStore.setState({ newShell: true });
	useSessionStore.setState({
		sessions: [
			createMockSession({ id: 'one', groupId: 'group', cwd: '/one', projectRoot: '/one' }),
			createMockSession({ id: 'two', groupId: 'group', cwd: '/two', projectRoot: '/two' }),
		],
		groups: [{ id: 'group', name: 'Group', emoji: '' }],
		activeSessionId: 'one',
	});
	expect(openUiSurface('project-settings', undefined, { path: '/two' })).toEqual({ ok: true });
	expect(useUIStore.getState().newShellSettingsProjectKey).toBe('group:group');
	expect(useUIStore.getState().newShellSettingsScopeKey).toBe(
		projectSettingsKey({ projectPath: '/two' })
	);
	expect(openUiSurface('project-settings', undefined, { close: true })).toEqual({ ok: true });
	expect(useUIStore.getState().newShellSettingsProjectKey).toBeNull();
	useSettingsStore.setState({ newShell: false });
	expect(openUiSurface('project-settings', undefined, { path: '/two' }).ok).toBe(false);
});
