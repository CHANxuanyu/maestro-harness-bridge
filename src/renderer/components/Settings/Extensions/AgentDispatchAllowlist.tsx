import { useT } from '../../../i18n';
/**
 * Host-managed dispatch allow list (issue #1250).
 *
 * A plugin's `agents:dispatch` grant names EXACTLY which agents it may prompt.
 * That set used to be frozen in the signed manifest, so adding a new agent
 * forced a re-pack + re-sign of the plugin. This editor lets the USER - a
 * different principal from the plugin - widen or narrow that allow list from
 * Settings. On save the main process re-mints the grant's SCOPE into the sealed
 * ledger (`plugins:set-agent-allowlist`); the plugin is never involved and can
 * never reach this path. Only agents that currently exist are dispatchable, so
 * ids no longer present are surfaced and dropped on save.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import type { Theme } from '../../../types';
import { parseAllowlistScope, type PermissionGrant } from '../../../../shared/plugins/permissions';
import type { PluginGrantsSnapshot } from '../../../../main/ipc/handlers/plugins';
import { useSessionStore } from '../../../stores/sessionStore';
import { notifyToast } from '../../../stores/notificationStore';
import { captureException } from '../../../utils/sentry';

interface AgentDispatchAllowlistProps {
	theme: Theme;
	pluginId: string;
	/** The plugin's current agents:dispatch grant - its scope holds the allow list. */
	grant: PermissionGrant;
	/** Called with the refreshed snapshot after a successful re-mint. */
	onSaved: (snapshot: PluginGrantsSnapshot) => void;
}

export function AgentDispatchAllowlist({
	theme,
	pluginId,
	grant,
	onSaved,
}: AgentDispatchAllowlistProps) {
	const tExtra = useT();
	const sessions = useSessionStore((s) => s.sessions);
	const sessionIds = useMemo(() => new Set(sessions.map((s) => s.id)), [sessions]);

	// The persisted allow list from the ledger grant. Recomputed only when the
	// scope changes (after a save, or when switching plugins).
	const currentMembers = useMemo(
		() => new Set(parseAllowlistScope(grant.scope) ?? []),
		[grant.scope]
	);

	const [checked, setChecked] = useState<Set<string>>(new Set());
	const [saving, setSaving] = useState(false);

	// Seed the editable set from the persisted scope. Reset on pluginId too, so a
	// switch between plugins whose grants happen to share the same scope string
	// still re-seeds (belt-and-suspenders with the parent's per-plugin key). Does
	// NOT depend on the sessions list, so a live agent status change (a fresh
	// sessions array) never wipes an in-progress edit.
	useEffect(() => {
		setChecked(new Set(currentMembers));
	}, [currentMembers, pluginId]);

	// Allowed ids that no longer match a live agent (a deleted agent, or a stale
	// manifest id): unenforceable, and dropped when the user saves.
	const staleChecked = useMemo(
		() => [...checked].filter((id) => !sessionIds.has(id)),
		[checked, sessionIds]
	);
	const liveCheckedCount = checked.size - staleChecked.length;

	// A save is meaningful when the live selection diverges from the persisted
	// scope, OR there are stale ids to prune.
	const dirty =
		staleChecked.length > 0 ||
		checked.size !== currentMembers.size ||
		[...checked].some((id) => !currentMembers.has(id));

	const toggle = useCallback((id: string) => {
		setChecked((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const save = useCallback(async () => {
		setSaving(true);
		try {
			// Send only live ids; the host also filters, but keep the payload honest.
			const members = [...checked].filter((id) => sessionIds.has(id));
			const snapshot = await window.maestro.plugins.setAgentAllowlist(pluginId, members);
			onSaved(snapshot);
			notifyToast({
				color: 'green',
				title: tExtra('settings.extra.agentDispatchAllowlist.plugins'),
				message: tExtra('settings.extra.agentDispatchAllowlist.updatedDispatchAllowList'),
			});
		} catch (err) {
			// The IPC only rejects on host-side validation (InvalidAgentIds /
			// DispatchNotGranted / ...), which the editor's own gating makes
			// unreachable in normal use - so a failure here is unexpected. Report it
			// AND surface a toast (this is a user-initiated action, not a silent path).
			captureException(err, { tags: { pluginId }, extra: { operation: 'setAgentAllowlist' } });
			notifyToast({
				color: 'red',
				title: tExtra('settings.extra.agentDispatchAllowlist.plugins'),
				message: tExtra('settings.extra.agentDispatchAllowlist.updateFailed', {
					error: String(err),
				}),
			});
		} finally {
			setSaving(false);
		}
	}, [pluginId, checked, sessionIds, onSaved, tExtra]);

	return (
		<div className="mt-5" data-testid="agent-dispatch-allowlist">
			<div
				className="text-xs font-bold uppercase opacity-70 mb-1"
				style={{ color: theme.colors.textMain }}
			>
				{tExtra('settings.extra.agentDispatchAllowlist.dispatchAllowList')}
			</div>
			<p className="text-xs-plus mb-2" style={{ color: theme.colors.textDim }}>
				{tExtra('settings.extra.agentDispatchAllowlist.chooseWhichAgentsThisPluginMaySend')}
			</p>

			{sessions.length === 0 ? (
				<div
					className="text-xs italic rounded-lg border p-3"
					style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
				>
					{tExtra('settings.extra.agentDispatchAllowlist.noAgentsYetCreateAnAgentThen')}
				</div>
			) : (
				<div
					className="flex flex-col gap-1 max-h-64 overflow-y-auto rounded-lg border p-1.5"
					style={{ borderColor: theme.colors.border }}
				>
					{sessions.map((session) => (
						<label
							key={session.id}
							data-testid="agent-dispatch-allowlist-row"
							data-agent-id={session.id}
							className="flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer hover:bg-white/5"
						>
							<input
								type="checkbox"
								data-testid="agent-dispatch-allowlist-checkbox"
								checked={checked.has(session.id)}
								onChange={() => toggle(session.id)}
							/>
							<div className="min-w-0 flex-1">
								<div className="text-xs truncate" style={{ color: theme.colors.textMain }}>
									{session.name || session.id}
								</div>
								<div
									className="text-2xs font-mono truncate"
									style={{ color: theme.colors.textDim }}
								>
									{session.id}
								</div>
							</div>
						</label>
					))}
				</div>
			)}

			{staleChecked.length > 0 && (
				<p
					className="text-2xs mt-1.5"
					data-testid="agent-dispatch-allowlist-stale"
					style={{ color: theme.colors.warning }}
				>
					{tExtra(
						staleChecked.length === 1
							? 'settings.extra.agentDispatchAllowlist.staleOne'
							: 'settings.extra.agentDispatchAllowlist.staleMany',
						{ count: staleChecked.length }
					)}
				</p>
			)}

			<div className="flex items-center gap-2 mt-2.5">
				<button
					type="button"
					data-testid="agent-dispatch-allowlist-save"
					disabled={!dirty || saving}
					onClick={() => void save()}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
					style={{ backgroundColor: theme.colors.accent, color: theme.colors.bgMain }}
				>
					<Send className="w-3.5 h-3.5" />{' '}
					{tExtra('settings.extra.agentDispatchAllowlist.saveAllowList')}
				</button>
				<span className="text-xs-plus" style={{ color: theme.colors.textDim }}>
					{tExtra(
						sessions.length === 1
							? 'settings.extra.agentDispatchAllowlist.allowedOne'
							: 'settings.extra.agentDispatchAllowlist.allowedMany',
						{ allowed: liveCheckedCount, total: sessions.length }
					)}
				</span>
			</div>
		</div>
	);
}
