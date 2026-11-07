import { isValidAgentId } from '../shared/agentIds';
import { DEEPSEEK_PRESET } from '../shared/agentPresets';
import {
	projectSettingsKey,
	projectSettingsKeysForScope,
	type ProjectSettingsErrorCode,
	type ProjectSettings,
	type ProjectSettingsCommand,
	type ProjectSettingsMap,
	type ProjectSettingsResult,
	type ProjectSettingsScope,
} from '../shared/projectSettings';
import type { SettingsStoreInterface } from './stores/types';

/** No native configuration or project file is read or written by this service. */
export function createProjectSettingsService(deps: {
	settingsStore: SettingsStoreInterface;
	onChanged?: () => void;
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
						: errorCode === 'saveFailed'
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
				const stored = deps.settingsStore.get<ProjectSettingsMap>('projectSettings', {});
				const storedKeys = projectSettingsKeysForScope(stored, scope);
				settings = { ...(stored[storedKeys[0]] ?? {}) };
				if (command.action === 'show') return { success: true, scope, settings };
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
				try {
					const updated = { ...stored };
					for (const alias of storedKeys) delete updated[alias];
					deps.settingsStore.set('projectSettings', { ...updated, [key]: next });
				} catch {
					return failure('saveFailed');
				}
				deps.onChanged?.();
				return { success: true, scope, settings: next };
			} catch {
				return failure('requestFailed');
			}
		},
	};
}
