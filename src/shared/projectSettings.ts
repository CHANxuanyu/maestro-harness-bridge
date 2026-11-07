import { normalizeWorktreePath } from './worktreePaths';

/** Defaults belong to one project path on one host, never to a sidebar group. */
export interface ProjectSettingsScope {
	projectPath: string;
	sshRemoteId?: string;
}

export interface ProjectSettings {
	defaultProvider?: string;
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

export interface ProjectSettingsResult {
	success: boolean;
	scope: ProjectSettingsScope;
	settings: ProjectSettings;
	code?: 'invalid-request' | 'full-access-confirmation-required' | 'persistence-failed';
	error?: string;
}

/** Pure equality key. Remote paths are never interpreted by the local filesystem. */
export function projectSettingsKey(scope: ProjectSettingsScope): string {
	return JSON.stringify([
		scope.sshRemoteId ?? null,
		normalizeWorktreePath(scope.projectPath, !!scope.sshRemoteId),
	]);
}
