import type React from 'react';
import {
	Check,
	Copy,
	Eye,
	FileText,
	GitFork,
	Hammer,
	RotateCcw,
	Save,
	Share2,
	Trash2,
} from 'lucide-react';
import type { LogEntry, Theme } from '../../../types';
import { formatShortcutKeys } from '../../../utils/shortcutFormatter';
import { useT } from '../../../i18n';

export interface MessageActionsProps {
	log: LogEntry;
	theme: Theme;
	isAIMode: boolean;
	/**
	 * `overlay`: the legacy layout's absolute cluster in the bubble's bottom-right
	 * corner, markup unchanged. `inline`: the conversation feed's meta line under
	 * the message, revealed on row hover, keyboard focus, touch, or `revealed`.
	 */
	variant: 'overlay' | 'inline';
	/** Inline only: keep the actions visible without hover (the newest reply). */
	revealed?: boolean;
	markdownEditMode: boolean;
	onToggleMarkdownEditMode: () => void;
	onReplayMessage?: (text: string, images?: string[]) => void;
	copyToClipboard: (text: string) => void;
	onSaveToFile?: (text: string) => void;
	onForkConversation?: (logId: string) => void;
	ghCliAvailable?: boolean;
	onPublishGist?: (text: string, messageId?: string) => void;
	publishedGistUrl?: string;
	deleteConfirmLogId: string | null;
	onDeleteLog?: (logId: string) => number | null;
	onSetDeleteConfirmLogId: (logId: string | null) => void;
	scrollContainerRef: React.RefObject<HTMLDivElement>;
}

/**
 * The per-message actions, in ONE place for both transcript layouts, so the
 * two cannot drift on which actions exist or what they do. Every handler,
 * gate and confirmation is the one LogItem always had.
 *
 * Inline visibility is opacity only (never `display`), so revealing them on
 * hover or focus moves nothing and every button stays in the Tab order. The
 * legacy overlay keeps its hover-only look byte for byte.
 */
