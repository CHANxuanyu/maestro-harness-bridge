import type { TeamState } from '../../../shared/team/types';
import { TeamCost, TeamResiduals } from './TeamProgress';
import { presentTeamText } from '../../services/teamClient';
import { useT } from '../../i18n';

/** One terminal summary, including accepted/stopped paths with no terminal event. */
export function TeamSummary({ state }: { state: TeamState }) {
	const t = useT();
	if (!state.terminal) return null;
	const stats = state.statistics;
	const review = state.reviews.at(-1);
	const residual = state.residual.length
		? state.residual
		: state.terminal === 'stopped'
			? state.criteria
					.filter((criterion) => criterion.status !== 'pass')
					.map((criterion) => criterion.id)
			: [];
	return (
		<section className="team-card" data-card="summary">
			<h3>{t('workflows.team.summary')}</h3>
			<p className="team-dim">{t('workflows.team.summarySource')}</p>
			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
				<dt>{t('workflows.team.summaryResult')}</dt>
				<dd>
					{t(
						state.terminal === 'all'
							? 'workflows.team.accepted'
							: state.terminal === 'gaps'
								? 'workflows.team.gaps'
								: 'workflows.team.stopped',
						{ count: state.residual.length }
					)}
					{residual.map((item) => (
						<p key={item}>
							{state.criteria.find((criterion) => criterion.id === item)?.text ??
								presentTeamText(item, state, t)}
						</p>
					))}
				</dd>
				<dt>{t('workflows.team.summaryOwner')}</dt>
				<dd>
					{t('workflows.team.summaryOwnerCounts', {
						decisions: stats.ownerDecisions,
						messages: stats.ownerMessages,
					})}
				</dd>
				<dt>{t('workflows.team.summaryTeam')}</dt>
				<dd>
					{t('workflows.team.summaryTeamCounts', {
						discussions: stats.discussions,
						decisions: state.decisions.length,
					})}
					<p>
						{review
							? t('workflows.team.summaryReviewCounts', {
									rejections: stats.rejections,
									retros: stats.retros,
									result: t(
										review.verdict === 'pass' ? 'workflows.team.pass' : 'workflows.team.reject'
									),
								})
							: t('workflows.team.summaryNoReview')}
					</p>
				</dd>
				<dt>{t('workflows.team.summaryRecovery')}</dt>
				<dd>
					{stats.recoveries || stats.substitutions
						? t('workflows.team.summaryRecoveryCounts', {
								recoveries: stats.recoveries,
								substitutions: stats.substitutions,
							})
						: t('workflows.team.summaryNoRecovery')}
				</dd>
				<dt>{t('workflows.team.summaryWakes')}</dt>
				<dd>{t('workflows.team.summaryWakeCount', { count: stats.wakes })}</dd>
				<dt>{t('workflows.team.summaryUsage')}</dt>
				<dd>{t('workflows.team.turns', { used: stats.turns, total: state.config!.turnBudget })}</dd>
				<dt>{t('workflows.team.standardChanges')}</dt>
				<dd>
					{state.standardChanges.length
						? state.standardChanges.map((change) => (
								<p key={change.id}>
									{change.before} → {change.after}
								</p>
							))
						: t('workflows.team.summaryNone')}
				</dd>
				{!!review?.suggestions.length && (
					<>
						<dt>{t('workflows.team.suggestions')}</dt>
						<dd>
							{review.suggestions.map((suggestion, index) => (
								<p key={index}>{suggestion}</p>
							))}
						</dd>
					</>
				)}
			</dl>
			<TeamResiduals state={state} />
			<TeamCost state={state} />
		</section>
	);
}
