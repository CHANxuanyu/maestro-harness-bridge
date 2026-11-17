import { useEffect, useRef, useState } from 'react';
import { PanelRight, Users } from 'lucide-react';
import { TEAM_PHASES } from '../../../shared/team/types';
import { useT, useAppLocale } from '../../i18n';
import type { Theme } from '../../types';
import { useTeamState, useTeamStatus, useTeamStore } from '../../stores/teamStore';
import { HeaderActionButton } from '../ui/HeaderActionButton';
import { MiniBadge } from '../ui/MiniBadge';
import { EscCloseButton } from '../ui/EscCloseButton';
import { useModalLayer } from '../../hooks/ui/useModalLayer';
import { useScrollPosition } from '../../hooks/ui/useScrollPosition';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import { TeamFeed } from './TeamFeed';
import { TeamPanel, type TeamPanelTab } from './TeamPanel';
import { TeamComposer } from './TeamComposer';
import { TeamMemberView } from './TeamMemberView';
import { CreateTeamModal } from './CreateTeamModal';
import { teamStyle } from './TeamPrimitives';

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
	const { isAtBottom, handleScroll, scrollToBottom } = useScrollPosition({ containerRef: feedRef });
	useEffect(() => {
		if (isAtBottom) scrollToBottom('auto');
	}, [events, isAtBottom, scrollToBottom]);
	useEffect(() => {
		scrollToBottom('auto');
	}, [teamId, seat, scrollToBottom]);
	const t = useT();
	const locale = useAppLocale();
	useModalLayer(
		MODAL_PRIORITIES.GROUP_CHAT_INFO - 1,
		t('workflows.team.title'),
		() => {
			if (panel) setPanel(false);
			else useTeamStore.getState().selectTeam(null);
		},
		{
			enabled: !seat,
			capturesFocus: false,
			focusTrap: 'none',
			blocksAppShortcuts: false,
			blocksLowerLayers: false,
		}
	);
	if (!teamId || !state || !status || !events)
		return <div role="status">{t('workflows.team.loading')}</div>;
	const selectPanel = (value: TeamPanelTab) => {
		setTab(value);
		setPanel(true);
	};
	const current = state.terminal
		? t(
				state.terminal === 'all'
					? 'workflows.team.accepted'
					: state.terminal === 'gaps'
						? 'workflows.team.gaps'
						: 'workflows.team.stopped',
				{ count: state.residual.length }
			)
		: state.paused
			? t('workflows.team.paused')
			: state.openCards.length
				? t('workflows.team.waitingOwner')
				: t(`workflows.team.phase.${state.phase}`);
	const solving =
		state.terminal === 'all'
			? t('workflows.team.noProblems')
			: state.residual.length
				? state.residual.map((id) => state.criteria.find((c) => c.id === id)?.text ?? id).join('；')
				: state.issues
						.filter((i) => i.state !== 'verified-pass')
						.map((i) => i.opened.title)
						.join('；') ||
					status.openWorkItems.map((i) => i.title).join('；') ||
					state.brief?.scope ||
					t('workflows.team.noProblems');
	const next = state.terminal
		? t('workflows.team.noNext')
		: state.openCards[0]?.title ||
			state.followUps[0]?.waitFor ||
			status.openWorkItems[0]?.title ||
			t('workflows.team.scheduler');
	return (
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
					<header className="team-head">
						<Users size={18} />
						<h2 className="font-semibold">{state.config!.title}</h2>
						<span className="team-dim">
							{status.budget.deadline
								? t('workflows.team.deadlineAt', {
										time: new Date(status.budget.deadline).toLocaleString(locale),
									})
								: t('workflows.team.noDeadline')}{' '}
							·{' '}
							{t('workflows.team.turns', {
								used: status.budget.turnsUsed,
								total: status.budget.turnsTotal,
							})}
						</span>
						<div className="flex-1" />
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
						<EscCloseButton
							theme={theme}
							onClose={() => useTeamStore.getState().selectTeam(null)}
						/>
					</header>
					<div
						className="flex items-center gap-3 px-4 py-2 border-b overflow-x-auto shrink-0"
						style={{ borderColor: 'var(--team-border)' }}
					>
						{TEAM_PHASES.map((phase, i) => (
							<span
								key={phase}
								className="whitespace-nowrap rounded-full px-2 py-0.5"
								aria-current={phase === state.phase ? 'step' : undefined}
								style={{
									fontWeight: phase === state.phase ? 600 : 400,
									background: phase === state.phase ? 'var(--team-soft)' : undefined,
									color: phase === state.phase ? 'var(--team-text)' : 'var(--team-dim)',
								}}
							>
								{i ? '› ' : ''}
								{t(`workflows.team.phase.${phase}`)}
							</span>
						))}
						{state.openCards.length > 0 && (
							<MiniBadge
								theme={theme}
								label={t('workflows.team.needsYou', { count: state.openCards.length })}
								style={{ color: 'var(--team-on-accent)', background: 'var(--team-accent)' }}
							/>
						)}
					</div>
					<div className="team-status">
						<div aria-live="polite">
							<span className="team-dim block">{t('workflows.team.now')}</span>
							{current}
						</div>
						<div>
							<span className="team-dim block">{t('workflows.team.solving')}</span>
							{solving}
						</div>
						<div>
							<span className="team-dim block">{t('workflows.team.next')}</span>
							{next}
						</div>
						<div>
							<span className="team-dim block">{t('workflows.team.output')}</span>
							{state.outputs.length ? (
								<button className="underline" onClick={() => selectPanel('output')}>
									{t('workflows.team.preview')} ›
								</button>
							) : (
								t('workflows.team.noneYet')
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
					<div className="flex gap-2 px-5 pb-2" style={{ background: 'var(--team-side)' }}>
						{!state.terminal && (
							<>
								<button
									className="team-button"
									onClick={() =>
										void useTeamStore.getState().command(teamId, state.paused ? 'resume' : 'pause')
									}
								>
									{t(state.paused ? 'workflows.team.resume' : 'workflows.team.pause')}
								</button>
								<button
									className="team-button"
									onClick={() => void useTeamStore.getState().command(teamId, 'stop')}
								>
									{t('workflows.team.stop')}
								</button>
							</>
						)}
						<button
							className="team-button"
							onClick={() => void useTeamStore.getState().command(teamId, 'export')}
						>
							{t('workflows.team.export')}
						</button>
					</div>
				</main>
			)}
			{panel && !seat && (
				<TeamPanel
					state={state}
					theme={theme}
					tab={tab}
					onTab={setTab}
					onClose={() => setPanel(false)}
				/>
			)}
		</div>
	);
}
