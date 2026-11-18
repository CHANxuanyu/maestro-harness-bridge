import type { OwnerCard, TeamState } from '../../../shared/team/types';
import { getAgentDisplayName } from '../../../shared/agentMetadata';
import type { Theme } from '../../types';
import { useFormatList, useT } from '../../i18n';
import { presentTeamText } from '../../services/teamClient';
import { TeamOutput } from './TeamOutput';
import { TeamLogin } from './TeamHealth';
import { TeamAttempts } from './TeamProgress';
import { SeatTag, TeamFold } from './TeamPrimitives';

export function TeamEscalation({
	card,
	state,
	theme,
}: {
	card: OwnerCard;
	state: TeamState;
	theme?: Theme;
}) {
	const t = useT();
	const formatList = useFormatList();
	const data = card.payload;
	if (data?.type === 'progress-report')
		return (
			<div data-card="progress-report" className="space-y-3">
				<p className="font-semibold" data-report-disclaimer>
					{t('workflows.team.progressFirst')}
				</p>
				{theme && (
					<TeamOutput
						state={
							data.generatedBy ? { ...state, outputs: data.output ? [data.output] : [] } : state
						}
						theme={theme}
						disclosure={false}
					/>
				)}
				<h4>{t('workflows.team.criteriaMissing')}</h4>
				{data.missing.map((criterion) => (
					<div key={criterion.id} data-missing-criterion={criterion.id}>
						<p>{criterion.text}</p>
						<p className="team-dim">{presentTeamText(criterion.reason, state, t)}</p>
					</div>
				))}
				{!!data.appObservations?.length && (
					<div data-app-observations>
						<h4>{t('workflows.team.appObservations')}</h4>
						{data.appObservations.map((observation) => (
							<p key={observation.id} className="team-dim">
								{observation.kind === 'output_observation'
									? t('workflows.team.appObservationMissing', {
											paths: formatList(observation.missing),
										})
									: t(
											observation.category === 'stall'
												? 'workflows.team.appObservationStall'
												: 'workflows.team.appObservationWait'
										)}
							</p>
						))}
					</div>
				)}
				{data.work?.map((item) => (
					<p key={item.itemId}>
						{item.title} · <SeatTag seat={item.owner} />
					</p>
				))}
				<TeamFold title={t('workflows.team.pathsTried')}>
					<TeamAttempts state={state} attempts={data.tried} />
					{data.faults?.map(
						({ seat, fault }) =>
							fault && (
								<p key={seat}>
									<SeatTag seat={seat} />: {t(`workflows.team.health.${fault.fault}`)}
								</p>
							)
					)}
				</TeamFold>
				<TeamFold title={t('workflows.team.standardChanges')}>
					{data.changes.map((change) => (
						<p key={change.id}>
							{change.before} → {change.after}: {presentTeamText(change.reason, state, t)}
						</p>
					))}
				</TeamFold>
				{data.contested.map((decision) => (
					<p key={decision.id}>{decision.decision}</p>
				))}
				{data.suggestions.map((suggestion, index) => (
					<p className="team-dim" key={index}>
						{suggestion}
					</p>
				))}
				<p>
					<b>{t('workflows.team.recommendation')}</b>:{' '}
					{data.recommendation && data.recommendation === state.wrapUp?.summary
						? data.recommendation
						: t('workflows.team.extendRecommendation', {
								hours: card.extension?.hours ?? 0,
								turns: card.extension?.turns ?? 0,
							})}
				</p>
			</div>
		);
	if (data?.type === 'permission')
		return (
			<div data-card="permission" className="space-y-2">
				<p>
					{t('workflows.team.permissionClass', { action: t(`workflows.team.auth.${data.action}`) })}
				</p>
				<p>{presentTeamText(data.detail, state, t)}</p>
				<p data-touches-main={data.touchesMain}>
					{t('workflows.team.permissionScope', { branch: data.branch })}
				</p>
				<p>{t('workflows.team.permissionDecline')}</p>
			</div>
		);
	if (data?.type !== 'escalation') return null;
	const source = data.accountSeat ?? card.seat ?? 'pm';
	return (
		<div data-card="escalation" data-cause={data.cause} className="space-y-2">
			{data.cause === 'login' && (
				<p>
					{t('workflows.team.fault.login-expired', {
						provider: getAgentDisplayName(data.provider ?? state.config!.seats[source].tool),
						seat: t(`workflows.team.${source}`),
					})}
				</p>
			)}
			{data.cause === 'login' && data.accountDir && (
				<p data-login-account>{t('workflows.team.loginAccount', { account: data.accountDir })}</p>
			)}
			{card.seatChange && <SeatTag seat={card.seatChange.seat} model={card.seatChange.model} />}
			{data.stuck && data.cause !== 'login' && data.cause !== 'availability' && (
				<p>
					{presentTeamText(
						Array.isArray(data.stuck) ? formatList(data.stuck) : data.stuck,
						state,
						t
					)}
				</p>
			)}
			<h4>{t('workflows.team.pathsTried')}</h4>
			{data.cause === 'problem' ? (
				data.paths.map(
					(path, index) =>
						typeof path !== 'string' && (
							<p key={index}>
								{t('workflows.team.attempt', { number: index + 1 })}: {path.plan} ·{' '}
								{t(`workflows.team.verdict.${path.verdict}`, {
									number:
										data.paths.findIndex(
											(entry) => typeof entry !== 'string' && entry.id === path.repeatOf
										) + 1,
								})}
							</p>
						)
				)
			) : (
				<ol className="list-decimal pl-5">
					{data.paths.map((_, index) => (
						<li key={index}>
							{data.cause === 'availability'
								? t(
										index === 0
											? 'workflows.team.pathUnavailable'
											: index === 1
												? 'workflows.team.pathSubstitute'
												: state.config!.authorizations.temporaryTakeover
													? 'workflows.team.pathTeamUnavailable'
													: 'workflows.team.pathTemporary'
									)
								: data.cause === 'login'
									? t(index === 0 ? 'workflows.team.pathExpired' : 'workflows.team.pathOtherSeats')
									: data.cause === 'external'
										? t('workflows.team.path.external')
										: data.cause === 'model'
											? t('workflows.team.path.model')
											: t('workflows.team.path.publication-login')}
						</li>
					))}
				</ol>
			)}
			{data.cause === 'problem' && (
				<p>
					{t('workflows.team.recommendation')}: {presentTeamText(data.recommendation, state, t)}
				</p>
			)}
			{data.cause === 'login' && (
				<>
					<p>{t('workflows.team.loginCost')}</p>
					<TeamLogin state={state} seat={card.seat ?? source} />
				</>
			)}
		</div>
	);
}
