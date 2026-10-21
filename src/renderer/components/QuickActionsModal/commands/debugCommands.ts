import { getT } from '../../../i18n';
import type React from 'react';
import type { Session } from '../../../types';
import type { NotifyToastInput } from '../../../stores/notificationStore';
import { captureException } from '../../../utils/sentry';
import { useModalStore } from '../../../stores/modalStore';
import { replayOnboardingSeries } from '../../../stores/onboardingSeriesStore';
import type { QuickAction } from '../types';

interface BuildDebugCommandsArgs {
	activeSession: Session | undefined;
	activeSessionId: string;
	sessions: Session[];
	setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
	setQuickActionOpen: (open: boolean) => void;
	setPlaygroundOpen?: (open: boolean) => void;
	setDebugApplicationStatsOpen?: (open: boolean) => void;
	setDebugAgentProbeOpen?: (open: boolean) => void;
	onDebugReleaseQueuedItem?: () => void;
	/** Whether a performance-profiling recording is currently in flight. */
	profilingActive: boolean;
	/** Trace-buffer usage of the active recording, 0-1. */
	profilingBufferPercent: number;
	onStartProfiling: () => void;
	onStopProfiling: () => void;
	getInstallationId: () => Promise<string | null | undefined>;
	safeClipboardWrite: (text: string) => Promise<boolean>;
	flashCopiedToClipboard: (value: string, message?: string) => void;
	notifyToast: (args: NotifyToastInput) => void;
	logger: {
		info: (message: string, context?: string, value?: unknown) => void;
		warn: (message: string, context?: string, value?: unknown) => void;
		error: (message: string, context?: string, error?: unknown) => void;
	};
}

function resetSessionBusyState(session: Session): Session {
	return {
		...session,
		state: 'idle' as const,
		busySource: undefined,
		thinkingStartTime: undefined,
		currentCycleTokens: undefined,
		currentCycleBytes: undefined,
		aiTabs: session.aiTabs?.map((tab) => ({
			...tab,
			state: 'idle' as const,
			thinkingStartTime: undefined,
		})),
	};
}

