import { getTranslator } from '../renderer/i18n/translate';
import { resolveAppLocale } from '../shared/i18n';
import { isValidAgentId } from '../shared/agentIds';
import { DEEPSEEK_PRESET } from '../shared/agentPresets';
import {
	projectSettingsKey,
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
			try {
				const t = getTranslator(
					resolveAppLocale(
						deps.settingsStore.get('uiLanguage'),
						Intl.DateTimeFormat().resolvedOptions().locale
					)
				);
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
					throw new Error(t('workflows.projectSettings.errors.scopeRequired'));
				scope = {
					projectPath: command.scope.projectPath,
					...(command.scope.sshRemoteId ? { sshRemoteId: command.scope.sshRemoteId } : {}),
				};
				const key = projectSettingsKey(scope);
				const stored = deps.settingsStore.get<ProjectSettingsMap>('projectSettings', {});
				settings = { ...(stored[key] ?? {}) };
				if (command.action === 'show') return { success: true, scope, settings };
				if (!command.patch || typeof command.patch !== 'object' || Array.isArray(command.patch))
					throw new Error(t('workflows.projectSettings.errors.invalidPatch'));
				const next = { ...settings };
				if (
					'defaultProvider' in command.patch &&
					(command.patch.defaultProvider ?? undefined) !== settings.defaultProvider
				) {
					delete next.defaultModel;
					delete next.defaultReasoningEffort;
				}
				for (const [field, value] of Object.entries(command.patch)) {
					if (
						![
							'defaultProvider',
							'defaultModel',
							'defaultReasoningEffort',
							'defaultPermissionMode',
							'envVars',
						].includes(field)
					)
						throw new Error(t('workflows.projectSettings.errors.unknownSetting', { field }));
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
							throw new Error(t('workflows.projectSettings.errors.invalidEnvironment'));
						next.envVars = { ...value };
						continue;
					}
					if (
						typeof value !== 'string' ||
						!value.trim() ||
						value.includes('\0') ||
						value.length > 512
					)
						throw new Error(t('workflows.projectSettings.errors.invalidSetting', { field }));
					if (
						field === 'defaultProvider' &&
						(value === 'terminal' || (!isValidAgentId(value) && value !== DEEPSEEK_PRESET.id))
					)
						throw new Error(t('workflows.projectSettings.errors.unknownProvider'));
					if (
						field === 'defaultPermissionMode' &&
						!['full', 'standard', 'readonly'].includes(value)
					)
						throw new Error(t('workflows.projectSettings.errors.invalidPermission'));
					Object.assign(next, { [field]: value });
				}
				if (next.defaultPermissionMode === 'full' && !settings.fullAccessAcknowledged) {
					if (command.acknowledgeFullAccess !== true)
						return {
							success: false,
							scope,
							settings,
							code: 'full-access-confirmation-required',
							error: t('workflows.projectSettings.errors.fullAccessRequired'),
						};
					next.fullAccessAcknowledged = true;
				}
				try {
					deps.settingsStore.set('projectSettings', { ...stored, [key]: next });
				} catch {
					return {
						success: false,
						scope,
						settings,
						code: 'persistence-failed',
						error: t('workflows.projectSettings.errors.saveFailed'),
					};
				}
				deps.onChanged?.();
				return { success: true, scope, settings: next };
			} catch (error) {
				return {
					success: false,
					scope,
					settings,
					code: 'invalid-request',
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	};
}
