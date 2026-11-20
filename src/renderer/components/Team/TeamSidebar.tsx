import { useEffect, useRef } from 'react';
import { Loader2, Users } from 'lucide-react';
import { SEAT_ROLES, type SeatRole, type TeamConfig } from '../../../shared/team/types';
import { useTeamState, useTeamStatus, useTeamStore } from '../../stores/teamStore';
import { useFocusAfterRender } from '../../hooks/utils/useFocusAfterRender';
import { useT } from '../../i18n';
import type { Theme } from '../../types';
import { TeamSeatHealth, TeamSeatIdentity } from './TeamHealth';
import { teamStyle } from './TeamPrimitives';
import { TeamModelCatalogProvider } from './TeamModelCatalogs';

function SeatRow({ config, seat }: { config: TeamConfig; seat: SeatRole }) {
	const t = useT();
	const ref = useRef<HTMLButtonElement>(null);
	const active = useTeamStore((s) => s.activeTeamId === config.id && s.activeSeat === seat);
	const returning = useTeamStore((s) => s.activeTeamId === config.id && s.returnSeat === seat);
	const state = useTeamState(config.id)!;

	useFocusAfterRender(ref, returning);
	useEffect(() => {
		if (returning) useTeamStore.getState().clearReturnSeat();
	}, [returning]);
	return (
		<button
			ref={ref}
			data-team-seat={seat}
			type="button"
			className="w-full flex items-center gap-2 rounded px-2 py-1.5 pl-8 text-left"
			style={{ background: active ? 'var(--team-activity)' : undefined }}
			aria-current={active ? 'page' : undefined}
			aria-label={`${t(`workflows.team.${seat}`)} ${config.title}`}
			onClick={() => useTeamStore.getState().selectTeam(config.id, seat)}
		>
			<span className="truncate flex-1">
				<TeamSeatIdentity state={state} seat={seat} compact />
			</span>
			<TeamSeatHealth state={state} seat={seat} />
		</button>
	);
}
function TeamRow({ config }: { config: TeamConfig }) {
	const t = useT();
	const status = useTeamStatus(config.id)!;
	const active = useTeamStore((s) => s.activeTeamId === config.id && !s.activeSeat);
	const working = !status.terminal && status.seats.some((s) => s.status === 'working');
	const terminalLabel = status.terminal
		? t(
				status.terminal === 'all'
					? 'workflows.team.accepted'
					: status.terminal === 'gaps'
						? 'workflows.team.gaps'
						: 'workflows.team.stopped',
				{ count: status.residual.length }
			)
		: undefined;
	return (
		<div>
			<button
				data-team-id={config.id}
				type="button"
				className="w-full min-w-0 flex items-center gap-2 rounded px-2 py-2 text-left"
				title={terminalLabel ? `${config.title}\n${terminalLabel}` : config.title}
				aria-label={config.title}
				style={{ background: active ? 'var(--team-activity)' : undefined }}
				aria-current={active ? 'page' : undefined}
				onClick={() => useTeamStore.getState().selectTeam(config.id)}
			>
				<Users size={15} className="shrink-0" aria-hidden />
				<span className="truncate flex-1 min-w-0" data-team-title title={config.title}>
					{config.title}
				</span>
				{!status.terminal && status.openCards.length > 0 ? (
					<span
						className="w-2 h-2 shrink-0 rounded-full"
						style={{ background: 'var(--team-accent)' }}
						aria-label={t('workflows.team.needsYou', { count: status.openCards.length })}
					/>
				) : working ? (
					<Loader2 size={12} className="animate-spin" aria-label={t('workflows.team.working')} />
				) : terminalLabel ? (
					<span
						role="img"
						aria-label={terminalLabel}
						title={terminalLabel}
						data-team-status={status.terminal}
						className="w-2 h-2 shrink-0 rounded-full"
						style={{
							background:
								status.terminal === 'all'
									? 'var(--team-success)'
									: status.terminal === 'gaps'
										? 'var(--team-warning)'
										: 'var(--team-dim)',
						}}
					/>
				) : status.paused ? (
					<span className="team-dim">{t('workflows.team.paused')}</span>
				) : null}
			</button>
			{SEAT_ROLES.map((seat) => (
				<SeatRow key={seat} config={config} seat={seat} />
			))}
		</div>
	);
}
export function TeamSidebar({ theme, teams }: { theme: Theme; teams: readonly TeamConfig[] }) {
	return (
		<div
			className="team-surface"
			style={{ ...teamStyle(theme), background: theme.colors.bgSidebar }}
		>
			{teams.map((config) => (
				<TeamModelCatalogProvider key={config.id} config={config}>
					<TeamRow config={config} />
				</TeamModelCatalogProvider>
			))}
		</div>
	);
}
