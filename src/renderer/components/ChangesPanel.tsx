import { joinPath } from '../../shared/formatters';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Diff, Hunk } from 'react-diff-view';
import {
	ChevronDown,
	ChevronRight,
	RefreshCw,
	ShieldCheck,
	Plus,
	Minus,
	Undo2,
	Loader2,
} from 'lucide-react';
import type { Session, Theme } from '../types';
import type {
	GitChangedFile,
	GitChanges,
	GitFileChangeDiff,
	GitChangeRequest,
} from '../../shared/gitChanges';
import { gitService } from '../services/git';
import { resolveGitCwd, resolveGitSshRemoteId } from '../hooks/git/useGitAgentActions';
import { canHandOffTab, requestAiHandoff } from '../services/aiHandoffEntry';
import { parseGitDiff } from '../utils/gitDiffParser';
import { generateDiffViewStyles } from '../utils/markdownConfig';
import { useModalStore } from '../stores/modalStore';
import { requestFileTreeRefresh } from '../utils/fileTreeRefresh';
import { useSettingsStore } from '../stores/settingsStore';
import { useT } from '../i18n';
import 'react-diff-view/style/index.css';

/**
 * The new shell's Changes panel: what this conversation's working directory
 * changed against HEAD, file by file, with the diff one click away, and the
 * entry point for asking another AI to review it (docs/roadmap/new-shell.md,
 * appendix B and C). Refreshes when a turn ends, when the conversation
 * changes, and on demand; the backend never watches files.
 */

const STATUS_LETTER: Record<GitChangedFile['status'], string> = {
	modified: 'M',
	added: 'A',
	deleted: 'D',
	renamed: 'R',
	copied: 'C',
	typechange: 'T',
	untracked: 'U',
	conflicted: '!',
};

type Load =
	| { kind: 'loading' }
	| { kind: 'ready'; changes: GitChanges }
	| { kind: 'error'; message: string };

type FileDiffState =
	| { kind: 'loading' }
	| { kind: 'ready'; diff: GitFileChangeDiff }
	| { kind: 'error'; message: string };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function splitPath(path: string): { dir: string; name: string } {
	const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
	const at = trimmed.lastIndexOf('/');
	return at < 0
		? { dir: '', name: path }
		: { dir: trimmed.slice(0, at + 1), name: path.slice(at + 1) };
}

interface ChangesPanelProps {
	theme: Theme;
	session: Session;
	onFileClick?: (path: string) => void;
}

