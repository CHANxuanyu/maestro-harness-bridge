import {
	projectSettingsKeysForScope,
	type ProjectSettingsScope,
} from '../../shared/projectSettings';
import { sessionProviderId } from '../../shared/agentPresets';
import { handoffLocation } from '../../shared/aiHandoff';
import { useSettingsStore } from '../stores/settingsStore';
import type { AITab, Session } from '../types';
import {
	newConversationPermissionFields,
	remoteConversationPermissionFields,
} from './newConversationPermissions';
import type { AgentCapabilities } from '../../shared/types';

/** The SSH execution directory is remote data and never enters local path resolution. */
export function projectSettingsScopeForSession(
	session: Pick<Session, 'cwd' | 'projectRoot' | 'sessionSshRemoteConfig'>
): ProjectSettingsScope {
	const ssh = session.sessionSshRemoteConfig;
	return {
		projectPath: ssh?.enabled ? handoffLocation(session).cwd : session.projectRoot || session.cwd,
		...(ssh?.enabled && ssh.remoteId ? { sshRemoteId: ssh.remoteId } : {}),
	};
}

export function projectSettingsForSession(
	session: Pick<Session, 'cwd' | 'projectRoot' | 'sessionSshRemoteConfig'>
) {
	const settings = useSettingsStore.getState();
	return settings.newShell
		? settings.projectSettings?.[
				projectSettingsKeysForScope(
					settings.projectSettings ?? {},
					projectSettingsScopeForSession(session)
				)[0]
			]
		: undefined;
}

/** Freeze defaults only onto a newly created conversation. Existing tabs never read them. */
export function projectConversationFields(
	session: Pick<
		Session,
		| 'cwd'
		| 'projectRoot'
		| 'sessionSshRemoteConfig'
		| 'toolType'
		| 'customEnvVars'
		| 'enableMaestroP'
		| 'maestroPMode'
		| 'customPath'
	>,
	source?: Pick<AITab, 'permissionMode' | 'readOnlyMode' | 'customModel' | 'customEffort'>,
	capabilities?: Pick<
		AgentCapabilities,
		'supportsReadOnlyMode' | 'supportsStandardPermissionMode' | 'supportsCodexAppServer'
	>,
	allowAppServer = true
) {
	const project = projectSettingsForSession(session);
	const permission = project?.defaultPermissionMode
		? remoteConversationPermissionFields(
				source ?? { permissionMode: 'full' },
				project.defaultPermissionMode
			)
		: source;
	const fields = newConversationPermissionFields(
		permission,
		capabilities,
		!allowAppServer || !!session.sessionSshRemoteConfig?.enabled,
		session
	);
	if (!fields) return null;
	const modelDefaults =
		(project?.modelProvider ?? project?.defaultProvider) === sessionProviderId(session)
			? project
			: undefined;
	return {
		...fields,
		customModel: source?.customModel ?? modelDefaults?.defaultModel,
		customEffort: source?.customEffort ?? modelDefaults?.defaultReasoningEffort,
	};
}
