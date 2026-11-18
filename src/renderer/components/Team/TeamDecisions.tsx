import type { LedgerEvent, TeamState } from '../../../shared/team/types';
import { useT } from '../../i18n';
import { presentTeamOwnerCard } from '../../services/teamClient';

export function TeamDecisions({
	state,
	events,
	onDiscussion,
}: {
	state: TeamState;
	events: readonly LedgerEvent[];
	onDiscussion: (id: string) => void;
}) {
	const t = useT();
	const link = (id: string) => (
		<button type="button" className="underline text-left" onClick={() => onDiscussion(id)}>
			{t('workflows.team.openDiscussion')}
		</button>
	);
	const decision = (entry: TeamState['decisions'][number]) => {
		const discussion = state.discussions.find((value) => value.id === entry.discussionId);
		return (
			<div key={entry.id} className="team-item" data-decision={entry.id}>
				<p>{entry.decision}</p>
				<p className="team-dim">
					{t('workflows.team.decider', { seat: t(`workflows.team.${entry.decider}`) })}
				</p>
				{discussion?.positions.map((position) => (
					<p key={position.id} className="team-dim">
						{t('workflows.team.basis')}: {position.basis}
					</p>
				))}
				{entry.dissent && (
					<p className="team-dim">
						{t('workflows.team.dissent')}: {entry.dissent}
					</p>
				)}
				{link(entry.discussionId)}
			</div>
		);
	};
	const owner = [
		...state.decisions
			.filter((entry) => entry.decider === 'owner')
			.map((entry) => ({ seq: entry.seq, node: decision(entry) })),
		...events.flatMap((event) => {
			if (event.cardId && state.cardAnswers.some((answer) => answer.cardId === event.cardId))
				return [];
			let label: string;
			let basis = '';
			switch (event.kind) {
				case 'baseline_confirmed':
					label = t('workflows.team.confirmBaseline');
					basis = t('workflows.team.baseline', { version: event.briefVersion });
					break;
				case 'baseline_edited':
					label = t('workflows.team.edit');
					basis = event.after;
					break;
				case 'baseline_returned':
					label = t('workflows.team.return');
					basis = event.note;
					break;
				case 'changes_requested':
					label = t('workflows.team.requestChanges');
					basis = event.note;
					break;
				case 'accepted':
					label = t('workflows.team.accept');
					basis = t('workflows.team.acceptanceBody');
					break;
				case 'stopped':
					label = t('workflows.team.stop');
					break;
				default:
					return [];
			}
			if (event.actor !== 'owner') return [];
			return [
				{
					seq: event.seq,
					node: (
						<div key={event.id} className="team-item" data-decision={event.id}>
							<p>{label}</p>
							<p className="team-dim">
								{t('workflows.team.decider', { seat: t('workflows.team.owner') })}
							</p>
							{basis && (
								<p>
									{t('workflows.team.basis')}: {basis}
								</p>
							)}
						</div>
					),
				},
			];
		}),
		...state.cardAnswers.flatMap((answer) => {
			const event = events.find(
				(event) => event.kind === 'decision_card' && event.card.id === answer.cardId
			);
			if (
				event?.kind !== 'decision_card' ||
				(event.card.discussionId &&
					state.decisions.some((entry) => entry.discussionId === event.card.discussionId))
			)
				return [];
			const card = presentTeamOwnerCard(event.card, state, t);
			return [
				{
					seq: answer.seq,
					node: (
						<div key={answer.id} className="team-item" data-decision={answer.id}>
							<p>
								{card.title} · {card.options.find((option) => option.id === answer.optionId)?.label}
							</p>
							<p className="team-dim">
								{t('workflows.team.decider', { seat: t('workflows.team.owner') })}
							</p>
							{(answer.note || card.body) && (
								<p>
									{t('workflows.team.basis')}: {answer.note || card.body}
								</p>
							)}
							{event.card.discussionId && link(event.card.discussionId)}
						</div>
					),
				},
			];
		}),
	];
	return (
		<>
			<section data-decisions="team">
				<h3>{t('workflows.team.teamDecisions')}</h3>
				{state.decisions
					.filter((entry) => entry.decider !== 'owner')
					.slice()
					.reverse()
					.map(decision)}
			</section>
			<section data-decisions="owner">
				<h3>{t('workflows.team.ownerDecisions')}</h3>
				{owner.sort((a, b) => b.seq - a.seq).map((entry) => entry.node)}
			</section>
			{state.standardChanges.length > 0 && (
				<section data-standard-changes>
					<h3>{t('workflows.team.standardChanges')}</h3>
					{state.standardChanges
						.slice()
						.reverse()
						.map((change) => (
							<div className="team-item" key={change.id}>
								<p>
									{t(`workflows.team.change.${change.change}`)} ·{' '}
									{change.before && <del>{change.before}</del>} {change.after}
								</p>
								<p className="team-dim">
									{change.reason} · {t(`workflows.team.${change.approvedBy}`)}
								</p>
							</div>
						))}
				</section>
			)}
			{!state.decisions.length && !owner.length && (
				<p className="team-dim">{t('workflows.team.noDecisions')}</p>
			)}
		</>
	);
}
