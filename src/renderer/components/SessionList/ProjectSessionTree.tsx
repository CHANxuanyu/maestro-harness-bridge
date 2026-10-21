/**
 * ProjectSessionTree - the Left Bar's conversation-first navigation.
 *
 * Projects stay as the grouping level, but the AGENT level is gone from
 * everyday navigation: each project lists its conversations directly - open
 * tabs AND native provider history, one row per native conversation - and the
 * provider (Claude Code, Codex, ...) is a small badge on the row rather than a
 * folder the user has to open. One click on a history row resumes it in its
 * original harness; nothing asks which configuration to use. Configurations
 * live in the secondary management view ("Manage agents").
 *
 * Purely presentational: the integrator hands in projects that are already
 * filtered, ordered and scoped (`utils/projectSessionTree`), and every action
 * is a callback. Do NOT add store subscriptions or filtering here - a second
 * copy of the membership rules would drift from the one the rest of the
 * sidebar uses.
 */

import {
	memo,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
	AlertCircle,
	ChevronDown,
	ChevronRight,
	Loader2,
	MoreHorizontal,
	Pencil,
	Plus,
	RotateCw,
	Settings2,
	Star,
	X,
} from 'lucide-react';
import type { Theme } from '../../types';
import type { ProjectHistoryError } from '../../../shared/projectHistory';
import type { SidebarConversation, SidebarProject } from '../../utils/projectSessionTree';
import { useClickOutside, useContextMenuPosition } from '../../hooks';
import { AgentLogo } from '../Wizard/screens/AgentSelectionScreen/components/AgentLogo';
import { getAgentDisplayName } from '../../../shared/agentMetadata';
import { FilterInput } from '../ui/FilterInput';
import { SegmentedControl } from '../ui/SegmentedControl';
import { useFormatRelativeTime, useT, type TFunction } from '../../i18n';

export type ProjectHistoryLoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

export interface ProjectSessionTreeProps {
	theme: Theme;
	projects: SidebarProject[];
	activeKey: string | null;
	search: string;
	onSearchChange: (value: string) => void;
	/** Providers with at least one conversation; the filter shows only for two or more. */
	providers?: string[];
	providerFilter?: string | null;
	onProviderFilterChange?: (provider: string | null) => void;
	historyStatus?: ProjectHistoryLoadStatus;
	historyRefreshing?: boolean;
	/** The whole history request failed. */
	historyFailure?: string | null;
	/** Per-project, per-provider scan failures. */
	historyErrors?: Record<string, ProjectHistoryError[]>;
	onRetryHistory?: () => void;
	/** History rows currently opening. */
	pendingKeys?: Record<string, true>;
	/** Rows whose last open (history row) or catch-up refresh (open tab) failed. */
	failedKeys?: Record<string, true>;
	onToggleProject: (project: SidebarProject) => void;
	/** Open rows focus their tab; history rows resume in the original harness. */
	onSelectConversation: (conversation: SidebarConversation) => void;
	onNewConversation: (ownerId: string) => void;
	onRenameConversation: (conversation: SidebarConversation) => void;
	/** Closes the TAB. Never deletes native history. */
	onCloseConversation: (conversation: SidebarConversation) => void;
	onShowMore?: (project: SidebarProject) => void;
	/** The secondary management view (agent configurations). */
	onManageAgents?: () => void;
	onAddAgent: () => void;
}

const ALL_PROVIDERS = '__all__';
const NO_KEYS: Record<string, true> = {};
const NO_ERRORS: Record<string, ProjectHistoryError[]> = {};

/** px of indent per project depth level (nested groups). */
const DEPTH_INDENT = 12;
/** Menus are right-aligned to their trigger; this is their minimum width. */
const MENU_MIN_WIDTH = 192;
/** Marks every element that Up/Down/Home/End walk through in the tree. */
const NAV_ATTR = 'data-tree-nav';

type MenuKind = 'new' | 'project' | 'row';

interface MenuState {
	kind: MenuKind;
	/** Project key for `new` / `project`, conversation key for `row`. */
	key: string;
	x: number;
	y: number;
}

type OpenMenu = (
	kind: MenuKind,
	key: string,
	trigger: HTMLElement,
	point?: { x: number; y: number }
) => void;

