import React from 'react';
import type { LogEntry, Theme } from '../../../types';
import { summarizeToolInput, summarizeToolOutput } from '../utils/toolSummaries';
import { AgentTaskListCard } from '../../AgentTaskListCard';
import { extractAgentTaskList } from '../../../utils/agentTaskList';
import { ToolCallDetails } from './ToolCallDetails';
import { useT } from '../../../i18n';

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
}: {
	log: LogEntry;
	theme: Theme;
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
				{toolStatus === 'running' && (
					<span className="animate-pulse shrink-0 pt-0.5" style={{ color: theme.colors.warning }}>
						●
					</span>
				)}
				{toolStatus === 'completed' && (
					<span className="shrink-0 pt-0.5" style={{ color: theme.colors.success }}>
						✓
					</span>
				)}
				{(toolStatus === 'failed' || toolStatus === 'error') && (
					<span className="shrink-0 pt-0.5" style={{ color: theme.colors.error }}>
						!
					</span>
				)}
				{/* Stopped while running: neither busy nor a success. */}
				{toolStatus === 'canceled' && (
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
						className={`opacity-50 ${part === 'header' ? 'truncate min-w-0' : 'break-words'}`}
						style={{ color: theme.colors.textMain }}
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
