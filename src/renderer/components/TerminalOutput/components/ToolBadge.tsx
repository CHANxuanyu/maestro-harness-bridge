import React from 'react';
import type { LogEntry, Theme } from '../../../types';
import { summarizeToolInput, summarizeToolOutput } from '../utils/toolSummaries';
import { AgentTaskListCard } from '../../AgentTaskListCard';
import { extractAgentTaskList } from '../../../utils/agentTaskList';
import { ToolCallDetails } from './ToolCallDetails';
import { useT } from '../../../i18n';
import { readableTextOn } from '../../../../shared/colorContrast';

export type ToolStatusKind = 'running' | 'completed' | 'error' | 'canceled';

/** Map a stored tool status onto the four states the transcript draws. */
export function toolStatusKind(status: string | undefined): ToolStatusKind | undefined {
	if (status === 'running') return 'running';
	if (status === 'completed') return 'completed';
	if (status === 'failed' || status === 'error') return 'error';
	if (status === 'canceled') return 'canceled';
	return undefined;
}

/**
 * A tool state as glyph AND word, for the conversation feed: color alone must
 * not carry it. The status color is passed through `readableTextOn` against the
 * page background, since a theme's warning or success hue is chosen as an
 * accent, not as text. Completed stays a quiet check with an accessible name -
 * it is the expected outcome and repeating "Done" on every call is noise.
 */
export function ToolStatusLabel({
	theme,
	kind,
	quiet = false,
}: {
	theme: Theme;
	kind: ToolStatusKind;
	/** Glyph only (a call inside an unfolded run whose row already says it). */
	quiet?: boolean;
}) {
	const t = useT();
	const background = theme.colors.bgMain;
	const color =
		kind === 'running'
			? readableTextOn(theme.colors.warning, [background])
			: kind === 'completed'
				? readableTextOn(theme.colors.success, [background])
				: kind === 'error'
					? readableTextOn(theme.colors.error, [background])
					: theme.colors.textMain;
	const word =
		kind === 'running'
			? t('workflows.transcript.toolRunning')
			: kind === 'completed'
				? t('workflows.transcript.toolCompleted')
				: kind === 'error'
					? t('workflows.transcript.toolFailed')
					: t('workflows.transcript.toolStopped');
	const glyph =
		kind === 'running' ? '●' : kind === 'completed' ? '✓' : kind === 'error' ? '!' : '×';
	const showWord = !quiet && kind !== 'completed';
	return (
		<span
			// nowrap: a status is one unit. Without it a CJK word ("运行中") breaks
			// between characters and stacks vertically when its row is narrow.
			className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap font-sans"
			style={{ color }}
			data-tool-status={kind}
			{...(kind === 'running'
				? { role: 'status' }
				: showWord
					? {}
					: {
							role: 'img',
							'aria-label': kind === 'canceled' ? t('workflows.transcript.toolCanceled') : word,
						})}
			title={kind === 'canceled' ? t('workflows.transcript.toolCanceled') : word}
		>
			<span aria-hidden className={kind === 'running' ? 'animate-pulse' : undefined}>
				{glyph}
			</span>
			{showWord ? (
				<span>{word}</span>
			) : kind === 'running' ? (
				<span className="sr-only">{word}</span>
			) : null}
		</span>
	);
}

/**
 * The compact tool-execution badge: name pill, status glyph, input summary and
 * (once finished) an output preview.
 *
 * Extracted from LogItem so the same markup renders a top-level tool entry AND
 * the subagent tool entries nested under a Task badge - there is exactly one
 * tool renderer.
 */
