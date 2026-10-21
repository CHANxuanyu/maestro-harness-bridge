import { useT } from '../../i18n';
/**
 * Coworking Setup panel - shown inside the Coworking section of the Encore tab.
 *
 * Lists every supported agent with its current install status and per-agent
 * Install / Uninstall buttons, plus an "Install for all" convenience button.
 *
 * Install writes the `maestro-coworking` MCP entry into the agent's user-level
 * config file (e.g. `~/.claude.json`, `~/.codex/config.toml`). After install,
 * the user must restart any open agent tabs of that type for the change to be
 * picked up - we surface that explicitly via toast.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, Loader2, RefreshCw, X } from 'lucide-react';
import type { Theme } from '../../types';
import { getAgentDisplayName } from '../../../shared/agentMetadata';
import type { AgentId } from '../../../shared/agentIds';
import { notifyToast } from '../../stores/notificationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
	DEFAULT_BROWSER_CONFIRM_POLICY,
	type BrowserConfirmPolicy,
} from '../../../shared/coworkingBrowser';

/** Segmented-control options for the per-call approval policy, in escalating
 *  paranoia order. Labels are user language; values are the wire policy. */
const CONFIRM_POLICY_OPTIONS: ReadonlyArray<{ value: BrowserConfirmPolicy; label: string }> = [
	{ value: 'dangerous', label: 'Risky only' },
	{ value: 'all', label: 'Every action' },
	{ value: 'off', label: 'JS only' },
];

interface CoworkingInstallStatus {
	agentId: string;
	configPath: string;
	installed: boolean;
}

export interface CoworkingSetupProps {
	theme: Theme;
}