function providerName(provider: string): string {
	return getAgentDisplayName(provider);
}

function conversationTitle(conversation: SidebarConversation, t: TFunction): string {
	return conversation.title || t('workflows.conversations.newConversation');
}

// ============================================================================
// Menu
// ============================================================================

interface TreeMenuItem {
	key: string;
	label: string;
	/** Secondary line, e.g. the agent configuration a "New with" item uses. */
	detail?: string;
	icon?: ReactNode;
	color?: string;
	onSelect: () => void;
}

interface TreeMenuSection {
	key: string;
	heading?: string;
	items: TreeMenuItem[];
}

interface TreeMenuProps {
	theme: Theme;
	x: number;
	y: number;
	label: string;
	sections: TreeMenuSection[];
	triggerRef: RefObject<HTMLElement | null>;
	/** `restoreFocus` is true for Escape: the caret goes back to the trigger. */
	onDismiss: (restoreFocus: boolean) => void;
}

function TreeMenu({ theme, x, y, label, sections, triggerRef, onDismiss }: TreeMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const onDismissRef = useRef(onDismiss);
	onDismissRef.current = onDismiss;

	// The trigger counts as "inside": its own click toggles the menu, and a
	// mousedown-dismiss first would make that click reopen it.
	useClickOutside([menuRef, triggerRef] as RefObject<HTMLElement | null>[], () =>
		onDismissRef.current(false)
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				onDismissRef.current(true);
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, []);

	// Re-measure when the menu's SHAPE changes, not on every parent render.
	const shapeKey = sections.map((s) => `${s.heading ?? ''}:${s.items.length}`).join('|');
	const { left, top, maxHeight, ready } = useContextMenuPosition(menuRef, x, y, 8, shapeKey);

	useEffect(() => {
		if (!ready) return;
		menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
	}, [ready]);

	const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onDismissRef.current(true);
			return;
		}
		if (e.key === 'Tab') {
			onDismissRef.current(false);
			return;
		}
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
		const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
		if (items.length === 0) return;
		e.preventDefault();
		e.stopPropagation();
		const current = items.indexOf(document.activeElement as HTMLElement);
		let next = 0;
		if (e.key === 'End') next = items.length - 1;
		else if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
		else if (e.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
		items[next].focus();
	}, []);

	return createPortal(
		<div
			ref={menuRef}
			role="menu"
			aria-label={label}
			onKeyDown={handleKeyDown}
			className="fixed z-50 py-1 rounded-md shadow-xl border select-none"
			style={{
				left,
				top,
				opacity: ready ? 1 : 0,
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
				minWidth: MENU_MIN_WIDTH,
				maxWidth: '18rem',
				maxHeight,
				overflowY: 'auto',
			}}
		>
			{sections.map((section, sectionIndex) => (
				<div key={section.key} role="group" aria-label={section.heading}>
					{sectionIndex > 0 && (
						<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />
					)}
					{section.heading && (
						<div
							className="px-3 py-1 text-2xs uppercase tracking-wider truncate"
							style={{ color: theme.colors.textDim }}
						>
							{section.heading}
						</div>
					)}
					{section.items.map((item) => (
						<button
							key={item.key}
							type="button"
							role="menuitem"
							tabIndex={-1}
							onClick={() => {
								onDismissRef.current(false);
								item.onSelect();
							}}
							className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 focus:bg-white/5 outline-none transition-colors flex items-center gap-2"
							style={{ color: item.color ?? theme.colors.textMain }}
						>
							{item.icon && (
								<span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center" aria-hidden>
									{item.icon}
								</span>
							)}
							<span className="min-w-0 flex-1">
								<span className="block truncate">{item.label}</span>
								{item.detail && (
									<span className="block truncate text-2xs" style={{ color: theme.colors.textDim }}>
										{item.detail}
									</span>
								)}
							</span>
						</button>
					))}
				</div>
			))}
		</div>,
		document.body
	);
}

// ============================================================================
// Row pieces
// ============================================================================

