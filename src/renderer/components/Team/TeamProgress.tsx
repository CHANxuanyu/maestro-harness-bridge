import { useState } from 'react';
import type { JudgedAttempt } from '../../../shared/progressRules';
import type { TeamState, TeamEvent } from '../../../shared/team/types';
import { SEAT_ROLES } from '../../../shared/team/types';
import { teamStatus } from '../../../shared/team/status';
import { formatCost, formatTokens, formatNumber } from '../../../shared/formatters';
import { formatDurationCompact } from '../../../shared/duration';
import { useAppLocale, useT } from '../../i18n';
import { useTeamStore } from '../../stores/teamStore';
import { criterionLabel, SeatTag } from './TeamPrimitives';
import { presentTeamText, presentTeamWait } from '../../services/teamClient';

export function TeamWait({
	wait,
	state,
}: {
	wait: TeamEvent<'follow_up_registered'>;
	state: TeamState;
}) {
	const t = useT();
	const locale = useAppLocale();
	const presentation = presentTeamWait(wait, state, t, locale);
	if (!presentation) return null;
	return (
		<div className="team-item" data-wait>
			<SeatTag seat={wait.seat} />
			<p>{presentation.title}</p>
			<p className="team-dim">{presentation.reason}</p>
			{wait.untilMs !== undefined && (
				<p data-next-check={wait.untilMs}>
					{t('workflows.team.nextCheck', { time: new Date(wait.untilMs).toLocaleString(locale) })}
				</p>
			)}
			<p className="team-dim text-xs">{t('workflows.team.waitCadence')}</p>
		</div>
	);
}

export function TeamAppStatus({ state }: { state: TeamState }) {
	const t = useT();
	const now = useTeamStore((s) => s.now);
	const status = teamStatus(state, now);
	return (
		<section className="team-card" data-card="app-status">
			<h3>{t('workflows.team.appStatus')}</h3>
			<p>
				{t('workflows.team.criteriaDone', {
					done: status.criteria.withEvidence,
					total: status.criteria.total,
				})}
			</p>
			{status.criteria.missing.map((criterion) => (
				<p key={criterion.id}>
					{criterion.text}: {presentTeamText(criterion.reason, state, t)}
				</p>
			))}
			<h4>{t('workflows.team.panel.progress')}</h4>
			{status.openWorkItems.map((item) => (
				<p key={item.itemId}>
					{item.title} · <SeatTag seat={item.owner} />
				</p>
			))}
			{state.followUps.map((wait) => (
				<TeamWait key={wait.id} wait={wait} state={state} />
			))}
			<p>
				{t('workflows.team.budgetUsed', {
					used: status.budget.turnsUsed,
					total: status.budget.turnsTotal,
				})}
			</p>
		</section>
	);
}

export function TeamAttempts({
	state,
	attempts,
}: {
	state: TeamState;
	attempts?: Record<string, JudgedAttempt[]>;
}) {
	const t = useT();
	return (
		<div data-testid="team-attempts" className="space-y-4">
			{Object.entries(
				attempts ??
					Object.fromEntries(
						Object.entries(state.problems).map(([id, problem]) => [id, problem.progress.attempts])
					)
			).map(([id, entries], number) => (
				<section key={id} className="team-item" data-problem={id}>
					<h3>{t('workflows.team.attemptLedger', { number: number + 1 })}</h3>
					{entries.map((attempt, index, attempts) => (
						<div
							key={attempt.id}
							data-verdict={attempt.verdict}
							className="border-t py-2 space-y-1"
							style={{ borderColor: 'var(--team-border)' }}
						>
							<h4>
								{t('workflows.team.attempt', { number: index + 1 })} ·{' '}
								{t(`workflows.team.verdict.${attempt.verdict}`, {
									number: attempts.findIndex((entry) => entry.id === attempt.repeatOf) + 1,
								})}
							</h4>
							{attempt.plan && <p>{presentTeamText(attempt.plan, state, t)}</p>}
							{(['basis', 'difference', 'expectation'] as const).map(
								(key) =>
									attempt[key] && (
										<p key={key}>
											<b>
												{t(`workflows.team.${key === 'expectation' ? 'expectedEvidence' : key}`)}
											</b>
											: {presentTeamText(attempt[key]!, state, t)}
										</p>
									)
							)}
						</div>
					))}
				</section>
			))}
		</div>
	);
}

