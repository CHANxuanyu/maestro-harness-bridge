import { getT } from '../../../i18n';
import type { Session } from '../../../types';
import type { NotifyToastInput } from '../../../stores/notificationStore';
import type { GitAgentActions } from '../../../hooks/git/useGitAgentActions';
import { resolveGitCwd } from '../../../hooks/git/useGitAgentActions';
import { formatGitChangeSummary } from '../../../../shared/gitUtils';
import { captureException } from '../../../utils/sentry';
import type { QuickAction } from '../types';

interface BuildGitWorktreeCommandsArgs {
	activeSession: Session | undefined;
	sessions: Session[];
	/**
	 * The same action set the header branch pill and the Left Bar right-click
	 * menu use. Every git entry below delegates to it, so the palette can't
	 * drift from the menus - it IS the third surface, not a reimplementation.
	 */
	gitActions: GitAgentActions;
	setQuickActionOpen: (open: boolean) => void;
	onQuickCreateWorktree?: (session: Session) => void;
	onOpenCreatePR?: (session: Session) => void;
	onRefreshGitFileState?: () => Promise<void>;
	shortcuts: {
		viewGitDiff?: QuickAction['shortcut'];
		viewGitLog?: QuickAction['shortcut'];
		gitPull?: QuickAction['shortcut'];
		gitPush?: QuickAction['shortcut'];
		gitChangeBranch?: QuickAction['shortcut'];
		gitCreatePR?: QuickAction['shortcut'];
		refreshGitFileState?: QuickAction['shortcut'];
	};
	gitService: {
		getRemoteBrowserUrl: (cwd: string) => Promise<string | null>;
	};
	notifyToast: (args: NotifyToastInput) => void;
	openUrl: (url: string) => void;
	logger: {
		error: (message: string, context?: string, error?: unknown) => void;
	};
}