const ProviderBadge = memo(function ProviderBadge({
	theme,
	provider,
	agentName,
}: {
	theme: Theme;
	provider: string;
	agentName: string;
}) {
	const name = providerName(provider);
	return (
		<span
			role="img"
			aria-label={name}
			title={agentName && agentName !== name ? `${name} · ${agentName}` : name}
			className="w-4 h-4 shrink-0 rounded flex items-center justify-center text-2xs leading-none"
			style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
		>
			<AgentLogo agentId={provider} supported detected theme={theme} className="w-4 h-4" />
		</span>
	);
});

const StatusMark = memo(function StatusMark({
	theme,
	conversation,
	t,
}: {
	theme: Theme;
	conversation: SidebarConversation;
	t: TFunction;
}) {
	const labels: string[] = [];
	if (conversation.error) labels.push(t('workflows.conversations.error'));
	if (conversation.busy) labels.push(t('workflows.conversations.busy'));
	if (conversation.unread) labels.push(t('workflows.conversations.unread'));
	if (labels.length === 0) return null;

	// One visible mark, by severity: an error outranks work in progress, which
	// outranks unread. Screen readers get every state that applies.
	let mark: ReactNode;
	if (conversation.error) {
		mark = <AlertCircle className="w-3 h-3" style={{ color: theme.colors.error }} />;
	} else if (conversation.busy) {
		mark = (
			<span
				className="block w-1.5 h-1.5 rounded-full animate-pulse"
				style={{ backgroundColor: theme.colors.warning }}
			/>
		);
	} else {
		mark = (
			<span
				className="block w-1.5 h-1.5 rounded-full"
				style={{ backgroundColor: theme.colors.accent }}
			/>
		);
	}

	return (
		<span className="shrink-0 flex items-center" title={labels.join(', ')}>
			<span aria-hidden>{mark}</span>
			<span className="sr-only">{labels.join(', ')}</span>
		</span>
	);
});

interface ConversationRowProps {
	theme: Theme;
	conversation: SidebarConversation;
	depth: number;
	active: boolean;
	menuOpen: boolean;
	pending: boolean;
	failed: boolean;
	t: TFunction;
	formatRelative: (value: number) => string;
	onSelect: (conversation: SidebarConversation) => void;
	openMenu: OpenMenu;
}

