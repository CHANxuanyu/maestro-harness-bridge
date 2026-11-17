import { useMemo, useState } from 'react';
import type { LedgerEvent, SeatRole, TeamReport, TeamState } from '../../../shared/team/types';
import { SEAT_ROLES } from '../../../shared/team/types';
import { teamStatus } from '../../../shared/team/status';
import { formatDurationCompact } from '../../../shared/duration';
import { useT, useFormatList } from '../../i18n';
import type { Theme } from '../../types';
import { useTeamStore } from '../../stores/teamStore';
import { Criteria, SeatTag, TeamFold } from './TeamPrimitives';
import { deriveTeamFeed } from './deriveTeamFeed';
import { OwnerCard } from './OwnerCard';
import { TeamOutput } from './TeamOutput';
import { TeamSummary } from './TeamSummary';

function ReportMessage({ report }: { report: TeamReport }) {
	const t = useT();
	const formatList = useFormatList();
	switch (report.type) {
		case 'brief':
			return <p>{report.scope}</p>;
		case 'work':
			return (
				<>
					<p>{report.summary}</p>
					{report.done.map((text) => (
						<p key={text}>{text}</p>
					))}
				</>
			);
		case 'fix':
			return <p>{report.summary || formatList(report.fixed)}</p>;
		case 'qa_prep':
			return (
				<>
					{[...report.tests, ...report.samples].map((text) => (
						<p key={text}>{text}</p>
					))}
				</>
			);
		case 'verify':
			return (
				<>
					{report.criteria.map((c) => (
						<p key={c.id}>
							{c.id} · {t(c.pass ? 'workflows.team.pass' : 'workflows.team.fail')}: {c.evidence}
						</p>
					))}
				</>
			);
		case 'reverify':
			return (
				<>
					{report.results.map((r) => (
						<p key={r.issue}>
							{r.issue} ·{' '}
							{t(r.pass ? 'workflows.team.verified-pass' : 'workflows.team.verified-fail')}:{' '}
							{r.evidence}
						</p>
					))}
				</>
			);
		case 'demo':
			return <p>{report.summary}</p>;
		case 'topic':
			return (
				<p>
					{report.topic}: {report.why}
				</p>
			);
		case 'respond':
			return (
				<>
					{report.decisions.map((d, i) => (
						<p key={i}>
							{d.about}: {d.reason}
						</p>
					))}
				</>
			);
		case 'challenge':
			return (
				<>
					{report.objections.map((o, i) => (
						<p key={i}>
							{o.about}: {o.problem}
						</p>
					))}
				</>
			);
		case 'review':
			return (
				<>
					{report.problems.map((p, i) => (
						<p key={i}>
							{p.title}: {p.impact}
						</p>
					))}
					<p>{t(report.verdict === 'pass' ? 'workflows.team.pass' : 'workflows.team.reject')}</p>
				</>
			);
	}
}

