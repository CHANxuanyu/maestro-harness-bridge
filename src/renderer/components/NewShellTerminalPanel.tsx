import { useWindowContextOptional } from '../contexts/WindowContext';
import { useTabStore } from '../stores/tabStore';
import { useUIStore } from '../stores/uiStore';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { truncatePath } from '../../shared/formatters';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
	openPanelTerminal,
	panelTerminalLocation,
	panelTerminals,
	selectPanelTerminal,
} from '../services/newShellTerminal';
import { useTerminalMounting } from '../hooks/terminal/useTerminalMounting';
import { useRemoteTerminalBufferResponder } from '../hooks/terminal/useRemoteTerminalBufferResponder';
import { useCoworkingBufferResponder } from '../hooks/coworking/useCoworkingBufferResponder';
import { useSurfaceTypography } from '../hooks/ui/useSurfaceTypography';
import { useTerminalTabHandlers } from '../hooks/tabs/internal/useTerminalTabHandlers';
import { getTerminalTabDisplayName, previousHostTerminals } from '../utils/terminalTabHelpers';
import {
	TerminalView,
	createTabPidChangeHandler,
	createTabStateChangeHandler,
} from './TerminalView';
import { useT } from '../i18n';
import type { Session, Theme } from '../types';

export interface NewShellTerminalPanelHandle {
	clearActiveTerminal(): void;
	openTerminalSearch(): void;
	closeActiveTerminal(): void;
}

export const NewShellTerminalPanel = forwardRef<
	NewShellTerminalPanelHandle,
	{
		session: Session;
		theme: Theme;
		visible: boolean;
	}