export function buildDebugCommands({
	activeSession,
	activeSessionId,
	sessions,
	setSessions,
	setQuickActionOpen,
	setPlaygroundOpen,
	setDebugApplicationStatsOpen,
	setDebugAgentProbeOpen,
	onDebugReleaseQueuedItem,
	profilingActive,
	profilingBufferPercent,
	onStartProfiling,
	onStopProfiling,
	getInstallationId,
	safeClipboardWrite,
	flashCopiedToClipboard,
	notifyToast,
	logger,
}: BuildDebugCommandsArgs): QuickAction[] {
	const t = getT();
	const commands: QuickAction[] = [
		{
			id: 'debugResetBusy',
			label: t('workflows.shell.debugResetBusyState'),
			subtext: t('workflows.shell.clearStuckThinkingBusyStateForAllSessions'),
			action: () => {
				setSessions((prev) => prev.map(resetSessionBusyState));
				logger.info('[Debug] Reset busy state for all sessions');
				setQuickActionOpen(false);
			},
		},
		{
			id: 'debugLogSessions',
			label: t('workflows.shell.debugLogSessionState'),
			subtext: t('workflows.shell.printSessionStateToDevtoolsConsole'),
			action: () => {
				console.log(
					'[Debug] All sessions:',
					sessions.map((session) => ({
						id: session.id,
						name: session.name,
						state: session.state,
						busySource: session.busySource,
						thinkingStartTime: session.thinkingStartTime,
						tabs: session.aiTabs?.map((tab) => ({
							id: tab.id.substring(0, 8),
							name: tab.name,
							state: tab.state,
							thinkingStartTime: tab.thinkingStartTime,
						})),
					}))
				);
				setQuickActionOpen(false);
			},
		},
		{
			id: 'debugOnboardingNewUser',
			label: t('workflows.shell.debugReplayFirstRunSeriesNewUser'),
			subtext: t('workflows.shell.typographyThemeUpdatesThenAgentPowersWithNew'),
			action: () => {
				// Forced: ignores every seen flag AND the theme gate, and skips
				// writing the flags back, so replaying the series to look at it
				// cannot consume a real first run.
				replayOnboardingSeries('new');
				setQuickActionOpen(false);
			},
		},
		{
			id: 'debugOnboardingReturningUser',
			label: t('workflows.shell.debugReplayFirstRunSeriesExistingUser'),
			subtext: t('workflows.shell.sameFourStepsWithTheCopyAnUpgrading'),
			action: () => {
				replayOnboardingSeries('returning');
				setQuickActionOpen(false);
			},
		},
		{
			id: 'debugWidgetGallery',
			label: t('workflows.shell.debugWidgetGallery'),
			subtext: t('workflows.shell.previewTheSharedOutputInputWidgetLibraryTheme'),
			action: () => {
				useModalStore.getState().openModal('widgetGallery');
				setQuickActionOpen(false);
			},
		},
		{
			id: 'debugCopyInstallGuid',
			label: t('workflows.shell.debugCopyInstallGuidToClipboard'),
			subtext: t('workflows.shell.copyYourUniqueInstallationIdentifier'),
			action: async () => {
				const t = getT();
				try {
					const installationId = await getInstallationId();
					if (installationId) {
						const ok = await safeClipboardWrite(installationId);
						if (ok) {
							flashCopiedToClipboard(installationId, t('workflows.shell.extraInstallGuidCopied'));
							logger.info(
								'[Debug] Installation GUID copied to clipboard:',
								undefined,
								installationId
							);
						} else {
							notifyToast({
								type: 'error',
								title: t('workflows.shell.error'),
								message: t('workflows.shell.extraFailedToCopyInstallationGuid'),
							});
							logger.error('[Debug] Failed to copy Installation GUID', undefined, installationId);
						}
					} else {
						notifyToast({
							type: 'error',
							title: t('workflows.shell.error'),
							message: t('workflows.shell.extraNoInstallationGuidFound'),
						});
						logger.warn('[Debug] No installation GUID found');
					}
				} catch (err) {
					notifyToast({
						type: 'error',
						title: t('workflows.shell.error'),
						message: t('workflows.shell.extraFailedToCopyInstallationGuid'),
					});
					logger.error('[Debug] Failed to copy installation GUID:', undefined, err);
					captureException(err);
				}
				setQuickActionOpen(false);
			},
		},
	];

	if (activeSession) {
		commands.push({
			id: 'debugResetSession',
			label: t('workflows.shell.debugResetCurrentSession'),
			subtext: t('workflows.shell.clearBusyStateForValue', { p0: activeSession.name }),
			action: () => {
				setSessions((prev) =>
					prev.map((session) =>
						session.id === activeSessionId ? resetSessionBusyState(session) : session
					)
				);
				logger.info('[Debug] Reset busy state for session:', undefined, activeSessionId);
				setQuickActionOpen(false);
			},
		});
	}

	if (setPlaygroundOpen) {
		commands.push({
			id: 'debugPlayground',
			label: t('workflows.shell.debugPlayground'),
			subtext: t('workflows.shell.openTheDeveloperPlayground'),
			action: () => {
				setPlaygroundOpen(true);
				setQuickActionOpen(false);
			},
		});
	}

	if (setDebugApplicationStatsOpen) {
		commands.push({
			id: 'debugApplicationStats',
			label: t('workflows.shell.debugViewApplicationStats'),
			subtext: t('workflows.shell.memoryAndDataFootprintPerLoadedAgent'),
			action: () => {
				setDebugApplicationStatsOpen(true);
				setQuickActionOpen(false);
			},
		});
	}

	if (setDebugAgentProbeOpen) {
		commands.push({
			id: 'debugAgentProbe',
			label: t('workflows.shell.debugReProbeAgents'),
			subtext: t('workflows.shell.reDetectEachAgentBinaryAndRefreshReadiness'),
			action: () => {
				setDebugAgentProbeOpen(true);
				setQuickActionOpen(false);
			},
		});
	}

	if (activeSession && activeSession.executionQueue?.length > 0 && onDebugReleaseQueuedItem) {
		commands.push({
			id: 'debugReleaseQueued',
			label: t('workflows.shell.debugReleaseNextQueuedItem'),
			subtext: t('workflows.shell.processNextItemFromQueueValueQueued', {
				p0: activeSession.executionQueue.length,
			}),
			action: () => {
				onDebugReleaseQueuedItem();
				setQuickActionOpen(false);
			},
		});
	}

	// Provider re-authentication. Fires the same event a real credential failure
	// produces, from the main process, so the whole flow runs for real: the
	// provider-scoped outage grouping, the modal, the login PTY (including over
	// SSH), and the resume that replays what the outage blocked. Waiting for a
	// token to actually expire is not a workable way to test any of that.
	//
	// Needs the FULL process id, because a real error carries one and it is how
	// the failing tab is identified for replay - a base agent id would open the
	// dialog and then resume nothing.
	if (activeSession) {
		const activeTabId = activeSession.activeTabId ?? activeSession.aiTabs?.[0]?.id;
		const simulate = (fromPipeline: boolean) => async () => {
			const t = getT();
			setQuickActionOpen(false);
			try {
				await window.maestro.debug.simulateAuthExpiry({
					processSessionId: fromPipeline
						? activeSession.id
						: `${activeSession.id}-ai-${activeTabId}`,
					agentId: activeSession.toolType,
					fromPipeline,
				});
			} catch (err) {
				notifyToast({
					type: 'error',
					title: t('workflows.shell.error'),
					message: t('workflows.shell.extraFailedToSimulateAProviderAuthFailure'),
				});
				logger.error('[Debug] Failed to simulate auth expiry', undefined, err);
			}
		};

		if (activeTabId) {
			commands.push({
				id: 'debugTriggerReauth',
				label: t('workflows.shell.debugTriggerProviderReAuth'),
				subtext: t('workflows.shell.fakeAnExpiredCredentialOnValue', { p0: activeSession.name }),
				action: simulate(false),
			});
		}

		// The pipeline variant arrives on its own channel because Cue spawns its
		// agents outside the ProcessManager. It is the path that failed silently
		// in the field, and the one hardest to reproduce on purpose.
		commands.push({
			id: 'debugTriggerReauthPipeline',
			label: t('workflows.shell.debugTriggerProviderReAuthCuePipeline'),
			subtext: t('workflows.shell.fakeAPipelineAuthFailureOnValue', { p0: activeSession.name }),
			action: simulate(true),
		});
	}

	// Performance profiling: a Start/End toggle. "End" only surfaces while a
	// recording is in flight (main process is the source of truth for `active`).
	if (profilingActive) {
		commands.push({
			id: 'debugEndProfiling',
			label: t('workflows.shell.debugEndPerformanceProfiling'),
			// Surface buffer pressure here rather than a duration. Chromium drops
			// events once the buffer fills, so this is the number that says how much
			// capture window is left; elapsed seconds say nothing, because a busy
			// app fills the buffer in a fraction of the time a quiet one takes.
			subtext: t('workflows.shell.stopAndSaveTheTraceBundleTraceBuffer', {
				p0: Math.round(profilingBufferPercent * 100),
			}),
			action: () => {
				onStopProfiling();
				setQuickActionOpen(false);
			},
		});
	} else {
		commands.push({
			id: 'debugStartProfiling',
			label: t('workflows.shell.debugStartPerformanceProfiling'),
			subtext: t('workflows.shell.captureAChromiumTraceToDiagnoseUiLag'),
			action: () => {
				onStartProfiling();
				setQuickActionOpen(false);
			},
		});
	}

	return commands;
}