export const ChangesPanel = memo(function ChangesPanel({
	theme,
	session,
	onFileClick,
}: ChangesPanelProps) {
	const t = useT();
	const newShell = useSettingsStore((s) => s.newShell);
	const colorBlindMode = useSettingsStore((s) => s.colorBlindMode);
	const cwd = newShell ? session.cwd : resolveGitCwd(session);
	const sshRemoteId = resolveGitSshRemoteId(session);
	const remoteCwd =
		newShell && session.sessionSshRemoteConfig?.enabled
			? session.sessionSshRemoteConfig.workingDirOverride || undefined
			: undefined;
	const context = JSON.stringify([session.id, session.activeTabId, cwd, sshRemoteId, remoteCwd]);
	const refreshContext = newShell ? context : JSON.stringify([cwd, sshRemoteId, remoteCwd]);
	const contextRef = useRef(context);
	contextRef.current = context;
	const [message, setMessage] = useState('');
	const [actionError, setActionError] = useState('');
	const [pending, setPending] = useState<string | null>(null);
	const actionRef = useRef<object | null>(null);
	const mountedRef = useRef(false);
	const [load, setLoad] = useState<Load>({ kind: 'loading' });
	const [refreshing, setRefreshing] = useState(false);
	const [open, setOpen] = useState<Record<string, FileDiffState>>({});
	// Only the newest request may write state: a slow answer for the previous
	// conversation must not overwrite the one on screen.
	const requestRef = useRef(0);

	const refresh = useCallback(async () => {
		const request = ++requestRef.current;
		setRefreshing(true);
		try {
			const changes = await gitService.getChanges(cwd, sshRemoteId, remoteCwd);
			if (request !== requestRef.current) return;
			// A timeout is no answer; keep what is on screen.
			setLoad((previous) =>
				changes.timedOut && previous.kind === 'ready' ? previous : { kind: 'ready', changes }
			);
			setOpen({});
		} catch (error) {
			if (request !== requestRef.current) return;
			setLoad({ kind: 'error', message: messageOf(error) });
		} finally {
			if (request === requestRef.current) setRefreshing(false);
		}
	}, [cwd, sshRemoteId, remoteCwd, refreshContext]);

	useEffect(() => {
		mountedRef.current = true;
		setLoad({ kind: 'loading' });
		setOpen({});
		setMessage('');
		setActionError('');
		setPending(null);
		actionRef.current = null;
		void refresh();
		return () => {
			mountedRef.current = false;
			requestRef.current++;
			actionRef.current = null;
		};
	}, [refresh]);

	// A turn ending is when files change; refresh on the busy -> idle edge.
	const busy = session.state === 'busy';
	const wasBusyRef = useRef(busy);
	useEffect(() => {
		if (wasBusyRef.current && !busy) void refresh();
		wasBusyRef.current = busy;
	}, [busy, refresh]);

	const toggleFile = useCallback(
		async (file: GitChangedFile) => {
			if (open[file.path]) {
				setOpen(({ [file.path]: _closed, ...rest }) => rest);
				return;
			}
			setOpen((previous) => ({ ...previous, [file.path]: { kind: 'loading' } }));
			try {
				const diff = await gitService.getChangeDiff(cwd, file.path, sshRemoteId, remoteCwd);
				if (contextRef.current !== context) return;
				setOpen((previous) =>
					previous[file.path] ? { ...previous, [file.path]: { kind: 'ready', diff } } : previous
				);
			} catch (error) {
				if (contextRef.current !== context) return;
				setOpen((previous) =>
					previous[file.path]
						? { ...previous, [file.path]: { kind: 'error', message: messageOf(error) } }
						: previous
				);
			}
		},
		[cwd, open, sshRemoteId, remoteCwd, context]
	);

	const runAction = async (request: GitChangeRequest) => {
		if (!mountedRef.current || actionRef.current || contextRef.current !== context) return;
		if (session.sessionSshRemoteConfig?.enabled && !sshRemoteId) {
			setActionError(t('workflows.changes.missingRemote'));
			return;
		}
		const token = {};
		actionRef.current = token;
		setPending(request.action === 'commit' ? 'commit' : request.paths[0]);
		setActionError('');
		try {
			const result = await gitService.applyChange(cwd, request, sshRemoteId, remoteCwd);
			if (actionRef.current !== token || contextRef.current !== context) return;
			if (!result.success)
				setActionError(
					result.reason
						? t(`workflows.changes.error.${result.reason}`, { file: result.file ?? '' })
						: result.error
				);
			else {
				if (request.action === 'commit') setMessage('');
				requestFileTreeRefresh(session.id);
			}
			// A failed hook or a partial Git failure can still have changed the index.
			await refresh();
		} catch (error) {
			if (actionRef.current === token && contextRef.current === context)
				setActionError(messageOf(error));
		} finally {
			if (actionRef.current === token && contextRef.current === context) {
				actionRef.current = null;
				setPending(null);
			}
		}
	};
	const confirmRevert = (file: GitChangedFile) => {
		const deletesFile =
			file.status === 'untracked' || file.status === 'added' || file.status === 'copied';
		useModalStore.getState().openModal('confirm', {
			title: t('workflows.changes.revertTitle'),
			confirmLabel: t(deletesFile ? 'workflows.files.delete' : 'workflows.changes.revert'),
			message: t(
				deletesFile
					? 'workflows.changes.deleteNewConfirm'
					: file.status === 'renamed'
						? 'workflows.changes.renameConfirm'
						: 'workflows.changes.revertConfirm',
				{ file: file.path, oldFile: file.oldPath ?? file.path }
			),
			destructive: true,
			onConfirm: () => void runAction({ action: 'revert', paths: [file.path], confirmed: true }),
		});
	};

	const activeTab = session.aiTabs.find((tab) => tab.id === session.activeTabId);
	const changes = load.kind === 'ready' ? load.changes : null;
	const stagedCount =
		changes?.stagedCount ??
		changes?.files.filter((file) => file.staged && file.status !== 'conflicted').length ??
		0;
	const canCommit = stagedCount > 0 && !pending && !refreshing && !!message.trim();
	const hasChanges = !!changes && changes.totals.files > 0;
	const canReview = hasChanges && !!activeTab && canHandOffTab(session, activeTab);
	const diffStyles = useMemo(
		() => generateDiffViewStyles(theme, colorBlindMode),
		[theme, colorBlindMode]
	);
	const addColor = colorBlindMode ? '#009988' : theme.colors.success;
	const delColor = colorBlindMode ? '#CC3311' : theme.colors.error;
	const dim = { color: theme.colors.textDim };

	const body = (() => {
		if (load.kind === 'loading')
			return (
				<p className="text-xs px-1 py-3" style={dim}>
					{t('workflows.changes.loading')}
				</p>
			);
		if (load.kind === 'error')
			return (
				<p className="text-xs px-1 py-3" style={{ color: theme.colors.error }} role="alert">
					{t('workflows.changes.failed', { error: load.message })}
				</p>
			);
		if (load.changes.notARepo)
			return (
				<p className="text-xs px-1 py-3" style={dim}>
					{t('workflows.changes.notARepo')}
				</p>
			);
		if (load.changes.timedOut)
			return (
				<p className="text-xs px-1 py-3" style={dim}>
					{t('workflows.changes.timedOut')}
				</p>
			);
		if (!hasChanges)
			return (
				<p className="text-xs px-1 py-3" style={dim}>
					{t('workflows.changes.clean')}
				</p>
			);
		return (
			<ul className="flex flex-col" data-testid="changes-list">
				{(newShell && stagedCount > 0
					? [
							{
								label: 'staged',
								files: load.changes.files.filter(
									(file) => file.staged && file.status !== 'conflicted'
								),
								count: stagedCount,
							},
							{
								label: 'unstaged',
								files: load.changes.files.filter(
									(file) => !file.staged || file.status === 'conflicted'
								),
								count: load.changes.totals.files - stagedCount,
							},
						]
					: [{ label: '', files: load.changes.files, count: load.changes.totals.files }]
				).map((group) => (
					<Fragment key={group.label}>
						{group.label && (
							<li className="px-1 pt-3 pb-1 text-xs font-medium" style={dim}>
								{t(
									group.label === 'staged'
										? 'workflows.changes.staged'
										: 'workflows.changes.unstaged',
									{ count: group.count }
								)}
							</li>
						)}
						{group.files.map((file) => {
							const { dir, name } = splitPath(file.path);
							const state = open[file.path];
							const Row = newShell ? 'div' : 'button';
							const Name = newShell ? 'button' : 'span';
							return (
								<li key={file.path}>
									<Row
										type="button"
										onClick={newShell ? undefined : () => void toggleFile(file)}
										aria-expanded={newShell ? undefined : !!state}
										className="group/changed-file relative w-full flex items-center gap-2 px-1 py-1 rounded text-left text-xs hover:bg-white/5"
										title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
									>
										{newShell ? (
											<button
												type="button"
												aria-label={t('workflows.changes.diffFile', { file: file.path })}
												aria-expanded={!!state}
												onClick={() => void toggleFile(file)}
											>
												{state ? (
													<ChevronDown className="w-3 h-3 shrink-0" style={dim} />
												) : (
													<ChevronRight className="w-3 h-3 shrink-0" style={dim} />
												)}
											</button>
										) : (
											<>
												{state ? (
													<ChevronDown className="w-3 h-3 shrink-0" style={dim} />
												) : (
													<ChevronRight className="w-3 h-3 shrink-0" style={dim} />
												)}
											</>
										)}
										<span
											className="font-mono w-3 shrink-0 text-center"
											style={dim}
											aria-label={t(`workflows.changes.status.${file.status}`)}
										>
											{STATUS_LETTER[file.status]}
										</span>
										<Name
											className="min-w-0 flex-1 truncate text-left"
											onClick={
												newShell
													? () => onFileClick?.(joinPath(load.changes.root, file.path))
													: undefined
											}
										>
											<span style={dim}>{dir}</span>
											<span style={{ color: theme.colors.textMain }}>{name}</span>
										</Name>
										{newShell && file.unstaged && (
											<span
												title={t('workflows.changes.partlyStaged')}
												aria-label={t('workflows.changes.partlyStaged')}
												style={dim}
											>
												*
											</span>
										)}
										{file.additions === null ? (
											<span className="shrink-0 font-mono" style={dim}>
												{t('workflows.changes.noCounts')}
											</span>
										) : (
											<span className="shrink-0 font-mono tabular-nums">
												<span style={{ color: addColor }}>+{file.additions}</span>{' '}
												<span style={{ color: delColor }}>-{file.deletions}</span>
											</span>
										)}
										{newShell && (
											<div
												className={`absolute right-0 flex items-center gap-1 rounded opacity-0 group-hover/changed-file:opacity-100 group-focus-within/changed-file:opacity-100 ${pending === file.path ? 'opacity-100' : ''}`}
												style={{ backgroundColor: theme.colors.bgSidebar }}
											>
												<button
													type="button"
													disabled={!!pending || refreshing}
													className="p-1 rounded hover:bg-white/10 disabled:opacity-40"
													aria-label={t(
														file.staged && file.status !== 'conflicted'
															? 'workflows.changes.unstageFile'
															: 'workflows.changes.stageFile',
														{ file: file.path }
													)}
													title={t(
														file.staged && file.status !== 'conflicted'
															? 'workflows.changes.unstageFile'
															: 'workflows.changes.stageFile',
														{ file: file.path }
													)}
													onClick={() =>
														void runAction({
															action:
																file.staged && file.status !== 'conflicted' ? 'unstage' : 'stage',
															paths: [file.path],
														})
													}
												>
													{pending === file.path ? (
														<Loader2 className="w-3.5 h-3.5 animate-spin" />
													) : file.staged && file.status !== 'conflicted' ? (
														<Minus className="w-3.5 h-3.5" />
													) : (
														<Plus className="w-3.5 h-3.5" />
													)}
												</button>
												{file.status !== 'conflicted' && (
													<button
														type="button"
														disabled={!!pending || refreshing}
														className="p-1 rounded hover:bg-white/10 disabled:opacity-40"
														aria-label={t('workflows.changes.revertFile', { file: file.path })}
														title={t('workflows.changes.revertFile', { file: file.path })}
														onClick={() => confirmRevert(file)}
													>
														<Undo2 className="w-3.5 h-3.5" />
													</button>
												)}
											</div>
										)}
									</Row>
									{state && (
										<div className="ml-5 mb-2 font-mono text-xs overflow-x-auto">
											{state.kind === 'loading' && (
												<p style={dim}>{t('workflows.changes.loading')}</p>
											)}
											{state.kind === 'error' && (
												<p style={{ color: theme.colors.error }}>
													{t('workflows.changes.failed', { error: state.message })}
												</p>
											)}
											{state.kind === 'ready' && (
												<FileDiffBody state={state.diff} t={t} dim={dim} />
											)}
										</div>
									)}
								</li>
							);
						})}
					</Fragment>
				))}
			</ul>
		);
	})();

	return (
		<div className="h-full flex flex-col min-h-0" data-testid="changes-panel">
			<style>{diffStyles}</style>
			<div className="flex items-center gap-2 py-2 text-xs" style={dim}>
				<span className="flex-1 min-w-0 truncate" data-testid="changes-summary">
					{changes && hasChanges
						? t(
								changes.totals.files === 1
									? 'workflows.changes.summaryOne'
									: 'workflows.changes.summary',
								{ files: changes.totals.files }
							)
						: (changes?.branch ?? '')}
					{changes && hasChanges && (
						<>
							{' '}
							<span style={{ color: addColor }}>+{changes.totals.additions}</span>{' '}
							<span style={{ color: delColor }}>-{changes.totals.deletions}</span>
						</>
					)}
				</span>
				<button
					type="button"
					onClick={() => void refresh()}
					className="p-1 rounded hover:bg-white/5"
					title={t('workflows.changes.refresh')}
					aria-label={t('workflows.changes.refresh')}
				>
					<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
				</button>
			</div>
			{changes?.truncated && (
				<p className="text-xs pb-2" style={dim}>
					{t('workflows.changes.truncated', {
						shown: changes.files.length,
						total: changes.totals.files,
					})}
				</p>
			)}
			<div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">{body}</div>
			<div className="pt-3">
				<button
					type="button"
					disabled={!canReview}
					onClick={() => activeTab && requestAiHandoff(session.id, activeTab.id, 'review')}
					className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-white/5"
					style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					data-testid="changes-review"
				>
					<ShieldCheck className="w-3.5 h-3.5" />
					{t('workflows.changes.review')}
				</button>
			</div>
			{newShell && (
				<>
					{actionError && (
						<p
							role="alert"
							className="pt-2 text-xs whitespace-pre-wrap select-text"
							style={{ color: theme.colors.error }}
						>
							{actionError}
						</p>
					)}
					<div className="flex items-center gap-2 pt-3 pb-1">
						<input
							type="text"
							value={message}
							disabled={!!pending}
							aria-label={t('workflows.changes.commitMessage')}
							placeholder={t(
								stagedCount ? 'workflows.changes.commitMessage' : 'workflows.changes.stageFirst'
							)}
							onChange={(event) => setMessage(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
									event.preventDefault();
									event.stopPropagation();
									if (canCommit) void runAction({ action: 'commit', message });
								}
							}}
							className="min-w-0 flex-1 px-2 py-1.5 rounded border text-xs"
							style={{
								borderColor: theme.colors.border,
								backgroundColor: theme.colors.bgMain,
								color: theme.colors.textMain,
							}}
						/>
						<button
							type="button"
							disabled={!canCommit}
							onClick={() => void runAction({ action: 'commit', message })}
							className="shrink-0 flex items-center gap-1 rounded px-2 py-1.5 text-xs disabled:opacity-40"
							style={{ backgroundColor: theme.colors.accent, color: theme.colors.accentForeground }}
						>
							{pending === 'commit' && <Loader2 className="w-3 h-3 animate-spin" />}
							{t(
								stagedCount === 1
									? 'workflows.changes.commitOne'
									: stagedCount
										? 'workflows.changes.commitCount'
										: 'workflows.changes.commit',
								{
									count: stagedCount,
								}
							)}
						</button>
					</div>
				</>
			)}
		</div>
	);
});

function FileDiffBody({
	state,
	t,
	dim,
}: {
	state: GitFileChangeDiff;
	t: ReturnType<typeof useT>;
	dim: { color: string };
}) {
	const parsed = useMemo(() => (state.diff ? parseGitDiff(state.diff) : []), [state.diff]);
	if (state.tooLarge) return <p style={dim}>{t('workflows.changes.tooLarge')}</p>;
	if (state.binary) return <p style={dim}>{t('workflows.changes.binary')}</p>;
	const files = parsed.flatMap((entry) => entry.parsedDiff);
	if (files.length === 0) return <p style={dim}>{t('workflows.changes.noDiff')}</p>;
	return (
		<>
			{files.map((file, index) => (
				<Diff key={index} viewType="unified" diffType={file.type} hunks={file.hunks}>
					{(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
				</Diff>
			))}
		</>
	);
}