>(function NewShellTerminalPanel({ session, theme, visible }, ref) {
	const t = useT();
	const windowContext = useWindowContextOptional();
	const newShell = useSettingsStore((s) => s.newShell);
	const activeFocus = useUIStore((s) => s.activeFocus);
	const sessions = useSessionStore((s) => s.sessions);
	const source = sessions.find((s) => s.id === session.id) || session;
	const typography = useSurfaceTypography('terminal');
	const { handleCloseTerminalTab } = useTerminalTabHandlers();
	const [error, setError] = useState('');
	const [openedVisit, setOpenedVisit] = useState<{ sessionId: string; tabId: string } | null>(null);
	useEffect(() => setError(''), [source.id, source.activeTabId]);
	const panel = source.aiTabs?.find((tab) => tab.id === source.activeTabId)?.newShellPanel;
	let pool: ReturnType<typeof panelTerminals> = [];
	let cwd = source.cwd;
	try {
		cwd = panelTerminalLocation(source).cwd;
		pool = panelTerminals(sessions, source);
	} catch {
		/* The opening effect displays invalid remote configuration errors. */
	}
	const previousHost = previousHostTerminals(source);
	const selected = pool.find((item) => item.tab.id === panel?.terminalTabId) || pool[0];
	// Ownership refreshes may finish a pending visit, but cannot start a new one.
	const openedThisVisit = useRef(false);
	useEffect(() => {
		openedThisVisit.current = false;
		setOpenedVisit(null);
	}, [newShell, visible, source.id, source.activeTabId]);
	useEffect(() => {
		if (!newShell || !visible || openedThisVisit.current) return;
		try {
			if (openPanelTerminal(source.id)) {
				openedThisVisit.current = true;
				setOpenedVisit({ sessionId: source.id, tabId: source.activeTabId });
			}
		} catch (err) {
			openedThisVisit.current = true;
			setOpenedVisit({ sessionId: source.id, tabId: source.activeTabId });
			setError(
				t('workflows.newShell.terminalStartFailed', {
					reason: err instanceof Error ? err.message : String(err),
				})
			);
		}
	}, [newShell, visible, source.id, source.activeTabId, windowContext?.ownsSession, t]);

	const handleNewTerminal = () => {
		try {
			openPanelTerminal(source.id, { additional: true });
		} catch (err) {
			setError(
				t('workflows.newShell.terminalStartFailed', {
					reason: err instanceof Error ? err.message : String(err),
				})
			);
		}
	};

	const mounted = useTerminalMounting(newShell && visible ? selected?.session || null : null);
	useImperativeHandle(ref, () => ({
		clearActiveTerminal() {
			if (selected)
				mounted.terminalViewRefs.current.get(selected.session.id)?.clearActiveTerminal();
		},
		openTerminalSearch() {
			mounted.setTerminalSearchOpen(true);
		},
		closeActiveTerminal() {
			if (selected) handleCloseTerminalTab(selected.tab.id);
		},
	}));
	useEffect(() => {
		mounted.setTerminalSearchOpen(false);
	}, [source.id, source.activeTabId, visible]);
	useRemoteTerminalBufferResponder(mounted.terminalViewRefs, newShell);
	useCoworkingBufferResponder(mounted.terminalViewRefs, newShell);
	const panelRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!visible || activeFocus !== 'right') return;
		if (selected) mounted.terminalViewRefs.current.get(selected.session.id)?.focusActiveTerminal();
		else panelRef.current?.focus();
	}, [visible, selected?.tab.id, activeFocus]);
	const displayedError =
		windowContext?.ownershipStatus === 'error'
			? t('workflows.newShell.terminalOwnershipFailed')
			: error;
	if (!newShell) return null;
	return (
		<div
			ref={panelRef}
			tabIndex={-1}
			data-testid="terminal-panel"
			aria-hidden={!visible}
			{...(!visible ? { inert: '' } : {})}
			className="absolute inset-0 flex flex-col outline-none"
			style={{
				visibility: visible ? 'visible' : 'hidden',
				pointerEvents: visible ? 'auto' : 'none',
			}}
		>
			<div
				className="flex items-center gap-1 px-3 h-9 shrink-0 text-xs"
				style={{ color: theme.colors.textDim }}
			>
				<span className="truncate min-w-0 flex-1" title={selected?.tab.cwd || cwd}>
					{truncatePath(selected?.tab.cwd || cwd, 32)}
				</span>
				{pool.length > 1 && (
					<select
						aria-label={t('workflows.newShell.selectTerminal')}
						className="max-w-28 min-w-0 rounded"
						style={{ backgroundColor: theme.colors.bgSidebar, color: theme.colors.textMain }}
						value={selected?.tab.id}
						onChange={(event) => selectPanelTerminal(source.id, event.target.value)}
					>
						{pool.map(({ tab }, index) => (
							<option key={tab.id} value={tab.id}>
								{getTerminalTabDisplayName(tab, index)}
							</option>
						))}
					</select>
				)}
				<button
					className="p-1 shrink-0"
					title={t('workflows.newShell.newTerminal')}
					aria-label={t('workflows.newShell.newTerminal')}
					onClick={handleNewTerminal}
				>
					<Plus className="w-4 h-4" />
				</button>
				<button
					className="p-1 shrink-0 disabled:opacity-30"
					disabled={!selected}
					title={t('workflows.newShell.closeTerminal')}
					aria-label={t('workflows.newShell.closeTerminal')}
					onClick={() => selected && handleCloseTerminalTab(selected.tab.id)}
				>
					<X className="w-4 h-4" />
				</button>
			</div>
			{previousHost.length > 0 && (
				<div
					className="flex items-center gap-2 px-3 py-1 text-xs"
					style={{ color: theme.colors.textDim }}
				>
					<span role="status">
						{t('workflows.newShell.previousHostTerminals', { count: previousHost.length })}
					</span>
					<button
						className="px-2 py-1 rounded"
						style={{ color: theme.colors.accent }}
						onClick={() => handleCloseTerminalTab(previousHost.map(({ tab }) => tab.id))}
					>
						{t('common.close')}
					</button>
				</div>
			)}

			{selected?.tab.state === 'exited' && (
				<div
					className="flex items-center gap-2 px-3 py-1 text-xs"
					style={{ color: theme.colors.textDim }}
				>
					<span role="status">
						{t('workflows.newShell.terminalExited')}
						{selected.tab.exitCode !== undefined ? ` (${selected.tab.exitCode})` : ''}
					</span>
					<button
						className="px-2 py-1 rounded"
						style={{ color: theme.colors.accent }}
						onClick={() => {
							setError('');
							void useTabStore
								.getState()
								.restartTerminalTab(selected.tab.id)
								.catch((err) => setError(String(err)));
						}}
					>
						{t('workflows.newShell.restartTerminal')}
					</button>
				</div>
			)}

			{displayedError && (
				<p role="alert" className="px-3 text-sm" style={{ color: theme.colors.error }}>
					{displayedError}
				</p>
			)}
			<div className="relative flex-1 min-h-0">
				{visible &&
					!pool.length &&
					openedVisit?.sessionId === source.id &&
					openedVisit.tabId === source.activeTabId && (
						<div
							data-testid="terminal-empty"
							className="h-full flex flex-col items-center justify-center gap-2 text-sm"
							style={{ color: theme.colors.textDim }}
						>
							<p>{t('workflows.newShell.terminalEmpty')}</p>
							<button
								className="px-2 py-1 rounded"
								style={{ color: theme.colors.accent }}
								onClick={handleNewTerminal}
							>
								{t('workflows.newShell.newTerminal')}
							</button>
						</div>
					)}
				{mounted.mountedTerminalSessionIds.map((id) => {
					const owner = sessions.find((s) => s.id === id);
					if (!owner?.terminalTabs?.length || windowContext?.ownsSession(owner.id, true) === false)
						return null;
					const shown = visible && selected?.session.id === id;
					const previousIds = new Set(previousHostTerminals(owner).map(({ tab }) => tab.id));
					const viewSession = {
						...owner,
						terminalTabs: owner.terminalTabs.filter((tab) => !previousIds.has(tab.id)),
						activeTerminalTabId: shown ? selected.tab.id : owner.activeTerminalTabId,
					};
					return (
						<div
							key={id}
							className="absolute inset-0 flex"
							{...(!shown ? { inert: '' } : {})}
							style={{
								visibility: shown ? 'visible' : 'hidden',
								pointerEvents: shown ? 'auto' : 'none',
							}}
						>
							<TerminalView
								ref={(handle) => {
									if (handle) mounted.terminalViewRefs.current.set(id, handle);
									else mounted.terminalViewRefs.current.delete(id);
								}}
								session={viewSession}
								theme={theme}
								fontFamily={typography.fontFamily}
								fontSize={typography.fontSize}
								onTabPidChange={(tabId, pid) => {
									createTabPidChangeHandler(id)(tabId, pid);
									if (pool.some((item) => item.session.id === id && item.tab.id === tabId))
										setError('');
								}}
								onSpawnFailure={(tabId, reason) => {
									if (pool.some((item) => item.session.id === id && item.tab.id === tabId)) {
										setError(t('workflows.newShell.terminalStartFailed', { reason }));
									}
								}}
								onTabStateChange={createTabStateChangeHandler(id)}
								searchOpen={shown && mounted.terminalSearchOpen}
								onSearchClose={() => mounted.setTerminalSearchOpen(false)}
								isVisible={shown}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
});
