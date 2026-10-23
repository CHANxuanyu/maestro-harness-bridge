import React, {
	useRef,
	useMemo,
	useEffect,
	useLayoutEffect,
	forwardRef,
	useCallback,
	useState,
	memo,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import type { LogEntry } from '../../types';
import { useT } from '../../i18n';
import type { TerminalOutputProps } from './types';
import { useAnsiConverter } from '../../hooks/ui/useAnsiConverter';
import { getActiveTab } from '../../utils/tabHelpers';
import { useTranscriptBackfill } from '../../hooks/agent/useTranscriptBackfill';
import { useDebouncedValue, useProgressiveRenderWindow } from '../../hooks';
import { jumpToMessageEdge, isTextInputTarget } from '../../utils/messageScrollNavigation';
import { QueuedItemsList } from '../QueuedItemsList';
import { SaveMarkdownModal } from '../SaveMarkdownModal';
import { Spinner } from '../ui/Spinner';
import {
	TerminalSelectionContextMenu,
	type TerminalSelectionContextMenuState,
} from '../TerminalSelectionContextMenu';
import { resolveImageFromEvent } from '../ImageContextMenuHost';
import { isEditingTextTarget } from '../../utils/editableTarget';
import { appendQuoteToDraft } from '../../utils/quoteSelection';
import { useComposerInputStore } from '../../stores/composerInputStore';
import { generateTerminalProseStyles } from '../../utils/markdownConfig';
import { safeClipboardWrite } from '../../utils/clipboard';
import { flashCopiedToClipboard } from '../../utils/flashCopiedToClipboard';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMessageGistStore } from '../../stores/messageGistStore';
import { getClaudeTokenMode } from '../../../shared/claudeTokenMode';
import { collapseAiResponseLogs } from './utils/collapseAiResponseLogs';
import { computeTurnDurations } from './utils/turnDurations';
import { computeTurnSettingChanges } from './utils/turnSettingChanges';
import { readableTextOn } from '../../../shared/colorContrast';
import { groupSubagentToolLogs } from './utils/groupSubagentToolLogs';
import { foldNativeToolRuns } from './utils/foldNativeToolRuns';
import { foldTurnActivity, type TurnActivity } from './utils/foldTurnActivity';
import { feedProseStyles } from './utils/feedProseStyles';
import { TurnActivityFold } from './components/TurnActivityFold';
import { buildRenderedIdMap } from './utils/renderedLogIds';
import { useUIStore } from '../../stores/uiStore';
import { jumpToElement } from '../../utils/jumpHighlight';
import { LogItem } from './components/LogItem';
import { OutputSearchBar } from './components/OutputSearchBar';
import { ScrollToBottomButton } from './components/ScrollToBottomButton';
import { useLogItemUiState } from './hooks/useLogItemUiState';
import { useTerminalOutputSearch } from './hooks/useTerminalOutputSearch';
import { useTerminalOutputScroll } from './hooks/useTerminalOutputScroll';
import { requestWebBridgeReconcile } from '../../services/webBridgeReconcile';

/**
 * Widest the transcript column grows in the conversation-centred layout: a
 * comfortable reading measure for prose (about 45rem of text after the row
 * padding). Code fences and tables scroll inside their own wrappers.
 */
const READING_COLUMN_MAX_WIDTH = '50rem';

/**
 * The transcript rows: the content wrapper's own children that carry a log id
 * (the history status row above them does not).
 */
function transcriptRows(content: HTMLElement): Element[] {
	return Array.from(content.children).filter((el) => el.hasAttribute('data-log-id'));
}

/**
 * How far the reader's row may sit from its target before a scroll counts as
 * the reader moving it. Below this the scroll is the echo of our own
 * correction, which lands only as precisely as the scroller's offset allows
 * (a device pixel); any real wheel, key or drag moves the row well past it,
 * and slow sub-pixel drags still cross it because each event is compared with
 * the fixed target, not with the previous event.
 */
const ANCHOR_HOLD_TOLERANCE_PX = 1;

/** The row the reader is on and where its edges sit relative to the viewport top. */
interface ReadingAnchor {
	tabKey: string;
	rowId: string;
	top: number;
	bottom: number;
}

/**
 * Where each conversation was being read when its transcript unmounted, keyed
 * `${sessionId}:${tabId}`. The transcript is keyed per agent and tab, so leaving
 * one (another agent, a file tab) and coming back remounts it, and the saved
 * absolute `scrollTop` cannot bring the reader back: the remount renders only
 * the newest rows and mounts the rest above them over idle ticks, so that
 * offset is reached while most of the history above it is still missing and
 * lands near the latest messages. A message id plus its offset survives that.
 * In memory only: a restart has no anchor and keeps the absolute restore.
 */
const savedReadingAnchors = new Map<string, ReadingAnchor>();

/**
 * Frames a cross-tab search jump keeps re-asserting its scroll position.
 * Rows carry `content-visibility: auto`, so ones that have never been near the
 * viewport are laid out at their `contain-intrinsic-size` estimate; the target
 * shifts as real heights replace those estimates on the way there.
 */
const JUMP_STABILIZE_FRAMES = 10;

/** How long the jump keeps auto-scroll suppressed after landing (~2x the stabilize window). */
const JUMP_SETTLE_MS = 400;