const ConversationRow = memo(function ConversationRow({
	theme,
	conversation,
	depth,
	active,
	menuOpen,
	pending,
	failed,
	t,
	formatRelative,
	onSelect,
	openMenu,
}: ConversationRowProps) {
	const title = conversationTitle(conversation, t);
	const isOpen = conversation.kind === 'open';
	const indent = 4 + depth * DEPTH_INDENT + 16;

	const handleContextMenu = useCallback(
		(e: ReactMouseEvent<HTMLButtonElement>) => {
			// Only an open tab has actions (rename, close tab).
			if (!isOpen) return;
			e.preventDefault();
			openMenu('row', conversation.key, e.currentTarget, { x: e.clientX, y: e.clientY });
		},
		[isOpen, openMenu, conversation.key]
	);

	return (
		<li data-conversation-key={conversation.key} data-conversation-kind={conversation.kind}>
			<div className="group relative flex items-center">
				<button
					type="button"
					data-tree-nav=""
					aria-current={active ? 'page' : undefined}
					aria-busy={pending || undefined}
					aria-label={[
						providerName(conversation.provider),
						title,
						conversation.error ? t('workflows.conversations.error') : '',
						conversation.busy ? t('workflows.conversations.busy') : '',
						conversation.unread ? t('workflows.conversations.unread') : '',
						pending ? t('workflows.conversations.opening') : '',
					]
						.filter(Boolean)
						.join(' ')}
					onClick={() => onSelect(conversation)}
					onContextMenu={handleContextMenu}
					className={`w-full min-w-0 flex items-center gap-2 py-2 rounded text-left text-xs outline-none focus-visible:ring-1 hover:bg-white/5 transition-colors ${
						isOpen ? 'pr-7' : 'pr-2'
					}`}
					style={{
						paddingLeft: indent,
						backgroundColor: active ? theme.colors.accentDim : undefined,
						// A conversation not open in a tab reads one step quieter.
						color: isOpen ? theme.colors.textMain : theme.colors.textDim,
						boxShadow: active ? `inset 2px 0 0 ${theme.colors.accent}` : undefined,
						fontWeight: conversation.unread ? 600 : undefined,
					}}
				>
					<ProviderBadge
						theme={theme}
						provider={conversation.provider}
						agentName={conversation.agentName}
					/>
					<span
						className="truncate flex-1 min-w-0"
						title={
							conversation.nativeTitle
								? `${title}\n${conversation.nativeTitle}`
								: conversation.history?.preview || title
						}
					>
						{title}
					</span>
					{conversation.starred && (
						<Star
							aria-hidden
							className="w-3 h-3 shrink-0"
							style={{ color: theme.colors.warning, fill: theme.colors.warning }}
						/>
					)}
					{pending ? (
						<Loader2
							aria-hidden
							className="w-3 h-3 shrink-0 animate-spin"
							style={{ color: theme.colors.textDim }}
						/>
					) : conversation.modifiedAt > 0 && !conversation.busy ? (
						<time
							dateTime={new Date(conversation.modifiedAt).toISOString()}
							className="shrink-0 text-2xs tabular-nums"
							style={{ color: theme.colors.textDim, opacity: 0.8 }}
						>
							{formatRelative(conversation.modifiedAt)}
						</time>
					) : null}
					<StatusMark theme={theme} conversation={conversation} t={t} />
				</button>
				{isOpen && (
					<button
						type="button"
						aria-label={`${t('workflows.conversations.more')}: ${title}`}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						title={t('workflows.conversations.more')}
						onClick={(e) => openMenu('row', conversation.key, e.currentTarget)}
						className={`absolute right-1 p-0.5 rounded outline-none focus-visible:opacity-100 group-hover:opacity-100 hover:bg-white/10 transition-opacity ${
							menuOpen ? 'opacity-100' : 'opacity-0'
						}`}
						style={{ color: theme.colors.textDim }}
					>
						<MoreHorizontal className="w-3.5 h-3.5" />
					</button>
				)}
			</div>
			{failed && !pending && (
				<div
					role="alert"
					className="flex items-center gap-1 pb-1 text-2xs"
					style={{ paddingLeft: indent + 24, color: theme.colors.error }}
				>
					<span className="truncate min-w-0">
						{t(
							// An open tab still shows its saved copy; only the catch-up failed.
							isOpen
								? 'workflows.conversations.refreshFailed'
								: 'workflows.conversations.openFailed'
						)}
					</span>
					<button
						type="button"
						onClick={() => onSelect(conversation)}
						className="shrink-0 flex items-center gap-0.5 rounded px-1 outline-none focus-visible:ring-1 hover:bg-white/10"
						style={{ color: theme.colors.accent }}
					>
						<RotateCw aria-hidden className="w-3 h-3" />
						{t('workflows.conversations.retry')}
					</button>
				</div>
			)}
		</li>
	);
});

/** Inline note under a project or the tree: what failed, plus a retry. */
function HistoryNotice({
	theme,
	message,
	indent,
	onRetry,
	t,
}: {
	theme: Theme;
	message: string;
	indent: number;
	onRetry?: () => void;
	t: TFunction;
}) {
	return (
		<div
			role="status"
			className="flex items-center gap-1 py-1 pr-2 text-2xs"
			style={{ paddingLeft: indent, color: theme.colors.textDim }}
		>
			<AlertCircle
				aria-hidden
				className="w-3 h-3 shrink-0"
				style={{ color: theme.colors.warning }}
			/>
			<span className="min-w-0 flex-1 break-words">{message}</span>
			{onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className="shrink-0 flex items-center gap-0.5 rounded px-1 outline-none focus-visible:ring-1 hover:bg-white/10"
					style={{ color: theme.colors.accent }}
				>
					<RotateCw aria-hidden className="w-3 h-3" />
					{t('workflows.conversations.retry')}
				</button>
			)}
		</div>
	);
}

// ============================================================================
// Project section
// ============================================================================

interface ProjectSectionProps {
	theme: Theme;
	project: SidebarProject;
	activeKey: string | null;
	searching: boolean;
	openMenuState: MenuState | null;
	pendingKeys: Record<string, true>;
	failedKeys: Record<string, true>;
	errors: ProjectHistoryError[] | undefined;
	historyLoading: boolean;
	t: TFunction;
	formatRelative: (value: number) => string;
	onToggleProject: (project: SidebarProject) => void;
	onSelectConversation: (conversation: SidebarConversation) => void;
	onNewConversation: (ownerId: string) => void;
	onShowMore?: (project: SidebarProject) => void;
	onRetryHistory?: () => void;
	onAddAgent: () => void;
	openMenu: OpenMenu;
}