export function DemoCard({
	state,
	theme,
	active,
	onChanges,
}: {
	state: TeamState;
	theme: Theme;
	active: boolean;
	onChanges: () => void;
}) {
	const t = useT();
	const formatList = useFormatList();
	const [editing, setEditing] = useState(false);
	const [note, setNote] = useState('');
	const status = teamStatus(state, Date.now());
	const id = state.config!.id;
	const busy = useTeamStore((s) => s.pending[`${id}:command`]);
	const ready =
		state.openCards.some((card) => card.boundary === 'acceptance') &&
		state.openCards.every((card) => card.boundary === 'acceptance') &&
		status.criteria.total > 0 &&
		status.criteria.withEvidence === status.criteria.total &&
		state.reviews.at(-1)?.verdict === 'pass';
	const report = [...state.turns].reverse().find((turn) => turn.report?.type === 'demo')?.report;
	return (
		<section
			className="team-card"
			data-card="demo"
			data-boundary="acceptance"
			data-emphasis={active && state.openCards.every((card) => card.boundary === 'acceptance')}
		>
			<h3>
				{t('workflows.team.demo')} <SeatTag seat="pm" model={state.seats.pm.model} />
			</h3>
			<TeamOutput state={state} theme={theme} />
			{report?.type === 'demo' && (
				<>
					<p>{report.summary}</p>
					<ul>
						{report.changes.map((change) => (
							<li key={change}>{change}</li>
						))}
					</ul>
				</>
			)}
			<TeamFold
				title={t('workflows.team.evidenceCount', {
					total: status.criteria.total,
					passed: status.criteria.withEvidence,
				})}
			>
				<Criteria state={state} />
				<p className="team-dim">{t('workflows.team.evidenceSource')}</p>
			</TeamFold>
			<TeamFold
				title={t('workflows.team.decisionCount', {
					team: state.decisions.filter((d) => d.decider !== 'owner').length,
					owner: state.statistics.ownerDecisions,
				})}
			>
				{state.decisions.map((d) => (
					<p key={d.id}>{d.decision}</p>
				))}
			</TeamFold>
			<TeamFold title={t('workflows.team.standardChanges')}>
				{state.standardChanges.length ? (
					state.standardChanges.map((c) => (
						<p key={c.id}>
							{c.criterionId}: {c.before} → {c.after} · {c.reason}
						</p>
					))
				) : (
					<p>{t('workflows.team.empty')}</p>
				)}
			</TeamFold>
			<p className="team-dim">
				{t('workflows.team.notDoing')}: {formatList(state.baseline.brief?.notDoing ?? [])}
			</p>
			{editing && (
				<label>
					{t('workflows.team.changeNote')}
					<textarea className="w-full" value={note} onChange={(e) => setNote(e.target.value)} />
					<button
						className="team-button"
						disabled={!note.trim() || busy}
						onClick={async () => {
							if (await useTeamStore.getState().requestChanges(id, note.trim())) {
								setEditing(false);
								setNote('');
							}
						}}
					>
						{t('workflows.team.sendChanges')}
					</button>
				</label>
			)}
			<div className="flex flex-wrap gap-2">
				{active && (
					<>
						<button
							className="team-button"
							data-primary="true"
							disabled={!ready || busy}
							onClick={() => void useTeamStore.getState().command(id, 'accept')}
						>
							{t('workflows.team.accept')}
						</button>
						<button className="team-button" disabled={busy} onClick={() => setEditing(!editing)}>
							{t('workflows.team.requestChanges')}
						</button>
					</>
				)}
				<button className="team-button" onClick={onChanges}>
					{t('workflows.team.viewChanges')}
				</button>
			</div>
		</section>
	);
}

