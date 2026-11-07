import { normalizeWorktreePath } from './worktreePaths';

/** Allows an SSH tool probe and the owning window to persist a new conversation. */
export const PROJECT_CONVERSATION_TIMEOUT_MS = 60_000;

/** Defaults belong to one project path on one host, never to a sidebar group. */
export interface ProjectSettingsScope {
	projectPath: string;
	sshRemoteId?: string;
}

export interface ProjectSettings {
	defaultProvider?: string;
	/** Tool that owns the model and effort, even when the default tool is inherited. */
	modelProvider?: string;
	defaultModel?: string;
	defaultReasoningEffort?: string;
	defaultPermissionMode?: 'full' | 'standard' | 'readonly';
	envVars?: Record<string, string>;
	fullAccessAcknowledged?: true;
}

export type ProjectSettingsMap = Record<string, ProjectSettings>;
export type ProjectSettingsPatch = {
	[Key in Exclude<keyof ProjectSettings, 'fullAccessAcknowledged'>]?: ProjectSettings[Key] | null;
};

export type ProjectSettingsCommand =
	| { action: 'show'; scope: ProjectSettingsScope }
	| {
			action: 'set';
			scope: ProjectSettingsScope;
			patch: ProjectSettingsPatch;
			acknowledgeFullAccess?: boolean;
	  };

export type ProjectSettingsErrorCode =
	| 'scopeRequired'
	| 'invalidPatch'
	| 'unknownSetting'
	| 'invalidEnvironment'
	| 'invalidSetting'
	| 'unknownProvider'
	| 'invalidPermission'
	| 'fullAccessRequired'
	| 'saveFailed'
	| 'requestFailed'
	| 'modelProviderRequired';

export interface ProjectSettingsResult {
	success: boolean;
	scope: ProjectSettingsScope;
	settings: ProjectSettings;
	code?: 'invalid-request' | 'full-access-confirmation-required' | 'persistence-failed';
	environmentRedacted?: boolean;
	errorCode?: ProjectSettingsErrorCode;
	params?: Record<string, string>;
	/** Localized by the caller, never by the main service. */
	error?: string;
}

/** Pure equality key. Remote paths are never interpreted by the local filesystem. */
export function projectSettingsKey(scope: ProjectSettingsScope): string {
	return JSON.stringify([
		scope.sshRemoteId ?? null,
		normalizeWorktreePath(scope.projectPath, !!scope.sshRemoteId, true),
	]);
}

/** Keep the presence of environment defaults for creation routing without exposing values. */
export function publicProjectSettings(settings: ProjectSettings): ProjectSettings {
	return { ...settings, ...(settings.envVars ? { envVars: {} } : {}) };
}

export function publicProjectSettingsMap(settings: ProjectSettingsMap): ProjectSettingsMap {
	return Object.fromEntries(
		Object.entries(settings).map(([key, value]) => [key, publicProjectSettings(value)])
	);
}

/** Dot notation must not bypass the service's confirmation and validation. */
export function isProjectSettingsKey(key: string): boolean {
	return key === 'projectSettings' || key.startsWith('projectSettings.');
}

/** Canonical spelling first, then compatible keys saved before Windows case folding. */
export function projectSettingsKeysForScope(
	settings: ProjectSettingsMap,
	scope: ProjectSettingsScope
): string[] {
	const canonical = projectSettingsKey(scope);
	const aliases = Object.keys(settings).filter((key) => {
		if (key === canonical) return false;
		try {
			const parsed = JSON.parse(key);
			return (
				Array.isArray(parsed) &&
				parsed.length === 2 &&
				(parsed[0] === null || typeof parsed[0] === 'string') &&
				typeof parsed[1] === 'string' &&
				projectSettingsKey({ projectPath: parsed[1], sshRemoteId: parsed[0] ?? undefined }) ===
					canonical
			);
		} catch {
			return false;
		}
	});
	return [
		...(Object.prototype.hasOwnProperty.call(settings, canonical) ? [canonical] : []),
		...aliases,
	];
}
