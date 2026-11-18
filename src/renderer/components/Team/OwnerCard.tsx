import type { OwnerCard as OwnerCardData, TeamState } from '../../../shared/team/types';
import { presentTeamOwnerCard, presentTeamText } from '../../services/teamClient';
import { useTeamStore } from '../../stores/teamStore';
import { useT, useFormatList } from '../../i18n';
import { SeatTag } from './TeamPrimitives';
import type { Theme } from '../../types';
import { TeamEscalation } from './TeamEscalation';
import { TeamBaseline } from './TeamBaseline';

export function OwnerCard({
	card: source,
	teamId,
	state,
	emphasis = true,
	answered,
	theme,
}: {
	card: OwnerCardData;
	teamId: string;
	state: TeamState;
	emphasis?: boolean;
	answered?: string;
	theme?: Theme;
}) {
	const t = useT();
	const formatList = useFormatList();
	const card = presentTeamOwnerCard(source, state, t);
	const busy = useTeamStore(
		(s) => s.pending[`${teamId}:${card.id}`] || s.pending[`${teamId}:baseline`]
	);
	const brief = source.payload?.type === 'baseline' ? source.payload.brief : state.brief;
	const discussion = source.payload?.type === 'discussion' ? source.payload : undefined;
	const baseline = card.boundary === 'baseline';
	const trials = state.checks.filter(
		(check) => check.purpose === 'trial' && check.batchId === `trial:${card.briefVersion}`
	);
	const bare = /^(continue|继续)[.!。！]?$/i;
	const options = [...card.options].sort(
		(a, b) => Number(!!b.recommended) - Number(!!a.recommended)
	);
	const visible = options.filter(
		(option) =>
			!bare.test(option.label.trim()) && (!baseline || !/edit|diff|return|back/i.test(option.id))
	);
	return (
		<section
			className="team-card"
			data-card={baseline ? 'baseline' : 'owner'}
			data-boundary={card.boundary}
			data-emphasis={emphasis && !answered}
			aria-label={card.title}
		>
			<h3>{card.title}</h3>
			{card.body && <p className="whitespace-pre-wrap">{card.body}</p>}
			{card.question && <p>{card.question}</p>}
			{!baseline && card.boundary !== 'acceptance' && (
				<p className="team-dim text-xs">
					{t('workflows.team.boundary', {
						boundary: formatList(
							(card.boundaries ?? [card.boundary]).map((boundary) =>
								t(`workflows.team.boundary.${boundary}`)
							)
						),
					})}
				</p>
			)}
			<TeamEscalation card={source} state={state} theme={theme} />
			{card.budgetNote && <p className="team-dim">{card.budgetNote}</p>}
			{baseline && (
				<>
					<TeamBaseline
						frozenDiff={source.payload?.type === 'baseline' ? source.payload.diff : undefined}
						brief={brief!}
						state={state}
						editable={!answered && state.openCards.some((open) => open.id === card.id)}
					/>
					<p>
						<b>{t('workflows.team.notDoing')}</b>: {formatList(brief?.notDoing ?? [])}
					</p>
					{trials.length > 0 && (
						<p className="team-dim">
							{t(
								trials.every((check) => !check.notRun && !check.timedOut)
									? 'workflows.team.baselineDryRun'
									: 'workflows.team.baselineDryRunFailed'
							)}
						</p>
					)}
				</>
			)}
			{discussion && (
				<div
					data-card={source.standardChange ? 'standard-change' : 'commitment'}
					className="space-y-3"
				>
					{source.standardChange && (
						<>
							<div className="grid grid-cols-2 gap-3">
								<div data-standard="before">
									<h4>{t('workflows.team.previousText')}</h4>
									<p>{discussion.before?.text}</p>
								</div>
								<div data-standard="after">
									<h4>{t('workflows.team.proposedText')}</h4>
									<p>{discussion.after?.text}</p>
								</div>
							</div>
							<p>
								{t('workflows.team.standardReason')}:{' '}
								{presentTeamText(source.standardChange.reason, state, t)}
							</p>
							{discussion.failingNow && (
								<p data-failing-now>{t('workflows.team.failureUnchanged')}</p>
							)}
						</>
					)}
					{discussion.positions.map((position) => (
						<div key={position.id}>
							<SeatTag seat={position.seat} model={state.seats[position.seat].model} />
							<p>{position.claim}</p>
							<p className="team-dim">{position.basis}</p>
						</div>
					))}
					<p>{discussion.proposal}</p>
					{source.referenceVotes && (
						<div data-reference-votes className="team-dim text-xs">
							<p>{t('workflows.team.referenceOnly')}</p>
							{discussion.responses.map((response) => (
								<p key={response.id}>
									{t('workflows.team.voteCount', {
										seat: t(`workflows.team.${response.seat}`),
										result: t(`workflows.team.${response.result}`),
									})}
								</p>
							))}
						</div>
					)}
				</div>
			)}
			{answered ? (
				<p>
					{t('workflows.team.answered', {
						option:
							card.options.find((o) => o.id === answered)?.label ?? t('workflows.team.superseded'),
					})}
				</p>
			) : (
				<div className="flex flex-wrap gap-2">
					{visible.map((option, index) => (
						<button
							type="button"
							className="team-button text-left"
							data-primary={emphasis && index === 0}
							key={option.id}
							data-option={option.id}
							data-boundary={option.boundary ?? card.boundary}
							disabled={busy}
							onClick={() => void useTeamStore.getState().answer(teamId, card.id, option.id)}
						>
							<span>
								{option.label}
								{option.recommended && !baseline && card.boundary !== 'acceptance'
									? ` (${t('workflows.team.recommended')})`
									: ''}
							</span>
							{option.cost && (
								<span className="block">{t('workflows.team.cost', { cost: option.cost })}</span>
							)}
						</button>
					))}
					{visible.length !== options.length && options.some((o) => bare.test(o.label.trim())) && (
						<p role="status">{t('workflows.team.noBareContinue')}</p>
					)}
				</div>
			)}
		</section>
	);
}