export function CoworkingSetup({ theme }: CoworkingSetupProps) {
	const tExtra = useT();
	const [statuses, setStatuses] = useState<CoworkingInstallStatus[]>([]);
	const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
	const [busyAll, setBusyAll] = useState(false);
	const [loading, setLoading] = useState(true);
	// Alphabetical by display name, matching every other provider list.
	const sortedStatuses = useMemo(
		() =>
			[...statuses].sort((a, b) =>
				getAgentDisplayName(a.agentId as AgentId).localeCompare(
					getAgentDisplayName(b.agentId as AgentId)
				)
			),
		[statuses]
	);
	const browserInteractionAgents = useSettingsStore((s) => s.coworkingBrowserInteraction);
	const setBrowserInteractionAgents = useSettingsStore((s) => s.setCoworkingBrowserInteraction);
	const toggleInteraction = useCallback(
		(agentId: string) => {
			const isEnabled = browserInteractionAgents.includes(agentId);
			setBrowserInteractionAgents(
				isEnabled
					? browserInteractionAgents.filter((a) => a !== agentId)
					: [...browserInteractionAgents, agentId]
			);
		},
		[browserInteractionAgents, setBrowserInteractionAgents]
	);
	const browserConfirm = useSettingsStore((s) => s.coworkingBrowserInteractionConfirm);
	const setBrowserConfirm = useSettingsStore((s) => s.setCoworkingBrowserInteractionConfirm);
	const setConfirmPolicy = useCallback(
		(agentId: string, policy: BrowserConfirmPolicy) => {
			setBrowserConfirm({ ...browserConfirm, [agentId]: policy });
		},
		[browserConfirm, setBrowserConfirm]
	);
	const backgroundBrowsers = useSettingsStore((s) => s.coworkingBackgroundBrowsers);
	const setBackgroundBrowsers = useSettingsStore((s) => s.setCoworkingBackgroundBrowsers);
	const backgroundLimit = useSettingsStore((s) => s.coworkingBackgroundBrowsersLimit);
	const setBackgroundLimit = useSettingsStore((s) => s.setCoworkingBackgroundBrowsersLimit);

	const refresh = useCallback(async () => {
		// Defensive: in test harnesses (or older preload bundles) the namespace
		// may not exist. Treat as "no agents detected" rather than crashing.
		const bridge = window.maestro?.coworking;
		if (!bridge) {
			setStatuses([]);
			setLoading(false);
			return;
		}
		try {
			const next = await bridge.getInstallStatus();
			setStatuses(next);
		} catch (err) {
			notifyToast({
				color: 'red',
				title: tExtra('settings.extra.coworkingSetup.coworking'),
				message: tExtra('settings.extra.coworkingSetup.statusFailed', {
					error: err instanceof Error ? err.message : String(err),
				}),
			});
		} finally {
			setLoading(false);
		}
	}, [tExtra]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const handleInstall = useCallback(
		async (agentId: string) => {
			// Don't let two mutations race on the same user-level config file.
			if (busyAll || busyAgentId) return;
			setBusyAgentId(agentId);
			try {
				await window.maestro.coworking.install(agentId);
				notifyToast({
					color: 'green',
					title: tExtra('settings.extra.coworkingSetup.coworkingInstalled'),
					message: tExtra('settings.extra.coworkingSetup.installed', {
						agent: getAgentDisplayName(agentId as AgentId),
					}),
				});
				await refresh();
			} catch (err) {
				notifyToast({
					color: 'red',
					title: tExtra('settings.extra.coworkingSetup.coworkingInstallFailed'),
					message: err instanceof Error ? err.message : String(err),
				});
			} finally {
				setBusyAgentId(null);
			}
		},
		[busyAll, busyAgentId, refresh, tExtra]
	);

	const handleUninstall = useCallback(
		async (agentId: string) => {
			if (busyAll || busyAgentId) return;
			setBusyAgentId(agentId);
			try {
				await window.maestro.coworking.uninstall(agentId);
				notifyToast({
					color: 'theme',
					title: tExtra('settings.extra.coworkingSetup.coworkingUninstalled'),
					message: tExtra('settings.extra.coworkingSetup.uninstalled', {
						agent: getAgentDisplayName(agentId as AgentId),
					}),
				});
				await refresh();
			} catch (err) {
				notifyToast({
					color: 'red',
					title: tExtra('settings.extra.coworkingSetup.coworkingUninstallFailed'),
					message: err instanceof Error ? err.message : String(err),
				});
			} finally {
				setBusyAgentId(null);
			}
		},
		[busyAll, busyAgentId, refresh, tExtra]
	);

	const handleInstallAll = useCallback(async () => {
		// Don't let bulk install race with a per-agent mutation already in flight.
		if (busyAll || busyAgentId) return;
		setBusyAll(true);
		try {
			const results = await window.maestro.coworking.installAll();
			const failures = results.filter((r) => !r.ok);
			if (failures.length === 0) {
				notifyToast({
					color: 'green',
					title: tExtra('settings.extra.coworkingSetup.coworkingInstalled'),
					message: tExtra('settings.extra.coworkingSetup.installedAll', { count: results.length }),
				});
			} else {
				notifyToast({
					color: 'orange',
					title: tExtra('settings.extra.coworkingSetup.coworkingPartiallyInstalled'),
					message: tExtra('settings.extra.coworkingSetup.partlyFailed', {
						agents: failures.map((f) => f.agentId).join(', '),
					}),
				});
			}
			await refresh();
		} catch (err) {
			notifyToast({
				color: 'red',
				title: tExtra('settings.extra.coworkingSetup.coworkingInstallFailed'),
				message: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setBusyAll(false);
		}
	}, [busyAll, busyAgentId, refresh, tExtra]);

	const allInstalled = useMemo(
		() => statuses.length > 0 && statuses.every((s) => s.installed),
		[statuses]
	);

	const anyBusy = busyAll || busyAgentId !== null;

	return (
		<div className="px-4 pb-4 pt-3 space-y-3 border-t" style={{ borderColor: theme.colors.border }}>
			<div className="flex items-center justify-between">
				<div>
					<div className="text-sm font-bold" style={{ color: theme.colors.textMain }}>
						{tExtra('settings.extra.coworkingSetup.coworkingSetup')}
					</div>
					<div className="text-xs mt-0.5" style={{ color: theme.colors.textDim }}>
						{tExtra('settings.extra.coworkingSetup.installTheMaestroCoworkingMcpServerInto')}
					</div>
				</div>
				<button
					onClick={refresh}
					disabled={loading}
					title={tExtra('settings.extra.coworkingSetup.refreshInstallStatus')}
					className="p-1.5 rounded transition-colors hover:bg-white/10 disabled:opacity-40"
					style={{ color: theme.colors.textDim }}
				>
					<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
				</button>
			</div>

			<div
				data-setting-id="coworking-background-browsers"
				className="flex items-center justify-between px-3 py-2 rounded"
				style={{
					backgroundColor: theme.colors.bgActivity,
					border: `1px solid ${theme.colors.border}`,
				}}
			>
				<div className="min-w-0 flex-1 pr-2">
					<div className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
						{tExtra('settings.extra.coworkingSetup.backgroundBrowsing')}
					</div>
					<div className="text-xs mt-0.5" style={{ color: theme.colors.textDim }}>
						{tExtra('settings.extra.coworkingSetup.letAgentsReadAndDriveTheirOwn')}
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{backgroundBrowsers && (
						<label
							className="text-xs flex items-center gap-1"
							style={{ color: theme.colors.textDim }}
							title={tExtra(
								'settings.extra.coworkingSetup.maximumBackgroundWebviewsKeptAliveLruEvicted'
							)}
						>
							{tExtra('settings.extra.coworkingSetup.limit')}
							<input
								type="number"
								min={1}
								max={10}
								value={backgroundLimit}
								onChange={(e) => setBackgroundLimit(Number(e.target.value))}
								className="w-12 px-1 py-0.5 rounded text-xs"
								style={{
									backgroundColor: theme.colors.bgMain,
									border: `1px solid ${theme.colors.border}`,
									color: theme.colors.textMain,
								}}
							/>
						</label>
					)}
					<button
						onClick={() => setBackgroundBrowsers(!backgroundBrowsers)}
						className="relative w-10 h-5 rounded-full transition-colors shrink-0"
						style={{
							backgroundColor: backgroundBrowsers ? theme.colors.accent : theme.colors.bgMain,
						}}
						role="switch"
						aria-checked={backgroundBrowsers}
						aria-label={tExtra('settings.extra.coworkingSetup.backgroundBrowsing')}
					>
						<span
							className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
								backgroundBrowsers ? 'translate-x-5' : 'translate-x-0.5'
							}`}
						/>
					</button>
				</div>
			</div>

			<div className="space-y-1.5">
				{sortedStatuses.map((s) => {
					const isBusy = busyAgentId === s.agentId || busyAll;
					const interactionOn = browserInteractionAgents.includes(s.agentId);
					const confirmPolicy = browserConfirm[s.agentId] ?? DEFAULT_BROWSER_CONFIRM_POLICY;
					return (
						<div
							key={s.agentId}
							className="px-3 py-2 rounded"
							style={{
								backgroundColor: theme.colors.bgActivity,
								border: `1px solid ${theme.colors.border}`,
							}}
						>
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2 min-w-0 flex-1">
									{s.installed ? (
										<Check
											className="w-3.5 h-3.5 shrink-0"
											style={{ color: theme.colors.success }}
										/>
									) : (
										<X
											className="w-3.5 h-3.5 shrink-0 opacity-50"
											style={{ color: theme.colors.textDim }}
										/>
									)}
									<div className="min-w-0">
										<div
											className="text-sm font-medium truncate"
											style={{ color: theme.colors.textMain }}
										>
											{getAgentDisplayName(s.agentId as AgentId)}
										</div>
										<div className="text-2xs font-mono truncate opacity-55" title={s.configPath}>
											{s.configPath}
										</div>
									</div>
								</div>
								<div className="flex items-center gap-2 shrink-0">
									{s.installed ? (
										<button
											onClick={() => handleUninstall(s.agentId)}
											disabled={isBusy}
											className="text-xs px-2.5 py-1 rounded transition-colors disabled:opacity-40 hover:bg-white/10"
											style={{ color: theme.colors.error, borderColor: theme.colors.error }}
										>
											{isBusy ? (
												<Loader2 className="w-3 h-3 animate-spin" />
											) : (
												tExtra('settings.extra.coworkingSetup.uninstall')
											)}
										</button>
									) : (
										<button
											onClick={() => handleInstall(s.agentId)}
											disabled={isBusy}
											className="text-xs px-2.5 py-1 rounded transition-colors disabled:opacity-40"
											style={{
												backgroundColor: theme.colors.accent,
												color: theme.colors.bgMain,
											}}
										>
											{isBusy ? (
												<Loader2 className="w-3 h-3 animate-spin" />
											) : (
												tExtra('settings.extra.coworkingSetup.install')
											)}
										</button>
									)}
								</div>
							</div>
							{s.installed && (
								<div
									className="mt-2 pt-2 space-y-2 border-t"
									style={{ borderColor: theme.colors.border }}
								>
									<div className="flex items-center justify-between gap-3">
										<div className="min-w-0">
											<p className="text-sm" style={{ color: theme.colors.textMain }}>
												{tExtra('settings.extra.coworkingSetup.browserInteraction')}
											</p>
											<p className="text-xs opacity-70 mt-0.5">
												{tExtra(
													'settings.extra.coworkingSetup.letThisAgentDriveBrowserTabsNavigate'
												)}
											</p>
										</div>
										<button
											onClick={() => toggleInteraction(s.agentId)}
											className="relative w-10 h-5 rounded-full transition-colors shrink-0"
											style={{
												backgroundColor: interactionOn ? theme.colors.accent : theme.colors.bgMain,
											}}
											role="switch"
											aria-checked={interactionOn}
											aria-label={tExtra('settings.extra.coworkingSetup.interactionFor', {
												agent: getAgentDisplayName(s.agentId as AgentId),
											})}
										>
											<span
												className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
													interactionOn ? 'translate-x-5' : 'translate-x-0.5'
												}`}
											/>
										</button>
									</div>
									{interactionOn && (
										<div className="flex items-center justify-between gap-3">
											<div className="min-w-0">
												<p className="text-sm" style={{ color: theme.colors.textMain }}>
													{tExtra('settings.extra.coworkingSetup.askBeforeActions')}
												</p>
												<p className="text-xs opacity-70 mt-0.5">
													{tExtra(`settings.extra.coworkingSetup.policyHelp.${confirmPolicy}`)}
												</p>
											</div>
											<div
												className="flex rounded overflow-hidden shrink-0"
												style={{ border: `1px solid ${theme.colors.border}` }}
												role="radiogroup"
												aria-label={tExtra('settings.extra.coworkingSetup.askBeforeActions')}
											>
												{CONFIRM_POLICY_OPTIONS.map((opt) => (
													<button
														key={opt.value}
														onClick={() => setConfirmPolicy(s.agentId, opt.value)}
														className="text-xs px-2 py-1 transition-colors"
														style={{
															backgroundColor:
																confirmPolicy === opt.value ? theme.colors.accent : 'transparent',
															color:
																confirmPolicy === opt.value
																	? theme.colors.bgMain
																	: theme.colors.textDim,
														}}
														role="radio"
														aria-checked={confirmPolicy === opt.value}
													>
														{tExtra(`settings.extra.coworkingSetup.policy.${opt.value}`)}
													</button>
												))}
											</div>
										</div>
									)}
									{interactionOn && confirmPolicy === 'off' && (
										<p
											className="text-xs flex items-center gap-1.5"
											style={{ color: theme.colors.warning }}
										>
											<AlertTriangle className="w-3.5 h-3.5 shrink-0" />
											{tExtra('settings.extra.coworkingSetup.thisAgentCanDriveYourBrowserWithout')}
										</p>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>

			<div className="flex justify-end pt-1">
				<button
					onClick={handleInstallAll}
					disabled={anyBusy || allInstalled || statuses.length === 0}
					className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors disabled:opacity-40"
					style={{
						borderColor: theme.colors.border,
						border: '1px solid',
						color: theme.colors.textMain,
					}}
				>
					{busyAll ? (
						<Loader2 className="w-3.5 h-3.5 animate-spin" />
					) : (
						<Download className="w-3.5 h-3.5" />
					)}
					{allInstalled
						? tExtra('settings.extra.coworkingSetup.allAgentsInstalled')
						: tExtra('settings.extra.coworkingSetup.installForAllAgents')}
				</button>
			</div>
		</div>
	);
}
