import { useT } from '../../i18n';
import React, { memo } from 'react';
import {
	Copy,
	Edit2,
	Star,
	Link,
	Mail,
	GitMerge,
	ArrowRightCircle,
	ArrowRightLeft,
	Minimize2,
	Download,
	Clipboard,
	Share2,
	ChevronsLeft,
	ChevronsRight,
	Clock,
	X,
} from 'lucide-react';
import type { AITab, Theme } from '../../types';
import { buildSessionDeepLink } from '../../../shared/deep-link-urls';
import { useSettingsStore } from '../../stores/settingsStore';
import { hasThinkingEntries } from '../../utils/contextExtractor';
import type { CopyContextOptions } from '../../hooks/tabs/useTabExportHandlers';
import { ShortcutHint } from '../ui/ShortcutHint';

export interface AITabOverlayMenuProps {
	tab: AITab;
	tabId: string;
	sessionId?: string;
	theme: Theme;
	showCopied: 'sessionId' | 'deepLink' | false;
	totalTabs?: number;
	tabIndex?: number;
	// Action handlers
	onCopySessionId: (e: React.MouseEvent) => void;
	onCopyDeepLink: (e: React.MouseEvent) => void;
	onStarClick: (e: React.MouseEvent) => void;
	onRenameClick: (e: React.MouseEvent) => void;
	onMarkUnreadClick: (e: React.MouseEvent) => void;
	onExportHtmlClick: (e: React.MouseEvent) => void;
	onSnoozeClick: (e: React.MouseEvent) => void;
	onCopyContextClick: (e: React.MouseEvent) => void;
	onCopyContextWithReasoningClick: (e: React.MouseEvent) => void;
	onSummarizeAndContinueClick: (e: React.MouseEvent) => void;
	onMergeWithClick: (e: React.MouseEvent) => void;
	onSendToAgentClick: (e: React.MouseEvent) => void;
	/** "Continue with another AI". Absent when this tab cannot hand off. */
	onHandoffClick?: (e: React.MouseEvent) => void;
	onPublishGistClick: (e: React.MouseEvent) => void;
	onMoveToFirstClick: (e: React.MouseEvent) => void;
	onMoveToLastClick: (e: React.MouseEvent) => void;
	onCloseTabClick: (e: React.MouseEvent) => void;
	onCloseOtherTabsClick: (e: React.MouseEvent) => void;
	onCloseTabsLeftClick: (e: React.MouseEvent) => void;
	onCloseTabsRightClick: (e: React.MouseEvent) => void;
	// Optional handler availability (undefined = hidden)
	onMergeWith?: (tabId: string) => void;
	onSendToAgent?: (tabId: string) => void;
	onSummarizeAndContinue?: (tabId: string) => void;
	onCopyContext?: (tabId: string, options?: CopyContextOptions) => void;
	onExportHtml?: (tabId: string) => void;
	onSnooze?: (tabId: string) => void;
	onPublishGist?: (tabId: string) => void;
	onMoveToFirst?: (tabId: string) => void;
	onMoveToLast?: (tabId: string) => void;
	onCloseOtherTabs?: (tabId: string) => void;
	onCloseTabsLeft?: (tabId: string) => void;
	onCloseTabsRight?: (tabId: string) => void;
}

/**
 * Overlay menu content for AI tabs.
 * Pure presentational - all handlers passed as props.
 */
