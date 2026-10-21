import { getT } from '../../../i18n';
import type { Session } from '../../../types';
import type { ActiveTabInfo, QuickAction } from '../types';
import { editClipboardImage } from '../../ImageAnnotator/editClipboardImage';
import { requestEditLastQueuedMessage } from '../../../services/editQueuedMessage';

interface BuildFeatureCommandsArgs {
	activeSession: Session | undefined;
	/** Resolved active tab type; AI-context commands only apply when this is 'ai'. */
	activeTabType?: ActiveTabInfo['activeTabType'];
	canSummarizeActiveTab?: boolean;
	markdownEditMode?: boolean;
	isFilePreviewOpen?: boolean;
	ghCliAvailable?: boolean;
	lastGraphFocusFile?: string;
	/** Name of the active markdown file, set only when one is open in the preview. */
	currentGraphFile?: string;
	hasActiveSessionCapability?: (
		capability:
			| 'supportsSessionStorage'
			| 'supportsSlashCommands'
			| 'supportsContextMerge'
			| 'supportsProjectMemory'
	) => boolean;
	setQuickActionOpen: (open: boolean) => void;
	setSuccessFlashNotification: (message: string | null) => void;
	setAgentSessionsOpen: (open: boolean) => void;
	setActiveAgentSessionId: (id: string | null) => void;
	setMemoryViewerOpen?: (open: boolean) => void;
	setFuzzyFileSearchOpen?: (open: boolean) => void;
	setUsageDashboardOpen?: (open: boolean) => void;
	setAgentRunDashboardOpen?: (open: boolean) => void;
	onSummarizeAndContinue?: () => void;
	onOpenMergeSession?: () => void;
	onOpenSendToAgent?: () => void;
	onOpenQueueBrowser?: () => void;
	onOpenPlaybookExchange?: () => void;
	onOpenSymphony?: () => void;
	onOpenDirectorNotes?: () => void;
	onOpenMaestroCue?: () => void;
	onOpenPianola?: () => void;
	onConfigureCue?: (session: Session) => void;
	onOpenLastDocumentGraph?: () => void;
	onOpenCurrentFileInGraph?: () => void;
	onPublishGist?: () => void;
	bionifyReadingMode: boolean;
	setBionifyReadingMode: (enabled: boolean) => void;
	audioFeedbackEnabled: boolean;
	setAudioFeedbackEnabled: (enabled: boolean) => void;
	idleNotificationEnabled: boolean;
	setIdleNotificationEnabled: (enabled: boolean) => void;
	showStarredSessionsSection: boolean;
	setShowStarredSessionsSection: (enabled: boolean) => void;
	shortcuts: {
		usageDashboard?: QuickAction['shortcut'];
		agentSessions?: QuickAction['shortcut'];
		openMemoryViewer?: QuickAction['shortcut'];
		executionQueue?: QuickAction['shortcut'];
		editLastQueuedMessage?: QuickAction['shortcut'];
		openSymphony?: QuickAction['shortcut'];
		directorNotes?: QuickAction['shortcut'];
		openCue?: QuickAction['shortcut'];
		fuzzyFileSearch?: QuickAction['shortcut'];
		editClipboardImage?: QuickAction['shortcut'];
	};
}

function flash(
	setSuccessFlashNotification: (message: string | null) => void,
	message: string
): void {
	setSuccessFlashNotification(message);
	setTimeout(() => setSuccessFlashNotification(null), 2000);
}

