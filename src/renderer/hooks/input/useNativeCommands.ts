import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { nativeCommandContext } from '../../services/nativeCommands';
import { useSessionStore } from '../../stores/sessionStore';
import { selectNewShellEnabled, useSettingsStore } from '../../stores/settingsStore';
import type { Session } from '../../types';
import { nativeBuiltinCommands, type NativeCommandSnapshot } from '../../../shared/nativeCommands';

const useCommandCache = create<{ entries: Map<string, NativeCommandSnapshot> }>(() => ({
	entries: new Map(),
}));

/** Cached commands stay mounted during refresh; results are isolated by conversation configuration. */
export function useNativeCommands(
	session: Session | null | undefined,
	open: boolean,
	refresh = true
) {
	const enabled = useSettingsStore(selectNewShellEnabled);
	const shellEnvVars = useSettingsStore((s) => s.shellEnvVars);
	const supported = enabled && !!session && ['claude-code', 'codex'].includes(session.toolType);
	// App's chrome snapshot omits environment edits. Subscribe to the account input directly.
	const customEnvVars = useSessionStore((s) =>
		supported
			? (s.sessions.find((current) => current.id === session.id) ?? session).customEnvVars
			: session?.customEnvVars
	);
	const context = session && nativeCommandContext({ ...session, customEnvVars });
	const key = JSON.stringify([context, shellEnvVars]);
	const snapshot = useCommandCache((s) => s.entries.get(key));
	const builtins = useMemo(
		() => nativeBuiltinCommands(session?.toolType ?? ''),
		[session?.toolType]
	);
	useEffect(() => {
		if (!supported || !context || !refresh || (!open && snapshot)) return;
		let cancelled = false;
		const publish = (value: NativeCommandSnapshot) => {
			if (cancelled) return;
			useCommandCache.setState((state) => {
				const entries = new Map(state.entries);
				entries.delete(key);
				entries.set(key, value);
				while (entries.size > 64) entries.delete(entries.keys().next().value!);
				return { entries };
			});
		};
		void (async () => {
			try {
				publish(await window.maestro.agents.getNativeCommands(context, true));
				publish(await window.maestro.agents.getNativeCommands(context));
			} catch {
				publish({
					commands: nativeBuiltinCommands(context.toolType),
					warning: context.sessionSshRemoteConfig?.enabled ? 'remote-unavailable' : 'unavailable',
				});
			}
		})();
		return () => {
			cancelled = true;
		};
		// key contains the context and account environment. No polling while the menu is closed.
	}, [key, supported, open, refresh, session?.agentCommands]);
	return { supported, commands: snapshot?.commands ?? builtins, warning: snapshot?.warning };
}