export function TeamCost({ state }: { state: TeamState }) {
	const t = useT();
	const now = useTeamStore((s) => s.now);
	const rows = [
		...SEAT_ROLES.map((seat) => ({
			label: t(`workflows.team.${seat}`),
			key: seat,
			usage: state.seats[seat].usage,
		})),
		{ label: t('workflows.team.total'), key: 'total', usage: state.usage },
	];
	return (
		<section data-testid="team-cost" className="space-y-2">
			<h3>{t('workflows.team.costBill')}</h3>
			<div className="overflow-x-auto">
				<table className="w-full text-xs text-left">
					<thead>
						<tr>
							{(['seatLabel', 'actualTurns', 'tokens', 'recordedCost', 'memberTime'] as const).map(
								(key) => (
									<th key={key} className="p-1 font-medium">
										{t(`workflows.team.${key}`)}
									</th>
								)
							)}
						</tr>
					</thead>
					<tbody>
						{rows.map(({ label, key, usage }) => (
							<tr key={key} data-cost-seat={key}>
								<th className="p-1">{label}</th>
								<td data-turns={usage.turns}>{formatNumber(usage.turns)}</td>
								<td data-input={usage.inputTokens} data-output={usage.outputTokens}>
									{formatTokens(usage.inputTokens)} / {formatTokens(usage.outputTokens)}
								</td>
								<td data-cost={usage.costUsd}>{formatCost(usage.costUsd)}</td>
								<td data-duration={usage.durationMs}>{formatDurationCompact(usage.durationMs)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p>
				{t('workflows.team.wallTime', {
					time: formatDurationCompact(
						Math.max(0, (state.endedAt ?? now) - state.config!.createdAt)
					),
				})}
			</p>
			<p className="team-dim text-xs">
				{t('workflows.team.costCoverage', {
					reported: state.usage.turnsWithCost,
					turns: state.usage.turns,
				})}
			</p>
		</section>
	);
}

function ResidualOwner({ item, state }: { item: TeamEvent<'residual_item'>; state: TeamState }) {
	const t = useT();
	const [owner, setOwner] = useState(item.owner ?? '');
	const busy = useTeamStore((s) => s.pending[`${state.config!.id}:residual:${item.itemId}`]);
	return (
		<form
			className="team-item space-y-2"
			data-residual={item.itemId}
			onSubmit={async (event) => {
				event.preventDefault();
				await useTeamStore
					.getState()
					.assignResidual(state.config!.id, item.itemId, owner.trim() || null);
			}}
		>
			<p>
				<span className="team-dim">{t('workflows.team.unmet')}: </span>
				{presentTeamText(item.text, state, t)}
			</p>
			<label className="block">
				{t('workflows.team.followUpOwner')}
				<input
					className="w-full"
					value={owner}
					placeholder={t('workflows.team.unassigned')}
					onChange={(event) => setOwner(event.target.value)}
				/>
			</label>
			<button className="team-button" disabled={busy || owner.trim() === (item.owner ?? '')}>
				{t('workflows.team.saveOwner')}
			</button>
		</form>
	);
}
export function TeamResiduals({ state }: { state: TeamState }) {
	const t = useT();
	if (!state.residualItems.length) return null;
	return (
		<section data-testid="team-residuals">
			<h3>{t('workflows.team.residual')}</h3>
			{state.residualItems.map((item) => (
				<ResidualOwner key={`${item.itemId}:${item.owner}`} item={item} state={state} />
			))}
		</section>
	);
}

export function TeamWrapUp({ state }: { state: TeamState }) {
	const t = useT();
	if (!state.wrapUp) return null;
	return (
		<section className="team-card" data-card="wrap-up">
			<h3>{t('workflows.team.wrapUp')}</h3>
			<p>{state.wrapUp.summary}</p>
			<ul>
				{state.wrapUp.priorities.map((priority, index) => (
					<li key={index}>
						{criterionLabel(state, priority) || presentTeamText(priority, state, t)}
					</li>
				))}
			</ul>
		</section>
	);
}
