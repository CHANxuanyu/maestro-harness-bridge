import { presentTeamText } from '../../services/teamClient';
import type { TeamDiscussion as Discussion, TeamState } from '../../../shared/team/types';
import { discussionDecider } from '../../../shared/team/policy';
import { useT } from '../../i18n';
import { SeatTag, TeamFold, criterionLabel, teamEvidenceLabel } from './TeamPrimitives';

export function discussionPositionsOpen(discussion: Discussion, state: TeamState): boolean {
	return (
		!!discussion.decision ||
		discussion.responses.length > 0 ||
		state.turns.some(
			(turn) =>
				turn.dispatched?.discussionId === discussion.id && turn.dispatched.turn === 'response'
		)
	);
}

/** One live projection per topic. Positions stay sealed through the proposal step. */
export function TeamDiscussion({
	discussion,
	state,
}: {
	discussion: Discussion;
	state: TeamState;
}) {
	const t = useT();
	const opened = discussion.opened;
	if (!opened) return null;
	const revealed = discussionPositionsOpen(discussion, state);
	const decider = discussion.decision?.decider ?? discussionDecider(discussion);
	const assignment = state.turns
		.filter((turn) => turn.dispatched?.discussionId === discussion.id)
		.at(-1)?.dispatched?.turn;
	const step = discussion.decision
		? 4
		: assignment === 'proposal'
			? 2
			: revealed
				? 3
				: discussion.proposals.length
					? 2
					: 1;
	const stepKey =
		step === 1 ? 'positions' : step === 2 ? 'proposal' : step === 3 ? 'responses' : 'decision';
	const authority = discussion.decision
		? t('workflows.team.decidedBy', { seat: t(`workflows.team.${decider}`) })
		: decider === 'owner'
			? t('workflows.team.ownerWillDecide')
			: decider === 'app'
				? t('workflows.team.appWillDecide')
				: t('workflows.team.teamWillDecide', { seat: t(`workflows.team.${decider}`) });
	return (
		<div
			id={`team-discussion-${discussion.id}`}
			data-discussion-id={discussion.id}
			data-step={step}
		>
			<TeamFold
				kind="discussion"
				title={
					<>
						<b>
							{t('workflows.team.discussion')} · {opened.topic}
						</b>
						<span className="team-dim" data-discussion-authority={decider}>
							{' · '}
							{[discussion.decision?.decision, authority].filter(Boolean).join(' · ')}
						</span>
						{discussion.decision?.contested && (
							<span data-contested className="ml-2 team-dim">
								{t('workflows.team.contested')}
							</span>
						)}
						<span className="team-dim block" data-discussion-current-step={step}>
							{t(`workflows.team.step.${stepKey}`)}
						</span>
					</>
				}
			>
				<p className="team-dim">
					{opened.actor === 'app'
						? t('workflows.team.raisedByApp')
						: t('workflows.team.raisedBy', { seat: t(`workflows.team.${opened.actor}`) })}
				</p>
				<section data-discussion-step="1" className="space-y-2">
					<h4 aria-current={step === 1 ? 'step' : undefined}>
						{t('workflows.team.step.positions')}
					</h4>
					{opened.participants.map((seat) => {
						const position = discussion.positions.find((p) => p.seat === seat);
						return (
							<div key={seat} data-position-seat={seat} data-sealed={!revealed}>
								<SeatTag seat={seat} model={state.seats[seat].model ?? state.config?.seats[seat]} />
								{revealed && position ? (
									<>
										<p>{position.claim}</p>
										<p className="team-dim">
											{t('workflows.team.basis')}: {position.basis}
										</p>
										{position.evidence?.map((evidence) => (
											<p key={evidence} className="team-dim">
												{teamEvidenceLabel(evidence, state)}
											</p>
										))}
										<p className="team-dim">
											{t('workflows.team.changeMind')}: {position.wouldChangeMind}
										</p>
									</>
								) : (
									<p className="team-dim">
										{t(position ? 'workflows.team.sealed' : 'workflows.team.awaitingPosition')}
									</p>
								)}
							</div>
						);
					})}
				</section>
				{step >= 2 && (
					<section data-discussion-step="2" className="space-y-2">
						<h4 aria-current={step === 2 ? 'step' : undefined}>
							{t('workflows.team.step.proposal')}
						</h4>
						<p>{t('workflows.team.decider', { seat: t(`workflows.team.${decider}`) })}</p>
						{discussion.proposals.map((proposal, index) => {
							const unchanged =
								index > 0 && proposal.proposal === discussion.proposals[index - 1].proposal;
							return (
								<div
									key={proposal.id}
									data-proposal-round={proposal.round ?? index + 1}
									data-unchanged={unchanged}
								>
									<h5 className="font-semibold">
										{t('workflows.team.round', { round: proposal.round ?? index + 1 })}
									</h5>
									{unchanged ? (
										<p className="team-dim">{t('workflows.team.proposalUnchanged')}</p>
									) : (
										<>
											{index > 0 && (
												<p className="team-dim">{t('workflows.team.proposalRevised')}</p>
											)}
											<p>{proposal.proposal}</p>
										</>
									)}
								</div>
							);
						})}
					</section>
				)}
				{step >= 3 && (
					<section data-discussion-step="3" className="space-y-2">
						<h4 aria-current={step === 3 ? 'step' : undefined}>
							{t('workflows.team.step.responses')}
						</h4>
						{discussion.responses.map((response) => (
							<div key={response.id}>
								<p className="team-dim">
									{t('workflows.team.round', { round: response.round ?? 1 })}
								</p>
								<SeatTag
									seat={response.seat}
									model={state.seats[response.seat].model ?? state.config?.seats[response.seat]}
								/>
								<p>
									{t(`workflows.team.${response.result}`)}:{' '}
									{presentTeamText(response.reason, state, t)}
								</p>
								{response.evidence && (
									<p className="team-dim">{teamEvidenceLabel(response.evidence, state)}</p>
								)}
								{response.baselineViolation && (
									<p className="team-dim">{criterionLabel(state, response.baselineViolation)}</p>
								)}
							</div>
						))}
					</section>
				)}
				{step >= 4 && (
					<section data-discussion-step="4" className="space-y-2">
						<h4 aria-current={step === 4 ? 'step' : undefined}>
							{t('workflows.team.step.decision')}
						</h4>
						{discussion.decision && (
							<>
								<p>{discussion.decision.decision}</p>
								<p>{t('workflows.team.decider', { seat: t(`workflows.team.${decider}`) })}</p>
								{discussion.decision.dissent && (
									<p>
										{t('workflows.team.dissent')}: {discussion.decision.dissent}
									</p>
								)}
								{discussion.decision.actions.map((action, index) => (
									<div key={index}>
										<SeatTag seat={action.seat} />
										<p>{action.action}</p>
										{action.waitFor && (
											<p className="team-dim">
												{t('workflows.team.waitingFor')}:{' '}
												{presentTeamText(action.waitFor, state, t)}
											</p>
										)}
									</div>
								))}
							</>
						)}
					</section>
				)}
			</TeamFold>
		</div>
	);
}