function FeedEvent({
	event,
	state,
	events,
	theme,
	onChanges,
}: {
	event: LedgerEvent;
	state: TeamState;
	events: readonly LedgerEvent[];
	theme: Theme;
	onChanges: () => void;
}) {
	const t = useT();
	const formatList = useFormatList();
	const teamId = state.config!.id;
	const tag = (seat: SeatRole) => {
		const binding = [...events]
			.reverse()
			.find(
				(candidate) =>
					candidate.seq <= event.seq &&
					(candidate.kind === 'seat_bound' || candidate.kind === 'substitute_took_over') &&
					candidate.seat === seat
			);
		const model =
			binding && (binding.kind === 'seat_bound' || binding.kind === 'substitute_took_over')
				? binding.model
				: state.config!.seats[seat];
		return <SeatTag seat={seat} model={model} />;
	};
	switch (event.kind) {
		case 'team_created':
			return (
				<>
					<div
						className="self-end max-w-[85%] rounded-xl p-3"
						style={{ background: 'var(--team-activity)' }}
					>
						{event.config.idea}
					</div>
					<section className="team-card" data-card="team">
						<h3>
							{t('workflows.team.title')} · {event.config.title}
						</h3>
						{SEAT_ROLES.map((seat) => (
							<div key={seat}>
								<SeatTag seat={seat} model={event.config.seats[seat]} />
								<span className="team-dim">
									{' '}
									·{' '}
									{event.config.seats[seat].substitute ? (
										<SeatTag seat={seat} model={event.config.seats[seat].substitute} />
									) : (
										t('workflows.team.noSubstitute')
									)}
								</span>
							</div>
						))}
						<p className="team-dim">{t('workflows.team.alwaysAsk')}</p>
					</section>
				</>
			);
		case 'report_accepted':
			return (
				<div data-card="message" className="flex flex-col gap-1">
					{tag(event.seat)}
					<div className="whitespace-pre-wrap">
						<ReportMessage report={event.report} />
					</div>
				</div>
			);
		case 'brief_published':
			return (
				<section className="team-card" data-card="brief">
					<h3>{t('workflows.team.brief', { version: event.brief.version })}</h3>
					<p>{event.brief.scope}</p>
					<TeamFold title={t('workflows.team.criteria', { count: event.brief.criteria.length })}>
						{event.brief.criteria.map((c) => (
							<div key={c.id}>
								<span className="team-dim">{c.id} </span>
								{c.text}
								<p className="team-dim">
									{t(`workflows.team.proof.${c.proof}`)} · {c.how}
								</p>
							</div>
						))}
					</TeamFold>
					<p className="team-dim">
						{t('workflows.team.notDoing')}: {formatList(event.brief.notDoing)}
					</p>
				</section>
			);
		case 'challenge_submitted':
			return (
				<TeamFold
					kind="challenge"
					title={
						<>
							{tag(event.seat)} · {t('workflows.team.challenge')}
						</>
					}
				>
					{event.objections.map((o, i) => (
						<p key={i}>
							{o.about}: {o.problem}
						</p>
					))}
					{event.plans?.map((p, i) => (
						<p key={i}>
							{t('workflows.team.verificationPlan')} · {p.criterion}: {p.how} {p.data}
						</p>
					))}
				</TeamFold>
			);
		case 'brief_response':
			return (
				<TeamFold kind="brief-response" title={t('workflows.team.briefResponse')}>
					{event.decisions.map((d, i) => (
						<p key={i}>
							{d.about}: {d.reason}
						</p>
					))}
				</TeamFold>
			);
		case 'baseline_proposed':
			return state.openCards.some((c) => c.boundary === 'baseline') ||
				events.some((e) => e.kind === 'decision_card' && e.card.boundary === 'baseline') ? null : (
				<section className="team-card" data-card="baseline" data-boundary="baseline">
					<h3>{t('workflows.team.baseline', { version: event.briefVersion })}</h3>
					<Criteria state={state} />
					<p className="team-dim">{t('workflows.team.waitingOwner')}</p>
				</section>
			);
		case 'baseline_confirmed':
			return (
				<p className="team-dim">
					{t('workflows.team.confirmBaseline')} · {event.briefVersion}
				</p>
			);
		case 'decision_card': {
			const answer = state.cardAnswers.find((a) => a.cardId === event.card.id);
			return answer ? (
				<OwnerCard
					card={event.card}
					state={state}
					teamId={teamId}
					answered={answer.optionId}
					emphasis={false}
				/>
			) : null;
		}
		case 'discussion_opened': {
			const discussion = state.discussions.find((d) => d.id === event.discussionId);
			return (
				<TeamFold
					kind="discussion"
					title={
						<>
							<b>
								{t('workflows.team.discussion')} · {event.topic}
							</b>
							{discussion?.decision && (
								<span className="team-dim"> · {discussion.decision.decision}</span>
							)}
						</>
					}
				>
					<p className="team-dim">{event.trigger}</p>
					<h4>{t('workflows.team.positions')}</h4>
					{discussion?.positions.map((p) => (
						<div key={p.id}>
							{tag(p.seat)}
							<p>{p.claim}</p>
							<p className="team-dim">
								{t('workflows.team.basis')}: {p.basis}
							</p>
							<p className="team-dim">
								{t('workflows.team.changeMind')}: {p.wouldChangeMind}
							</p>
						</div>
					))}
					<h4>{t('workflows.team.proposal')}</h4>
					{discussion?.proposals.map((p) => (
						<p key={p.id}>{p.proposal}</p>
					))}
					<h4>{t('workflows.team.responses')}</h4>
					{discussion?.responses.map((r) => (
						<div key={r.id}>
							{tag(r.seat)}
							<p>{r.reason}</p>
							<p>{r.evidence}</p>
						</div>
					))}
					{discussion?.decision && (
						<>
							<h4>{t('workflows.team.decision')}</h4>
							<p>
								{discussion.decision.decision} ·{' '}
								{t(`workflows.team.${discussion.decision.decider}`)}
							</p>
							{discussion.decision.dissent && (
								<p>
									{t('workflows.team.dissent')}: {discussion.decision.dissent}
								</p>
							)}
							<h4>{t('workflows.team.actions')}</h4>
							{discussion.decision.actions.map((a, i) => (
								<div key={i}>
									{tag(a.seat)}
									<p>{a.action}</p>
								</div>
							))}
						</>
					)}
				</TeamFold>
			);
		}
		case 'check_run':
			return (
				<TeamFold
					kind="check"
					title={
						<>
							<b>{t('workflows.team.check')}</b> · {formatList(event.covers)} ·{' '}
							{t(
								event.exitCode === 0 && !event.timedOut && !event.notRun
									? 'workflows.team.pass'
									: 'workflows.team.fail'
							)}{' '}
							<span className="team-dim">{t('workflows.team.proof.app')}</span>
						</>
					}
				>
					<code>{event.command}</code>
					<p className="team-dim">{event.cwd}</p>
					{event.purpose === 'trial' && <p>{t('workflows.team.trial')}</p>}
					<p>
						{t('workflows.team.checkResult', {
							code: event.exitCode ?? t('workflows.team.notRun'),
							duration: formatDurationCompact(event.durationMs),
						})}
					</p>
					<pre className="whitespace-pre-wrap break-words max-h-64 overflow-auto">
						{event.notRun || event.outputTail}
					</pre>
				</TeamFold>
			);
		case 'issue_opened': {
			const issue = state.issues.find((i) => i.id === event.issueId);
			return (
				<section className="team-card" data-card="issue" data-state={issue?.state}>
					<h3>
						{t('workflows.team.issue', { id: event.issueId })} · {event.title}
					</h3>
					<ol className="list-decimal pl-5">
						{event.steps.map((step, i) => (
							<li key={i}>{step}</li>
						))}
					</ol>
					<p>{event.expected && `${t('workflows.team.expected')}: ${event.expected}`}</p>
					<p>{event.actual && `${t('workflows.team.actual')}: ${event.actual}`}</p>
					<p className="team-dim">
						{event.criterionId && t('workflows.team.violates', { id: event.criterionId })}
					</p>
					<div className="flex flex-wrap gap-1 text-xs">
						{(['opened', 'fixed-claimed', 'verified-pass'] as const).map((step, i) => (
							<span
								key={step}
								className="rounded border px-1.5"
								style={{
									borderColor: 'var(--team-border)',
									color: issue?.history.some((entry) =>
										step === 'opened'
											? entry.kind === 'issue_opened'
											: step === 'fixed-claimed'
												? entry.kind === 'issue_fixed'
												: entry.kind === 'issue_verified' && entry.pass
									)
										? 'var(--team-success)'
										: 'var(--team-dim)',
								}}
							>
								{i > 0 ? '→ ' : ''}
								{t(`workflows.team.${step}`)}
							</span>
						))}
					</div>
					{issue?.state === 'verified-fail' && (
						<p style={{ color: 'var(--team-error)' }}>{t('workflows.team.verified-fail')}</p>
					)}
					{issue?.history
						.filter((e) => e.kind === 'issue_verified')
						.map((e) => (
							<p className="team-dim" key={e.id}>
								{e.evidence}
							</p>
						))}
				</section>
			);
		}
		case 'quota_exhausted':
		case 'substitute_took_over':
			return (
				<section className="team-card" data-card="quota">
					<h3>
						{tag(event.seat)} ·{' '}
						{t(
							event.kind === 'quota_exhausted'
								? 'workflows.team.quota'
								: event.temporary
									? 'workflows.team.temporary'
									: 'workflows.team.takeover'
						)}
					</h3>
					{event.kind === 'quota_exhausted' ? (
						<>
							<p>{t('workflows.team.quotaWaiting')}</p>
							{event.resetsAt && (
								<p>
									{t('workflows.team.resetsAt', {
										time: new Date(event.resetsAt).toLocaleString(),
									})}
								</p>
							)}
						</>
					) : (
						<>
							<p>{t('workflows.team.takeoverContext')}</p>
						</>
					)}
					<button
						className="team-button self-start"
						onClick={() => useTeamStore.getState().selectTeam(teamId, event.seat)}
					>
						{t('workflows.team.openConversation')}
					</button>
				</section>
			);
		case 'review':
			return (
				<section className="team-card" data-card="review">
					<h3>
						{t('workflows.team.review')} ·{' '}
						{t(event.verdict === 'pass' ? 'workflows.team.pass' : 'workflows.team.reject')}
					</h3>
					{event.problems.map((p, i) => (
						<div key={i} className="team-item">
							<b>{p.title}</b>
							<p className="team-dim">
								{t('workflows.team.location')}: {p.location} · {p.criterion}
							</p>
							<p>
								{t('workflows.team.impact')}: {p.impact}
							</p>
							<p>
								{t('workflows.team.expected')}: {p.expected}
							</p>
						</div>
					))}
					{event.suggestions.length > 0 && (
						<TeamFold title={t('workflows.team.suggestions')}>
							{event.suggestions.map((s) => (
								<p key={s}>{s}</p>
							))}
						</TeamFold>
					)}
				</section>
			);
		case 'retro':
			return (
				<section className="team-card" data-card="retro">
					<h3>{t('workflows.team.retro')}</h3>
					<p>{event.summary}</p>
					<p>
						{t('workflows.team.progressEvidence')}: {event.progressEvidence}
					</p>
				</section>
			);
		case 'demo':
			return (
				<DemoCard
					state={state}
					theme={theme}
					onChanges={onChanges}
					active={
						!state.terminal &&
						(state.phase === 'demo' || state.phase === 'accept') &&
						[...events].reverse().find((e) => e.kind === 'demo')?.id === event.id
					}
				/>
			);
		case 'owner_message': {
			const delivered = events.some(
				(e) => e.kind === 'message_delivered' && e.messageId === event.messageId
			);
			return (
				<div data-card="owner-message" className="self-end max-w-[85%]">
					<p
						className="rounded-xl p-3 whitespace-pre-wrap"
						style={{ background: 'var(--team-activity)' }}
					>
						{event.text}
					</p>
					<p className="team-dim">
						{t(delivered ? 'workflows.team.delivered' : 'workflows.team.queued', {
							seat: t(`workflows.team.${event.to ?? 'pm'}`),
						})}
					</p>
				</div>
			);
		}
		case 'follow_up_registered':
			return (
				<TeamFold
					kind="follow-up"
					title={
						<>
							{t('workflows.team.followUp')} · {event.waitFor}
						</>
					}
				>
					<p>{event.reason}</p>
					{tag(event.seat)}
					{event.untilMs && <p className="team-dim">{new Date(event.untilMs).toLocaleString()}</p>}
					{events
						.filter((e) => e.kind === 'follow_up_fired' && e.followUpId === event.followUpId)
						.map((e) => e.kind === 'follow_up_fired' && <p key={e.id}>{e.result}</p>)}
				</TeamFold>
			);
		case 'follow_up_fired':
			return <p className="team-dim">{event.result}</p>;
		case 'member_fault':
			return (
				<section className="team-card" data-card="recovery">
					{tag(event.seat)}
					<h3>{t('workflows.team.recovery')}</h3>
					<p>{event.detail}</p>
				</section>
			);
		case 'member_recovered':
			return (
				<p className="team-dim">
					{tag(event.seat)} · {event.how}
				</p>
			);
		case 'changes_requested':
			return (
				<p>
					{t('workflows.team.changeNote')}: {event.note}
				</p>
			);
		case 'paused':
		case 'stopped':
			return <p className="team-dim">{t(`workflows.team.${event.kind}`)}</p>;
		case 'resumed':
			return <p className="team-dim">{t('workflows.team.resume')}</p>;
		default:
			return null;
	}
}

