import { useSessionStore } from '../../stores/sessionStore';
import { buildProjectHistoryScopes } from '../../utils/nativeConversationMatch';
import { projectHistoryScopeFor } from '../../../shared/projectHistory';
import { useEffect, useRef } from 'react';
import { Loader2, Users } from 'lucide-react';
import { SEAT_ROLES, type SeatRole, type TeamConfig } from '../../../shared/team/types';
import { useTeamState, useTeamStatus, useTeams, useTeamStore } from '../../stores/teamStore';
import { useFocusAfterRender } from '../../hooks/utils/useFocusAfterRender';
import { useT } from '../../i18n';
import type { Theme } from '../../types';
import { SeatTag, teamStyle } from './TeamPrimitives';

function SeatRow({ config, seat }: { config: TeamConfig; seat: SeatRole }) {
	const t = useT();
	const ref = useRef<HTMLButtonElement>(null);
	const active = useTeamStore((s) => s.activeTeamId === config.id && s.activeSeat === seat);
	const returning = useTeamStore((s) => s.activeTeamId === config.id && s.returnSeat === seat);
	const state = useTeamState(config.id)!;
	const working = state.seats[seat].activeDispatchIds.length > 0;
	useFocusAfterRender(ref, returning);
	useEffect(() => {
		if (returning) useTeamStore.getState().clearReturnSeat();
	}, [returning]);
	return (
		<button
			ref={ref}
			type="button"
			className="w-full flex items-center gap-2 rounded px-2 py-1.5 pl-8 text-left"
			style={{ background: active ? 'var(--team-activity)' : undefined }}
			aria-current={active ? 'page' : undefined}
			aria-label={`${t(`workflows.team.${seat}`)} ${config.title}`}
			onClick={() => useTeamStore.getState().selectTeam(config.id, seat)}
		>
			<span className="truncate flex-1">
				<SeatTag seat={seat} model={state.seats[seat].model ?? config.seats[seat]} />
			</span>
			{working && (
				<Loader2 size={12} className="animate-spin" aria-label={t('workflows.team.working')} />
			)}
		</button>
	);
}
function TeamRow({ config }: { config: TeamConfig }) {
	const t = useT();
	const status = useTeamStatus(config.id)!;
	const active = useTeamStore((s) => s.activeTeamId === config.id && !s.activeSeat);
	const working = status.seats.some((s) => s.status === 'working');
	return (
		<div>
			<button
				type="button"
				className="w-full flex items-center gap-2 rounded px-2 py-2 text-left"
				style={{ background: active ? 'var(--team-activity)' : undefined }}
				aria-current={active ? 'page' : undefined}
				onClick={() => useTeamStore.getState().selectTeam(config.id)}
			>
				<Users size={15} />
				<span className="truncate flex-1">{config.title}</span>
				{status.openCards.length > 0 ? (
					<span
						className="w-2 h-2 rounded-full"
						style={{ background: 'var(--team-accent)' }}
						aria-label={t('workflows.team.needsYou', { count: status.openCards.length })}
					/>
				) : working ? (
					<Loader2 size={12} className="animate-spin" aria-label={t('workflows.team.working')} />
				) : (
					<span className="team-dim">
						{status.terminal
							? t(
									status.terminal === 'all'
										? 'workflows.team.accepted'
										: status.terminal === 'gaps'
											? 'workflows.team.gaps'
											: 'workflows.team.stopped',
									{ count: status.residual.length }
								)
							: status.paused
								? t('workflows.team.paused')
								: ''}
					</span>
				)}
			</button>
			{SEAT_ROLES.map((seat) => (
				<SeatRow key={seat} config={config} seat={seat} />
			))}
		</div>
	);
}
export function TeamSidebar({ theme, projectKey }: { theme: Theme; projectKey: string }) {
	const teams = useTeams();
	const sessions = useSessionStore((s) => s.sessions);
	const groups = useSessionStore((s) => s.groups);
	const scopes = buildProjectHistoryScopes(sessions, groups);
	return (
		<div
			className="team-surface"
			style={{ ...teamStyle(theme), background: theme.colors.bgSidebar }}
		>
			{teams
				.filter(
					(config) =>
						projectHistoryScopeFor(scopes, {
							projectPath: config.projectRoot,
							sshRemoteId: config.sshRemoteId,
						})?.projectKey === projectKey
				)
				.map((config) => (
					<TeamRow key={config.id} config={config} />
				))}
		</div>
	);
}
