import React from 'react';
import type { LogEntry, Theme } from '../../../types';
import { CollapsibleJsonViewer } from '../../CollapsibleJsonViewer';
import { AgentTaskListCard } from '../../AgentTaskListCard';
import { extractAgentTaskList } from '../../../utils/agentTaskList';
import { storedToolValueTruncation, withoutStoredTruncationNote } from '../utils/toolSummaries';
import { useT } from '../../../i18n';

/**
 * Tallest a single input or result block grows before it scrolls. Unfolding a
 * call must not push the conversation off screen, however long its result.
 */
const DETAIL_BLOCK_MAX_HEIGHT = '20rem';

/** Strings in the JSON tree are shown whole up to the storage cap. */
const JSON_STRING_LIMIT = 4000;

/**
 * The full stored input and result of one tool call, for the UNFOLDED card.
 *
 * The badge header keeps the one-line summary; this is what the user asked to
 * see by unfolding, so nothing is summarised away: nested arguments render as a
 * collapsible JSON tree (the app's canonical viewer), text results render
 * whole, and each block scrolls inside a bounded height. A value Maestro capped
 * for persistence (`compactToolOutput`) says so with the original length instead
 * of passing a cut-off string off as complete.
 */
export const ToolCallDetails = React.memo(function ToolCallDetails({
	log,
	theme,
}: {
	log: LogEntry;
	theme: Theme;
}) {
	const t = useT();
	const toolState = log.metadata?.toolState;
	const input = toolState?.input;
	const output = toolState?.output;
	const taskList = extractAgentTaskList(input);
	const hasInput = !taskList && input !== undefined && input !== null && input !== '';
	const hasOutput = output !== undefined && output !== null && output !== '';
	if (!taskList && !hasInput && !hasOutput) return null;

	return (
		<div className="mt-1 flex flex-col gap-2" data-tool-call-details="">
			{taskList && <AgentTaskListCard theme={theme} taskList={taskList} />}
			{hasInput && (
				<DetailBlock
					label={t('workflows.transcript.toolInput')}
					value={input}
					theme={theme}
					testId="tool-call-input"
				/>
			)}
			{hasOutput && (
				<DetailBlock
					label={t('workflows.transcript.toolResult')}
					value={output}
					theme={theme}
					testId="tool-call-result"
				/>
			)}
		</div>
	);
});

/**
 * One call inside an unfolded "N tool calls" run: its header line as a toggle,
 * its full details only once that call is unfolded too. Local state is enough
 * here - the run row itself owns the persisted unfold, and a run is short-lived
 * UI rather than a transcript position the jump/search code addresses.
 */
export const ToolCallFold = React.memo(function ToolCallFold({
	log,
	theme,
	renderHeader,
}: {
	log: LogEntry;
	theme: Theme;
	renderHeader: (log: LogEntry) => React.ReactNode;
}) {
	const t = useT();
	const [open, setOpen] = React.useState(false);
	return (
		<div data-tool-call-fold="">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-label={
					open
						? t('workflows.transcript.hideToolDetails', { name: log.text })
						: t('workflows.transcript.showToolDetails', { name: log.text })
				}
				className="w-full flex items-start gap-1 text-left rounded outline-none focus-visible:ring-1 hover:opacity-90"
			>
				<span className="shrink-0 pt-0.5" style={{ color: theme.colors.textDim }} aria-hidden>
					{open ? '▾' : '▸'}
				</span>
				<div className="flex-1 min-w-0">{renderHeader(log)}</div>
			</button>
			{open && (
				<div className="pl-4 select-text">
					<ToolCallDetails log={log} theme={theme} />
				</div>
			)}
		</div>
	);
});

function DetailBlock({
	label,
	value,
	theme,
	testId,
}: {
	label: string;
	value: unknown;
	theme: Theme;
	testId: string;
}) {
	const t = useT();
	const truncatedFrom = storedToolValueTruncation(value);
	const structured = value !== null && typeof value === 'object';
	return (
		<div data-testid={testId}>
			<div className="flex items-center gap-2 mb-0.5 text-2xs uppercase tracking-wide">
				<span style={{ color: theme.colors.textDim }}>{label}</span>
				{truncatedFrom !== null && (
					<span style={{ color: theme.colors.warning }} data-tool-value-truncated="">
						{t('workflows.transcript.toolValueTruncated', { count: truncatedFrom })}
					</span>
				)}
			</div>
			<div
				className="overflow-auto scrollbar-thin rounded"
				style={{ maxHeight: DETAIL_BLOCK_MAX_HEIGHT, overscrollBehavior: 'contain' }}
			>
				{structured ? (
					<CollapsibleJsonViewer
						data={value}
						theme={theme}
						// Tool arguments nest a level or two; open that far, deeper on demand.
						initialExpandLevel={3}
						maxStringLength={JSON_STRING_LIMIT}
					/>
				) : (
					<pre
						className="m-0 p-2 text-xs whitespace-pre-wrap break-words font-mono rounded"
						style={{
							color: theme.colors.textMain,
							backgroundColor: theme.colors.bgSidebar,
							border: `1px solid ${theme.colors.border}`,
						}}
					>
						{typeof value === 'string' ? withoutStoredTruncationNote(value) : String(value)}
					</pre>
				)}
			</div>
		</div>
	);
}