export function TeamFeed({
	state,
	events,
	theme,
	onChanges,
}: {
	state: TeamState;
	events: readonly LedgerEvent[];
	theme: Theme;
	onChanges: () => void;
}) {
	const t = useT();
	const groups = useMemo(() => deriveTeamFeed(events), [events]);
	const demoPending =
		!state.terminal &&
		(state.phase === 'demo' || state.phase === 'accept') &&
		events.some((event) => event.kind === 'demo');
	return (
		<div className="max-w-[760px] w-full mx-auto px-5 py-5 flex flex-col gap-3.5">
			{groups.map((group, index) => {
				const body = group.events.map((event) => (
					<div key={event.id} className="contents" data-team-event={event.id}>
						<FeedEvent
							event={event}
							state={state}
							events={events}
							theme={theme}
							onChanges={onChanges}
						/>
					</div>
				));
				return index < groups.length - 1 && group.phase !== 'demo' && group.phase !== 'accept' ? (
					<TeamFold key={group.id} kind="phase" title={t(`workflows.team.phase.${group.phase}`)}>
						{body}
					</TeamFold>
				) : (
					<div key={group.id} className="contents">
						{body}
					</div>
				);
			})}
			{!state.terminal &&
				state.openCards
					.filter((card) => !(demoPending && card.boundary === 'acceptance'))
					.map((card, i) => (
						<OwnerCard
							key={card.id}
							card={card}
							teamId={state.config!.id}
							state={state}
							emphasis={i === 0}
						/>
					))}
			<TeamSummary state={state} />
		</div>
	);
}
