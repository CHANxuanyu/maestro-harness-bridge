import { createKeyedWriteQueue } from '../../shared/keyedWriteQueue';
import type { AgentSshRemoteConfig } from '../../shared/types';
import type { Session } from '../types';
import { getT } from '../i18n';
import { useSessionStore } from '../stores/sessionStore';

import { probeSessionAiProcesses } from './process';

const writes = createKeyedWriteQueue();
const EDITABLE_KEYS = new Set([
	'nudgeMessage',
	'newSessionMessage',
	'customPath',
	'customArgs',
	'customEnvVars',
	'customModel',
	'customEffort',
	'customContextWindow',
	// Provenance for the key above (finding AD1). Must be allowlisted or
	// `maestro-cli update-agent --context-window` writes the number without
	// its provenance, and the value it just set stays outranked by the
	// provider's report - the deliberate edit would silently not apply.
	'contextWindowSource',
	'enableMaestroP',
	'maestroPMode',
	'maestroPPath',
	// UI state
	'bookmarked',
]);

/** The existing update-agent allowlist, shared with project tool configuration. */
export function editableSessionConfigPatch(patch: Record<string, unknown>): Partial<Session> {
	const updated: Partial<Session> = {};
	for (const key of Object.keys(patch)) {
		if (!EDITABLE_KEYS.has(key)) continue;
		(updated as Record<string, unknown>)[key] = patch[key] === null ? undefined : patch[key];
	}
	if (patch.customContextWindow === null) updated.contextWindowSource = undefined;
	return updated;
}

/** Persist only the edited owner fields. Never replace its conversations with a form snapshot. */
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
		const t = getT();
		let current = access.getSession();
		if (!current) throw new Error(t('workflows.projectSettings.toolMissing'));
		const updated = editableSessionConfigPatch(configPatch);
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
		const result = await window.maestro.sessions.setMany([{ ...current, ...updated }], []);
		if (result === false) throw new Error(t('workflows.projectSettings.toolSaveFailed'));
		access.setSessions((sessions) =>
			sessions.map((session) => (session.id === sessionId ? { ...session, ...updated } : session))
		);
	});
}