export const ToolBadge = React.memo(function ToolBadge({
	log,
	theme,
	part = 'all',
	feedLayout = false,
	secondaryTextColor,
}: {
	log: LogEntry;
	theme: Theme;
	/**
	 * Conversation feed: status as glyph plus word, and the summary in the
	 * readable secondary color instead of half-opacity body text.
	 */
	feedLayout?: boolean;
	secondaryTextColor?: string;
	/**
	 * Which half to draw. `header` is the name, status and one-line summary;
	 * `details` is the full input, checklist and result. A tool call read back
	 * from a transcript draws its header inside a fold toggle and its details
	 * only once unfolded, outside the button so the text stays selectable.
	 */
	part?: 'all' | 'header' | 'details';
}) {
	const t = useT();
	// The unfolded card shows the whole stored input and result, not the
	// eight-line preview the inline badge uses.
	if (part === 'details') return <ToolCallDetails log={log} theme={theme} />;
	const feedStatus = feedLayout ? toolStatusKind(log.metadata?.toolState?.status) : undefined;
	const showDetails = part === 'all';
	// Extract tool input details for display
	const toolInput = log.metadata?.toolState?.input;
	// Checklist-shaped payloads (Claude Code/OpenCode TodoWrite, Codex update_plan)
	// get the richer inline card instead of the generic key/value summary.
	const taskList = extractAgentTaskList(toolInput);
	const toolSummary =
		!taskList && toolInput !== undefined && toolInput !== null
			? summarizeToolInput(toolInput)
			: null;
	// Show the tool result once it has finished. Without this the
	// compact tool log drops the output entirely (e.g. MCP calls
	// like squash_repos that take no args render as a bare name).
	const toolStatus = log.metadata?.toolState?.status;
	// A call read back from a transcript may carry its result with no status
	// (the provider recorded none); only a call still running hides it.
	const outputSummary =
		toolStatus === 'completed' ||
		toolStatus === 'failed' ||
		toolStatus === 'error' ||
		toolStatus === 'canceled' ||
		(toolStatus === undefined && !!log.nativeTranscript)
			? summarizeToolOutput(log.metadata?.toolState?.output)
			: null;

	// The folded header carries the one-line summary: the description, or else
	// the first line of the input summary (a command, a path) so the row says
	// what ran without unfolding it.
	const headerSummary =
		toolSummary?.description ||
		(part === 'header' ? toolSummary?.detail?.split('\n')[0]?.trim() || undefined : undefined);

	return (
		<>
			<div className="flex items-start gap-2 min-w-0">
				<span
					className="px-1.5 py-0.5 rounded shrink-0"
					style={{
						backgroundColor: `${theme.colors.accent}30`,
						color: theme.colors.accent,
					}}
				>
					{log.text}
				</span>
				{feedStatus && (
					// shrink-0 here too: this wrapper is the header row's flex item, and
					// a shrinkable wrapper squeezed the status to one character wide.
					// The summary after it is what truncates.
					<span className="shrink-0 pt-0.5" data-tool-status-slot="">
						<ToolStatusLabel theme={theme} kind={feedStatus} />
					</span>
				)}
				{!feedLayout && toolStatus === 'running' && (
					<span className="animate-pulse shrink-0 pt-0.5" style={{ color: theme.colors.warning }}>
						●
					</span>
				)}
				{!feedLayout && toolStatus === 'completed' && (
					<span className="shrink-0 pt-0.5" style={{ color: theme.colors.success }}>
						✓
					</span>
				)}
				{!feedLayout && (toolStatus === 'failed' || toolStatus === 'error') && (
					<span className="shrink-0 pt-0.5" style={{ color: theme.colors.error }}>
						!
					</span>
				)}
				{/* Stopped while running: neither busy nor a success. */}
				{!feedLayout && toolStatus === 'canceled' && (
					<span
						className="shrink-0 pt-0.5"
						style={{ color: theme.colors.textDim }}
						data-tool-status="canceled"
						role="img"
						aria-label={t('workflows.transcript.toolCanceled')}
						title={t('workflows.transcript.toolCanceled')}
					>
						×
					</span>
				)}
				{headerSummary && (
					<span
						className={`${feedLayout ? '' : 'opacity-50 '}${part === 'header' ? 'truncate min-w-0' : 'break-words'}`}
						style={{
							color: feedLayout
								? (secondaryTextColor ?? theme.colors.textMain)
								: theme.colors.textMain,
						}}
					>
						{headerSummary}
					</span>
				)}
			</div>
			{showDetails && (
				<>
					{taskList && <AgentTaskListCard theme={theme} taskList={taskList} />}
					{toolSummary?.detail && (
						<div
							className="mt-1 ml-1 pl-2 opacity-70 break-words whitespace-pre-wrap border-l"
							style={{
								color: theme.colors.textMain,
								borderColor: `${theme.colors.accent}40`,
							}}
						>
							{toolSummary.detail}
						</div>
					)}
					{outputSummary && (
						<div
							className="mt-1 ml-1 pl-2 opacity-60 break-words whitespace-pre-wrap border-l"
							style={{
								color: theme.colors.textMain,
								borderColor: `${theme.colors.success}40`,
							}}
						>
							{outputSummary}
						</div>
					)}
				</>
			)}
		</>
	);
});

ToolBadge.displayName = 'ToolBadge';
