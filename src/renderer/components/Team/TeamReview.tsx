import type { TeamEvent, TeamState } from '../../../shared/team/types';
import { useT } from '../../i18n';
import { criterionLabel, teamPathLabel, TeamFold } from './TeamPrimitives';

export function TeamReview({ review, state }: { review: TeamEvent<'review'>; state: TeamState }) {
	const t = useT();
	return (
		<section className="team-card" data-card="review" data-verdict={review.verdict}>
			<h3>
				{t('workflows.team.review')} ·{' '}
				{t(review.verdict === 'pass' ? 'workflows.team.pass' : 'workflows.team.reject')}
			</h3>
			<div data-review-problems>
				{review.problems.map((problem, index) => (
					<div key={index} className="team-item">
						<b>{problem.title}</b>
						<p className="team-dim">
							{t('workflows.team.location')}: {teamPathLabel(problem.location, state)}
						</p>
						<p>{criterionLabel(state, problem.criterion)}</p>
						<p>
							{t('workflows.team.impact')}: {problem.impact}
						</p>
						<p>
							{t('workflows.team.expected')}: {problem.expected}
						</p>
					</div>
				))}
			</div>
			{review.suggestions.length > 0 && (
				<div data-review-suggestions className="team-dim text-xs">
					<h4>{t('workflows.team.suggestions')}</h4>
					{review.suggestions.map((suggestion, index) => (
						<p key={index}>{suggestion}</p>
					))}
				</div>
			)}
		</section>
	);
}

export function TeamRetro({ retro }: { retro: TeamEvent<'retro'> }) {
	const t = useT();
	return (
		<section className="team-card" data-card="retro">
			<h3>{t('workflows.team.retro')}</h3>
			<p>{retro.summary}</p>
			{retro.approach && (
				<p>
					{t('workflows.team.approach')}: {retro.approach}
				</p>
			)}
			{retro.basis && (
				<p>
					{t('workflows.team.basis')}: {retro.basis}
				</p>
			)}
			{retro.difference && (
				<p>
					{t('workflows.team.difference')}: {retro.difference}
				</p>
			)}
			<p>
				{t('workflows.team.progressEvidence')}: {retro.progressEvidence}
			</p>
		</section>
	);
}

export function TeamReviewRecord({ state }: { state: TeamState }) {
	const t = useT();
	return (
		<TeamFold kind="review-record" title={t('workflows.team.reviewRecord')}>
			{state.reviewProgress.attempts.map((attempt) => {
				const review = state.reviews.find((entry) => entry.id === attempt.id);
				return (
					<div key={attempt.id} data-review-attempt={attempt.id} className="team-item">
						<p>
							{review
								? t('workflows.team.reviewAttempt', { count: state.reviews.indexOf(review) + 1 })
								: t('workflows.team.retro')}{' '}
							· {t(`workflows.team.progress.${attempt.verdict}`)}
						</p>
						{review?.problems.map((problem, index) => (
							<p key={index}>{problem.title}</p>
						))}
					</div>
				);
			})}
		</TeamFold>
	);
}