export const AITabOverlayMenu = memo(function AITabOverlayMenu({
	tab,
	tabId,
	sessionId,
	theme,
	showCopied,
	totalTabs,
	tabIndex,
	onCopySessionId,
	onCopyDeepLink,
	onStarClick,
	onRenameClick,
	onMarkUnreadClick,
	onExportHtmlClick,
	onSnoozeClick,
	onCopyContextClick,
	onCopyContextWithReasoningClick,
	onSummarizeAndContinueClick,
	onMergeWithClick,
	onSendToAgentClick,
	onHandoffClick,
	onPublishGistClick,
	onMoveToFirstClick,
	onMoveToLastClick,
	onCloseTabClick,
	onCloseOtherTabsClick,
	onCloseTabsLeftClick,
	onCloseTabsRightClick,
	onMergeWith,
	onSendToAgent,
	onSummarizeAndContinue,
	onCopyContext,
	onExportHtml,
	onSnooze,
	onPublishGist,
	onMoveToFirst,
	onMoveToLast,
	onCloseOtherTabs,
	onCloseTabsLeft,
	onCloseTabsRight,
}: AITabOverlayMenuProps) {
	const t = useT();
	const shortcuts = useSettingsStore((s) => s.shortcuts);
	const tabShortcuts = useSettingsStore((s) => s.tabShortcuts);

	return (
		<div
			className="shadow-xl overflow-hidden whitespace-nowrap"
			style={{
				backgroundColor: theme.colors.bgSidebar,
				borderLeft: `1px solid ${theme.colors.border}`,
				borderRight: `1px solid ${theme.colors.border}`,
				borderBottom: `1px solid ${theme.colors.border}`,
				borderBottomLeftRadius: '8px',
				borderBottomRightRadius: '8px',
				minWidth: '13.75rem',
			}}
		>
			{/* Header with session name and ID - only show for tabs with sessions */}
			{tab.agentSessionId && (
				<div
					className="border-b"
					style={{
						backgroundColor: theme.colors.bgActivity,
						borderColor: theme.colors.border,
					}}
				>
					{/* Session name display */}
					{tab.name && (
						<div className="px-3 py-2 text-sm font-medium" style={{ color: theme.colors.textMain }}>
							{tab.name}
						</div>
					)}

					{/* Session ID display */}
					<div className="px-3 py-2 text-2xs font-mono" style={{ color: theme.colors.textDim }}>
						{tab.agentSessionId}
					</div>
				</div>
			)}

			{/* Actions */}
			<div className="p-1">
				{tab.agentSessionId && (
					<button
						onClick={onCopySessionId}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
						title={t('workflows.shell.fullIdValue', { p0: tab.agentSessionId })}
					>
						<Copy className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{showCopied === 'sessionId'
							? t('workflows.shell.copied')
							: t('workflows.shell.copySessionId')}
					</button>
				)}

				{sessionId && (
					<button
						onClick={onCopyDeepLink}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
						title={buildSessionDeepLink(sessionId, tabId)}
					>
						<Link className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{showCopied === 'deepLink'
							? t('workflows.shell.copied')
							: t('workflows.shell.copyDeepLink')}
					</button>
				)}

				{/* Star button - only show for tabs with established session */}
				{tab.agentSessionId && (
					<button
						onClick={onStarClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						<Star
							className={`w-3.5 h-3.5 ${tab.starred ? 'fill-current' : ''}`}
							style={{ color: tab.starred ? theme.colors.warning : theme.colors.textDim }}
						/>
						{tab.starred ? t('workflows.shell.unstarSession') : t('workflows.shell.starSession')}
						{shortcuts.toggleTabStar && (
							<ShortcutHint keys={shortcuts.toggleTabStar.keys} theme={theme} />
						)}
					</button>
				)}

				{/* Rename button - always available */}
				<button
					onClick={onRenameClick}
					className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
					style={{ color: theme.colors.textMain }}
				>
					<Edit2 className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
					{t('workflows.shell.renameTab')}
					{tabShortcuts.renameTab && (
						<ShortcutHint keys={tabShortcuts.renameTab.keys} theme={theme} />
					)}
				</button>

				{/* Mark as Unread button - only show for tabs with established session */}
				{tab.agentSessionId && (
					<button
						onClick={onMarkUnreadClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						<Mail className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.markAsUnread')}
						{tabShortcuts.toggleTabUnread && (
							<ShortcutHint keys={tabShortcuts.toggleTabUnread.keys} theme={theme} />
						)}
					</button>
				)}

				{/* Export as HTML - only show if tab has logs */}
				{(tab.logs?.length ?? 0) >= 1 && onExportHtml && (
					<button
						onClick={onExportHtmlClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						<Download className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.exportAsHtml')}
					</button>
				)}

				{/* Snooze - hide the tab until a chosen moment, then bring it back */}
				{onSnooze && (
					<button
						onClick={onSnoozeClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						<Clock className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.snoozeTab')}
						{tabShortcuts.snoozeTab && (
							<ShortcutHint keys={tabShortcuts.snoozeTab.keys} theme={theme} />
						)}
					</button>
				)}

				{/* Context Management Section - divider and grouped options */}
				{(tab.agentSessionId || (tab.logs?.length ?? 0) >= 1) &&
					(onHandoffClick ||
						onMergeWith ||
						onSendToAgent ||
						onSummarizeAndContinue ||
						onCopyContext) && (
						<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
					)}

				{/* Continue with another AI: first in the section, it is the one that
				    moves the conversation on rather than copying or merging it. */}
				{onHandoffClick && (
					<button
						onClick={onHandoffClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						<ArrowRightLeft className="w-3.5 h-3.5" style={{ color: theme.colors.accent }} />
						{t('workflows.sessions.handoff.menuItem')}
					</button>
				)}

				{/* Context: Copy to Clipboard */}
				{(tab.logs?.length ?? 0) >= 1 && onCopyContext && (
					<button
						onClick={onCopyContextClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						<Clipboard className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.contextCopyToClipboard')}
					</button>
				)}

				{/* Context: Copy with Reasoning - only when the tab has reasoning blocks */}
				{onCopyContext && hasThinkingEntries(tab.logs) && (
					<button
						onClick={onCopyContextWithReasoningClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						<Clipboard className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.contextCopyWithReasoning')}
					</button>
				)}

				{/* Context: Compact */}
				{(tab.logs?.length ?? 0) >= 5 && onSummarizeAndContinue && (
					<button
						onClick={onSummarizeAndContinueClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						<Minimize2 className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.contextCompact')}
					</button>
				)}

				{/* Context: Merge Into */}
				{(tab.logs?.length ?? 0) >= 1 && onMergeWith && (
					<button
						onClick={onMergeWithClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						<GitMerge className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.contextMergeInto')}
					</button>
				)}

				{/* Context: Send to Agent */}
				{(tab.logs?.length ?? 0) >= 1 && onSendToAgent && (
					<button
						onClick={onSendToAgentClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						<ArrowRightCircle className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.contextSendToAgent')}
					</button>
				)}

				{/* Context: Publish as GitHub Gist - only show if tab has logs and gh CLI is available */}
				{(tab.logs?.length ?? 0) >= 1 && onPublishGist && (
					<button
						onClick={onPublishGistClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						<Share2 className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.contextPublishAsGithubGist')}
					</button>
				)}

				{/* Tab Move Actions Section - divider and move options */}
				{(onMoveToFirst || onMoveToLast) && (
					<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
				)}

				{/* Move to First Position - suppressed if already first tab or no handler */}
				{onMoveToFirst && (
					<button
						onClick={onMoveToFirstClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors hover:bg-white/10"
						style={{ color: theme.colors.textMain }}
					>
						<ChevronsLeft className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.moveToFirstPosition')}
						{tabShortcuts.moveTabToStart && (
							<ShortcutHint keys={tabShortcuts.moveTabToStart.keys} theme={theme} />
						)}
					</button>
				)}

				{/* Move to Last Position - suppressed if already last tab or no handler */}
				{onMoveToLast && (
					<button
						onClick={onMoveToLastClick}
						className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors hover:bg-white/10"
						style={{ color: theme.colors.textMain }}
					>
						<ChevronsRight className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.moveToLastPosition')}
						{tabShortcuts.moveTabToEnd && (
							<ShortcutHint keys={tabShortcuts.moveTabToEnd.keys} theme={theme} />
						)}
					</button>
				)}

				{/* Tab Close Actions Section - divider and close options */}
				<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />

				{/* Close Tab */}
				<button
					onClick={onCloseTabClick}
					className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
						totalTabs === 1 ? 'opacity-40 cursor-default' : 'hover:bg-white/10'
					}`}
					style={{ color: theme.colors.textMain }}
					disabled={totalTabs === 1}
				>
					<X className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
					{t('workflows.shell.closeTab')}
					{tabShortcuts.closeTab && (
						<ShortcutHint keys={tabShortcuts.closeTab.keys} theme={theme} />
					)}
				</button>

				{/* Close Other Tabs */}
				{onCloseOtherTabs && (
					<button
						onClick={onCloseOtherTabsClick}
						className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
							totalTabs === 1 ? 'opacity-40 cursor-default' : 'hover:bg-white/10'
						}`}
						style={{ color: theme.colors.textMain }}
						disabled={totalTabs === 1}
					>
						<X className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.closeOtherTabs')}
						{tabShortcuts.closeOtherTabs && (
							<ShortcutHint keys={tabShortcuts.closeOtherTabs.keys} theme={theme} />
						)}
					</button>
				)}

				{/* Close Tabs to Left */}
				{onCloseTabsLeft && (
					<button
						onClick={onCloseTabsLeftClick}
						className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
							tabIndex === 0 ? 'opacity-40 cursor-default' : 'hover:bg-white/10'
						}`}
						style={{ color: theme.colors.textMain }}
						disabled={tabIndex === 0}
					>
						<ChevronsLeft className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.closeTabsToLeft')}
						{tabShortcuts.closeTabsLeft && (
							<ShortcutHint keys={tabShortcuts.closeTabsLeft.keys} theme={theme} />
						)}
					</button>
				)}

				{/* Close Tabs to Right */}
				{onCloseTabsRight && (
					<button
						onClick={onCloseTabsRightClick}
						className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
							tabIndex === (totalTabs ?? 1) - 1 ? 'opacity-40 cursor-default' : 'hover:bg-white/10'
						}`}
						style={{ color: theme.colors.textMain }}
						disabled={tabIndex === (totalTabs ?? 1) - 1}
					>
						<ChevronsRight className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
						{t('workflows.shell.closeTabsToRight')}
						{tabShortcuts.closeTabsRight && (
							<ShortcutHint keys={tabShortcuts.closeTabsRight.keys} theme={theme} />
						)}
					</button>
				)}
			</div>
		</div>
	);
});
