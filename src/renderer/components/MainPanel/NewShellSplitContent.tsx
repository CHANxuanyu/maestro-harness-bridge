import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { X } from 'lucide-react';
import {
	NEW_SHELL_SPLIT_MIN_CONTENT_WIDTH,
	NEW_SHELL_SPLIT_MIN_WIDTH,
	type SplitConversationRef,
} from '../../../shared/newShellSplit';
import { useT } from '../../i18n';
import { useWindowContextOptional } from '../../contexts/WindowContext';
import { useAgentCapabilities } from '../../hooks/agent/useAgentCapabilities';
import {
	useAgentModelEffortOptions,
	resolveModelEffort,
} from '../../hooks/agent/useAgentModelEffortOptions';
import { useContextWindow } from '../../hooks/mainPanel/useContextWindow';
import {
	focusSplitConversation,
	splitConversation,
	unsplitConversation,
} from '../../services/newShellSplit';
import { notifyCenterFlash } from '../../stores/centerFlashStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTabStore } from '../../stores/tabStore';
import { conversationDisplayTitle } from '../../utils/conversationTitle';
import { aiTabFocusFields } from '../../utils/tabFocusFields';
import type { Session } from '../../types';
import { MainPanelContent, type MainPanelContentProps } from './MainPanelContent';
import { SplitDivider } from './TiledLayout';

function reportSplitError(error: unknown) {
	notifyCenterFlash({
		color: 'yellow',
		message: error instanceof Error ? error.message : String(error),
	});
}

/** Only the focused pane owns App's refs and transient completion popovers. */
function ConversationPane({
	owner,
	target,
	keep,
	focused,
	content,
}: {
	owner: Session;
	target: SplitConversationRef;
	keep: SplitConversationRef;
	focused: boolean;
	content: MainPanelContentProps;
}) {
	const t = useT();
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const logsEndRef = useRef<HTMLDivElement>(null);
	const terminalOutputRef = useRef<HTMLDivElement>(null);
	const session = useMemo(
		() => ({ ...owner, ...aiTabFocusFields(target.tabId) }),
		[owner, target.tabId]
	);
	const tab = owner.aiTabs.find((item) => item.id === target.tabId)!;
	const { hasCapability } = useAgentCapabilities(owner.toolType);
	const options = useAgentModelEffortOptions(owner.toolType, owner.customEnvVars);
	const { model, effort } = resolveModelEffort(tab, owner, options);
	const { activeTabContextUsage } = useContextWindow(session, tab);
	const focus = () => {
		// Capture precedes child clicks, paste and keyboard handlers. Flush the
		// existing draft handover and App callbacks before they read the active tab.
		if (!focused) flushSync(() => focusSplitConversation(target));
	};
	return (
		<div
			className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden"
			data-testid="new-shell-split-pane"
			data-tab-id={target.tabId}
			data-focused={focused}
			onPointerDownCapture={focus}
			onFocusCapture={focus}
			onClickCapture={focus}
			onDropCapture={focus}
		>
			<div
				className="flex items-center gap-2 h-9 px-3 shrink-0 border-b"
				style={{ borderColor: content.theme.colors.border, color: content.theme.colors.textMain }}
			>
				<span
					className="w-1.5 h-1.5 rounded-full shrink-0"
					aria-hidden
					style={{
						backgroundColor: focused ? content.theme.colors.accent : content.theme.colors.border,
					}}
				/>
				<span className="text-xs truncate flex-1">
					{conversationDisplayTitle(tab) ?? t('workflows.conversations.newConversation')}
				</span>
				<button
					type="button"
					className="p-1 rounded hover:bg-white/10 shrink-0"
					aria-label={t('workflows.split.closePane')}
					title={t('workflows.split.closePane')}
					onClick={() => void unsplitConversation(keep).catch(reportSplitError)}
				>
					<X size={14} />
				</button>
			</div>
			<MainPanelContent
				{...content}
				activeSession={session}
				activeTab={tab}
				activeFileTabId={null}
				activeBrowserTabId={null}
				focusedPane={focused}
				composerTargetTabId={target.tabId}
				inputRef={focused ? content.inputRef : inputRef}
				logsEndRef={focused ? content.logsEndRef : logsEndRef}
				terminalOutputRef={focused ? content.terminalOutputRef : terminalOutputRef}
				handleInputFocus={() => focusSplitConversation(target)}
				stagedImages={tab.stagedImages}
				commandHistoryOpen={focused && content.commandHistoryOpen}
				slashCommandOpen={focused && content.slashCommandOpen}
				tabCompletionOpen={focused && content.tabCompletionOpen}
				atMentionOpen={focused && content.atMentionOpen}
				isCurrentSessionAutoMode={focused && content.isCurrentSessionAutoMode}
				currentSessionBatchState={focused ? content.currentSessionBatchState : null}
				isSummarizing={focused && content.isSummarizing}
				isMerging={focused && content.isMerging}
				isRecoveringSession={focused && content.isRecoveringSession}
				sessionRecoveryError={focused ? content.sessionRecoveryError : null}
				fileTree={owner.fileTree}
				onScrollPositionChange={(value) =>
					useTabStore.getState().setAiTabScrollTop(target.tabId, value)
				}
				onAtBottomChange={(value) => useTabStore.getState().setAiTabAtBottom(target.tabId, value)}
				hasCapability={hasCapability}
				activeTabContextUsage={activeTabContextUsage}
				currentModel={model}
				currentEffort={effort}
				availableModels={options.models}
				availableEfforts={options.efforts}
				onModelChange={(value) =>
					useTabStore.getState().setTabModel(target.tabId, value || undefined)
				}
				onEffortChange={(value) =>
					useTabStore.getState().setTabEffort(target.tabId, value || undefined)
				}
			/>
		</div>
	);
}

