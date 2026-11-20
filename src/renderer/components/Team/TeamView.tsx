import { Fragment, useEffect, useRef, useState } from 'react';
import { PanelRight, Users } from 'lucide-react';
import { formatDurationCompact } from '../../../shared/duration';
import { TEAM_PHASES } from '../../../shared/team/types';
import { useT, useAppLocale, useFormatList } from '../../i18n';
import type { Theme } from '../../types';
import { useTeamState, useTeamStatus, useTeamStore } from '../../stores/teamStore';
import { HeaderActionButton } from '../ui/HeaderActionButton';
import { MiniBadge } from '../ui/MiniBadge';
import { useFocusAfterRender } from '../../hooks/utils/useFocusAfterRender';
import { useScrollPosition } from '../../hooks/ui/useScrollPosition';
import { TeamFeed } from './TeamFeed';
import { TeamPanel, type TeamPanelTab } from './TeamPanel';
import { TeamComposer } from './TeamComposer';
import { TeamMemberView } from './TeamMemberView';
import { CreateTeamModal } from './CreateTeamModal';
import { presentTeamOwnerCard, presentTeamText, presentTeamWait } from '../../services/teamClient';
import { teamStyle } from './TeamPrimitives';
import { TeamModelCatalogProvider } from './TeamModelCatalogs';

export function TeamSetupHost({ theme }: { theme: Theme }) {
	const open = useTeamStore((s) => s.setupOpen);
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		if (open) setMounted(true);
	}, [open]);
	useEffect(() => useTeamStore.getState().connect(), []);
	if (!open && !mounted) return null;
	return (
		<CreateTeamModal
			theme={theme}
			open={open}
			onClose={() => useTeamStore.getState().setSetupOpen(false)}
		/>
	);
}

