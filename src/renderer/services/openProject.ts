import { createKeyedWriteQueue } from '../../shared/keyedWriteQueue';
import { normalizeWorktreePath } from '../../shared/worktreePaths';
import { useSettingsStore, selectNewShellEnabled } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useUIStore } from '../stores/uiStore';
import { jumpToAgent } from './agentNavigation';
import { sessionProjectKey } from '../utils/projectSessionTree';
import { notifyToast } from '../stores/notificationStore';
import { getT } from '../i18n';
import type { OpenProjectTarget, OpenProjectResult } from '../../shared/projects';
import type { UseSessionCrudReturn } from '../hooks/session/useSessionCrud';

/** All project-opening UI entries use the same service as the CLI bridge. */
export async function openProject(path: string): Promise<OpenProjectResult> {
	if (!selectNewShellEnabled(useSettingsStore.getState()))
		return { success: false, code: 'unavailable', error: 'Open Project requires the new shell' };
	try {
		const result = await window.maestro.agentSessions.openProject(path);
		if (!result.success)
			notifyToast({
				type: 'warning',
				title: getT()('workflows.projects.open'),
				message: result.code === 'no-tools' ? getT()('workflows.projects.install') : result.error,
			});
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		notifyToast({ type: 'error', title: getT()('workflows.projects.open'), message });
		return { success: false, code: 'unavailable', error: message };
	}
}

export async function chooseProject(): Promise<void> {
	if (!selectNewShellEnabled(useSettingsStore.getState())) return;
	const path = await window.maestro.dialog.selectFolder();
	if (path) await openProject(path);
}

const projectOpens = createKeyedWriteQueue();

/** Responds to both desktop and CLI requests using the canonical GUI creator. */
export async function openProjectTarget(
	target: OpenProjectTarget,
	create: UseSessionCrudReturn['createNewSession']
): Promise<OpenProjectResult> {
	return projectOpens.enqueue('open-project', async () => {
		if (!selectNewShellEnabled(useSettingsStore.getState()))
			return { success: false, code: 'unavailable', error: 'Open Project requires the new shell' };
		// A timed-out main request can still finish in this renderer. Recheck before creating.
		let id =
			target.sessionId ??
			useSessionStore
				.getState()
				.sessions.find(
					(session) =>
						session.toolType !== 'terminal' &&
						!session.sessionSshRemoteConfig?.enabled &&
						normalizeWorktreePath(session.cwd) === normalizeWorktreePath(target.path)
				)?.id;
		if (!id) {
			const before = new Set(useSessionStore.getState().sessions.map((session) => session.id));
			await create(target.toolType!, target.path, target.name!);
			id = useSessionStore
				.getState()
				.sessions.find((session) => !before.has(session.id) && session.cwd === target.path)?.id;
		}
		if (!id || !jumpToAgent(id))
			return { success: false, code: 'unavailable', error: 'Could not open the project' };
		const { sessions, groups } = useSessionStore.getState();
		const session = sessions.find((owner) => owner.id === id)!;
		const { key } = sessionProjectKey(
			session,
			new Map(sessions.map((owner) => [owner.id, owner])),
			new Map(groups.map((group) => [group.id, group]))
		);
		const settings = useSettingsStore.getState();
		if (settings.collapsedConversationProjects.includes(key))
			settings.setCollapsedConversationProjects(
				settings.collapsedConversationProjects.filter((entry) => entry !== key)
			);
		useUIStore.getState().setActiveFocus('main');
		useUIStore.getState().setLeftSidebarHidden(false);
		useUIStore.getState().setLeftSidebarOpen(true);
		useUIStore.getState().requestTabFocus({ type: 'ai', id: session.activeTabId });
		await window.maestro.sessions.setMany([session], []);
		return { success: true, sessionId: id };
	});
}
