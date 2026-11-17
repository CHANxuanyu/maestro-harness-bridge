import type { AgentId } from '../../shared/agentIds';
import type { LedgerEvent, SeatRole, TeamConfig, TeamStatusView } from '../../shared/team/types';

/** Pending preload contract. Keep all team bridge names and wire assumptions here. */
export type CreateTeamInput = Omit<TeamConfig, 'id' | 'createdAt'>;
export interface TeamSnapshot {
	config: TeamConfig;
	events: LedgerEvent[];
}
export interface TeamTranscript {
	provider: AgentId;
	nativeSessionId?: string;
	cwd: string;
}
export interface TeamClient {
	create(input: CreateTeamInput): Promise<TeamConfig>;
	list(): Promise<TeamConfig[]>;
	get(teamId: string): Promise<TeamSnapshot>;
	status(teamId: string): Promise<TeamStatusView>;
	answer(teamId: string, cardId: string, optionId: string, note?: string): Promise<void>;
	say(teamId: string, text: string, to?: SeatRole): Promise<void>;
	pause(teamId: string): Promise<void>;
	resume(teamId: string): Promise<void>;
	stop(teamId: string): Promise<void>;
	accept(teamId: string): Promise<void>;
	requestChanges(teamId: string, note: string): Promise<void>;
	export(teamId: string): Promise<unknown>;
	seatTranscript(teamId: string, seat: SeatRole): Promise<TeamTranscript | null>;
	onChanged(listener: (change: { teamId: string; event: LedgerEvent }) => void): () => void;
}

export function teamClient(): TeamClient | undefined {
	return (window.maestro as typeof window.maestro & { team?: TeamClient }).team;
}

/** No speculative IPC calls: these controls become available with the extended contract. */
export const teamFeatures = { baselineEdit: false, baselineDiff: false, baselineReturn: false };
