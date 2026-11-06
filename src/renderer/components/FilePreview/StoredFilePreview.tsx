import React from 'react';
import type { Session, Theme } from '../../types';
import type { PaneFileActions } from '../MainPanel/TiledLayout';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTabStore } from '../../stores/tabStore';
import { useFilePreviewHandlers } from '../../hooks/mainPanel/useFilePreviewHandlers';
import { filePaneAttrs } from '../../utils/paneFocus';
const FilePreview = React.lazy(() =>
	import('../FilePreview').then((m) => ({ default: m.FilePreview }))
);
export function StoredFilePreview({
	fileTabId,
	session,
	theme,
	actions,
	onBack,
}: {
	fileTabId: string;
	session: Session;
	theme: Theme;
	actions: PaneFileActions | null;
	onBack?: () => void;
}) {
	const shortcuts = useSettingsStore((s) => s.shortcuts);
	// Subscribe to THIS tab via the session store so edit-mode / edit-content / tier /
	// html-mode changes re-render the pane (the session prop is a snapshot that alone
	// wouldn't update). The tabStore setters below all mutate the ACTIVE session's file
	// tabs, and a tiled file pane's session IS the active session (its group is active).
	const fileTab = useSessionStore(
		(s) =>
			s.sessions
				.find((x) => x.id === session.id)
				?.filePreviewTabs?.find((t) => t.id === fileTabId) ?? null
	);
	const store = useTabStore.getState();

	// Same binding the single view uses, pointed at THIS pane's tab instead of the
	// active one. Gives the pane the identical file object, cwd, SSH id, and handlers.
	const {
		memoizedFilePreviewFile,
		filePreviewCwd,
		filePreviewSshRemoteId,
		handleFilePreviewEditModeChange,
		handleFilePreviewSave,
		handleFilePreviewEditContentChange,
		handleFilePreviewScrollPositionChange,
		handleFilePreviewSearchQueryChange,
		handleFilePreviewReload,
	} = useFilePreviewHandlers({
		activeSession: session,
		activeFileTabId: fileTabId,
		activeFileTab: fileTab,
		onFileTabEditModeChange: actions?.onFileTabEditModeChange,
		onFileTabEditContentChange: actions?.onFileTabEditContentChange,
		onFileTabScrollPositionChange: actions?.onFileTabScrollPositionChange,
		onFileTabSearchQueryChange: actions?.onFileTabSearchQueryChange,
		onReloadFileTab: actions?.onReloadFileTab,
	});

	// Breadcrumb history, derived from THIS tab (the single view derives the same
	// slices for the active tab in getTabDerivedState).
	const history = fileTab?.navigationHistory ?? [];
	const navIndex = fileTab?.navigationIndex ?? (history.length > 0 ? history.length - 1 : -1);
	const navigateToIndex = actions?.onFileTabNavigateToIndex;
	const goToIndex = React.useCallback(
		(index: number) => navigateToIndex?.(index, fileTabId),
		[navigateToIndex, fileTabId]
	);

	if (!fileTab || !memoizedFilePreviewFile) return null;

	return (
		// Tagged with the tab id so the pane focus router can land the caret in THIS
		// pane's editor when several file panes are tiled at once (see utils/paneFocus).
		<div className="h-full flex-1 overflow-hidden select-text" {...filePaneAttrs(fileTabId)}>
			<React.Suspense fallback={null}>
				<FilePreview
					file={memoizedFilePreviewFile}
					onClose={onBack ?? (() => actions?.onFileTabClose?.(fileTabId))}
					onPanelBack={onBack}
					isTabMode={true}
					theme={theme}
					shortcuts={shortcuts}
					markdownEditMode={fileTab.editMode ?? false}
					setMarkdownEditMode={handleFilePreviewEditModeChange}
					onSave={handleFilePreviewSave}
					externalEditContent={fileTab.editContent}
					onEditContentChange={handleFilePreviewEditContentChange}
					previewTierOverride={fileTab.previewTierOverride}
					onPreviewTierChange={(tier) => store.setFileTabPreviewTier(fileTabId, tier)}
					htmlRenderMode={fileTab.htmlRenderMode}
					onHtmlRenderModeChange={(value) => store.setFileTabHtmlRenderMode(fileTabId, value)}
					sshRemoteId={filePreviewSshRemoteId}
					// File/wiki links inside the document, resolved against the same tree
					// and proximity cwd the single view uses.
					fileTree={actions?.fileTree}
					cwd={filePreviewCwd}
					onFileClick={actions?.onFileClick}
					onOpenFuzzySearch={actions?.onOpenFuzzySearch}
					onShortcutUsed={actions?.onShortcutUsed}
					// Scroll + find-query memory, so switching away and back lands where
					// the user left off instead of jumping to the top with a cleared term.
					initialScrollTop={fileTab.scrollTop}
					onScrollPositionChange={handleFilePreviewScrollPositionChange}
					initialSearchQuery={fileTab.searchQuery}
					onSearchQueryChange={handleFilePreviewSearchQueryChange}
					// On-disk change detection + reload.
					lastModified={fileTab.lastModified}
					onReloadFile={handleFilePreviewReload}
					// Breadcrumb navigation across this tab's own visit history.
					canGoBack={navIndex > 0}
					canGoForward={navIndex < history.length - 1}
					onNavigateBack={navigateToIndex ? () => goToIndex(navIndex - 1) : undefined}
					onNavigateForward={navigateToIndex ? () => goToIndex(navIndex + 1) : undefined}
					backHistory={history.slice(0, navIndex)}
					forwardHistory={history.slice(navIndex + 1)}
					currentHistoryIndex={navIndex}
					onNavigateToIndex={navigateToIndex ? goToIndex : undefined}
					// Transient deep-link scroll target, cleared once consumed.
					pendingScrollToLine={fileTab.pendingScrollToLine}
					onPendingScrollToLineConsumed={() => store.clearFileTabPendingScrollToLine(fileTabId)}
				/>
			</React.Suspense>
		</div>
	);
}
