import { startAccountReauth } from '../../stores/authOutageStore';
import { getModalActions } from '../../stores/modalStore';
import { Loader2 } from 'lucide-react';
import type { SeatRole, TeamState, TeamEvent } from '../../../shared/team/types';
import { teamStatus } from '../../../shared/team/status';
import { getAgentDisplayName } from '../../../shared/agentMetadata';
import { useAppLocale, useT } from '../../i18n';
import { useTeamStore } from '../../stores/teamStore';
import { presentTeamText } from '../../services/teamClient';
import { SeatTag } from './TeamPrimitives';

export function TeamFault({
	fault,
	state,
}: {
	fault: TeamEvent<'member_fault'>;
	state: TeamState;
}) {
	const t = useT();
	const health = state.seats[fault.seat];
	const quota = [...state.unavailable]
		.reverse()
		.find((entry) => entry.seat === fault.seat && entry.login);
	const provider = quota?.model?.tool ?? health.model?.tool ?? state.config!.seats[fault.seat].tool;
	return (
		<div data-fault={fault.fault}>
			<p>
				{t(`workflows.team.fault.${fault.fault}`, {
					provider: getAgentDisplayName(provider),
					seat: t(`workflows.team.${quota?.configSource ?? fault.seat}`),
				})}
			</p>
			{fault.fault === 'login-expired' &&
				state.openCards
					.map((card) => card.payload)
					.filter(
						(payload) =>
							payload?.type === 'escalation' &&
							payload.cause === 'login' &&
							payload.accountSeat === (quota?.configSource ?? fault.seat)
					)
					.map(
						(payload, index) =>
							payload?.type === 'escalation' &&
							payload.accountDir && (
								<p key={index} data-login-account>
									{t('workflows.team.loginAccount', { account: payload.accountDir })}
								</p>
							)
					)}
			{fault.detail &&
				!['model-unavailable', 'login-expired', 'idle-turn'].includes(fault.fault) && (
					<p className="team-dim whitespace-pre-wrap">{presentTeamText(fault.detail, state, t)}</p>
				)}
		</div>
	);
}

/** Shared row/detail projection; a repair dispatch does not disguise a held fault as busy. */
export function TeamSeatHealth({
	state,
	seat,
	detail = false,
}: {
	state: TeamState;
	seat: SeatRole;
	detail?: boolean;
}) {
	const t = useT();
	const locale = useAppLocale();
	const now = useTeamStore((s) => s.now);
	const health = state.seats[seat];
	const status = teamStatus(state, now).seats.find((entry) => entry.seat === seat)!;
	const fault = health.faultActive && !health.takeover ? health.lastFault : undefined;
	const kind = state.terminal
		? 'ready'
		: (fault?.fault ??
			(state.paused
				? 'waiting'
				: status.status === 'unbound'
					? 'ready'
					: status.status === 'fault'
						? 'waiting'
						: status.status));
	const working = kind === 'working';
	const reset = health.quota?.resetsAt;
	const description = [
		t(`workflows.team.health.${kind}`),
		fault?.detail ? presentTeamText(fault.detail, state, t) : undefined,
		reset ? t('workflows.team.resetsAt', { time: new Date(reset).toLocaleString(locale) }) : '',
	]
		.filter(Boolean)
		.join('\n');
	const login = state.openCards.find(
		(card) =>
			card.boundary === 'login' &&
			card.seat === seat &&
			card.options.some((option) => option.id === 'login')
	);
	return (
		<div data-seat-health={kind} data-takeover={health.takeover ?? undefined} title={description}>
			<span className="inline-flex items-center gap-1 text-xs whitespace-nowrap">
				{working ? (
					<Loader2 size={12} className="animate-spin" aria-hidden />
				) : (
					<i
						className="w-1.5 h-1.5 rounded-full shrink-0"
						aria-hidden
						style={{ background: fault ? 'var(--team-warning)' : 'var(--team-dim)' }}
					/>
				)}
				{t(`workflows.team.health.${kind}`)}
			</span>
			{detail && (
				<>
					{fault && <TeamFault fault={fault} state={state} />}
					{!fault && !health.takeover && health.lastFault && (
						<div>
							<p>{t('workflows.team.recoveredSeat')}</p>
							<TeamFault fault={health.lastFault} state={state} />
						</div>
					)}
					{health.takeover && (
						<>
							<p>
								{t(
									health.takeover === 'temporary'
										? 'workflows.team.temporary'
										: 'workflows.team.takeover'
								)}
							</p>
							<p>
								{t('workflows.team.switchBack')}{' '}
								<SeatTag seat={seat} model={state.config!.seats[seat]} hideRole />
							</p>
							{health.lastFault && <TeamFault fault={health.lastFault} state={state} />}
						</>
					)}
					{reset && (
						<p>{t('workflows.team.resetsAt', { time: new Date(reset).toLocaleString(locale) })}</p>
					)}
					{login && <TeamLogin state={state} seat={seat} />}
					{login && (
						<button
							type="button"
							className="team-button"
							onClick={() =>
								void useTeamStore.getState().answer(state.config!.id, login.id, 'login')
							}
						>
							{t('workflows.team.loginRestored')}
						</button>
					)}
				</>
			)}
		</div>
	);
}