export function buildGitWorktreeCommands({
	activeSession,
	sessions,
	gitActions,
	setQuickActionOpen,
	onQuickCreateWorktree,
	onOpenCreatePR,
	onRefreshGitFileState,
	shortcuts,
	gitService,
	notifyToast,
	openUrl,
	logger,
}: BuildGitWorktreeCommandsArgs): QuickAction[] {
	const t = getT();
	if (!activeSession) return [];
	const commands: QuickAction[] = [];

	if (activeSession.isGitRepo) {
		// Every entry below carries the `Git:` prefix. The palette filters on the
		// label alone, so without it `git` found four of these nine and missed
		// Change Branch, Create Pull Request, and the worktree pair. The palette
		// also SORTS by label, so the prefix is what keeps them drawn as one block
		// rather than scattered between unrelated commands.
		//
		// Mirrors the git menu order so the palette reads the same as the menus.
		commands.push({
			id: 'gitLog',
			label: t('workflows.shell.gitViewLog'),
			shortcut: shortcuts.viewGitLog,
			action: () => {
				gitActions.viewLog();
				setQuickActionOpen(false);
			},
		});

		commands.push({
			id: 'gitDiff',
			label: t('workflows.shell.gitViewDiff'),
			// Says up front whether the diff has anything in it, the same thing the
			// badge on the menu rows says.
			subtext: formatGitChangeSummary(gitActions.changes),
			shortcut: shortcuts.viewGitDiff,
			action: () => {
				// Fire-and-forget: viewDiff opens its own modal (or flashes when the
				// tree is clean), so the palette shouldn't linger while git runs.
				void gitActions.viewDiff();
				setQuickActionOpen(false);
			},
		});

		commands.push({
			id: 'gitPull',
			label: t('workflows.shell.gitPull'),
			// A run already in flight (its console may have been dismissed with Run
			// in Background) is worth more than the behind count, which is stale
			// until that run finishes.
			subtext: gitActions.pullRunning
				? t('workflows.shell.runningOpenToWatchIt')
				: gitActions.behind > 0
					? t('workflows.shell.valueCommitvalueBehind', {
							p0: gitActions.behind,
							p1: gitActions.behind === 1 ? '' : t('workflows.shell.pluralSuffix'),
						})
					: t('workflows.shell.pullFromOrigin'),
			shortcut: shortcuts.gitPull,
			action: () => {
				gitActions.pull();
				setQuickActionOpen(false);
			},
		});

		commands.push({
			id: 'gitPush',
			label: t('workflows.shell.gitPush'),
			subtext: gitActions.pushRunning
				? t('workflows.shell.runningOpenToWatchIt')
				: gitActions.ahead > 0
					? t('workflows.shell.valueCommitvalueAhead', {
							p0: gitActions.ahead,
							p1: gitActions.ahead === 1 ? '' : t('workflows.shell.pluralSuffix'),
						})
					: t('workflows.shell.pushToOrigin'),
			shortcut: shortcuts.gitPush,
			action: () => {
				gitActions.push();
				setQuickActionOpen(false);
			},
		});

		commands.push({
			id: 'changeBranch',
			label: t('workflows.shell.gitChangeBranch'),
			subtext: gitActions.branch
				? t('workflows.shell.currentlyOnValue', { p0: gitActions.branch })
				: t('workflows.shell.switchToAnotherBranch'),
			shortcut: shortcuts.gitChangeBranch,
			action: () => {
				gitActions.switchBranch();
				setQuickActionOpen(false);
			},
		});

		commands.push({
			id: 'openRepo',
			label: t('workflows.shell.gitOpenRepositoryInBrowser'),
			action: async () => {
				try {
					const browserUrl = await gitService.getRemoteBrowserUrl(resolveGitCwd(activeSession));
					if (browserUrl) {
						openUrl(browserUrl);
					} else {
						notifyToast({
							type: 'error',
							title: t('workflows.shell.noRemoteUrl'),
							message: t('workflows.shell.extraCouldNotFindARemoteUrlForThis'),
						});
					}
				} catch (error) {
					logger.error('Failed to open repository in browser:', undefined, error);
					notifyToast({
						type: 'error',
						title: t('workflows.shell.error'),
						message:
							error instanceof Error
								? error.message
								: t('workflows.shell.extraFailedToOpenRepositoryInBrowser'),
					});
					// Network/git failures are recoverable - capture for tracking but keep modal close path.
					captureException(error);
				}
				setQuickActionOpen(false);
			},
		});
	}

	if (activeSession.isGitRepo && onQuickCreateWorktree) {
		commands.push({
			id: 'createWorktree',
			label: t('workflows.shell.gitCreateWorktree'),
			subtext: activeSession.parentSessionId
				? t('workflows.shell.newWorktreeUnderValue', {
						p0:
							sessions.find((session) => session.id === activeSession.parentSessionId)?.name ||
							'parent',
					})
				: t('workflows.shell.createANewGitWorktreeBranch'),
			action: () => {
				const targetSession = activeSession.parentSessionId
					? sessions.find((session) => session.id === activeSession.parentSessionId) ||
						activeSession
					: activeSession;
				onQuickCreateWorktree(targetSession);
				setQuickActionOpen(false);
			},
		});
	}

	// Any agent on a branch can open a PR, not just worktree children - matching
	// what the git menus offer. The explicit handler still wins for worktree
	// children, since App wires extra behavior into it.
	if (gitActions.canCreatePR) {
		const isWorktreeChild = Boolean(activeSession.parentSessionId && activeSession.worktreeBranch);
		commands.push({
			id: 'createPR',
			label: gitActions.branch
				? t('workflows.shell.gitCreatePullRequestValue', { p0: gitActions.branch })
				: t('workflows.shell.gitCreatePullRequest'),
			subtext: gitActions.prRunning
				? t('workflows.shell.creatingOpenToSeeHowItWent')
				: isWorktreeChild
					? t('workflows.shell.openPrFromThisWorktreeBranch')
					: t('workflows.shell.openPrFromTheCurrentBranch'),
			shortcut: shortcuts.gitCreatePR,
			action: () => {
				if (isWorktreeChild && onOpenCreatePR) {
					onOpenCreatePR(activeSession);
				} else {
					gitActions.createPR();
				}
				setQuickActionOpen(false);
			},
		});
	}

	if (gitActions.canConfigureWorktrees) {
		commands.push({
			id: 'configureWorktrees',
			label: t('workflows.shell.gitConfigureWorktrees'),
			subtext: t('workflows.shell.setTheWorktreeDirectoryAndWatchOptions'),
			action: () => {
				gitActions.configureWorktrees();
				setQuickActionOpen(false);
			},
		});
	}

	if (onRefreshGitFileState) {
		commands.push({
			id: 'refreshGitFileState',
			label: t('workflows.shell.refreshFilesGitHistory'),
			subtext: t('workflows.shell.reloadFileTreeGitStatusHistoryAndThe'),
			shortcut: shortcuts.refreshGitFileState,
			action: async () => {
				await onRefreshGitFileState();
				setQuickActionOpen(false);
			},
		});
	}

	return commands;
}
