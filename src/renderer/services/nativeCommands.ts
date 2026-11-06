import { selectNewShellEnabled, useSettingsStore } from '../stores/settingsStore';
import type { Session } from '../types';
import { nativeBuiltinCommands, type NativeCommandContext } from '../../shared/nativeCommands';

export function nativeCommandContext(session: Session): NativeCommandContext {
	return {
		toolType: session.toolType,
		cwd: session.cwd,
		customEnvVars: session.customEnvVars,
		sessionSshRemoteConfig:
			session.sessionSshRemoteConfig ??
			(session.sshRemote?.id ? { enabled: true, remoteId: session.sshRemote.id } : undefined),
	};
}

/** Execution resolves the same account and files as discovery, including commands typed directly. */
export async function conversationNativeCommands(session: Session) {
	if (
		!selectNewShellEnabled(useSettingsStore.getState()) ||
		!['claude-code', 'codex'].includes(session.toolType)
	)
		return { commands: session.agentCommands ?? [], warning: undefined };
	try {
		return await window.maestro.agents.getNativeCommands(nativeCommandContext(session));
	} catch {
		return {
			commands: nativeBuiltinCommands(session.toolType),
			warning: nativeCommandContext(session).sessionSshRemoteConfig?.enabled
				? ('remote-unavailable' as const)
				: ('unavailable' as const),
		};
	}
}