// PERFORMANCE: Wrap in React.memo to prevent re-renders when parent re-renders
// but TerminalOutput's props haven't changed. This is critical because TerminalOutput
// can render many log entries and is expensive to re-render.
export const TerminalOutput = memo(
	forwardRef<HTMLDivElement, TerminalOutputProps>((props, ref) => {
		const t = useT();
		const {
			session,
			theme,
			fontFamily,
			activeFocus: _activeFocus,
			outputSearchOpen,
			outputSearchQuery,
			outputSearchRegex,
			setOutputSearchOpen,
			setOutputSearchQuery,
			setOutputSearchRegex,
			setActiveFocus,
			setLightboxImage,
			inputRef,
			logsEndRef,
			maxOutputLines,
			onDeleteLog,
			onRemoveQueuedItem,
			onTogglePauseQueuedItem,
			onEditQueuedItem,
			onReorderQueuedItem,
			onForceSendQueuedItem,
			forcedParallelEnabled,
			getForceSendContext,
			forceSendShortcutEnabled = true,
			onInterrupt: _onInterrupt,
			onScrollPositionChange,
			onAtBottomChange,
			initialScrollTop,
			initialIsAtBottom,
			markdownEditMode,
			setMarkdownEditMode,
			onReplayMessage,
			onForkConversation,
			fileTree,
			cwd,
			projectRoot,
			onFileClick,
			onShowErrorDetails,
			onFileSaved,
			userMessageAlignment = 'right',
			onOpenInTab,
			ghCliAvailable,
			onPublishMessageGist,
			onSessionRecover,
			isRecoveringSession,
			sessionRecoveryError,
		} = props;
		const globalBionifyReadingMode = useSettingsStore((s) => s.bionifyReadingMode);
		const globalBionifyIntensity = useSettingsStore((s) => s.bionifyIntensity);
		const publishedGists = useMessageGistStore((s) => s.published);
		const globalBionifyAlgorithm = useSettingsStore((s) => s.bionifyAlgorithm);

		// Use the forwarded ref if provided, otherwise create a local one
		const localRef = useRef<HTMLDivElement>(null);
		const terminalOutputRef = (ref as React.RefObject<HTMLDivElement>) || localRef;

		// Scroll container ref for native scrolling
		const scrollContainerRef = useRef<HTMLDivElement>(null);
		// Single inner wrapper whose border-box height equals the scrollable content
		// height. The scroll container itself only resizes with the viewport, so a
		// ResizeObserver needs this element to see content growth (image decode,
		// async font load, markdown/tool-badge layout settling) that arrives without
		// a DOM mutation.
		const contentRef = useRef<HTMLDivElement>(null);

		const activeTabId = session.activeTabId;

		const copyToClipboard = useCallback(async (text: string) => {
			const ok = await safeClipboardWrite(text);
			if (ok) {
				flashCopiedToClipboard(text);
			}
		}, []);

		// Right-click on selected transcript text: Quote in Message / Copy (issue #1663).
		const [selectionMenu, setSelectionMenu] = useState<TerminalSelectionContextMenuState | null>(
			null
		);
		const closeSelectionMenu = useCallback(() => setSelectionMenu(null), []);

		const handleTranscriptContextMenu = useCallback((e: React.MouseEvent) => {
			// A link or image menu already claimed this right-click, or it landed in a
			// text field (the native cut/copy/paste + spellcheck menu owns those).
			if (e.defaultPrevented || isEditingTextTarget(e.target)) return;
			if (resolveImageFromEvent(e.nativeEvent)) return;
			const selection = window.getSelection();
			const text = selection?.toString() ?? '';
			if (!selection || selection.isCollapsed || !text.trim()) return;
			const container = scrollContainerRef.current;
			if (
				!container ||
				!selection.anchorNode ||
				!selection.focusNode ||
				!container.contains(selection.anchorNode) ||
				!container.contains(selection.focusNode)
			) {
				return;
			}
			// Only when the click lands on the highlighted text itself, so a stale
			// selection elsewhere in the transcript is not what gets quoted.
			const target = e.target as Node;
			let onSelection = false;
			for (let i = 0; i < selection.rangeCount && !onSelection; i++) {
				onSelection = selection.getRangeAt(i).intersectsNode(target);
			}
			if (!onSelection) return;
			e.preventDefault();
			setSelectionMenu({ x: e.clientX, y: e.clientY, selection: text });
		}, []);

		// Append the passage to the composer as a Markdown quote and park the caret
		// on the blank line below it, ready for the comment about that passage.
		// Repeating it stacks quotes, so one message can answer several passages.
		const handleQuoteSelection = useCallback(
			(text: string) => {
				const composer = useComposerInputStore.getState();
				// A quote is prose for the agent, never a shell command line.
				if (composer.aiCommandMode !== 'off') composer.setAiCommandMode('off');
				composer.setAiValue((prev) => appendQuoteToDraft(prev, text));
				window.getSelection()?.removeAllRanges();
				// Wait a frame so the controlled textarea has rendered the new value.
				requestAnimationFrame(() => {
					const input = inputRef.current;
					if (!input) return;
					input.focus();
					const end = input.value.length;
					input.setSelectionRange(end, end);
					input.scrollTop = input.scrollHeight;
				});
			},
			[inputRef]
		);

		// Theme-aware ANSI palette, shared with every other raw-output surface.
		const ansiConverter = useAnsiConverter(theme);

		const activeTab = useMemo(() => getActiveTab(session), [session.aiTabs, session.activeTabId]);
		const activeLogs = useMemo((): LogEntry[] => activeTab?.logs ?? [], [activeTab?.logs]);
		const transcriptDeferred =
			!!activeTab && !!session.deferredContent?.tabIds.includes(activeTab.id);
		// Collapse FIRST so tool logs still act as response boundaries
		// (collapseAiResponseLogs treats source:'tool' as a boundary between
		// assistant segments); only THEN hide them. Tool visibility is a pure render
		// concern: tool events are always recorded (useAgentToolExecutionListener),
		// so hiding here keeps toggling from mutating log storage (the flicker bug)
		// and preserves running->completed correlation.
		const collapsedAll = useMemo(() => collapseAiResponseLogs(activeLogs), [activeLogs]);
		// Per-turn elapsed time for the badge under each reply's clock. Derived from
		// the RAW logs (not the collapsed ones) because the tool and thinking entries
		// that mark when the agent stopped working can be filtered out below.
		const responseDurationByLogId = useMemo(() => computeTurnDurations(activeLogs), [activeLogs]);
		// Tool visibility is independent of the Thinking toggle. Reading the
		// reasoning chain and watching tool activity are separate appetites: a tab
		// can show thinking with a clean, tool-free transcript, or show tools with
		// no reasoning at all. One switch, one meaning.
		const toolsVisible = useSettingsStore((s) => s.showToolCalls);
		const readingColumn = useSettingsStore((s) => s.sidebarNavigationMode === 'conversations');
		const showProviderModePill = useSettingsStore((s) => s.showProviderModePill);
		// Reasoning summaries read back from the provider transcript follow the
		// tab's Thinking switch. They are history and stay in the logs (the switch
		// no longer deletes them), so hiding them is a render concern like tools.
		const thinkingHidden = (activeTab?.showThinking ?? 'off') === 'off';
		// With tool calls switched off, each run of stored tool calls folds into one
		// "N tool calls" row (see foldNativeToolRuns), so a stored turn never reads
		// as tool-free. Live calls stay hidden, as before. The conversation-centred
		// layout folds each finished turn's whole process instead (foldTurnActivity
		// below), so there every call - the running turn's included - stays one
		// line of its own.
		const toolFold = useMemo(
			() =>
				foldNativeToolRuns(
					thinkingHidden
						? collapsedAll.filter((l) => !(l.source === 'thinking' && l.nativeTranscript))
						: collapsedAll,
					toolsVisible || readingColumn,
					readingColumn
				),
			[collapsedAll, toolsVisible, thinkingHidden, readingColumn]
		);
		const collapsedLogs = toolFold.logs;
		const toolRunByHostId = toolFold.runByHostId;
		// Nest subagent tool badges (claude-code Task) under the tool entry that
		// spawned them; orphans and non-claude agents pass through untouched.
		const { logs: groupedLogs, childrenByParentId } = useMemo(
			() => groupSubagentToolLogs(collapsedLogs),
			[collapsedLogs]
		);
		const debouncedSearchQuery = useDebouncedValue(outputSearchQuery, 150);
		// Conversation feed: each finished turn's process (tools, reasoning,
		// progress notes, interim text) folds behind one "Worked for ..." row above
		// its answer, as in Codex. The running turn stays open, and a search shows
		// everything so every match is on the page.
		const turnLive = activeTab?.state === 'busy';
		const turnFold = useMemo(
			() =>
				readingColumn && !debouncedSearchQuery
					? foldTurnActivity(groupedLogs, { keepLastTurnOpen: turnLive })
					: { logs: groupedLogs, activityByHostId: new Map<string, TurnActivity>() },
			[groupedLogs, readingColumn, debouncedSearchQuery, turnLive]
		);
		const filteredLogs = turnFold.logs;
		const turnActivityByHostId = turnFold.activityByHostId;
		// Conversation feed presentation (see LogItem `feedLayout`). Derived from
		// the full rendered list, not the progressive window, so mounting older
		// rows cannot move which reply is newest or where a setting changed.
		const feedLayout = readingColumn;
		const feedFacts = useMemo(
			() => (feedLayout ? computeTurnSettingChanges(filteredLogs) : null),
			[feedLayout, filteredLogs]
		);
		// Secondary labels and icons in the feed: the theme's textDim, nudged only
		// where it is too faint to read on the page (Dracula's is about 3:1).
		const feedSecondaryColor = useMemo(
			() => readableTextOn(theme.colors.textDim, [theme.colors.bgMain]),
			[theme.colors.textDim, theme.colors.bgMain]
		);

		// ============================================================================
		// Progressive transcript rendering (issue #1342)
		// ============================================================================
		// Mounting every entry of a long transcript in one commit blocked the main
		// thread for seconds on agent switch (each entry runs the full remark/rehype
		// pipeline). Render the newest slice first, then backfill older history on
		// idle ticks. Prepending entries above the viewport would shift what the user
		// is reading. While the reader follows the tail, distance-from-bottom is
		// what stays constant (snapshot before each expansion, restore before
		// paint). While they are reading history, the MESSAGE they are reading is
		// what must stay put: see the reading anchor below.
		const backfillBottomDistanceRef = useRef<number | null>(null);
		// Assigned below, once the scroll hook is wired; called before any change
		// this component makes at the head of the list.
		const recordReadingAnchorRef = useRef<() => void>(() => {});

		const handleBeforeBackfill = useCallback(() => {
			const container = scrollContainerRef.current;
			if (container) {
				backfillBottomDistanceRef.current = container.scrollHeight - container.scrollTop;
			}
			recordReadingAnchorRef.current();
		}, []);

		const {
			startIndex: windowStartIndex,
			revealTo: revealLogIndex,
			absorbPrepend: absorbLogPrepend,
		} = useProgressiveRenderWindow(filteredLogs.length, `${session.id}-${activeTabId ?? ''}`, {
			onBeforeExpand: handleBeforeBackfill,
		});

		// ============================================================================
		// Scroll-to-top history backfill (issue #1407)
		// ============================================================================
		// The tab only holds the newest slice of its conversation (500 messages on
		// resume, 100 after a restart), so scrolling up used to hit a hard stop
		// mid-conversation. Reaching the top now pages older history back in from
		// the provider transcript on disk. Entries arrive at the HEAD, so hand the
		// count to the render window: it shifts by exactly that many, keeping the
		// visible slice stable and letting the idle loop mount the new history a
		// chunk at a time instead of one page-sized commit.
		//
		// The count the backfill reports is RAW log entries, but the window indexes
		// RENDERED rows: a tool-heavy turn folds dozens of entries into one row,
		// hidden reasoning renders none, and the newest prepended response can merge
		// into the row that was on top. Shifting the window by the raw count pushed
		// it far past what the user was reading (they landed minutes later in the
		// conversation). So the backfill only records which row was first in the
		// window; the render that brings the prepend in finds the row that now
		// holds it and slices from there (see pendingPrependRows below).
		const prependAnchorRef = useRef<{ rowId: string; list: LogEntry[] } | null>(null);
		const filteredLogsRef = useRef(filteredLogs);
		filteredLogsRef.current = filteredLogs;
		const logStartIndexRef = useRef(windowStartIndex);
		const historyBackfill = useTranscriptBackfill(session, activeTab, {
			onPrepend: useCallback(
				(count: number) => {
					if (count <= 0) return;
					handleBeforeBackfill();
					const list = filteredLogsRef.current;
					const rowId = list[logStartIndexRef.current]?.id;
					prependAnchorRef.current = rowId ? { rowId, list } : null;
				},
				[handleBeforeBackfill]
			),
		});

		const restoreBackfillScroll = useCallback(() => {
			const container = scrollContainerRef.current;
			const bottomDistance = backfillBottomDistanceRef.current;
			backfillBottomDistanceRef.current = null;
			if (!container || bottomDistance === null) return;
			// Anchor to the bottom rather than the top: content was prepended, so the
			// distance from the bottom is what stayed constant for the user.
			container.scrollTop = container.scrollHeight - bottomDistance;
		}, []);

		// ============================================================================
		// Cross-tab search jump (Opt+Cmd+F -> pick a hit in another tab)
		// ============================================================================
		// The modal switches the active tab, seeds this tab's Find bar with the same
		// query, and leaves a pendingLogJump behind. Here we scroll that entry into
		// view, flash it, and hand the match index to the Find bar so next/prev
		// continues from the hit the user actually clicked.
		//
		// Raw log ids have to be resolved to the row that survived collapsing (see
		// buildRenderedIdMap) - the transcript renders far fewer rows than tab.logs.
		const renderedIdByLogId = useMemo(
			() => buildRenderedIdMap(filteredLogs, activeLogs),
			[filteredLogs, activeLogs]
		);

		// Resolve a pending history prepend (see onPrepend above) in the render that
		// brings it in. The anchor is the raw id of the row that was first in the
		// window; `buildRenderedIdMap` names the row that holds it now, even when
		// the newest prepended response merged into it. The slice starts at that
		// row in this very render, so no commit ever mounts the prepended page (a
		// backfill page can be hundreds of entries - the long task the progressive
		// window exists to avoid). Only a list other than the one the anchor was
		// taken from can hold the prepend: a render that lands before the store
		// update (an idle chunk, say) must neither shift the window nor consume
		// the anchor.
		const pendingPrepend = prependAnchorRef.current;
		const pendingPrependRows = useMemo(() => {
			if (!pendingPrepend || pendingPrepend.list === filteredLogs) return 0;
			const rowId = renderedIdByLogId.get(pendingPrepend.rowId);
			const rowIndex = rowId ? filteredLogs.findIndex((row) => row.id === rowId) : -1;
			return Math.max(0, rowIndex - windowStartIndex);
		}, [pendingPrepend, filteredLogs, renderedIdByLogId, windowStartIndex]);
		const logStartIndex = windowStartIndex + pendingPrependRows;
		logStartIndexRef.current = logStartIndex;

		// The window's own state catches up before paint; from the next render on
		// the shift is part of `windowStartIndex` (and the anchor is gone, so the
		// memo above reads 0) and the idle loop walks back through the new history
		// a chunk at a time.
		useLayoutEffect(() => {
			const pending = prependAnchorRef.current;
			if (!pending || pending.list === filteredLogs) return;
			prependAnchorRef.current = null;
			if (pendingPrependRows > 0) absorbLogPrepend(pendingPrependRows);
		}, [pendingPrependRows, filteredLogs, absorbLogPrepend]);

		const visibleLogs = useMemo(
			() => (logStartIndex > 0 ? filteredLogs.slice(logStartIndex) : filteredLogs),
			[filteredLogs, logStartIndex]
		);

		// ============================================================================
		// Which rows are NEW (the "new messages" count)
		// ============================================================================
		// useTerminalOutputScroll counts growth of the length it is given as output
		// arriving at the tail. History paged in at the HEAD is not that, so it is
		// given the rows from the tab's ORIGINAL head on: the first row this
		// transcript showed for the tab, resolved through buildRenderedIdMap so a
		// merge with prepended history or a fold change still finds it. Derived in
		// render from the list itself - no counter updated a commit later, which is
		// what let one inflated length through and left a false unread behind - and
		// no running subtraction to drift when visibility or reconciliation change
		// what renders. If the head entry is gone (deleted, re-read), it re-anchors
		// on the current first row rather than guessing.
		const headAnchorByTabRef = useRef(new Map<string, string>());
		const tailRowCount = useMemo(() => {
			const tabKey = `${session.id}:${activeTabId ?? ''}`;
			const headRawId = headAnchorByTabRef.current.get(tabKey);
			const headRow = headRawId ? renderedIdByLogId.get(headRawId) : undefined;
			const headIndex = headRow ? filteredLogs.findIndex((row) => row.id === headRow) : -1;
			if (headIndex >= 0) return filteredLogs.length - headIndex;
			const firstId = filteredLogs[0]?.id;
			if (firstId) headAnchorByTabRef.current.set(tabKey, firstId);
			else headAnchorByTabRef.current.delete(tabKey);
			return filteredLogs.length;
		}, [filteredLogs, renderedIdByLogId, session.id, activeTabId]);
		const pendingLogJump = useUIStore((s) => s.pendingLogJump);
		const pendingJumpMatchIdRef = useRef<string | null>(null);
		const cancelJumpRef = useRef<(() => void) | null>(null);
		// Only cancel an in-flight jump when the transcript goes away; clearing the
		// store entry inside the effect must NOT tear down the flash we just started.
		useEffect(() => () => cancelJumpRef.current?.(), []);

		const {
			expandedLogs,
			toggleExpanded,
			localFilters,
			activeLocalFilter,
			filterModes,
			toggleLocalFilter,
			setLocalFilterQuery,
			setFilterModeForLog,
			clearLocalFilter,
			deleteConfirmLogId,
			setDeleteConfirmLogId,
			saveModalContent,
			setSaveModalContent,
			handleSaveToFile,
			toggleMarkdownEditMode,
		} = useLogItemUiState(markdownEditMode, setMarkdownEditMode);

		const {
			currentMatchIndex,
			totalMatches,
			regexError,
			goToNextMatch,
			goToPrevMatch,
			closeSearch,
		} = useTerminalOutputSearch({
			scrollContainerRef,
			terminalOutputRef,
			outputSearchOpen,
			outputSearchRegex,
			debouncedSearchQuery,
			filteredLogsLength: filteredLogs.length,
			logStartIndex,
			setOutputSearchOpen,
			setOutputSearchQuery,
			pendingJumpMatchIdRef,
		});

		// Coming back to a conversation that was left mid-history: its saved
		// reading anchor (see savedReadingAnchors), if the row is still in this
		// transcript. Decided once per mount, and while it applies the absolute
		// `initialScrollTop` restore is not run at all, since the two would fight.
		const readingTabKey = `${session.id}:${activeTabId ?? ''}`;
		const [anchorRestore] = useState(() => {
			if (initialIsAtBottom !== false) return null;
			const saved = savedReadingAnchors.get(readingTabKey);
			if (!saved) return null;
			const rowId = renderedIdByLogId.get(saved.rowId) ?? saved.rowId;
			const rowIndex = filteredLogs.findIndex((row) => row.id === rowId);
			return rowIndex < 0 ? null : { anchor: saved, rowIndex };
		});

		const {
			isAtBottom,
			// The hook's live at-bottom ref (see its mirror comment): the gate for
			// every hold, restore and save below, because the render value can lag a
			// reveal by a commit.
			isAtBottomRef: isAtBottomLatestRef,
			hasNewMessages,
			newMessageCount,
			autoScrollPaused,
			isAutoScrollActive,
			handleScroll,
			noteUserScrollInput,
			scrollToBottomAndResume,
			jumpInFlightRef,
			pauseForJump,
		} = useTerminalOutputScroll({
			scrollContainerRef,
			contentRef,
			initialScrollTop: anchorRestore ? undefined : initialScrollTop,
			initialIsAtBottom,
			sessionId: session.id,
			activeTabId,
			// Rows from the original head on: history paged in above them is not
			// "new messages" (it raised a 99+ badge on every earlier-history load).
			filteredLogsLength: tailRowCount,
			onScrollPositionChange,
			onAtBottomChange,
			onNearTop: historyBackfill.loadEarlier,
			// The user's own Send for this tab: stop holding where they were reading.
			// The reading target, a remount restore still waiting for its row, and
			// the pause that restore would re-assert all go, synchronously, before
			// the commit that renders their new row - so neither that commit nor a
			// resize can scroll them back. A later scroll up records a new target.
			// (Refs declared below; this only runs from the event, after render.)
			onRevealRequested: () => {
				readingAnchorRef.current = null;
				pendingAnchorRestoreRef.current = null;
				anchorRestoredRef.current = false;
			},
		});

		// ============================================================================
		// Reading anchor: keep the MESSAGE the reader is on in place
		// ============================================================================
		// While the reader is up in history, distance-from-bottom is the wrong
		// invariant: a reply streaming onto the tail in the same commit as a
		// history prepend, a chunk of the idle window mounting above, or the
		// "Loading earlier messages..." row appearing or going away all move the
		// rows they are reading. So the first row on screen and its offset from
		// the viewport top are recorded as the reader's target whenever the reader
		// moves (or, if there is none yet, before a change we cause at the head),
		// and every commit that could move it puts it back, before paint. Raw ids
		// survive re-collapsing through
		// buildRenderedIdMap; when the anchored row was folded into a different
		// row (the newest prepended response merging into the top row), the new
		// content is OLDER and lands at that row's top, so its bottom edge is the
		// part that stayed put.
		const readingAnchorRef = useRef<ReadingAnchor | null>(null);
		const readingTabKeyRef = useRef(readingTabKey);
		readingTabKeyRef.current = readingTabKey;
		const recordReadingAnchor = useCallback(() => {
			const container = scrollContainerRef.current;
			const content = contentRef.current;
			if (!container || !content) return;
			const rows = transcriptRows(content);
			if (rows.length === 0) {
				readingAnchorRef.current = null;
				return;
			}
			const viewTop = container.getBoundingClientRect().top;
			// Rows are in document order, so their bottoms increase: binary search
			// for the first one whose bottom is still below the viewport top.
			let lo = 0;
			let hi = rows.length - 1;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (rows[mid].getBoundingClientRect().bottom > viewTop) hi = mid;
				else lo = mid + 1;
			}
			const rect = rows[lo].getBoundingClientRect();
			readingAnchorRef.current = {
				tabKey: readingTabKeyRef.current,
				rowId: rows[lo].getAttribute('data-log-id') ?? '',
				top: rect.top - viewTop,
				bottom: rect.bottom - viewTop,
			};
		}, []);
		// Before a change at the head: make sure there IS a target. An existing one
		// is left alone (see below).
		recordReadingAnchorRef.current = () => {
			const anchor = readingAnchorRef.current;
			if (!anchor || anchor.tabKey !== readingTabKeyRef.current) recordReadingAnchor();
		};

		// The anchor is the reader's TARGET, and only the reader moves it. A
		// correction lands only as precisely as the scroller's offset allows (a
		// device pixel), so it is never re-recorded from where a correction landed:
		// over the dozens of corrections a remount runs, those landing errors
		// compounded into a few physical pixels of creep on every return.
		// Measured from the row's own top, or its bottom when it was folded into
		// an older row (that row grew at its top).
		const measureReadingAnchor = useCallback(() => {
			const anchor = readingAnchorRef.current;
			const container = scrollContainerRef.current;
			const content = contentRef.current;
			if (!anchor || !container || !content) return null;
			// An anchor taken in another conversation says nothing about this one.
			if (anchor.tabKey !== readingTabKeyRef.current) return null;
			const rowId = renderedIdByLogId.get(anchor.rowId) ?? anchor.rowId;
			const row = transcriptRows(content).find((el) => el.getAttribute('data-log-id') === rowId);
			if (!row) return null;
			const viewTop = container.getBoundingClientRect().top;
			const rect = row.getBoundingClientRect();
			const delta =
				rowId === anchor.rowId
					? rect.top - viewTop - anchor.top
					: rect.bottom - viewTop - anchor.bottom;
			return { container, delta };
		}, [renderedIdByLogId]);
		const measureReadingAnchorRef = useRef(measureReadingAnchor);
		measureReadingAnchorRef.current = measureReadingAnchor;

		const handleTranscriptScroll = useCallback(() => {
			handleScroll();
			// The reader's row is still where the target puts it: this is the echo
			// of our own correction (or a scroll that changed nothing for them), so
			// the target stands. Anything that moved the row away - a wheel, a
			// scrollbar drag, a key, a search jump - is a new target.
			const measured = measureReadingAnchorRef.current();
			if (measured && Math.abs(measured.delta) < ANCHOR_HOLD_TOLERANCE_PX) return;
			recordReadingAnchor();
		}, [handleScroll, recordReadingAnchor]);

		const restoreReadingAnchor = useCallback((): boolean => {
			const measured = measureReadingAnchor();
			if (!measured) return false;
			const { container, delta } = measured;
			// Relative, so the correction acts on the real offset rather than on a
			// value read back through the scrollTop getter.
			if (delta !== 0) {
				if (typeof container.scrollBy === 'function') {
					container.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
				} else {
					container.scrollTop += delta;
				}
			}
			return true;
		}, [measureReadingAnchor]);

		// Every commit that can move rows above the reader: the window moving, rows
		// arriving or leaving, and the history status row toggling. Reading
		// history -> the anchor; following the tail -> bottom distance (the scroll
		// hook re-pins to the bottom on top of that). Gated on the hook's live ref,
		// not the `isAtBottom` render value: a reveal of the user's own send flips
		// the ref at once, and the commit that renders their new row can arrive
		// before the state does - restoring the old anchor there scrolled the view
		// straight back into history.
		useLayoutEffect(() => {
			if (!isAtBottomLatestRef.current && restoreReadingAnchor()) {
				backfillBottomDistanceRef.current = null;
				return;
			}
			restoreBackfillScroll();
			// Keyed on what moves rows, not on the callbacks: a scroll that only
			// changes `isAtBottom` must not re-apply an anchor it just recorded.
		}, [
			visibleLogs,
			logStartIndex,
			historyBackfill.isLoading,
			historyBackfill.error,
			historyBackfill.reachedStart,
		]);

		// Returning to a conversation left mid-history (anchorRestore above). The
		// window is revealed down to the saved row only - never the whole history
		// - and once that row is mounted it is put back at its saved offset and the
		// view is paused there, exactly as a scroll up to it would leave it.
		const pendingAnchorRestoreRef = useRef(anchorRestore);
		const anchorRestoredRef = useRef(false);
		useLayoutEffect(() => {
			// Consumed by this mount; the unmount below saves a fresh one.
			savedReadingAnchors.delete(readingTabKeyRef.current);
			const pending = pendingAnchorRestoreRef.current;
			if (pending && pending.rowIndex < logStartIndex) revealLogIndex(pending.rowIndex);
			// Mount only.
		}, []);
		useLayoutEffect(() => {
			const pending = pendingAnchorRestoreRef.current;
			if (!pending) return;
			readingAnchorRef.current = { ...pending.anchor, tabKey: readingTabKeyRef.current };
			// Not mounted yet: the reveal above lands in the next commit.
			if (!restoreReadingAnchor()) return;
			pendingAnchorRestoreRef.current = null;
			anchorRestoredRef.current = true;
			pauseForJump();
		}, [logStartIndex, visibleLogs, restoreReadingAnchor, pauseForJump]);
		// Again after the scroll hook's own mount effects: its tab-switch effect
		// marks a tab it has no read state for as being at the bottom, and it runs
		// after the layout effect above. Declared after the hook, so this runs last.
		useEffect(() => {
			if (!anchorRestoredRef.current) return;
			anchorRestoredRef.current = false;
			pauseForJump();
		}, [logStartIndex, visibleLogs, pauseForJump]);

		// Save where this conversation is being read for the next mount.
		useEffect(
			() => () => {
				const key = readingTabKeyRef.current;
				const anchor = readingAnchorRef.current;
				if (!isAtBottomLatestRef.current && anchor && anchor.tabKey === key) {
					savedReadingAnchors.set(key, anchor);
				} else {
					savedReadingAnchors.delete(key);
				}
			},
			[]
		);

		// ============================================================================
		// Older history when the transcript cannot scroll up to ask for it
		// ============================================================================
		// The scroll hook pages history in from a scroll event near the top, and
		// only when the transcript overflows. A tab restored from the persisted
		// 100 entries can collapse (folded tools, hidden reasoning) to less than
		// one screen on a large window: no scrollbar, scrollTop already 0, so no
		// scroll event ever fires and wheel, PageUp and Home all do nothing - the
		// rest of the conversation is unreachable. Two bounded ways in, both
		// through the same `loadEarlier` (one page per call, its own in-flight,
		// reached-start and account/host handling):
		//  - automatically, once per transcript LENGTH, while the fully mounted
		//    window does not fill the viewport. A load that adds rows changes the
		//    length and may ask again (still short); one that adds nothing, a
		//    failure, the start of the conversation, or a running turn stops it,
		//    so it never walks the whole file on its own;
		//  - on the user's own upward wheel or scroll key at scrollTop 0, which
		//    is the request the missing scroll event would have carried.
		const autoLoadLengthRef = useRef<number | null>(null);
		const tabIsBusy = activeTab?.state === 'busy';
		useEffect(() => {
			if (
				logStartIndex !== 0 ||
				filteredLogs.length === 0 ||
				tabIsBusy ||
				historyBackfill.isLoading ||
				historyBackfill.reachedStart ||
				historyBackfill.error ||
				autoLoadLengthRef.current === filteredLogs.length
			) {
				return;
			}
			const container = scrollContainerRef.current;
			// Not laid out (a hidden pane): nothing is known about overflow yet.
			if (!container || container.clientHeight <= 0) return;
			if (container.scrollHeight > container.clientHeight) return;
			autoLoadLengthRef.current = filteredLogs.length;
			historyBackfill.loadEarlier();
		});
		const requestEarlierAtTop = useCallback(() => {
			const container = scrollContainerRef.current;
			if (!container || container.scrollTop > 0 || logStartIndexRef.current !== 0) return;
			historyBackfill.loadEarlier();
		}, [historyBackfill]);
		const handleTranscriptWheel = useCallback(
			(event: React.WheelEvent) => {
				noteUserScrollInput(event);
				if (event.deltaY < 0) requestEarlierAtTop();
			},
			[noteUserScrollInput, requestEarlierAtTop]
		);
		const handleTranscriptKeyDown = useCallback(
			(event: React.KeyboardEvent) => {
				noteUserScrollInput(event);
				if (event.key === 'PageUp' || event.key === 'Home' || event.key === 'ArrowUp') {
					requestEarlierAtTop();
				}
			},
			[noteUserScrollInput, requestEarlierAtTop]
		);

		// Hold the reader's row in place when the layout moves with no scroll and
		// no commit - the scroll anchoring the browser would do, which is off
		// here. Every row is `content-visibility: auto`, so a row near the
		// viewport switches from its 120px estimate to its real height as it comes
		// into range, and while the reader is up in history the scroller has
		// `overflow-anchor: none`, so nothing compensates and no scroll event
		// fires. Left alone, that moved the reader with no input: a later commit
		// restored a stale offset, and after a remount (whose rows above are all
		// still estimates when it positions the reader) the real heights arriving
		// above pushed the view about a screen back into older history.
		// So the shift is corrected against the target, measured from the row's
		// own top (its own growth, and anything below it, never moves the reader).
		// Reacts to layout only, never to time; a user scroll sets a new target in
		// its scroll event first (scroll events run before resize observers in a
		// frame), so the correction always holds the position the user chose.
		const restoreReadingAnchorRef = useRef(restoreReadingAnchor);
		restoreReadingAnchorRef.current = restoreReadingAnchor;
		useEffect(() => {
			const content = contentRef.current;
			if (!content || typeof ResizeObserver === 'undefined') return;
			const observer = new ResizeObserver(() => {
				if (isAtBottomLatestRef.current || pendingAnchorRestoreRef.current) return;
				restoreReadingAnchorRef.current();
			});
			observer.observe(content);
			return () => observer.disconnect();
		}, []);

		useEffect(() => {
			if (!pendingLogJump) return;
			if (pendingLogJump.sessionId !== session.id) return;
			// Wait for the tab switch to land before hunting for the entry.
			if (!activeTab || pendingLogJump.tabId !== activeTab.id) return;

			const { logId } = pendingLogJump;
			const renderedId = renderedIdByLogId.get(logId) ?? logId;
			pendingJumpMatchIdRef.current = renderedId;
			cancelJumpRef.current?.();

			// The target may still be behind the progressive render window (#1342).
			// jumpToElement gives up after ~30 frames, which idle backfill can outlast
			// on a long transcript, so pull the entry in now instead of racing it.
			const targetIndex = filteredLogs.findIndex((l) => l.id === renderedId);
			if (targetIndex >= 0) revealLogIndex(targetIndex);

			jumpInFlightRef.current = true;
			const releaseJump = () => {
				jumpInFlightRef.current = false;
			};
			const cancel = jumpToElement(
				() =>
					Array.from(
						scrollContainerRef.current?.querySelectorAll<HTMLElement>('[data-log-id]') ?? []
					).find((el) => el.getAttribute('data-log-id') === renderedId),
				{
					color: theme.colors.accent,
					// Instant rather than smooth: an animated scroll is still running
					// when the next batch of rows renders, and whoever scrolls during
					// that window wins. Landing in one frame removes the race.
					behavior: 'auto',
					stabilizeFrames: JUMP_STABILIZE_FRAMES,
					onFound: () => {
						pauseForJump();
						setTimeout(releaseJump, JUMP_SETTLE_MS);
					},
					onTimeout: releaseJump,
				}
			);
			// Releasing on cancel matters: a jump abandoned before it landed would
			// otherwise leave auto-scroll suppressed for the rest of the session.
			cancelJumpRef.current = () => {
				releaseJump();
				cancel();
			};
			// Consume it: the jump is a one-shot request, not persistent state.
			useUIStore.getState().clearPendingLogJump(logId);
		}, [
			pendingLogJump,
			session.id,
			activeTab,
			renderedIdByLogId,
			theme.colors.accent,
			jumpInFlightRef,
			pauseForJump,
			filteredLogs,
			revealLogIndex,
		]);

		// Helper to find last user command for echo stripping in terminal mode
		const getLastUserCommand = useCallback(
			(index: number): string | undefined => {
				for (let i = index - 1; i >= 0; i--) {
					if (filteredLogs[i]?.source === 'user') {
						return filteredLogs[i].text;
					}
				}
				return undefined;
			},
			[filteredLogs]
		);

		// TerminalOutput only handles AI mode; terminal mode renders via TerminalView
		const isTerminal = false;
		const isAIMode = true;

		// Memoized prose styles - applied once at container level instead of per-log-item
		// IMPORTANT: Scoped to .terminal-output to avoid CSS conflicts with other prose containers (e.g., AutoRun panel)
		const proseStyles = useMemo(
			() =>
				generateTerminalProseStyles(theme, '.terminal-output') +
				(readingColumn ? feedProseStyles(theme) : ''),
			[theme, readingColumn]
		);

		return (
			<div
				ref={terminalOutputRef}
				tabIndex={0}
				role="region"
				aria-label={t('workflows.terminalOutput.region')}
				className="terminal-output flex-1 flex flex-col overflow-hidden transition-colors outline-none relative"
				style={{
					backgroundColor: theme.colors.bgMain,
				}}
				onKeyDown={(e) => {
					// Cmd+F to open search
					if (e.key === 'f' && (e.metaKey || e.ctrlKey) && !outputSearchOpen) {
						e.preventDefault();
						setOutputSearchOpen(true);
						return;
					}
					// Escape handling removed - delegated to layer stack for search
					// When search is not open, Escape should still focus back to input
					if (e.key === 'Escape' && !outputSearchOpen) {
						e.preventDefault();
						e.stopPropagation();
						// Focus back to text input
						inputRef.current?.focus();
						setActiveFocus('main');
						return;
					}
					// Shift+Arrow: jump message-by-message. Skip when the user is typing in
					// an input/textarea inside the region - those handle their own
					// arrow-key cursor movement.
					if (
						(e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
						e.shiftKey &&
						!e.metaKey &&
						!e.ctrlKey &&
						!e.altKey &&
						!isTextInputTarget(e.target)
					) {
						const container = scrollContainerRef.current;
						if (container) {
							e.preventDefault();
							jumpToMessageEdge(container, '[data-log-index]', e.key === 'ArrowUp' ? 'up' : 'down');
						}
						return;
					}
					// Plain Arrow keys: nudge scroll by ~100px (instant, no smooth behavior).
					if (
						e.key === 'ArrowUp' &&
						!e.shiftKey &&
						!e.metaKey &&
						!e.ctrlKey &&
						!e.altKey &&
						!isTextInputTarget(e.target)
					) {
						e.preventDefault();
						scrollContainerRef.current?.scrollBy({ top: -100 });
						return;
					}
					if (
						e.key === 'ArrowDown' &&
						!e.shiftKey &&
						!e.metaKey &&
						!e.ctrlKey &&
						!e.altKey &&
						!isTextInputTarget(e.target)
					) {
						e.preventDefault();
						scrollContainerRef.current?.scrollBy({ top: 100 });
						return;
					}
					// Option/Alt+Up: page up
					if (e.key === 'ArrowUp' && e.altKey && !e.metaKey && !e.ctrlKey) {
						e.preventDefault();
						const height = terminalOutputRef.current?.clientHeight || 400;
						scrollContainerRef.current?.scrollBy({ top: -height });
						return;
					}
					// Option/Alt+Down: page down
					if (e.key === 'ArrowDown' && e.altKey && !e.metaKey && !e.ctrlKey) {
						e.preventDefault();
						const height = terminalOutputRef.current?.clientHeight || 400;
						scrollContainerRef.current?.scrollBy({ top: height });
						return;
					}
					// Cmd+Up to jump to top
					if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey) && !e.altKey) {
						e.preventDefault();
						scrollContainerRef.current?.scrollTo({ top: 0 });
						return;
					}
					// Cmd+Down to jump to bottom
					if (e.key === 'ArrowDown' && (e.metaKey || e.ctrlKey) && !e.altKey) {
						e.preventDefault();
						const container = scrollContainerRef.current;
						if (container) {
							container.scrollTo({ top: container.scrollHeight });
						}
						return;
					}
				}}
			>
				{transcriptDeferred && (
					<div
						className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-4 text-sm"
						style={{ backgroundColor: theme.colors.bgMain, color: theme.colors.textDim }}
					>
						<Spinner size={24} ariaLabel="Loading conversation" />
						<span>Loading conversation...</span>
						<button
							type="button"
							className="rounded-lg px-3 py-2"
							style={{ color: theme.colors.accent }}
							onClick={requestWebBridgeReconcile}
						>
							Retry
						</button>
					</div>
				)}
				{/* CSS for Custom Highlight API - paints matches without mutating DOM */}
				<style>{`
					::highlight(terminal-search-all) {
						background-color: ${theme.colors.warning};
						color: ${theme.mode === 'light' ? '#fff' : '#000'};
					}
					::highlight(terminal-search-current) {
						background-color: ${theme.colors.accent};
						color: #fff;
					}
				`}</style>
				{/* Output Search */}
				{outputSearchOpen && (
					<OutputSearchBar
						theme={theme}
						outputSearchQuery={outputSearchQuery}
						outputSearchRegex={outputSearchRegex}
						regexError={regexError}
						currentMatchIndex={currentMatchIndex}
						totalMatches={totalMatches}
						setOutputSearchQuery={setOutputSearchQuery}
						setOutputSearchRegex={setOutputSearchRegex}
						goToNextMatch={goToNextMatch}
						goToPrevMatch={goToPrevMatch}
						onClose={closeSearch}
					/>
				)}
				{/* Prose styles for markdown rendering - injected once at container level for performance */}
				<style>{proseStyles}</style>
				{/* Native scroll log list */}
				{/* overflow-anchor: disabled in AI mode when auto-scroll is off to prevent
				    browser from automatically keeping viewport pinned to bottom on new content */}
				<div
					ref={scrollContainerRef}
					className="flex-1 overflow-y-auto scrollbar-thin"
					style={{
						overflowAnchor: session.inputMode === 'ai' && autoScrollPaused ? 'none' : undefined,
						// The AI Chat surface's own size. Set here and inherited by every
						// log row rather than threaded as a prop: the transcript is DOM,
						// so the CSS variable reaches the whole subtree - including the
						// markdown, tool cards, and code fences nested several
						// components deep - without touching any of them. The family
						// still arrives as a prop because individual rows override it.
						fontSize: 'var(--maestro-size-chat, inherit)',
					}}
					onScroll={handleTranscriptScroll}
					onContextMenu={handleTranscriptContextMenu}
					// The input events that prove a scroll is the user's. `scroll` itself
					// cannot: this component writes `scrollTop` on every frame of a restore
					// and on every mutation while following the tail, and each of those
					// writes fires an indistinguishable `scroll` event.
					onWheel={handleTranscriptWheel}
					onTouchMove={noteUserScrollInput}
					onPointerDown={noteUserScrollInput}
					onKeyDown={handleTranscriptKeyDown}
				>
					{/* Content wrapper: unstyled block so its height tracks the scrollable
					    content exactly, giving the scroll hook's ResizeObserver something
					    that grows when late content settles. */}
					{/* In the conversation-centred layout the transcript is read like a
					    document, so its column is capped and centred: a wide window
					    otherwise stretches every line past a comfortable reading length.
					    Width only - the wrapper's height still tracks the content. */}
					<div
						ref={contentRef}
						className={readingColumn ? 'mx-auto w-full' : undefined}
						style={readingColumn ? { maxWidth: READING_COLUMN_MAX_WIDTH } : undefined}
						data-reading-column={readingColumn || undefined}
					>
						{/* Older-history status row (issue #1407). Only meaningful once the
						    idle render window has reached the head of the list - above that
						    point there is still local history left to mount, so "beginning of
						    conversation" would be a lie. Nothing renders until the user has
						    actually scrolled up far enough to trigger a read. */}
						{logStartIndex === 0 && filteredLogs.length > 0 && (
							<>
								{historyBackfill.isLoading && (
									<div
										className="flex items-center justify-center gap-2 py-3 text-xs"
										style={{ color: theme.colors.textDim }}
									>
										<Loader2 className="w-3.5 h-3.5 animate-spin" />
										{t('workflows.transcript.loadingEarlier')}
									</div>
								)}
								{!historyBackfill.isLoading && historyBackfill.error && (
									<div
										className="flex items-center justify-center gap-2 py-3 text-xs"
										style={{ color: theme.colors.textDim }}
										role="alert"
									>
										{t('workflows.transcript.earlierLoadFailed')}
										<button
											onClick={historyBackfill.loadEarlier}
											className="underline hover:opacity-80 transition-opacity"
											style={{ color: theme.colors.textMain }}
										>
											{t('workflows.conversations.retry')}
										</button>
									</div>
								)}
								{!historyBackfill.isLoading &&
									!historyBackfill.error &&
									historyBackfill.reachedStart && (
										<div
											className="flex items-center justify-center py-3 text-xs"
											style={{ color: theme.colors.textDim }}
										>
											{t('workflows.transcript.conversationStart')}
										</div>
									)}
							</>
						)}
						{/* Log entries */}
						{visibleLogs.map((log, visibleIndex) => {
							// Absolute index into filteredLogs - sibling lookups (echo stripping)
							// and jump-to-message targeting must not see the window offset.
							const index = logStartIndex + visibleIndex;
							const renderRow = (entry: LogEntry, nested: boolean) => (
								<LogItem
									key={entry.id}
									log={entry}
									index={index}
									isTerminal={isTerminal}
									isAIMode={isAIMode}
									theme={theme}
									fontFamily={fontFamily}
									maxOutputLines={maxOutputLines}
									lastUserCommand={
										isTerminal && entry.source !== 'user' ? getLastUserCommand(index) : undefined
									}
									isExpanded={expandedLogs.has(entry.id)}
									onToggleExpanded={toggleExpanded}
									subagentLogs={childrenByParentId.get(entry.id)}
									toolRun={toolRunByHostId.get(entry.id)}
									localFilterQuery={localFilters.get(entry.id) || ''}
									filterMode={filterModes.get(entry.id) || { mode: 'include', regex: false }}
									activeLocalFilter={activeLocalFilter}
									onToggleLocalFilter={toggleLocalFilter}
									onSetLocalFilterQuery={setLocalFilterQuery}
									onSetFilterMode={setFilterModeForLog}
									onClearLocalFilter={clearLocalFilter}
									deleteConfirmLogId={deleteConfirmLogId}
									onDeleteLog={onDeleteLog}
									onSetDeleteConfirmLogId={setDeleteConfirmLogId}
									scrollContainerRef={scrollContainerRef}
									setLightboxImage={setLightboxImage}
									copyToClipboard={copyToClipboard}
									ansiConverter={ansiConverter}
									markdownEditMode={markdownEditMode}
									onToggleMarkdownEditMode={toggleMarkdownEditMode}
									onReplayMessage={onReplayMessage}
									onForkConversation={onForkConversation}
									sessionId={session.id}
									onSessionRecover={onSessionRecover}
									isRecoveringSession={isRecoveringSession}
									sessionRecoveryError={sessionRecoveryError}
									fileTree={fileTree}
									cwd={cwd}
									projectRoot={projectRoot}
									onFileClick={onFileClick}
									sshRemoteId={
										session.sessionSshRemoteConfig?.enabled
											? (session.sessionSshRemoteConfig?.remoteId ?? undefined)
											: undefined
									}
									onShowErrorDetails={onShowErrorDetails}
									onSaveToFile={handleSaveToFile}
									ghCliAvailable={ghCliAvailable}
									onPublishGist={onPublishMessageGist}
									publishedGistUrl={publishedGists[entry.id]?.gistUrl}
									bionifyReadingMode={globalBionifyReadingMode}
									bionifyIntensity={globalBionifyIntensity}
									bionifyAlgorithm={globalBionifyAlgorithm}
									userMessageAlignment={userMessageAlignment}
									responseDurationMs={responseDurationByLogId.get(entry.id)}
									// Codex's assistant directives are Codex's own emitting
									// convention, so the same string from another provider is a
									// message about the format. The tab comes from the resolved
									// `activeTab` rather than `session.activeTabId`, which can
									// still name a hidden consult tab - the transcript below is
									// drawing `activeTab`'s logs, so that is the conversation a
									// chip in them belongs to.
									codexDirectives={session.toolType === 'codex'}
									codexFollowupTabId={activeTab?.id}
									isClaudeCode={session.toolType === 'claude-code'}
									isAdaptiveMode={getClaudeTokenMode(session) === 'dynamic'}
									showProviderModePill={showProviderModePill}
									feedLayout={feedLayout}
									isLatestReply={feedFacts?.latestReplyId === entry.id}
									turnSettingChange={feedFacts?.changes.get(entry.id)}
									secondaryTextColor={feedLayout ? feedSecondaryColor : undefined}
									feedNested={nested}
								/>
							);
							const activity = turnActivityByHostId.get(log.id);
							if (!activity) return renderRow(log, false);
							// A finished turn's work, folded behind one row (foldTurnActivity).
							const foldKey = `turn:${log.id}`;
							const open = expandedLogs.has(foldKey);
							return (
								<TurnActivityFold
									key={foldKey}
									hostId={log.id}
									index={index}
									activity={activity}
									open={open}
									onToggle={() => toggleExpanded(foldKey)}
									theme={theme}
									secondaryTextColor={feedSecondaryColor}
								>
									{open && activity.entries.map((entry) => renderRow(entry, true))}
								</TurnActivityFold>
							);
						})}

						{/* Queued items section - filtered to active tab */}
						{session.executionQueue && session.executionQueue.length > 0 && (
							<QueuedItemsList
								executionQueue={session.executionQueue}
								theme={theme}
								onRemoveQueuedItem={onRemoveQueuedItem}
								onTogglePauseQueuedItem={onTogglePauseQueuedItem}
								onEditQueuedItem={onEditQueuedItem}
								onReorderItems={
									onReorderQueuedItem
										? (fromIndex, toIndex) =>
												onReorderQueuedItem(fromIndex, toIndex, activeTabId || undefined)
										: undefined
								}
								onForceSendQueuedItem={onForceSendQueuedItem}
								forcedParallelEnabled={forcedParallelEnabled}
								getForceSendContext={getForceSendContext}
								shortcutEnabled={forceSendShortcutEnabled}
								activeTabId={activeTabId || undefined}
								onOpenLightbox={setLightboxImage}
							/>
						)}
					</div>

					{/* End ref for scrolling - always rendered so the jump works even when busy.
					    LOAD-BEARING: this marker MUST stay a direct child of the scroll container
					    (the overflow-y-auto element above), NOT nested inside the contentRef wrapper.
					    useMainKeyboardHandler's Cmd+Shift+J "Jump to Bottom" resolves the scroll target
					    via logsEndRef.current.parentElement, so if you wrap this marker in another
					    subtree parentElement lands on an unscrollable element and it silently no-ops. */}
					<div ref={logsEndRef} />
				</div>

				{/* Scroll-to-bottom / auto-scroll resume (AI mode only) */}
				{session.inputMode === 'ai' && filteredLogs.length > 0 && !isAtBottom && (
					<ScrollToBottomButton
						theme={theme}
						userMessageAlignment={userMessageAlignment}
						isAutoScrollActive={isAutoScrollActive}
						hasNewMessages={hasNewMessages}
						newMessageCount={newMessageCount}
						onClick={scrollToBottomAndResume}
					/>
				)}

				{/* Copy flash now rendered globally by <CenterFlash /> */}

				{selectionMenu &&
					createPortal(
						<TerminalSelectionContextMenu
							menu={selectionMenu}
							theme={theme}
							onDismiss={closeSelectionMenu}
							onQuote={handleQuoteSelection}
							onCopy={copyToClipboard}
						/>,
						document.body
					)}

				{/* Save Markdown Modal */}
				{saveModalContent !== null && (
					<SaveMarkdownModal
						theme={theme}
						content={saveModalContent}
						onClose={() => setSaveModalContent(null)}
						defaultFolder={cwd || session.cwd || ''}
						isRemoteSession={
							session.sessionSshRemoteConfig?.enabled && !!session.sessionSshRemoteConfig?.remoteId
						}
						sshRemoteId={
							session.sessionSshRemoteConfig?.enabled
								? (session.sessionSshRemoteConfig?.remoteId ?? undefined)
								: undefined
						}
						onFileSaved={onFileSaved}
						onOpenInTab={onOpenInTab}
					/>
				)}
			</div>
		);
	})
);

TerminalOutput.displayName = 'TerminalOutput';
