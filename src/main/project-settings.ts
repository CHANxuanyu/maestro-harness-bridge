import type { PendingSessionPatches } from './stores/pending-session-patches';
import { isValidAgentId } from '../shared/agentIds';
import { DEEPSEEK_PRESET } from '../shared/agentPresets';
import {
	projectSettingsKey,
	projectSettingsScopeForSession,
	editableSessionConfigPatch,
	projectSettingsKeysForScope,
	type ProjectSettingsErrorCode,
	type ProjectSettings,
	type ProjectSettingsCommand,
	type ProjectSettingsMap,
	type ProjectSettingsResult,
	type ProjectSettingsScope,
} from '../shared/projectSettings';
import type { SettingsStoreInterface, StoredSession } from './stores/types';
import { logger } from './utils/logger';

/** No native configuration or project file is read or written by this service. */
export function createProjectSettingsService(deps: {
	settingsStore: SettingsStoreInterface & { delete?(key: string): void };
	sessionsStore?: {
		get(key: 'sessions', fallback: StoredSession[]): StoredSession[];
		set(key: 'sessions', sessions: StoredSession[]): void;
	};
	flushSessionWrites?: () => Promise<void>;
	isSessionRunning?: (id: string) => boolean;
	onChanged?: (toolPatches?: Record<string, Record<string, unknown>>) => void;
	/** Guards a committed tool patch against a stale flush from the owning window. */
	pendingPatches?: Pick<PendingSessionPatches, 'note' | 'forget'>;
}) {
	return {
		async command(input: unknown): Promise<ProjectSettingsResult> {
			let scope: ProjectSettingsScope = { projectPath: '' };
			let settings: ProjectSettings = {};
			const failure = (
				errorCode: ProjectSettingsErrorCode,
				params?: Record<string, string>
			): ProjectSettingsResult => ({
				success: false,
				scope,
				settings,
				code:
					errorCode === 'fullAccessRequired'
						? 'full-access-confirmation-required'
						: errorCode === 'saveFailed' || errorCode === 'rollbackFailed'
							? 'persistence-failed'
							: 'invalid-request',
				errorCode,
				...(params ? { params } : {}),
			});
			try {
				const command = input as ProjectSettingsCommand;
				if (
					!command ||
					!['show', 'set'].includes(command.action) ||
					!command.scope ||
					typeof command.scope.projectPath !== 'string' ||
					!command.scope.projectPath.trim() ||
					command.scope.projectPath.includes('\0') ||
					(command.scope.sshRemoteId !== undefined &&
						(typeof command.scope.sshRemoteId !== 'string' ||
							!command.scope.sshRemoteId.trim() ||
							command.scope.sshRemoteId.includes('\0')))
				)
					return failure('scopeRequired');
				scope = {
					projectPath: command.scope.projectPath,
					...(command.scope.sshRemoteId ? { sshRemoteId: command.scope.sshRemoteId } : {}),
				};
				const key = projectSettingsKey(scope);
				const previousSettings = deps.settingsStore.get<ProjectSettingsMap | undefined>(
					'projectSettings'
				);
				const stored = previousSettings ?? {};
				const storedKeys = projectSettingsKeysForScope(stored, scope);
				settings = { ...(stored[storedKeys[0]] ?? {}) };
				if (command.action === 'show') return { success: true, scope, settings };
				const newShell = deps.settingsStore.get('newShell', false);
				if (!command.patch || typeof command.patch !== 'object' || Array.isArray(command.patch))
					return failure('invalidPatch');
				const next = { ...settings };
				if (
					'defaultProvider' in command.patch &&
					(command.patch.defaultProvider ?? undefined) !== settings.defaultProvider
				) {
					delete next.modelProvider;
					delete next.defaultModel;
					delete next.defaultReasoningEffort;
				}
				for (const [field, value] of Object.entries(command.patch)) {
					if (
						![
							'autoHandoffTarget',
							'defaultProvider',
							'modelProvider',
							'defaultModel',
							'defaultReasoningEffort',
							'defaultPermissionMode',
							'envVars',
						].includes(field)
					)
						return failure('unknownSetting', { field });
					if (value === null) {
						delete next[field as keyof ProjectSettings];
						continue;
					}
					if (field === 'envVars') {
						if (
							!value ||
							typeof value !== 'object' ||
							Array.isArray(value) ||
							Object.entries(value).some(
								([name, entry]) =>
									!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
									typeof entry !== 'string' ||
									entry.includes('\0')
							)
						)
							return failure('invalidEnvironment');
						next.envVars = { ...value };
						continue;
					}
					if (
						typeof value !== 'string' ||
						!value.trim() ||
						value.includes('\0') ||
						value.length > 512
					)
						return failure('invalidSetting', { field });
					if (
						(field === 'defaultProvider' || field === 'modelProvider') &&
						(value === 'terminal' || (!isValidAgentId(value) && value !== DEEPSEEK_PRESET.id))
					)
						return failure('unknownProvider');
					if (
						field === 'defaultPermissionMode' &&
						!['full', 'standard', 'readonly'].includes(value)
					)
						return failure('invalidPermission');
					Object.assign(next, { [field]: value });
				}
				if (next.defaultModel || next.defaultReasoningEffort) {
					next.modelProvider ??= next.defaultProvider;
					if (
						!next.modelProvider &&
						(command.patch.defaultModel || command.patch.defaultReasoningEffort)
					)
						return failure('modelProviderRequired');
				} else {
					delete next.modelProvider;
				}
				if (next.defaultPermissionMode === 'full' && !settings.fullAccessAcknowledged) {
					if (command.acknowledgeFullAccess !== true) return failure('fullAccessRequired');
					next.fullAccessAcknowledged = true;
				}
				const toolPatches: Record<string, Record<string, unknown>> = {};
				const previousSessions = deps.sessionsStore?.get('sessions', []) ?? [];
				if (command.toolPatches !== undefined) {
					if (!newShell) return failure('newShellRequired');
					if (
						!deps.sessionsStore ||
						!deps.flushSessionWrites ||
						!command.toolPatches ||
						typeof command.toolPatches !== 'object' ||
						Array.isArray(command.toolPatches)
					)
						return failure('invalidPatch');
					for (const [id, patch] of Object.entries(command.toolPatches)) {
						const owner = previousSessions.find((session) => session.id === id);
						if (!owner || projectSettingsKey(projectSettingsScopeForSession(owner)) !== key)
							return failure('toolMissing');
						if (!patch || typeof patch !== 'object' || Array.isArray(patch))
							return failure('invalidPatch');
						const { sessionSshRemoteConfig: ssh, ...config } = patch;
						const fields = editableSessionConfigPatch(config);
						if (Object.keys(config).some((field) => !(field in fields)))
							return failure('invalidPatch');
						for (const [field, value] of Object.entries(fields)) {
							if (value === undefined) continue;
							if (field === 'customEnvVars') {
								if (
									!value ||
									typeof value !== 'object' ||
									Array.isArray(value) ||
									Object.entries(value).some(
										([name, entry]) =>
											!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
											typeof entry !== 'string' ||
											entry.includes('\0')
									)
								)
									return failure('invalidEnvironment');
							} else if (field === 'enableMaestroP' || field === 'bookmarked') {
								if (typeof value !== 'boolean') return failure('invalidSetting', { field });
							} else if (field === 'maestroPMode') {
								if (value !== 'interactive' && value !== 'dynamic')
									return failure('invalidSetting', { field });
							} else if (field === 'contextWindowSource') {
								if (value !== 'user-edited') return failure('invalidSetting', { field });
							} else if (field === 'customContextWindow') {
								if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
									return failure('invalidSetting', { field });
							} else if (typeof value !== 'string' || value.includes('\0'))
								return failure('invalidSetting', { field });
						}
						if (ssh !== undefined) {
							if (!ssh || typeof ssh !== 'object' || Array.isArray(ssh))
								return failure('invalidPatch');
							const sshFields = ssh as Record<string, unknown>;
							if (
								Object.entries(sshFields).some(([field, value]) =>
									['enabled', 'syncHistory', 'shareHistoryToProjectDir'].includes(field)
										? typeof value !== 'boolean'
										: field === 'remoteId'
											? value !== null && typeof value !== 'string'
											: field === 'workingDirOverride'
												? typeof value !== 'string' || value.includes('\0')
												: true
								)
							)
								return failure('invalidPatch');
							if (
								owner.aiPid > 0 ||
								owner.state === 'busy' ||
								owner.state === 'connecting' ||
								deps.isSessionRunning?.(id)
							)
								return failure('toolRunning');
							const merged = {
								enabled: false,
								remoteId: null,
								...owner.sessionSshRemoteConfig,
								...sshFields,
							};
							if (merged.enabled && !merged.remoteId) return failure('invalidPatch');
							fields.sessionSshRemoteConfig = merged;
						}
						toolPatches[id] = fields;
					}
				}
				const hasTools = Object.keys(toolPatches).length > 0;
				let sessionsAttempted = false;
				let settingsAttempted = false;
				try {
					// Persist all edited tools together, then the defaults. No observer is
					// notified until both stores acknowledge the complete transaction.
					if (hasTools) {
						// Guard before writing: a window flush can land between this write
						// and the announcement, and it must not restore the old values.
						for (const [id, fields] of Object.entries(toolPatches)) {
							const before = previousSessions.find((session) => session.id === id) as
								| Record<string, unknown>
								| undefined;
							deps.pendingPatches?.note(
								id,
								fields,
								Object.fromEntries(Object.keys(fields).map((field) => [field, before?.[field]]))
							);
						}
						sessionsAttempted = true;
						deps.sessionsStore!.set(
							'sessions',
							previousSessions.map((session) =>
								toolPatches[session.id] ? { ...session, ...toolPatches[session.id] } : session
							)
						);
						await deps.flushSessionWrites!();
					}
					const updated = { ...stored };
					for (const alias of storedKeys) delete updated[alias];
					settingsAttempted = true;
					deps.settingsStore.set('projectSettings', { ...updated, [key]: next });
				} catch {
					// Include a write that threw after mutating its in-memory document.
					// Always restore both stores even if one rollback itself fails.
					let rollbackFailed = false;
					if (newShell) {
						try {
							if (settingsAttempted) {
								if (previousSettings === undefined && deps.settingsStore.delete)
									deps.settingsStore.delete('projectSettings');
								else deps.settingsStore.set('projectSettings', stored);
							}
						} catch {
							rollbackFailed = true;
						}
						try {
							if (sessionsAttempted) {
								deps.sessionsStore!.set('sessions', previousSessions);
								await deps.flushSessionWrites!();
							}
						} catch {
							rollbackFailed = true;
						}
					}
					// Nothing of the patch stays on disk when the write never happened or
					// was rolled back, so stop guarding it.
					if (hasTools && (!sessionsAttempted || newShell))
						deps.pendingPatches?.forget(Object.keys(toolPatches));
					return failure(rollbackFailed ? 'rollbackFailed' : 'saveFailed');
				}
				try {
					deps.onChanged?.(hasTools ? toolPatches : undefined);
				} catch (error) {
					if (!newShell) throw error;
					// The commit already succeeded. A disconnected observer must not
					// turn its acknowledgement into a misleading persistence failure.
					logger.warn(
						'Project settings committed, but a change listener failed',
						'ProjectSettings'
					);
				}
				return { success: true, scope, settings: next };
			} catch {
				return failure('requestFailed');
			}
		},
	};
}
