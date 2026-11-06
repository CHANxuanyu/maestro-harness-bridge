/** Presentation policy only. Never changes saved feature flags or CLI availability. */
export const NEW_SHELL_HIDDEN_FEATURES: ReadonlyArray<{
	id: string;
	actions: readonly string[];
	prefixes?: readonly string[];
	settingsTabs?: readonly string[];
	settings?: readonly string[];
}> = [
	{
		id: 'maestroCue',
		actions: [
			'openCue',
			'maestro-cue',
			'configure-cue',
			'agent-run-dashboard',
			'pianola',
			'debugTriggerProviderReAuthCuePipeline',
		],
	},
	{
		id: 'groupChat',
		actions: ['newGroupChat', 'closeGroupChat', 'toggleGroupChatModeratorOnly', 'deleteGroupChat'],
		prefixes: ['groupchat-', 'jump-groupchat-'],
	},
	{
		id: 'autoRun',
		settings: ['general-autorun-inactivity-timeout', 'general-autorun-max-task-duration'],
		actions: [
			'goToAutoRun',
			'toggleAutoRunExpanded',
			'autoRunExpandedPreview',
			'resetAutoRunTasks',
			'openBatchRunner',
			'openWizard',
			'wizard',
			'tour',
			'saveAutoRun',
			'runAutoRun',
		],
	},
	{ id: 'usageStats', actions: ['usageDashboard'] },
	{
		id: 'directorNotes',
		settings: ['general-history', 'general-synopsis-debounce', 'general-group-cue-entries'],
		actions: [
			'directorNotes',
			'searchDirectorNotes',
			'goToHistory',
			'searchHistory',
			'filterHistory',
			'toggleTabSaveToHistory',
			'toggleSaveToHistory',
			'toggleTabAutoRun',
		],
	},
	{ id: 'plugins', actions: [], prefixes: ['plugin:'], settingsTabs: ['encore'] },
	{ id: 'playbook', actions: ['openPlaybookExchange'], settingsTabs: ['prompts'] },
	{ id: 'marketplace', actions: ['marketplace'] },
	{ id: 'documentGraph', actions: ['viewInDocumentGraph', 'lastDocumentGraph'] },
	{ id: 'symphony', actions: ['openSymphony'] },
];

export function shellFeatureVisible(feature: string, newShell: boolean): boolean {
	return !newShell || !NEW_SHELL_HIDDEN_FEATURES.some((entry) => entry.id === feature);
}

export function shellActionVisible(id: string, newShell: boolean): boolean {
	return (
		!newShell ||
		!NEW_SHELL_HIDDEN_FEATURES.some(
			(entry) =>
				entry.actions.includes(id) || entry.prefixes?.some((prefix) => id.startsWith(prefix))
		)
	);
}

export function shellSettingsTabVisible(tab: string, newShell: boolean): boolean {
	return !newShell || !NEW_SHELL_HIDDEN_FEATURES.some((entry) => entry.settingsTabs?.includes(tab));
}

export function shellSettingVisible(id: string, tab: string, newShell: boolean): boolean {
	return (
		shellSettingsTabVisible(tab, newShell) &&
		(!newShell || !NEW_SHELL_HIDDEN_FEATURES.some((entry) => entry.settings?.includes(id)))
	);
}