const ProjectSection = memo(function ProjectSection({
	theme,
	project,
	activeKey,
	searching,
	openMenuState,
	pendingKeys,
	failedKeys,
	errors,
	historyLoading,
	t,
	formatRelative,
	onToggleProject,
	onSelectConversation,
	onNewConversation,
	onShowMore,
	onRetryHistory,
	onAddAgent,
	openMenu,
}: ProjectSectionProps) {
	const listId = useId();
	// A search reveals matches inside collapsed projects; the stored collapse
	// state is left alone so clearing the search restores the user's layout.
	const expanded = searching || !project.collapsed;
	// Conversations, not configurations: every matching row, paged or not.
	const count = project.totalCount;
	const rowIndent = 4 + project.depth * DEPTH_INDENT + 16;
	const newMenuOpen = openMenuState?.kind === 'new' && openMenuState.key === project.key;
	const projectMenuOpen = openMenuState?.kind === 'project' && openMenuState.key === project.key;

	const handleHeaderKeyDown = useCallback(
		(e: ReactKeyboardEvent<HTMLButtonElement>) => {
			if (searching) return;
			if (
				(e.key === 'ArrowRight' && project.collapsed) ||
				(e.key === 'ArrowLeft' && !project.collapsed)
			) {
				e.preventDefault();
				onToggleProject(project);
			}
		},
		[searching, project, onToggleProject]
	);

	const handleNew = useCallback(
		(e: ReactMouseEvent<HTMLButtonElement>) => {
			// One configuration means there is nothing to choose; zero means the
			// only useful next step is adding one.
			if (project.agents.length === 0) onAddAgent();
			else if (project.agents.length === 1) onNewConversation(project.agents[0].id);
			else openMenu('new', project.key, e.currentTarget);
		},
		[project, onAddAgent, onNewConversation, openMenu]
	);

	// While searching, a project with nothing matching keeps only its header.
	const showEmpty = expanded && count === 0 && !searching && !historyLoading;
	const showLoading = expanded && count === 0 && !searching && historyLoading;

	return (
		<li>
			<div
				className="group flex items-center gap-0.5 pr-1"
				style={{ paddingLeft: 4 + project.depth * DEPTH_INDENT }}
			>
				<button
					type="button"
					data-tree-nav=""
					aria-expanded={expanded}
					aria-controls={listId}
					onClick={() => onToggleProject(project)}
					onKeyDown={handleHeaderKeyDown}
					className="flex-1 min-w-0 flex items-center gap-1 py-2 rounded text-left text-xs font-semibold outline-none focus-visible:ring-1 hover:bg-white/5"
					style={{ color: theme.colors.textMain }}
				>
					{expanded ? (
						<ChevronDown
							aria-hidden
							className="w-3.5 h-3.5 shrink-0"
							style={{ color: theme.colors.textDim }}
						/>
					) : (
						<ChevronRight
							aria-hidden
							className="w-3.5 h-3.5 shrink-0"
							style={{ color: theme.colors.textDim }}
						/>
					)}
					{project.emoji && (
						<span aria-hidden className="shrink-0">
							{project.emoji}
						</span>
					)}
					<span className="truncate min-w-0">{project.name}</span>
					<span
						className="shrink-0 text-2xs font-normal tabular-nums"
						style={{ color: theme.colors.textDim }}
					>
						{count}
					</span>
				</button>
				<button
					type="button"
					aria-label={`${t('workflows.conversations.projectActions')}: ${project.name}`}
					title={t('workflows.conversations.projectActions')}
					aria-haspopup="menu"
					aria-expanded={projectMenuOpen}
					onClick={(e) => openMenu('project', project.key, e.currentTarget)}
					className={`shrink-0 p-0.5 rounded outline-none focus-visible:opacity-100 group-hover:opacity-100 hover:bg-white/10 transition-opacity ${
						projectMenuOpen ? 'opacity-100' : 'opacity-0'
					}`}
					style={{ color: theme.colors.textDim }}
				>
					<MoreHorizontal className="w-3.5 h-3.5" />
				</button>
				<button
					type="button"
					aria-label={`${t('workflows.conversations.new')}: ${project.name}`}
					title={t('workflows.conversations.new')}
					aria-haspopup={project.agents.length > 1 ? 'menu' : undefined}
					aria-expanded={project.agents.length > 1 ? newMenuOpen : undefined}
					onClick={handleNew}
					className="shrink-0 p-0.5 rounded outline-none focus-visible:ring-1 hover:bg-white/10"
					style={{ color: theme.colors.textDim }}
				>
					<Plus className="w-3.5 h-3.5" />
				</button>
			</div>
			{expanded && (
				<ul id={listId} className="flex flex-col">
					{project.conversations.map((conversation) => (
						<ConversationRow
							key={conversation.key}
							theme={theme}
							conversation={conversation}
							depth={project.depth}
							active={conversation.key === activeKey}
							menuOpen={openMenuState?.kind === 'row' && openMenuState.key === conversation.key}
							pending={!!pendingKeys[conversation.key]}
							failed={!!failedKeys[conversation.key]}
							t={t}
							formatRelative={formatRelative}
							onSelect={onSelectConversation}
							openMenu={openMenu}
						/>
					))}
					{project.hiddenCount > 0 && onShowMore && (
						<li>
							<button
								type="button"
								data-tree-nav=""
								onClick={() => onShowMore(project)}
								className="w-full text-left py-1.5 rounded text-2xs outline-none focus-visible:ring-1 hover:bg-white/5"
								style={{ paddingLeft: rowIndent, color: theme.colors.accent }}
							>
								{t('workflows.conversations.showMore', { count: project.hiddenCount })}
							</button>
						</li>
					)}
					{showLoading && (
						<li
							role="status"
							className="py-1 text-xs italic flex items-center gap-1"
							style={{ paddingLeft: rowIndent, color: theme.colors.textDim }}
						>
							<Loader2 aria-hidden className="w-3 h-3 animate-spin" />
							{t('workflows.conversations.loadingHistory')}
						</li>
					)}
					{showEmpty && (
						<li
							className="py-1 text-xs italic"
							style={{ paddingLeft: rowIndent, color: theme.colors.textDim }}
						>
							{t('workflows.conversations.empty')}
						</li>
					)}
					{errors && errors.length > 0 && (
						<li>
							<HistoryNotice
								theme={theme}
								indent={rowIndent}
								t={t}
								onRetry={onRetryHistory}
								message={t('workflows.conversations.historyUnavailableFor', {
									providers: [...new Set(errors.map((e) => providerName(e.provider)))].join(', '),
								})}
							/>
						</li>
					)}
				</ul>
			)}
		</li>
	);
});