export function TeamView({ theme }: { theme: Theme }) {
	const teamId = useTeamStore((s) => s.activeTeamId);
	const seat = useTeamStore((s) => s.activeSeat);
	const state = useTeamState(teamId);
	const status = useTeamStatus(teamId);
	const events = useTeamStore((s) => (teamId ? s.teams[teamId]?.events : undefined));
	const error = useTeamStore((s) => s.error);
	const [tab, setTab] = useState<TeamPanelTab>('output');
	const [panel, setPanel] = useState(true);
	const feedRef = useRef<HTMLDivElement>(null);
	const discussionRef = useRef<HTMLElement | null>(null);
	const [discussionId, setDiscussionId] = useState<string | null>(null);
	useFocusAfterRender(discussionRef, !!discussionId);
	useEffect(() => {
		if (discussionId) setDiscussionId(null);
	}, [discussionId]);
	const openDiscussion = (id: string) => {
		const target = document.getElementById(`team-discussion-${id}`);
		if (!target) return;
		for (let parent: HTMLElement | null = target; parent; parent = parent.parentElement) {
			if (parent instanceof HTMLDetailsElement) parent.open = true;
		}
		const detail = target.querySelector('details');
		if (detail) detail.open = true;
		target.tabIndex = -1;
		target.scrollIntoView({ block: 'nearest' });
		discussionRef.current = target;
		setDiscussionId(id);
	};
	const { isAtBottom, handleScroll, scrollToBottom } = useScrollPosition({ containerRef: feedRef });
	useEffect(() => {
		if (isAtBottom) scrollToBottom('auto');
	}, [events, isAtBottom, scrollToBottom]);
	useEffect(() => {
		scrollToBottom('auto');
	}, [teamId, seat, scrollToBottom]);
	const t = useT();
	const locale = useAppLocale();
	const formatList = useFormatList();
	if (!teamId || !state || !status || !events)
		return <div role="status">{t('workflows.team.loading')}</div>;
	const selectPanel = (value: TeamPanelTab) => {
		setTab(value);
		setPanel(true);
	};
	const budgetBlocked = !state.terminal && status.budget.exhausted;
	const current = state.terminal
		? t(
				state.terminal === 'all'
					? 'workflows.team.accepted'
					: state.terminal === 'gaps'
						? 'workflows.team.gaps'
						: 'workflows.team.stopped',
				{ count: state.residual.length }
			)
		: budgetBlocked
			? t('workflows.team.budgetBlocked')
			: state.paused
				? t('workflows.team.paused')
				: state.openCards.length
					? t('workflows.team.waitingOwner')
					: t(`workflows.team.phase.${state.phase}`);
	const issues = state.issues.filter((issue) => issue.state !== 'verified-pass');
	const solvingItems =
		state.terminal === 'all'
			? []
			: state.residual.length
				? state.residual.map(
						(id) =>
							state.criteria.find((criterion) => criterion.id === id)?.text ??
							presentTeamText(id, state, t)
					)
				: issues.length
					? issues.map((issue) => issue.opened.title)
					: status.openWorkItems.map((item) => item.title);
	const solving =
		formatList(solvingItems) ||
		(state.terminal === 'all' ? '' : state.brief?.scope) ||
		t('workflows.team.noProblems');
	const solvingPreview = solvingItems.length > 2 ? formatList(solvingItems.slice(0, 2)) : solving;
	const next = state.terminal
		? t('workflows.team.noNext')
		: (state.openCards[0] ? presentTeamOwnerCard(state.openCards[0], state, t).title : '') ||
			state.followUps.map((wait) => presentTeamWait(wait, state, t, locale)?.title).find(Boolean) ||
			status.openWorkItems[0]?.title ||
			t('workflows.team.scheduler');
	return (
		<TeamModelCatalogProvider config={state.config!}>
			<div
				className="team-surface flex flex-1 min-w-0 min-h-0 relative"
				style={teamStyle(theme)}
				data-testid="team-view"
			>
				{seat ? (
					<TeamMemberView
						key={`${teamId}:${seat}`}
						teamId={teamId}
						seat={seat}
						state={state}
						theme={theme}
					/>
				) : (
					<main className="flex flex-col flex-1 min-w-0 min-h-0">
						<header
							className="team-head"
							style={{ flexWrap: 'nowrap' }}
							data-testid="team-header"
							data-control-state={
								state.terminal ?? (budgetBlocked ? 'budget' : state.paused ? 'paused' : 'active')
							}
						>
							<Users size={18} className="shrink-0" />
							<div className="flex items-center gap-2 flex-1 min-w-0">
								<h2 className="font-semibold flex-1 min-w-0 truncate" title={state.config!.title}>
									{state.config!.title}
									{(budgetBlocked || state.paused) &&
										` · ${t(budgetBlocked ? 'workflows.team.budgetBlocked' : 'workflows.team.paused')}`}
								</h2>
								<span
									className="team-dim min-w-0 truncate"
									title={
										status.budget.deadline
											? new Date(status.budget.deadline).toLocaleString(locale)
											: undefined
									}
								>
									{status.budget.deadline
										? t('workflows.team.deadlineRemaining', {
												time: formatDurationCompact(status.budget.remainingMs ?? 0),
											})
										: t('workflows.team.noDeadline')}{' '}
									·{' '}
									{t('workflows.team.turns', {
										used: status.budget.turnsUsed,
										total: status.budget.turnsTotal,
									})}
								</span>
							</div>
							<div
								className="flex items-center gap-2 shrink-0 whitespace-nowrap"
								data-testid="team-header-actions"
							>
								<HeaderActionButton
									theme={theme}
									variant="ghost"
									onClick={() => selectPanel('members')}
								>
									{t('workflows.team.membersRules')}
								</HeaderActionButton>
								<button
									type="button"
									aria-label={t('workflows.team.panel')}
									aria-expanded={panel}
									onClick={() => setPanel(!panel)}
								>
									<PanelRight size={16} />
								</button>
							</div>
						</header>
						<div
							data-testid="team-phase-strip"
							className="flex items-center gap-2 px-4 py-2 border-b min-w-0 shrink-0"
							style={{ borderColor: 'var(--team-border)' }}
						>
							<div
								className="flex items-center gap-1 min-w-0 overflow-x-auto overflow-y-hidden"
								data-testid="team-phase-scroll"
							>
								{TEAM_PHASES.map((phase, i) => (
									<Fragment key={phase}>
										{i > 0 && (
											<span
												aria-hidden="true"
												className="shrink-0"
												style={{ color: 'var(--team-border)' }}
											>
												›
											</span>
										)}
										<span
											className="shrink-0 whitespace-nowrap rounded-full px-1 py-0.5 text-xs"
											aria-current={phase === state.phase ? 'step' : undefined}
											style={{
												fontWeight: phase === state.phase ? 600 : 400,
												background: phase === state.phase ? 'var(--team-soft)' : undefined,
												color: phase === state.phase ? 'var(--team-text)' : 'var(--team-dim)',
											}}
										>
											{t(`workflows.team.phase.${phase}`)}
										</span>
									</Fragment>
								))}
							</div>
							{!state.terminal && state.openCards.length > 0 && (
								<MiniBadge
									theme={theme}
									className="whitespace-nowrap"
									testId="team-needs-you"
									label={t('workflows.team.needsYou', { count: state.openCards.length })}
									style={{ color: 'var(--team-on-accent)', background: 'var(--team-accent)' }}
								/>
							)}
						</div>
						<div className="team-status" data-testid="team-status">
							<div aria-live="polite" data-status-cell="now">
								<span className="team-dim block truncate">{t('workflows.team.now')}</span>
								<span className="block truncate" data-status-value title={current}>
									{current}
								</span>
							</div>
							<div data-status-cell="solving">
								<span className="team-dim block truncate">{t('workflows.team.solving')}</span>
								<div className="flex gap-1 min-w-0" data-status-value title={solving}>
									<span className="truncate">{solvingPreview}</span>
									{solvingItems.length > 2 && (
										<span
											className="shrink-0 whitespace-nowrap"
											data-status-more={solvingItems.length - 2}
										>
											{t('workflows.team.moreItems', { count: solvingItems.length - 2 })}
										</span>
									)}
								</div>
							</div>
							<div data-status-cell="next">
								<span className="team-dim block truncate">{t('workflows.team.next')}</span>
								<span className="block truncate" data-status-value title={next}>
									{next}
								</span>
							</div>
							<div data-status-cell="output">
								<span className="team-dim block truncate">{t('workflows.team.output')}</span>
								{state.outputs.length ? (
									<button
										className="underline block max-w-full truncate text-left"
										data-status-value
										title={t('workflows.team.preview')}
										onClick={() => selectPanel('output')}
									>
										{t('workflows.team.preview')} ›
									</button>
								) : (
									<span
										className="block truncate"
										data-status-value
										title={t('workflows.team.noneYet')}
									>
										{t('workflows.team.noneYet')}
									</span>
								)}
							</div>
						</div>
						{error && (
							<p role="alert" className="px-5 py-2">
								{t('workflows.team.error', { error })}
								<button
									className="team-button ml-2"
									onClick={() => void useTeamStore.getState().refresh()}
								>
									{t('workflows.team.retry')}
								</button>
							</p>
						)}
						<div ref={feedRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-auto">
							<TeamFeed
								state={state}
								events={events}
								theme={theme}
								onChanges={() => selectPanel('changes')}
							/>
						</div>
						<TeamComposer key={teamId} state={state} />
						{!state.terminal && (
							<div className="flex gap-2 px-5 pb-2" style={{ background: 'var(--team-side)' }}>
								{!budgetBlocked && (
									<button
										className="team-button"
										onClick={() =>
											void useTeamStore
												.getState()
												.command(teamId, state.paused ? 'resume' : 'pause')
										}
									>
										{t(state.paused ? 'workflows.team.resume' : 'workflows.team.pause')}
									</button>
								)}
								<button
									className="team-button"
									onClick={() => void useTeamStore.getState().command(teamId, 'stop')}
								>
									{t('workflows.team.stop')}
								</button>
								<button
									className="team-button"
									onClick={() => void useTeamStore.getState().command(teamId, 'export')}
								>
									{t('workflows.team.export')}
								</button>
							</div>
						)}
					</main>
				)}
				{panel && !seat && (
					<TeamPanel
						state={state}
						theme={theme}
						tab={tab}
						onTab={setTab}
						onDiscussion={openDiscussion}
					/>
				)}
			</div>
		</TeamModelCatalogProvider>
	);
}
