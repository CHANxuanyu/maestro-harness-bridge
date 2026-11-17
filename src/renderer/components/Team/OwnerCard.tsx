import { useState } from 'react';
import type { OwnerCard as OwnerCardData, TeamState } from '../../../shared/team/types';
import { teamFeatures } from '../../services/teamClient';
import { useTeamStore } from '../../stores/teamStore';
import { useT } from '../../i18n';
import { Criteria, TeamFold } from './TeamPrimitives';

export function OwnerCard({
	card,
	teamId,
	state,
	emphasis = true,
	answered,
}: {
	card: OwnerCardData;
	teamId: string;
	state: TeamState;
	emphasis?: boolean;
	answered?: string;
}) {
	const t = useT();
	const busy = useTeamStore((s) => s.pending[`${teamId}:${card.id}`]);
	const [note, setNote] = useState('');
	const baseline = card.boundary === 'baseline';
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
			<p className="whitespace-pre-wrap">{card.body}</p>
			<p className="team-dim">
				{t('workflows.team.boundary', { boundary: t(`workflows.team.boundary.${card.boundary}`) })}
			</p>
			{card.budgetNote && <p className="team-dim">{card.budgetNote}</p>}
			{baseline && (
				<>
					<Criteria state={state} />
					<p>
						<b>{t('workflows.team.notDoing')}</b>: {state.brief?.notDoing.join('；')}
					</p>
				</>
			)}
			{answered ? (
				<p>
					{t('workflows.team.answered', {
						option: card.options.find((o) => o.id === answered)?.label ?? answered,
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
							disabled={busy}
							onClick={() => void useTeamStore.getState().answer(teamId, card.id, option.id)}
						>
							<span>
								{option.label}
								{option.recommended ? ` (${t('workflows.team.recommended')})` : ''}
							</span>
							{option.cost && (
								<span className="block">{t('workflows.team.cost', { cost: option.cost })}</span>
							)}
							<span className="block">
								{t('workflows.team.boundary', {
									boundary: t(`workflows.team.boundary.${option.boundary ?? card.boundary}`),
								})}
							</span>
						</button>
					))}
					{visible.length !== options.length && options.some((o) => bare.test(o.label.trim())) && (
						<p role="status">{t('workflows.team.noBareContinue')}</p>
					)}
				</div>
			)}
			{baseline && !answered && (
				<>
					{teamFeatures.baselineDiff && (
						<TeamFold title={t('workflows.team.diff')}>
							<pre className="whitespace-pre-wrap">
								{state.briefs
									.map((brief) => brief.criteria.map((c) => `${c.id}: ${c.text}`).join('\n'))
									.join('\n\n')}
							</pre>
						</TeamFold>
					)}
					{(teamFeatures.baselineReturn || teamFeatures.baselineEdit) && (
						<>
							<label>
								{t('workflows.team.returnNote')}
								<textarea value={note} onChange={(e) => setNote(e.target.value)} />
							</label>
							{options
								.filter(
									(o) =>
										(teamFeatures.baselineReturn && /return|back/i.test(o.id)) ||
										(teamFeatures.baselineEdit && /edit/i.test(o.id))
								)
								.map((o) => (
									<button
										key={o.id}
										className="team-button"
										disabled={!note.trim() || busy}
										onClick={() => void useTeamStore.getState().answer(teamId, card.id, o.id, note)}
									>
										{o.label}
									</button>
								))}
						</>
					)}
				</>
			)}
		</section>
	);
}
