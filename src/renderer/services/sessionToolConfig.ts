import { createKeyedWriteQueue } from '../../shared/keyedWriteQueue';
import type { AgentSshRemoteConfig } from '../../shared/types';
import type { Session } from '../types';
import { getT } from '../i18n';
import { useSessionStore } from '../stores/sessionStore';

import { probeSessionAiProcesses } from './process';

import { editableSessionConfigPatch } from '../../shared/projectSettings';
export { editableSessionConfigPatch } from '../../shared/projectSettings';

const writes = createKeyedWriteQueue();

/** Validate the edited owner against live processes before any project write. */
export async function prepareSessionToolConfig(
	sessionId: string,
	configPatch: Record<string, unknown>,
	sshPatch?: Partial<AgentSshRemoteConfig>,
	access = {
		getSession: () =>
			useSessionStore.getState().sessions.find((session) => session.id === sessionId),
		setSessions: useSessionStore.getState().setSessions,
	}
): Promise<Partial<Session>> {
	const t = getT();
	let current = access.getSession();
	if (!current) throw new Error(t('workflows.projectSettings.toolMissing'));
	const updated = editableSessionConfigPatch(configPatch) as Partial<Session>;
	if (sshPatch) {
		const processes = await probeSessionAiProcesses(sessionId);
		current = access.getSession();
		if (!current) throw new Error(t('workflows.projectSettings.toolMissing'));
		if (
			current.aiPid > 0 ||
			current.state === 'busy' ||
			current.state === 'connecting' ||
			processes.anyActive
		)
			throw new Error(t('workflows.projectSettings.toolRunning'));
		const merged = { ...current.sessionSshRemoteConfig, ...sshPatch };
		updated.sessionSshRemoteConfig = {
			...merged,
			enabled: merged.enabled ?? false,
			remoteId: merged.remoteId ?? null,
		};
	}
	if (Object.keys(updated).length === 0)
		throw new Error(t('workflows.projectSettings.toolNoChanges'));
	return updated;
}

/** Apply only committed configuration fields, keeping live turns and drafts. */
export function applyProjectToolPatches(patches: Record<string, Record<string, unknown>>): void {
	useSessionStore
		.getState()
		.setSessions((sessions) =>
			sessions.map((session) =>
				patches[session.id] ? { ...session, ...patches[session.id] } : session
			)
		);
}

export async function saveSessionToolConfig(
	sessionId: string,
	configPatch: Record<string, unknown>,
	sshPatch?: Partial<AgentSshRemoteConfig>,
	access = {
		getSession: () =>
			useSessionStore.getState().sessions.find((session) => session.id === sessionId),
		setSessions: useSessionStore.getState().setSessions,
	}
): Promise<void> {
	return writes.enqueue(sessionId, async () => {
		const updated = await prepareSessionToolConfig(sessionId, configPatch, sshPatch, access);
		const current = access.getSession();
		if (!current) throw new Error(getT()('workflows.projectSettings.toolMissing'));
		const result = await window.maestro.sessions.setMany([{ ...current, ...updated }], []);
		if (result === false) throw new Error(getT()('workflows.projectSettings.toolSaveFailed'));
		access.setSessions((sessions) =>
			sessions.map((session) => (session.id === sessionId ? { ...session, ...updated } : session))
		);
	});
}