// ============================================================================
// Tree
// ============================================================================

export const ProjectSessionTree = memo(function ProjectSessionTree({
	theme,
	projects,
	activeKey,
	search,
	onSearchChange,
	providers = [],
	providerFilter = null,
	onProviderFilterChange,
	historyStatus = 'unavailable',
	historyRefreshing = false,
	historyFailure = null,
	historyErrors = NO_ERRORS,
	onRetryHistory,
	pendingKeys = NO_KEYS,
	failedKeys = NO_KEYS,
	onToggleProject,
	onSelectConversation,
	onNewConversation,
	onRenameConversation,
	onCloseConversation,
	onShowMore,
	onManageAgents,
	onAddAgent,
}: ProjectSessionTreeProps) {
	const t = useT();
	const formatRelativeTime = useFormatRelativeTime();
	const formatRelative = useCallback(
		(value: number) => formatRelativeTime(value),
		[formatRelativeTime]
	);
	const historyLoading = historyStatus === 'idle' || historyStatus === 'loading';
	const [menu, setMenu] = useState<MenuState | null>(null);
	const triggerRef = useRef<HTMLElement | null>(null);
	const treeRef = useRef<HTMLUListElement>(null);
	const searching = search.trim().length > 0;

	const openMenu = useCallback<OpenMenu>((kind, key, trigger, point) => {
		triggerRef.current = trigger;
		setMenu((current) => {
			if (!point && current && current.kind === kind && current.key === key) return null;
			if (point) return { kind, key, x: point.x, y: point.y };
			const rect = trigger.getBoundingClientRect();
			return { kind, key, x: Math.max(8, rect.right - MENU_MIN_WIDTH), y: rect.bottom + 2 };
		});
	}, []);

	const dismissMenu = useCallback((restoreFocus: boolean) => {
		setMenu(null);
		if (restoreFocus) triggerRef.current?.focus();
	}, []);

	const handleTreeKeyDown = useCallback((e: ReactKeyboardEvent<HTMLUListElement>) => {
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
		const target = e.target as HTMLElement;
		if (!target.hasAttribute(NAV_ATTR)) return;
		const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(`[${NAV_ATTR}]`));
		const index = items.indexOf(target);
		if (index < 0) return;
		e.preventDefault();
		let next = index;
		if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = items.length - 1;
		else if (e.key === 'ArrowDown') next = Math.min(items.length - 1, index + 1);
		else next = Math.max(0, index - 1);
		items[next].focus();
	}, []);

	const handleSearchKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
		if (e.key !== 'ArrowDown') return;
		const first = treeRef.current?.querySelector<HTMLElement>(`[${NAV_ATTR}]`);
		if (first) {
			e.preventDefault();
			first.focus();
		}
	}, []);

	const addAgentSection: TreeMenuSection = {
		key: 'add-agent',
		items: [
			{
				key: 'add-agent',
				label: t('workflows.conversations.addAgent'),
				icon: <Plus className="w-3.5 h-3.5" />,
				color: theme.colors.accent,
				onSelect: onAddAgent,
			},
		],
	};

	// Menu content is resolved from the CURRENT props on every render, so a
	// project or conversation that changed while the menu was open is never
	// acted on through a stale snapshot. A target that vanished closes it.
	let menuLabel = '';
	let menuSections: TreeMenuSection[] | null = null;
	if (menu) {
		if (menu.kind === 'row') {
			const conversation = projects.flatMap((p) => p.conversations).find((c) => c.key === menu.key);
			// Only an open tab has actions; native history is never deleted from here.
			if (conversation && conversation.kind === 'open') {
				menuLabel = t('workflows.conversations.more');
				menuSections = [
					{
						key: 'conversation',
						heading: conversationTitle(conversation, t),
						items: [
							{
								key: 'rename',
								label: t('workflows.conversations.rename'),
								icon: <Pencil className="w-3.5 h-3.5" />,
								onSelect: () => onRenameConversation(conversation),
							},
							{
								key: 'close',
								label: t('workflows.conversations.close'),
								detail: conversation.nativeSessionId
									? t('workflows.conversations.closeKeepsHistory')
									: undefined,
								icon: <X className="w-3.5 h-3.5" />,
								onSelect: () => onCloseConversation(conversation),
							},
						],
					},
				];
			}
		} else {
			const project = projects.find((p) => p.key === menu.key);
			if (project && menu.kind === 'new') {
				menuLabel = t('workflows.conversations.new');
				menuSections = [
					{
						key: 'choices',
						// One row per provider; which configuration runs it is not asked.
						items: project.agents.map((agent) => ({
							key: agent.id,
							label: t('workflows.conversations.newWith', {
								provider: providerName(agent.provider),
							}),
							icon: (
								<AgentLogo
									agentId={agent.provider}
									supported
									detected
									theme={theme}
									className="w-4 h-4"
								/>
							),
							onSelect: () => onNewConversation(agent.id),
						})),
					},
					addAgentSection,
				];
			} else if (project) {
				menuLabel = t('workflows.conversations.projectActions');
				const items: TreeMenuItem[] = [];
				if (onRetryHistory) {
					items.push({
						key: 'refresh',
						label: t('workflows.conversations.refreshHistory'),
						icon: <RotateCw className="w-3.5 h-3.5" />,
						onSelect: onRetryHistory,
					});
				}
				if (onManageAgents) {
					items.push({
						key: 'manage',
						label: t('workflows.conversations.manageAgents'),
						icon: <Settings2 className="w-3.5 h-3.5" />,
						onSelect: onManageAgents,
					});
				}
				menuSections = [...(items.length > 0 ? [{ key: 'project', items }] : []), addAgentSection];
			}
		}
	}

	useEffect(() => {
		if (menu && !menuSections) setMenu(null);
	}, [menu, menuSections]);

	const totalConversations = projects.reduce((sum, p) => sum + p.totalCount, 0);
	const filtering = searching || !!providerFilter;
	const providerOptions =
		providers.length > 1
			? [
					{ value: ALL_PROVIDERS, label: t('workflows.conversations.allProviders') },
					...providers.map((provider) => ({
						value: provider,
						label: providerName(provider),
					})),
				]
			: null;

	return (
		<div className="flex flex-col min-w-0 gap-1 select-none">
			<div className="px-2 pt-1 pb-2 flex flex-col gap-1.5">
				<FilterInput
					theme={theme}
					value={search}
					onChange={onSearchChange}
					placeholder={t('workflows.conversations.search')}
					width="100%"
					clearLabel={t('common.clear')}
					onKeyDown={handleSearchKeyDown}
				/>
				{providerOptions && onProviderFilterChange && (
					<div className="text-2xs">
						<SegmentedControl
							theme={theme}
							ariaLabel={t('workflows.conversations.providerFilter')}
							value={providerFilter ?? ALL_PROVIDERS}
							options={providerOptions}
							onChange={(value) => onProviderFilterChange(value === ALL_PROVIDERS ? null : value)}
							testId="conversation-provider-filter"
						/>
					</div>
				)}
			</div>

			{historyStatus === 'loading' && totalConversations > 0 && (
				<p
					role="status"
					className="px-3 text-2xs flex items-center gap-1"
					style={{ color: theme.colors.textDim }}
				>
					<Loader2 aria-hidden className="w-3 h-3 animate-spin" />
					{t('workflows.conversations.loadingHistory')}
				</p>
			)}
			{historyRefreshing && (
				<span className="sr-only" role="status">
					{t('workflows.conversations.refreshingHistory')}
				</span>
			)}
			{historyFailure && (
				<HistoryNotice
					theme={theme}
					indent={12}
					t={t}
					onRetry={onRetryHistory}
					message={t('workflows.conversations.historyLoadFailed')}
				/>
			)}

			{filtering && totalConversations === 0 ? (
				<p className="px-3 py-2 text-xs italic" style={{ color: theme.colors.textDim }}>
					{historyLoading
						? t('workflows.conversations.loadingHistory')
						: t('workflows.conversations.noMatches')}
				</p>
			) : projects.length === 0 ? (
				<div className="px-3 py-2 flex flex-col items-start gap-1">
					<p className="text-xs italic" style={{ color: theme.colors.textDim }}>
						{t('workflows.conversations.empty')}
					</p>
					<button
						type="button"
						onClick={onAddAgent}
						className="flex items-center gap-1 text-xs rounded px-1 py-0.5 outline-none focus-visible:ring-1 hover:bg-white/5"
						style={{ color: theme.colors.accent }}
					>
						<Plus aria-hidden className="w-3.5 h-3.5" />
						{t('workflows.conversations.addAgent')}
					</button>
				</div>
			) : (
				<ul ref={treeRef} className="flex flex-col px-1" onKeyDown={handleTreeKeyDown}>
					{projects.map((project) => (
						<ProjectSection
							key={project.key}
							theme={theme}
							project={project}
							activeKey={activeKey}
							searching={filtering}
							openMenuState={menu}
							pendingKeys={pendingKeys}
							failedKeys={failedKeys}
							errors={historyErrors[project.key]}
							historyLoading={historyLoading}
							t={t}
							formatRelative={formatRelative}
							onToggleProject={onToggleProject}
							onSelectConversation={onSelectConversation}
							onNewConversation={onNewConversation}
							onShowMore={onShowMore}
							onRetryHistory={onRetryHistory}
							onAddAgent={onAddAgent}
							openMenu={openMenu}
						/>
					))}
				</ul>
			)}

			{menu && menuSections && (
				<TreeMenu
					theme={theme}
					x={menu.x}
					y={menu.y}
					label={menuLabel}
					sections={menuSections}
					triggerRef={triggerRef}
					onDismiss={dismissMenu}
				/>
			)}
		</div>
	);
});