/** Cross-provider layout references existing tabs; classic tiling stays untouched. */
export function NewShellSplitContent(props: MainPanelContentProps) {
	const enabled = useSettingsStore((state) => state.newShell);
	return enabled ? <SplitContent {...props} /> : <MainPanelContent {...props} />;
}

function SplitContent(props: MainPanelContentProps) {
	const t = useT();
	const split = useSettingsStore((state) => state.newShellSplit);
	const sessions = useSessionStore((state) => state.sessions);
	const sessionsReadOk = useSessionStore((state) => state.sessionsReadOk);
	const windowContext = useWindowContextOptional();
	const container = useRef<HTMLDivElement>(null);
	const leftElement = useRef<HTMLDivElement>(null);
	const rightElement = useRef<HTMLDivElement>(null);
	const dragRatio = useRef<number | null>(null);
	const [narrow, setNarrow] = useState(window.innerWidth < NEW_SHELL_SPLIT_MIN_WIDTH);
	useEffect(() => {
		const measure = () => {
			const width = container.current?.getBoundingClientRect().width ?? 0;
			setNarrow(
				window.innerWidth < NEW_SHELL_SPLIT_MIN_WIDTH ||
					(width > 0 && width < NEW_SHELL_SPLIT_MIN_CONTENT_WIDTH)
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		if (container.current) observer.observe(container.current);
		window.addEventListener('resize', measure);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', measure);
		};
	}, []);
	const left =
		split &&
		sessions.find(
			(s) => s.id === split.left.sessionId && s.aiTabs.some((tab) => tab.id === split.left.tabId)
		);
	const right =
		split &&
		sessions.find(
			(s) => s.id === split.right.sessionId && s.aiTabs.some((tab) => tab.id === split.right.tabId)
		);
	const ownsPair =
		!!split &&
		(!windowContext ||
			(windowContext.ownsSession(split.left.sessionId) &&
				windowContext.ownsSession(split.right.sessionId)));
	const matches = (target: SplitConversationRef) =>
		props.activeSession.id === target.sessionId && props.activeTab?.id === target.tabId;
	const activePair = !!split && (matches(split.left) || matches(split.right));
	useEffect(() => {
		// Do not erase a saved pair while sessions or window ownership hydrate.
		if (!split || !sessionsReadOk || !ownsPair || (left && right)) return;
		void unsplitConversation(left ? split.left : right ? split.right : undefined).catch(
			reportSplitError
		);
	}, [split, sessionsReadOk, ownsPair, left, right]);
	const visible = split && left && right && ownsPair && activePair && !narrow;
	const paintRatio = (ratio: number) => {
		if (leftElement.current) leftElement.current.style.flexGrow = String(ratio);
		if (rightElement.current) rightElement.current.style.flexGrow = String(1 - ratio);
	};
	return (
		<div
			ref={container}
			data-testid="new-shell-split-layout"
			className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden"
		>
			{split && activePair && ownsPair && narrow && (
				<div
					role="status"
					data-testid="new-shell-split-notice"
					className="px-3 py-2 text-xs"
					style={{ color: props.theme.colors.textDim }}
				>
					{t('workflows.split.narrow')}
				</div>
			)}
			{visible ? (
				<div className="flex flex-row flex-1 min-h-0 min-w-0">
					<div
						ref={leftElement}
						className="flex min-w-0 min-h-0"
						style={{ flexBasis: 0, flexGrow: split.ratio }}
					>
						<ConversationPane
							owner={left}
							target={split.left}
							keep={split.right}
							focused={matches(split.left)}
							content={props}
						/>
					</div>
					<SplitDivider
						direction="row"
						theme={props.theme}
						separatorProps={{
							role: 'separator',
							tabIndex: 0,
							'aria-label': t('workflows.split.resize'),
							'aria-orientation': 'vertical',
							'aria-valuenow': Math.round(split.ratio * 100),
							'aria-valuemin': 20,
							'aria-valuemax': 80,
							'data-testid': 'new-shell-split-divider',
							onKeyDown: (event) => {
								if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
								event.preventDefault();
								void splitConversation(
									split.right.sessionId,
									split.right.tabId,
									Math.max(
										0.2,
										Math.min(0.8, split.ratio + (event.key === 'ArrowLeft' ? -0.05 : 0.05))
									)
								).catch(reportSplitError);
							},
						}}
						onDrag={(delta) => {
							const width = (container.current?.getBoundingClientRect().width ?? 0) - 4;
							if (width <= 0) return;
							dragRatio.current = Math.max(0.2, Math.min(0.8, split.ratio + delta / width));
							paintRatio(dragRatio.current);
						}}
						onCommit={() => {
							const ratio = dragRatio.current;
							dragRatio.current = null;
							if (ratio !== null)
								void splitConversation(split.right.sessionId, split.right.tabId, ratio).catch(
									(error) => {
										paintRatio(split.ratio);
										reportSplitError(error);
									}
								);
						}}
						onCancel={() => {
							dragRatio.current = null;
							paintRatio(split.ratio);
						}}
					/>
					<div
						ref={rightElement}
						className="flex min-w-0 min-h-0"
						style={{ flexBasis: 0, flexGrow: 1 - split.ratio }}
					>
						<ConversationPane
							owner={right}
							target={split.right}
							keep={split.left}
							focused={matches(split.right)}
							content={props}
						/>
					</div>
				</div>
			) : (
				<MainPanelContent {...props} />
			)}
		</div>
	);
}