export function TeamSeatIdentity({
	state,
	seat,
	compact = false,
}: {
	state: TeamState;
	seat: SeatRole;
	compact?: boolean;
}) {
	const t = useT();
	const health = state.seats[seat];
	if (compact)
		return (
			<span className="block truncate whitespace-nowrap" data-seat-identity={seat} data-compact>
				<SeatTag
					seat={seat}
					source={health.binding?.configSource}
					model={health.model ?? state.config!.seats[seat]}
					roleLabel={
						health.takeover
							? t('workflows.team.coveredSeat', { seat: t(`workflows.team.${seat}`) })
							: undefined
					}
					hideModel={!!health.takeover}
				/>
			</span>
		);
	return (
		<span className="inline-flex flex-wrap items-center gap-1" data-seat-identity={seat}>
			{health.takeover && (
				<span>
					{t(`workflows.team.${seat}`)} · {t('workflows.team.coveredBy')}
				</span>
			)}
			<SeatTag
				seat={seat}
				source={health.binding?.configSource}
				model={health.model ?? state.config!.seats[seat]}
				hideRole={!!health.takeover}
			/>
		</span>
	);
}

/** Use the existing account-scoped login dialog; do not run login through a seat turn. */
export function TeamLogin({ state, seat }: { state: TeamState; seat: SeatRole }) {
	const t = useT();
	const quota = [...state.unavailable]
		.reverse()
		.find((entry) => entry.seat === seat && entry.login);
	const source = quota?.configSource ?? seat;
	const config = state.config!;
	const tool = quota?.model?.tool ?? config.seats[source].tool;
	const settings = config.seats[source].tool === tool ? config.seats[source] : undefined;
	return (
		<button
			type="button"
			className="team-button"
			data-action="login"
			onClick={() => {
				const { providerKey } = startAccountReauth(tool);
				getModalActions().openReauthModal({
					providerKey,
					host: {
						id: `team-login-${config.id}-${source}`,
						name: `${config.title}: ${t(`workflows.team.${source}`)}`,
						toolType: tool,
						cwd: config.projectRoot,
						projectRoot: config.projectRoot,
						customEnvVars: settings?.customEnv,
						customPath: settings?.customPath,
						sshRemoteId: config.sshRemoteId,
						remoteCwd: config.sshRemoteId ? config.projectRoot : undefined,
						sessionSshRemoteConfig: config.sshRemoteId
							? { enabled: true, remoteId: config.sshRemoteId }
							: undefined,
					},
				});
			}}
		>
			{t('workflows.team.signIn')}
		</button>
	);
}
