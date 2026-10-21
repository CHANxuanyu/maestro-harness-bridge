import type { TFunction } from '../../../i18n';
import type { UnifiedExtension } from './extensionModel';

const EXTENSION_TEXT_KEYS = {
	'Re-read the Pianola Encore consent flag before every supervised action.':
		'settings.extra.extensionText.reReadThePianolaEncoreConsentFlagBeforeEvery',
	'List agent sessions and status so Pianola can detect who is awaiting input.':
		'settings.extra.extensionText.listAgentSessionsAndStatusSoPianolaCanDetect',
	'Read projected agent transcript content to classify waiting prompts and risk.':
		'settings.extra.extensionText.readProjectedAgentTranscriptContentToClassifyWaitingPrompts',
	'Record Pianola decisions before any dispatch and record the dispatch outcome.':
		'settings.extra.extensionText.recordPianolaDecisionsBeforeAnyDispatchAndRecordThe',
	'Escalate uncovered, failed, timed-out, or high-risk prompts to the user.':
		'settings.extra.extensionText.escalateUncoveredFailedTimedOutOrHighRiskPrompts',
	'Run supervised watch/orchestrate and scheduled re-learn work with host lifecycle control.':
		'settings.extra.extensionText.runSupervisedWatchOrchestrateAndScheduledReLearnWork',
	Pianola: 'settings.extra.extensionText.pianola',
	'Autonomous manager agent that watches your agents and auto-answers or escalates prompts.':
		'settings.extra.extensionText.autonomousManagerAgentThatWatchesYourAgentsAndAuto',
	'Supervises Pianola watch/orchestrate targets and stops them when consent is off.':
		'settings.extra.extensionText.supervisesPianolaWatchOrchestrateTargetsAndStopsThemWhen',
	Coworking: 'settings.extra.extensionText.coworking',
	'Let agents read terminal scrollback and inspect/drive browser tabs on demand, via a per-agent MCP server.':
		'settings.extra.extensionText.letAgentsReadTerminalScrollbackAndInspectDriveBrowser',
	'Re-read the Coworking Encore flag, per-agent interaction toggles, and the per-agent browser confirm policy before serving any bridge request.':
		'settings.extra.extensionText.reReadTheCoworkingEncoreFlagPerAgentInteraction',
	'List installed agent CLIs and their config paths for the Coworking Setup install status, and resolve the owning Maestro session at bridge handshake.':
		'settings.extra.extensionText.listInstalledAgentClisAndTheirConfigPathsFor',
	'Install or remove the maestro-coworking MCP server entry in the Claude Code user config.':
		'settings.extra.extensionText.installCoworking.claude',
	'Install or remove the maestro-coworking MCP server block in the Codex user config.':
		'settings.extra.extensionText.installOrRemoveTheMaestroCoworkingMcpServerBlock',
	'Install or remove the maestro-coworking MCP server entry in the OpenCode user config (XDG-aware).':
		'settings.extra.extensionText.installCoworking.opencode',
	'Install or remove the maestro-coworking MCP server entry in the Factory Droid user config.':
		'settings.extra.extensionText.installCoworking.factory',
	'OpenCode Server': 'settings.extra.extensionText.opencodeServer',
	'Run local, interactive OpenCode through a shared `opencode serve` process (SDK) instead of a per-prompt CLI spawn - the foundation for live permission prompts. Known limitation: the Coworking MCP is unavailable on this path (tracked follow-up).':
		'settings.extra.extensionText.runLocalInteractiveOpencodeThroughASharedOpencodeServe',
	'Re-read the OpenCode Server Encore flag before routing each OpenCode prompt turn to the shared server path.':
		'settings.extra.extensionText.reReadTheOpencodeServerEncoreFlagBeforeRouting',
	"Director's Notes": 'settings.extra.extensionText.directorSNotes',
	'Unified history view and AI-generated synopsis across all sessions.':
		'settings.extra.extensionText.unifiedHistoryViewAndAiGeneratedSynopsisAcrossAll',
	"Re-read the Director's Notes Encore flag, synopsis provider settings, and per-agent config overrides before generating.":
		'settings.extra.extensionText.reReadTheDirectorSNotesEncoreFlagSynopsis',
	'Aggregate metadata history entries across every session for the unified list, activity graph buckets, and deterministic Rich Overview stats; subscribe to live history:entryAdded pushes.':
		'settings.extra.extensionText.aggregateMetadataHistoryEntriesAcrossEverySessionForThe',
	'History entries carry full agent response content (fullResponse) shown in the unified view, and the synopsis agent reads raw history JSON files to drill into response details.':
		'settings.extra.extensionText.historyEntriesCarryFullAgentResponseContentFullresponseShown',
	'Resolve Maestro session IDs to display names (sessions store) for unified-history labels and the synopsis file manifest.':
		'settings.extra.extensionText.resolveMaestroSessionIdsToDisplayNamesSessionsStore',
	'Notify the user when a synopsis finishes generating while the Director’s Notes modal is closed.':
		'settings.extra.extensionText.notifyTheUserWhenASynopsisFinishesGeneratingWhile',
	'Usage & Stats': 'settings.extra.extensionText.usageStats',
	'Track queries, Auto Run sessions, and view the Usage Dashboard.':
		'settings.extra.extensionText.trackQueriesAutoRunSessionsAndViewTheUsage',
	'Re-read the Usage & Stats Encore flag, stats collection opt-out, default lookback window, dashboard auto-refresh intervals, and WakaTime settings.':
		'settings.extra.extensionText.reReadTheUsageStatsEncoreFlagStatsCollection',
	'Discover recent Claude/Codex sessions (metadata only) so the quota samplers know which accounts to sample, and label dashboard drill-downs.':
		'settings.extra.extensionText.discoverRecentClaudeCodexSessionsMetadataOnlySoThe',
	'Read agent-level config (custom env vars, custom paths, detected binaries, usage account keys) to target the provider quota samplers.':
		'settings.extra.extensionText.readAgentLevelConfigCustomEnvVarsCustomPaths',
	'Check for and download WakaTime CLI releases when WakaTime tracking is enabled (api.github.com release lookup + release-asset download).':
		'settings.extra.extensionText.checkForAndDownloadWakatimeCliReleasesWhenWakatime',
	'Follow the GitHub release-asset redirect to the CDN when auto-installing the WakaTime CLI.':
		'settings.extra.extensionText.followTheGithubReleaseAssetRedirectToTheCdn',
	'Submit anonymized Cue telemetry batches - gated on BOTH the Usage & Stats and Maestro Cue Encore flags (shared opt-out).':
		'settings.extra.extensionText.submitAnonymizedCueTelemetryBatchesGatedOnBothThe',
	'Run the background provider-quota sampling loop (Usage Dashboard auto-refresh) with host lifecycle control.':
		'settings.extra.extensionText.runTheBackgroundProviderQuotaSamplingLoopUsageDashboard',
	'Periodic provider-quota sampling loop (Claude/Codex usage snapshots) driving the Usage Dashboard auto-refresh; stops when the feature is disabled.':
		'settings.extra.extensionText.periodicProviderQuotaSamplingLoopClaudeCodexUsageSnapshots',
	'Re-read the Symphony Encore flag and the user-configured custom registry URLs before every registry fetch.':
		'settings.extra.extensionText.reReadTheSymphonyEncoreFlagAndTheUser',
	'Fetch the curated repository registry (default + custom URLs), GitHub star/issue/PR data, and issue-attached documents.':
		'settings.extra.extensionText.fetchTheCuratedRepositoryRegistryDefaultCustomUrlsGithub',
	'Match active contributions against live sessions so orphaned contributions are dropped from the Active tab.':
		'settings.extra.extensionText.matchActiveContributionsAgainstLiveSessionsSoOrphanedContributions',
	'Starting a contribution opens a new Maestro session on the cloned repository for the Auto Run work.':
		'settings.extra.extensionText.startingAContributionOpensANewMaestroSessionOn',
	'Announce contribution lifecycle outcomes: PR ready for review, manual finalization needed, start failures.':
		'settings.extra.extensionText.announceContributionLifecycleOutcomesPrReadyForReviewManual',
	'Read Symphony-private state: contribution history, contributor stats, and the registry/issue cache.':
		'settings.extra.extensionText.readSymphonyPrivateStateContributionHistoryContributorStatsAnd',
	'Persist Symphony-private state: active/completed contributions, contributor stats, registry/issue cache, and staged issue documents.':
		'settings.extra.extensionText.persistSymphonyPrivateStateActiveCompletedContributionsContributorStats',
	'Maestro Symphony': 'settings.extra.extensionText.maestroSymphony',
	'Contribute to open-source projects through curated repositories.':
		'settings.extra.extensionText.contributeToOpenSourceProjectsThroughCuratedRepositories',
	'Re-read the Maestro Cue Encore flag and global Cue settings.':
		'settings.extra.extensionText.reReadTheMaestroCueEncoreFlagAndGlobal',
	'Watch file.changed subscription globs and cue.yaml/prompt files under session project roots.':
		'settings.extra.extensionText.watchFileChangedSubscriptionGlobsAndCueYamlPrompt',
	'Poll GitHub (via the gh CLI) for new pull requests and issues on github.* subscriptions.':
		'settings.extra.extensionText.pollGithubViaTheGhCliForNewPull',
	'Surface action:notify subscription toasts, queue-overflow warnings, and heartbeat failures.':
		'settings.extra.extensionText.surfaceActionNotifySubscriptionToastsQueueOverflowWarningsAnd',
	'Hold a wake lock while time-based subscriptions are armed so scheduled triggers fire on time.':
		'settings.extra.extensionText.holdAWakeLockWhileTimeBasedSubscriptionsAre',
	"Persist run history, queued events, and GitHub seen-state in Cue's own SQLite store.":
		'settings.extra.extensionText.persistRunHistoryQueuedEventsAndGithubSeenState',
	'Run the supervised Cue engine (watchers, pollers, heartbeat) with host lifecycle control.':
		'settings.extra.extensionText.runTheSupervisedCueEngineWatchersPollersHeartbeatWith',
	'Maestro Cue': 'settings.extra.extensionText.maestroCue',
	'Event-driven automation - trigger agent prompts on timers, file changes, and completions.':
		'settings.extra.extensionText.eventDrivenAutomationTriggerAgentPromptsOnTimersFile',
	'Cue engine runtime: file watchers, GitHub pollers, schedule timers, and the recovery heartbeat. Stops fully on disable.':
		'settings.extra.extensionText.cueEngineRuntimeFileWatchersGithubPollersScheduleTimers',
	Concerto: 'settings.extra.extensionText.concerto',
	'Let agents answer with something you can look at and click: interactive views on the Concerto stage, plus always-on-top cadenza HUD cards.':
		'settings.extra.extensionText.letAgentsAnswerWithSomethingYouCanLookAt',
	'Re-read the Concerto Encore flag before rendering movement panels or HUD cards.':
		'settings.extra.extensionText.reReadTheConcertoEncoreFlagBeforeRenderingMovement',
	'Resolve the owning agent’s display name for a cadenza card’s "opened by" attribution chip (the HUD window has no session store of its own).':
		'settings.extra.extensionText.resolveTheOwningAgentSDisplayNameForA',
	'Re-read the Groups+ Encore flag before rendering group hierarchy and appearance controls.':
		'settings.extra.extensionText.reReadTheGroupsEncoreFlagBeforeRenderingGroup',
	'Groups+': 'settings.extra.extensionText.groups',
	'Organize session groups into folders and personalize them with standard icons and label colors.':
		'settings.extra.extensionText.organizeSessionGroupsIntoFoldersAndPersonalizeThemWith',
	'Web Login': 'settings.extra.extensionText.webLogin',
	'Require a username and password on the web interface, manage the accounts here, and attribute every turn to the person who sent it.':
		'settings.extra.extensionText.requireAUsernameAndPasswordOnTheWebInterface',
	'Re-read the Web Login Encore flag before gating a web request.':
		'settings.extra.extensionText.reReadTheWebLoginEncoreFlagBeforeGating',
	Automation: 'settings.extra.extensionText.automation',
	Agents: 'settings.extra.extensionText.agents',
	Insights: 'settings.extra.extensionText.insights',
	UI: 'settings.extra.extensionText.ui',
	Data: 'settings.extra.extensionText.data',
	'Dev Tools': 'settings.extra.extensionText.devTools',
	Other: 'settings.extra.extensionText.other',
	'Not installed': 'settings.extra.extensionText.notInstalled',
	Installed: 'settings.extra.extensionText.installed',
	Enabled: 'settings.extra.extensionText.enabled',
	All: 'settings.extra.extensionText.all',
	Beta: 'settings.extra.extensionText.beta',
	Trusted: 'settings.extra.extensionText.trusted',
	Untrusted: 'settings.extra.extensionText.untrusted',
	'Bad signature': 'settings.extra.extensionText.badSignature',
	Unsigned: 'settings.extra.extensionText.unsigned',
	'Sort alphabetically by name': 'settings.extra.extensionText.sortAlphabeticallyByName',
	Newest: 'settings.extra.extensionText.newest',
	'Sort by release date, newest first': 'settings.extra.extensionText.sortByReleaseDateNewestFirst',
	Themes: 'settings.extra.extensionText.themes',
	Prompts: 'settings.extra.extensionText.prompts',
	Settings: 'settings.extra.extensionText.settings',
	'Command macros': 'settings.extra.extensionText.commandMacros',
	'Cue triggers': 'settings.extra.extensionText.cueTriggers',
	Commands: 'settings.extra.extensionText.commands',
	Panels: 'settings.extra.extensionText.panels',
	Tools: 'settings.extra.extensionText.tools',
	Keybindings: 'settings.extra.extensionText.keybindings',
	'UI items': 'settings.extra.extensionText.uiItems',
	low: 'settings.extra.extensionText.low',
	medium: 'settings.extra.extensionText.medium',
	high: 'settings.extra.extensionText.high',
	'Read files': 'settings.extra.extensionText.capability.fs.read',
	'Create and modify files': 'settings.extra.extensionText.capability.fs.write',
	'Make network requests (unscoped includes localhost and your internal network)':
		'settings.extra.extensionText.capability.net.fetch',
	'Hold an open, two-way network connection to a host (for example a chat gateway). Data can flow in and out continuously while the plugin runs.':
		'settings.extra.extensionText.capability.net.connect',
	'See your agents and their status': 'settings.extra.extensionText.capability.agents.read',
	'Make the named agents run on its behalf - agents run with permissions skipped, so this is ARBITRARY CODE EXECUTION on your machine (not just "send a prompt")':
		'settings.extra.extensionText.capability.agents.dispatch',
	'Show notifications': 'settings.extra.extensionText.capability.notifications.toast',
	'Read non-secret settings': 'settings.extra.extensionText.capability.settings.read',
	"Save the plugin's own settings": 'settings.extra.extensionText.capability.settings.write',
	'See your sessions and their details (not the message contents)':
		'settings.extra.extensionText.capability.sessions.read',
	'Create Maestro sessions': 'settings.extra.extensionText.capability.sessions.create',
	'Modify Maestro sessions': 'settings.extra.extensionText.capability.sessions.write',
	'Switch Maestro to one of your existing sessions':
		'settings.extra.extensionText.capability.sessions.focus',
	'Read metadata-only history entries': 'settings.extra.extensionText.capability.history.read',
	"Read the plugin's own saved data": 'settings.extra.extensionText.capability.storage.read',
	"Save the plugin's own data": 'settings.extra.extensionText.capability.storage.write',
	"Query the plugin's own SQL data": 'settings.extra.extensionText.capability.storage.sql',
	'Watch files for changes': 'settings.extra.extensionText.capability.fs.watch',
	'Run Maestro commands available in the command palette':
		'settings.extra.extensionText.capability.ui.command',
	'Create, focus, and close Maestro tabs': 'settings.extra.extensionText.capability.tabs.manage',
	'Be notified when things happen in Maestro (session, history, agent, and cue events)':
		'settings.extra.extensionText.capability.events.subscribe',
	'Open URLs with the operating system':
		'settings.extra.extensionText.capability.shell.openExternal',
	'Run the named host-approved programs on your machine - this is ARBITRARY CODE EXECUTION (not just "run a command")':
		'settings.extra.extensionText.capability.process.spawn',
	'Record decisions in Maestro': 'settings.extra.extensionText.capability.decisions.write',
	'Keep the computer awake while work is active':
		'settings.extra.extensionText.capability.power.preventSleep',
	'Run supervised background service work':
		'settings.extra.extensionText.capability.background.service',
	'Read the full conversation content of your sessions (messages, prompts, and agent output)':
		'settings.extra.extensionText.capability.transcripts.read',
	'Write brokered entries into session transcripts':
		'settings.extra.extensionText.capability.transcripts.write',
	"Add declarative items to Maestro's approved host surfaces":
		'settings.extra.extensionText.capability.ui.contribute',
	'Show its own panels inside approved Maestro regions':
		'settings.extra.extensionText.capability.ui.panel',
	'Show and update host-rendered BlockView data in Maestro':
		'settings.extra.extensionText.capability.ui.hostView',
	'Organize session metadata into virtual sidebar groups':
		'settings.extra.extensionText.capability.ui.grouping',
	'Render high-trust custom UI only in host-approved, non-protected regions (advanced - only enable authors you fully trust)':
		'settings.extra.extensionText.capability.ui.render-unsafe',
} as const;

/** Translate only Maestro-owned extension labels. Third-party content stays as supplied. */
export function extensionUiText(text: string, t: TFunction): string {
	const key = EXTENSION_TEXT_KEYS[text as keyof typeof EXTENSION_TEXT_KEYS];
	return key ? t(key) : text;
}

export function localizeBuiltinExtension(ext: UnifiedExtension, t: TFunction): UnifiedExtension {
	if (ext.kind !== 'builtin') return ext;
	return {
		...ext,
		name: extensionUiText(ext.name, t),
		description: extensionUiText(ext.description, t),
		permissions: ext.permissions?.map((req) => ({
			...req,
			reason: req.reason ? extensionUiText(req.reason, t) : req.reason,
		})),
	};
}
