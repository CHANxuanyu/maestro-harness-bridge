import { getT } from '../../../i18n';
import { buildMaestroUrl } from '../../../utils/buildMaestroUrl';
import type { NotifyToastInput } from '../../../stores/notificationStore';
import { captureException } from '../../../utils/sentry';
import type { SettingsTab } from '../../../types';
import type { QuickAction } from '../types';

interface FeedbackDraftActions {
	isMinimized: boolean;
	setMinimized: (minimized: boolean) => void;
}

interface BuildSupportCommandsArgs {
	setQuickActionOpen: (open: boolean) => void;
	setSettingsModalOpen: (open: boolean) => void;
	setSettingsTab: (tab: SettingsTab) => void;
	setShortcutsHelpOpen: (open: boolean) => void;
	setAboutModalOpen: (open: boolean) => void;
	onOpenLeaderboardRegistration: () => void;
	isLeaderboardRegistered: boolean;
	setFeedbackModalOpen: (open: boolean) => void;
	setLogViewerOpen: (open: boolean) => void;
	setProcessMonitorOpen: (open: boolean) => void;
	setUpdateCheckModalOpen?: (open: boolean) => void;
	setDebugPackageModalOpen?: (open: boolean) => void;
	startTour?: () => void;
	getFeedbackDraft: () => FeedbackDraftActions;
	createDebugPackage: () => Promise<{ success?: boolean; path?: string; error?: string }>;
	notifyToast: (args: NotifyToastInput) => void;
	openUrl: (url: string) => void;
	toggleDevtools: () => void;
	shortcuts: {
		settings?: QuickAction['shortcut'];
		help?: QuickAction['shortcut'];
		systemLogs?: QuickAction['shortcut'];
		processMonitor?: QuickAction['shortcut'];
		openThemeSettings?: QuickAction['shortcut'];
		openLeaderboard?: QuickAction['shortcut'];
	};
}