export function MessageActions({
	log,
	theme,
	isAIMode,
	variant,
	revealed = false,
	markdownEditMode,
	onToggleMarkdownEditMode,
	onReplayMessage,
	copyToClipboard,
	onSaveToFile,
	onForkConversation,
	ghCliAvailable,
	onPublishGist,
	publishedGistUrl,
	deleteConfirmLogId,
	onDeleteLog,
	onSetDeleteConfirmLogId,
	scrollContainerRef,
}: MessageActionsProps) {
	const t = useT();
	const inline = variant === 'inline';
	const isUserMessage = log.source === 'user';

	// Overlay: the original classes. Inline: full opacity when shown, so an icon
	// the user can see is never also dimmed.
	const hidden = inline
		? `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100${revealed ? ' !opacity-100' : ''}`
		: 'opacity-0 group-hover:opacity-50 hover:!opacity-100';
	const button = inline
		? `p-1 rounded transition-opacity hover:bg-white/10 ${hidden}`
		: `p-1.5 rounded ${hidden}`;
	const iconSize = 'w-3.5 h-3.5';
	// Inline buttons inherit the meta line's readable secondary color; the
	// overlay keeps the theme's raw textDim, as it always had.
	const dimColor = inline ? undefined : theme.colors.textDim;

	// Overlay keeps its English titles (and the tests that read them); the feed
	// names every control in the user's language, as title AND accessible name.
	const label = (inlineText: string, legacyText: string) => {
		const text = inline ? inlineText : legacyText;
		return inline ? { title: text, 'aria-label': text } : { title: text };
	};
	const markdownKeys = formatShortcutKeys(['Meta', 'e']);

	const deleteAfterConfirm = () => {
		const nextIndex = onDeleteLog!(log.id);
		onSetDeleteConfirmLogId(null);
		if (nextIndex !== null && nextIndex >= 0) {
			setTimeout(() => {
				const container = scrollContainerRef.current;
				const items = container?.querySelectorAll('[data-log-index]');
				const targetItem = items?.[nextIndex] as HTMLElement;
				if (targetItem && container) {
					container.scrollTop = targetItem.offsetTop;
				}
			}, 50);
		}
	};

	const content = (
		<>
			{/* Markdown toggle button - available on both user and assistant
			    messages in AI mode for consistent UX (#622). */}
			{isAIMode && (
				<button
					type="button"
					onClick={onToggleMarkdownEditMode}
					className={button}
					style={{ color: markdownEditMode ? theme.colors.accent : dimColor }}
					{...label(
						markdownEditMode
							? t('workflows.transcript.actionShowFormatted', { keys: markdownKeys })
							: t('workflows.transcript.actionShowPlain', { keys: markdownKeys }),
						markdownEditMode
							? `Show formatted (${markdownKeys})`
							: `Show plain text (${markdownKeys})`
					)}
				>
					{markdownEditMode ? (
						<Eye className={inline ? iconSize : 'w-4 h-4'} />
					) : (
						<FileText className={inline ? iconSize : 'w-4 h-4'} />
					)}
				</button>
			)}
			{/* Replay button for user messages in AI mode */}
			{isUserMessage && isAIMode && onReplayMessage && (
				<button
					type="button"
					onClick={() => onReplayMessage(log.text, log.images)}
					className={button}
					style={{ color: dimColor }}
					{...label(t('workflows.transcript.actionReplay'), 'Replay message')}
				>
					<RotateCcw className={iconSize} />
				</button>
			)}
			{/* Copy to Clipboard Button */}
			<button
				type="button"
				onClick={() => copyToClipboard(log.text)}
				className={button}
				style={{ color: dimColor }}
				{...label(t('workflows.transcript.actionCopy'), 'Copy to clipboard')}
			>
				<Copy className={iconSize} />
			</button>
			{/* Save to File Button - only for AI responses */}
			{log.source !== 'user' && isAIMode && onSaveToFile && (
				<button
					type="button"
					onClick={() => onSaveToFile(log.text)}
					className={button}
					style={{ color: dimColor }}
					{...label(t('workflows.transcript.actionSave'), 'Save to file')}
				>
					<Save className={iconSize} />
				</button>
			)}
			{/* Fork conversation - user messages and AI responses (source='stdout' in AI mode, or 'ai' if ever set) */}
			{(log.source === 'user' || log.source === 'ai' || log.source === 'stdout') &&
				isAIMode &&
				onForkConversation && (
					<button
						type="button"
						onClick={() => onForkConversation(log.id)}
						className={button}
						style={{ color: dimColor }}
						{...label(t('workflows.transcript.actionFork'), 'Fork conversation from here')}
					>
						<GitFork className={iconSize} />
					</button>
				)}
			{/* Publish to GitHub Gist - only for AI responses when gh CLI available */}
			{log.source !== 'user' && isAIMode && ghCliAvailable && onPublishGist && (
				<button
					type="button"
					onClick={() => onPublishGist(log.text, log.id)}
					className={
						inline
							? `p-1 rounded transition-opacity hover:bg-white/10 ${publishedGistUrl ? 'opacity-100' : hidden}`
							: `p-1.5 rounded hover:!opacity-100 ${
									publishedGistUrl ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'
								}`
					}
					style={{
						color: publishedGistUrl ? theme.colors.accent : dimColor,
					}}
					{...label(
						publishedGistUrl
							? t('workflows.transcript.actionGistPublished', { url: publishedGistUrl })
							: t('workflows.transcript.actionGist'),
						publishedGistUrl ? `Published as Gist: ${publishedGistUrl}` : 'Publish as GitHub Gist'
					)}
				>
					<Share2 className={iconSize} />
				</button>
			)}
			{/* Delete button for user messages (both AI and terminal modes) */}
			{log.source === 'user' &&
				onDeleteLog &&
				(deleteConfirmLogId === log.id ? (
					<div
						className={`flex items-center gap-1 rounded border ${inline ? 'px-1' : 'p-1'}`}
						style={{
							backgroundColor: theme.colors.bgSidebar,
							borderColor: theme.colors.error,
						}}
					>
						<span className="text-xs px-1" style={{ color: theme.colors.error }}>
							{inline ? t('workflows.transcript.deleteConfirm') : 'Delete?'}
						</span>
						<button
							type="button"
							onClick={deleteAfterConfirm}
							className="px-2 py-0.5 rounded text-xs font-medium hover:opacity-80"
							style={{ backgroundColor: theme.colors.error, color: '#fff' }}
						>
							{inline ? t('workflows.transcript.deleteYes') : 'Yes'}
						</button>
						<button
							type="button"
							onClick={() => onSetDeleteConfirmLogId(null)}
							className="px-2 py-0.5 rounded text-xs hover:opacity-80"
							style={{ color: dimColor }}
						>
							{inline ? t('workflows.transcript.deleteNo') : 'No'}
						</button>
					</div>
				) : (
					<button
						type="button"
						onClick={() => onSetDeleteConfirmLogId(log.id)}
						className={inline ? button : `${button} transition-opacity`}
						style={{ color: dimColor }}
						{...label(
							t('workflows.transcript.actionDelete'),
							isAIMode ? 'Delete message and response' : 'Delete command and output'
						)}
					>
						<Trash2 className={iconSize} />
					</button>
				))}
			{/* Read-only mode indicator for messages sent in read-only/plan mode */}
			{isUserMessage && isAIMode && log.readOnly && (
				<span
					title={inline ? t('workflows.transcript.infoReadOnly') : 'Sent in read-only mode'}
					className="flex items-center"
					{...(inline ? { role: 'img', 'aria-label': t('workflows.transcript.infoReadOnly') } : {})}
				>
					<Eye
						className={iconSize}
						style={{ color: theme.colors.warning, opacity: inline ? 1 : 0.7 }}
					/>
				</span>
			)}
			{/* Force parallel indicator for messages sent via Cmd+Shift+Enter */}
			{isUserMessage && isAIMode && log.forceParallel && (
				<span
					title={
						inline
							? t('workflows.transcript.infoForcedParallel')
							: 'Sent via forced parallel execution (bypassed queue)'
					}
					className="flex items-center"
					{...(inline
						? { role: 'img', 'aria-label': t('workflows.transcript.infoForcedParallel') }
						: {})}
				>
					<Hammer
						className={iconSize}
						style={{ color: theme.colors.warning, opacity: inline ? 1 : 0.7 }}
					/>
				</span>
			)}
			{/* Delivery checkmark for user messages in AI mode - positioned at the end.
			    The feed reports delivery in the message info instead of on every row. */}
			{!inline && isUserMessage && isAIMode && log.delivered && (
				<span title="Message delivered" className="flex items-center">
					<Check className={iconSize} style={{ color: theme.colors.success, opacity: 0.6 }} />
				</span>
			)}
		</>
	);

	// Inline: bare buttons, laid out by the meta line's controls group (which
	// keeps them from shrinking or clipping).
	if (inline) return content;

	return (
		<div
			className="absolute bottom-2 right-2 flex items-center gap-1"
			style={{ transition: 'opacity 0.15s ease-in-out' }}
		>
			{content}
		</div>
	);
}