export function buildFeatureCommands({
	activeSession,
	activeTabType,
	canSummarizeActiveTab,
	markdownEditMode,
	isFilePreviewOpen,
	ghCliAvailable,
	lastGraphFocusFile,
	currentGraphFile,
	hasActiveSessionCapability,
	setQuickActionOpen,
	setSuccessFlashNotification,
	setAgentSessionsOpen,
	setActiveAgentSessionId,
	setMemoryViewerOpen,
	setFuzzyFileSearchOpen,
	setUsageDashboardOpen,
	setAgentRunDashboardOpen,
	onSummarizeAndContinue,
	onOpenMergeSession,
	onOpenSendToAgent,
	onOpenQueueBrowser,
	onOpenPlaybookExchange,
	onOpenSymphony,
	onOpenDirectorNotes,
	onOpenMaestroCue,
	onOpenPianola,
	onConfigureCue,
	onOpenLastDocumentGraph,
	onOpenCurrentFileInGraph,
	onPublishGist,
	bionifyReadingMode,
	setBionifyReadingMode,
	audioFeedbackEnabled,
	setAudioFeedbackEnabled,
	idleNotificationEnabled,
	setIdleNotificationEnabled,
	showStarredSessionsSection,
	setShowStarredSessionsSection,
	shortcuts,
}: BuildFeatureCommandsArgs): QuickAction[] {
	const t = getT();
	const commands: QuickAction[] = [
		{
			id: 'editClipboardImage',
			label: t('workflows.shell.editImageFromClipboard'),
			subtext: t('workflows.shell.openTheImageAnnotatorOnTheCurrentClipboard'),
			shortcut: shortcuts.editClipboardImage,
			action: () => {
				setQuickActionOpen(false);
				void editClipboardImage();
			},
		},
		{
			id: 'toggleBionifyReadingMode',
			label: bionifyReadingMode
				? t('workflows.shell.turnOffBionifyEmphasis')
				: t('workflows.shell.turnOnBionifyEmphasis'),
			subtext: t('workflows.shell.bionifyEmphasisValue', {
				p0: bionifyReadingMode ? t('workflows.labels.enabled') : t('workflows.labels.disabled'),
			}),
			action: () => {
				const newState = !bionifyReadingMode;
				setBionifyReadingMode(newState);
				flash(
					setSuccessFlashNotification,
					newState ? t('workflows.shell.bionifyOn') : t('workflows.shell.bionifyOff')
				);
				setQuickActionOpen(false);
			},
		},
		{
			id: 'toggleCustomNotification',
			label: audioFeedbackEnabled
				? t('workflows.shell.turnOffCustomNotifications')
				: t('workflows.shell.turnOnCustomNotifications'),
			subtext: t('workflows.shell.customNotificationsValue', {
				p0: audioFeedbackEnabled ? t('workflows.labels.enabled') : t('workflows.labels.disabled'),
			}),
			action: () => {
				const t = getT();
				const newState = !audioFeedbackEnabled;
				setAudioFeedbackEnabled(newState);
				flash(
					setSuccessFlashNotification,
					newState
						? t('workflows.shell.extraCustomNotificationsOn')
						: t('workflows.shell.extraCustomNotificationsOff')
				);
				setQuickActionOpen(false);
			},
		},
		{
			id: 'toggleIdleNotification',
			label: idleNotificationEnabled
				? t('workflows.shell.turnOffIdleNotifications')
				: t('workflows.shell.turnOnIdleNotifications'),
			subtext: t('workflows.shell.idleNotificationsValue', {
				p0: idleNotificationEnabled
					? t('workflows.labels.enabled')
					: t('workflows.labels.disabled'),
			}),
			action: () => {
				const t = getT();
				const newState = !idleNotificationEnabled;
				setIdleNotificationEnabled(newState);
				flash(
					setSuccessFlashNotification,
					newState
						? t('workflows.shell.extraIdleNotificationsOn')
						: t('workflows.shell.extraIdleNotificationsOff')
				);
				setQuickActionOpen(false);
			},
		},
		{
			id: 'toggleStarredSessionsSection',
			label: showStarredSessionsSection
				? t('workflows.shell.hideStarredSessionsSection')
				: t('workflows.shell.showStarredSessionsSection'),
			subtext: t('workflows.shell.starredSessionsSectionValue', {
				p0: showStarredSessionsSection
					? t('workflows.labels.visible')
					: t('workflows.labels.hidden'),
			}),
			action: () => {
				const t = getT();
				const newState = !showStarredSessionsSection;
				setShowStarredSessionsSection(newState);
				flash(
					setSuccessFlashNotification,
					newState
						? t('workflows.shell.extraStarredSessionsShown')
						: t('workflows.shell.extraStarredSessionsHidden')
				);
				setQuickActionOpen(false);
			},
		},
	];

	if (onOpenQueueBrowser) {
		commands.push({
			id: 'executionQueue',
			label: t('workflows.shell.viewExecutionQueue'),
			shortcut: shortcuts.executionQueue,
			subtext: t('workflows.shell.browseAndManageQueuedPromptsAcrossAgents'),
			action: () => {
				onOpenQueueBrowser();
				setQuickActionOpen(false);
			},
		});
	}

	if (activeSession) {
		// Listed even with an empty queue, and deliberately not hidden: a command a
		// user goes hunting for by name has to be findable, and the service says
		// which empty it hit ("Nothing queued to edit" vs "Only commands are
		// queued") rather than the palette guessing here.
		const editableQueuedCount = (activeSession.executionQueue ?? []).filter(
			(item) => item.type !== 'command'
		).length;
		commands.push({
			id: 'editLastQueuedMessage',
			label: t('workflows.shell.editLastQueuedMessage'),
			subtext:
				editableQueuedCount > 0
					? t('workflows.shell.editTheNewestOfValueQueuedMessagevalue', {
							p0: editableQueuedCount,
							p1: editableQueuedCount === 1 ? '' : t('workflows.shell.pluralSuffix'),
						})
					: t('workflows.shell.nothingIsQueuedOnThisAgent'),
			shortcut: shortcuts.editLastQueuedMessage,
			action: () => {
				setQuickActionOpen(false);
				requestEditLastQueuedMessage();
			},
		});
	}

	if (setUsageDashboardOpen) {
		commands.push({
			id: 'usageDashboard',
			label: t('workflows.shell.usageDashboard'),
			shortcut: shortcuts.usageDashboard,
			action: () => {
				setUsageDashboardOpen(true);
				setQuickActionOpen(false);
			},
		});
	}

	if (activeSession && hasActiveSessionCapability?.('supportsSessionStorage')) {
		commands.push({
			id: 'agentSessions',
			label: t('workflows.shell.viewAgentSessionsForValue', { p0: activeSession.name }),
			shortcut: shortcuts.agentSessions,
			action: () => {
				setActiveAgentSessionId(null);
				setAgentSessionsOpen(true);
				setQuickActionOpen(false);
			},
		});
	}

	if (
		activeSession &&
		setMemoryViewerOpen &&
		hasActiveSessionCapability?.('supportsProjectMemory')
	) {
		commands.push({
			id: 'openMemoryViewer',
			label: t('workflows.shell.viewAgentMemoriesForValue', { p0: activeSession.name }),
			shortcut: shortcuts.openMemoryViewer,
			action: () => {
				setMemoryViewerOpen(true);
				setQuickActionOpen(false);
			},
		});
	}

	if (activeTabType === 'ai' && canSummarizeActiveTab && onSummarizeAndContinue) {
		commands.push({
			id: 'summarizeAndContinue',
			label: t('workflows.shell.contextCompact'),
			subtext: t('workflows.shell.compactContextIntoAFreshTab'),
			action: () => {
				onSummarizeAndContinue();
				setQuickActionOpen(false);
			},
		});
	}

	if (
		activeTabType === 'ai' &&
		activeSession &&
		hasActiveSessionCapability?.('supportsContextMerge') &&
		onOpenMergeSession
	) {
		commands.push({
			id: 'mergeSession',
			label: t('workflows.shell.contextMergeInto'),
			subtext: t('workflows.shell.mergeCurrentContextIntoAnotherSession'),
			action: () => {
				onOpenMergeSession();
				setQuickActionOpen(false);
			},
		});
	}

	if (
		activeTabType === 'ai' &&
		activeSession &&
		hasActiveSessionCapability?.('supportsContextMerge') &&
		onOpenSendToAgent
	) {
		commands.push({
			id: 'sendToAgent',
			label: t('workflows.shell.contextSendToAgent'),
			subtext: t('workflows.shell.transferContextToADifferentAiAgent'),
			action: () => {
				onOpenSendToAgent();
				setQuickActionOpen(false);
			},
		});
	}

	if (onOpenPlaybookExchange) {
		commands.push({
			id: 'openPlaybookExchange',
			label: t('workflows.shell.playbookExchange'),
			subtext: t('workflows.shell.browseAndImportCommunityPlaybooks'),
			action: () => {
				onOpenPlaybookExchange();
				setQuickActionOpen(false);
			},
		});
	}

	if (onOpenSymphony) {
		commands.push({
			id: 'openSymphony',
			label: t('workflows.shell.maestroSymphony'),
			shortcut: shortcuts.openSymphony,
			subtext: t('workflows.shell.contributeToOpenSourceProjects'),
			action: () => {
				onOpenSymphony();
				setQuickActionOpen(false);
			},
		});
	}

	if (onOpenDirectorNotes) {
		commands.push({
			id: 'directorNotes',
			label: t('workflows.shell.directorSNotes'),
			shortcut: shortcuts.directorNotes,
			subtext: t('workflows.shell.viewUnifiedHistoryAndAiSynopsisAcrossAll'),
			action: () => {
				onOpenDirectorNotes();
				setQuickActionOpen(false);
			},
		});
	}

	if (onOpenMaestroCue) {
		commands.push({
			id: 'maestro-cue',
			label: t('workflows.shell.maestroCue'),
			shortcut: shortcuts.openCue,
			subtext: t('workflows.shell.eventDrivenAutomationDashboard'),
			action: () => {
				onOpenMaestroCue();
				setQuickActionOpen(false);
			},
		});
	}

	if (setAgentRunDashboardOpen) {
		commands.push({
			id: 'agent-run-dashboard',
			label: t('workflows.shell.agentrunDashboard'),
			subtext: t('workflows.shell.inspectAgentRunsCampaignsEventsReviewsAndPianola'),
			action: () => {
				setAgentRunDashboardOpen(true);
				setQuickActionOpen(false);
			},
		});
	}

	if (onOpenPianola) {
		commands.push({
			id: 'pianola',
			label: t('workflows.shell.pianola'),
			subtext: t('workflows.shell.autonomousManagerRulesAndDecisionLog'),
			action: () => {
				onOpenPianola();
				setQuickActionOpen(false);
			},
		});
	}

	if (onConfigureCue && activeSession) {
		commands.push({
			id: 'configure-cue',
			label: t('workflows.shell.configureMaestroCueValue', { p0: activeSession.name }),
			subtext: t('workflows.shell.openYamlEditorForEventDrivenAutomation'),
			action: () => {
				onConfigureCue(activeSession);
				setQuickActionOpen(false);
			},
		});
	}

	if (currentGraphFile && onOpenCurrentFileInGraph) {
		commands.push({
			id: 'viewInDocumentGraph',
			label: t('workflows.shell.viewInDocumentGraph'),
			subtext: t('workflows.shell.focusTheGraphOnValue', { p0: currentGraphFile }),
			// No chord. This used to advertise Cmd+Shift+G, which belongs to View
			// Git Log - the File Preview handled the key itself, so the graph
			// silently won whenever a markdown preview had focus. The key was in no
			// registry, so it could not be seen in Settings or rebound out of the
			// way. The graph keeps its toolbar button and this entry.
			action: () => {
				onOpenCurrentFileInGraph();
				setQuickActionOpen(false);
			},
		});
	}

	if (lastGraphFocusFile && onOpenLastDocumentGraph) {
		commands.push({
			id: 'lastDocumentGraph',
			label: t('workflows.shell.openLastDocumentGraph'),
			subtext: t('workflows.shell.reOpenValue', { p0: lastGraphFocusFile }),
			action: () => {
				onOpenLastDocumentGraph();
				setQuickActionOpen(false);
			},
		});
	}

	if (setFuzzyFileSearchOpen) {
		commands.push({
			id: 'fuzzyFileSearch',
			label: t('workflows.shell.fuzzyFileSearch'),
			shortcut: shortcuts.fuzzyFileSearch,
			action: () => {
				setFuzzyFileSearchOpen(true);
				setQuickActionOpen(false);
			},
		});
	}

	if (isFilePreviewOpen && ghCliAvailable && onPublishGist && !markdownEditMode) {
		commands.push({
			id: 'publishGist',
			label: t('workflows.shell.publishDocumentAsGithubGist'),
			subtext: t('workflows.shell.shareCurrentFileAsAPublicOrSecret'),
			action: () => {
				onPublishGist();
				setQuickActionOpen(false);
			},
		});
	}

	return commands;
}