export function buildSupportCommands({
	setQuickActionOpen,
	setSettingsModalOpen,
	setSettingsTab,
	setShortcutsHelpOpen,
	setAboutModalOpen,
	onOpenLeaderboardRegistration,
	isLeaderboardRegistered,
	setFeedbackModalOpen,
	setLogViewerOpen,
	setProcessMonitorOpen,
	setUpdateCheckModalOpen,
	setDebugPackageModalOpen,
	startTour,
	getFeedbackDraft,
	createDebugPackage,
	notifyToast,
	openUrl,
	toggleDevtools,
	shortcuts,
}: BuildSupportCommandsArgs): QuickAction[] {
	const t = getT();
	const commands: QuickAction[] = [
		{
			id: 'settings',
			label: t('workflows.shell.settings'),
			shortcut: shortcuts.settings,
			action: () => {
				setSettingsModalOpen(true);
				setQuickActionOpen(false);
			},
		},
		{
			id: 'theme',
			label: t('workflows.shell.changeTheme'),
			shortcut: shortcuts.openThemeSettings,
			action: () => {
				setSettingsModalOpen(true);
				setSettingsTab('theme');
				setQuickActionOpen(false);
			},
		},
		{
			id: 'configureEnvVars',
			label: t('workflows.shell.configureGlobalEnvironmentVariables'),
			action: () => {
				setSettingsModalOpen(true);
				setSettingsTab('general');
				setQuickActionOpen(false);
			},
		},
		{
			id: 'shortcuts',
			label: t('workflows.shell.viewShortcuts'),
			shortcut: shortcuts.help,
			action: () => {
				setShortcutsHelpOpen(true);
				setQuickActionOpen(false);
			},
		},
		{
			id: 'logs',
			label: t('workflows.shell.viewSystemLogs'),
			shortcut: shortcuts.systemLogs,
			action: () => {
				setLogViewerOpen(true);
				setQuickActionOpen(false);
			},
		},
		{
			id: 'processes',
			label: t('workflows.shell.viewSystemProcesses'),
			shortcut: shortcuts.processMonitor,
			action: () => {
				setProcessMonitorOpen(true);
				setQuickActionOpen(false);
			},
		},
		{
			id: 'devtools',
			label: t('workflows.shell.toggleJavascriptConsole'),
			action: () => {
				toggleDevtools();
				setQuickActionOpen(false);
			},
		},
		{
			id: 'about',
			label: t('workflows.shell.aboutMaestro'),
			action: () => {
				setAboutModalOpen(true);
				setQuickActionOpen(false);
			},
		},
		{
			id: 'leaderboard',
			label: isLeaderboardRegistered
				? t('workflows.shell.leaderboardRegistration')
				: t('workflows.shell.joinLeaderboard'),
			shortcut: shortcuts.openLeaderboard,
			subtext: isLeaderboardRegistered
				? t('workflows.shell.updateYourGlobalRunmaestroAiLeaderboardProfile')
				: t('workflows.shell.registerForTheGlobalRunmaestroAiLeaderboard'),
			action: () => {
				onOpenLeaderboardRegistration();
				setQuickActionOpen(false);
			},
		},
		{
			id: 'feedback',
			label: t('workflows.shell.sendFeedback'),
			subtext: t('workflows.shell.reportABugOrSuggestAFeatureVia'),
			action: () => {
				const draft = getFeedbackDraft();
				if (draft.isMinimized) {
					draft.setMinimized(false);
				} else {
					setFeedbackModalOpen(true);
				}
				setQuickActionOpen(false);
			},
		},
		{
			id: 'website',
			label: t('workflows.shell.maestroWebsite'),
			subtext: t('workflows.shell.openTheMaestroWebsite'),
			action: () => {
				openUrl(buildMaestroUrl('https://runmaestro.ai/'));
				setQuickActionOpen(false);
			},
		},
		{
			id: 'docs',
			label: t('workflows.shell.documentationAndUserGuide'),
			subtext: t('workflows.shell.openTheMaestroDocumentation'),
			action: () => {
				openUrl(buildMaestroUrl('https://docs.runmaestro.ai/'));
				setQuickActionOpen(false);
			},
		},
		{
			id: 'discord',
			label: t('workflows.shell.joinDiscord'),
			subtext: t('workflows.shell.joinTheMaestroCommunity'),
			action: () => {
				openUrl(buildMaestroUrl('https://runmaestro.ai/discord'));
				setQuickActionOpen(false);
			},
		},
		{
			id: 'createDebugPackage',
			label: t('workflows.shell.createDebugPackage'),
			subtext: t('workflows.shell.generateASupportBundleForBugReporting'),
			action: () => {
				const t = getT();
				setQuickActionOpen(false);
				if (setDebugPackageModalOpen) {
					setDebugPackageModalOpen(true);
					return;
				}
				notifyToast({
					type: 'info',
					title: t('workflows.shell.debugPackage'),
					message: t('workflows.shell.extraCreatingDebugPackage'),
				});
				createDebugPackage()
					.then((result) => {
						if (result.success && result.path) {
							notifyToast({
								type: 'success',
								title: t('workflows.shell.debugPackageCreated'),
								message: t('workflows.shell.extraSavedToValue', { p0: result.path }),
							});
						} else if (result.error !== 'Cancelled by user') {
							notifyToast({
								type: 'error',
								title: t('workflows.shell.debugPackageFailed'),
								message: result.error || t('workflows.shell.extraUnknownError'),
							});
						}
					})
					.catch((error) => {
						notifyToast({
							type: 'error',
							title: t('workflows.shell.debugPackageFailed'),
							message:
								error instanceof Error ? error.message : t('workflows.shell.extraUnknownError'),
						});
						captureException(error);
						throw error;
					});
			},
		},
	];

	if (startTour) {
		commands.push({
			id: 'tour',
			label: t('workflows.shell.startIntroductoryTour'),
			subtext: t('workflows.shell.takeAGuidedTourOfTheInterface'),
			action: () => {
				startTour();
				setQuickActionOpen(false);
			},
		});
	}

	if (setUpdateCheckModalOpen) {
		commands.push({
			id: 'updateCheck',
			label: t('workflows.shell.checkForUpdates'),
			action: () => {
				setUpdateCheckModalOpen(true);
				setQuickActionOpen(false);
			},
		});
	}

	return commands;
}
