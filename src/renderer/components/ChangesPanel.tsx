import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Diff, Hunk } from 'react-diff-view';
import { ChevronDown, ChevronRight, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Session, Theme } from '../types';
import type { GitChangedFile, GitChanges, GitFileChangeDiff } from '../../shared/gitChanges';
import { gitService } from '../services/git';
import { resolveGitCwd, resolveGitSshRemoteId } from '../hooks/git/useGitAgentActions';
import { canHandOffTab, requestAiHandoff } from '../services/aiHandoffEntry';
import { parseGitDiff } from '../utils/gitDiffParser';
import { generateDiffViewStyles } from '../utils/markdownConfig';
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
}

export const ChangesPanel = memo(function ChangesPanel({ theme, session }: ChangesPanelProps) {
	const t = useT();
	const colorBlindMode = useSettingsStore((s) => s.colorBlindMode);
	const cwd = resolveGitCwd(session);
	const sshRemoteId = resolveGitSshRemoteId(session);
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
			const changes = await gitService.getChanges(cwd, sshRemoteId);
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
	}, [cwd, sshRemoteId]);

	useEffect(() => {
		setLoad({ kind: 'loading' });
		setOpen({});
		void refresh();
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
				const diff = await gitService.getChangeDiff(cwd, file.path, sshRemoteId);
				setOpen((previous) =>
					previous[file.path] ? { ...previous, [file.path]: { kind: 'ready', diff } } : previous
				);
			} catch (error) {
				setOpen((previous) =>
					previous[file.path]
						? { ...previous, [file.path]: { kind: 'error', message: messageOf(error) } }
						: previous
				);
			}
		},
		[cwd, open, sshRemoteId]
	);

	const activeTab = session.aiTabs.find((tab) => tab.id === session.activeTabId);
	const changes = load.kind === 'ready' ? load.changes : null;
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
				{load.changes.files.map((file) => {
					const { dir, name } = splitPath(file.path);
					const state = open[file.path];
					return (
						<li key={file.path}>
							<button
								type="button"
								onClick={() => void toggleFile(file)}
								aria-expanded={!!state}
								className="w-full flex items-center gap-2 px-1 py-1 rounded text-left text-xs hover:bg-white/5"
								title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
							>
								{state ? (
									<ChevronDown className="w-3 h-3 shrink-0" style={dim} />
								) : (
									<ChevronRight className="w-3 h-3 shrink-0" style={dim} />
								)}
								<span
									className="font-mono w-3 shrink-0 text-center"
									style={dim}
									aria-label={t(`workflows.changes.status.${file.status}`)}
								>
									{STATUS_LETTER[file.status]}
								</span>
								<span className="min-w-0 flex-1 truncate">
									<span style={dim}>{dir}</span>
									<span style={{ color: theme.colors.textMain }}>{name}</span>
								</span>
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
							</button>
							{state && (
								<div className="ml-5 mb-2 font-mono text-xs overflow-x-auto">
									{state.kind === 'loading' && <p style={dim}>{t('workflows.changes.loading')}</p>}
									{state.kind === 'error' && (
										<p style={{ color: theme.colors.error }}>
											{t('workflows.changes.failed', { error: state.message })}
										</p>
									)}
									{state.kind === 'ready' && <FileDiffBody state={state.diff} t={t} dim={dim} />}
								</div>
							)}
						</li>
					);
				})}
			</ul>
		);
	})();

	return (
		<div className="h-full flex flex-col min-h-0" data-testid="changes-panel">
			<style>{diffStyles}</style>
			<div className="flex items-center gap-2 py-2 text-xs" style={dim}>
				<span className="flex-1 min-w-0 truncate" data-testid="changes-summary">
					{changes && hasChanges
						? t('workflows.changes.summary', { files: changes.totals.files })
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
