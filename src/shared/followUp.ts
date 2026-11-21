import type { SeatRole } from './team/types';

export type FollowUpTarget =
	| { kind: 'conversation'; sessionId: string; tabId: string }
	| { kind: 'team'; teamId: string; seat: SeatRole };

export type FollowUpCondition =
	| { kind: 'time'; at: number }
	| { kind: 'command'; processId: string }
	| { kind: 'ci'; runId: string; cwd: string };

export interface FollowUpExternalStatus {
	state: 'waiting' | 'running' | 'completed' | 'unavailable';
	observedAt: number;
	status?: string;
	conclusion?: string | null;
	exitCode?: number | null;
	outputTail?: string;
	error?: string;
	failingJob?: string;
}

export interface FollowUpRegistration {
	id?: string;
	target: FollowUpTarget;
	reason: string;
	condition: FollowUpCondition;
	waitLimitMs?: number;
	pollIntervalMs?: number;
	/** Shared absolute budget deadline. Re-registering must retain this value. */
	deadline: number;
}

export interface FollowUp extends Omit<FollowUpRegistration, 'id' | 'waitLimitMs'> {
	id: string;
	createdAt: number;
	waitLimitMs: number;
	state: 'pending' | 'fired' | 'canceled';
	externalStatus: FollowUpExternalStatus;
	fire?: {
		kind: 'ready' | 'wait-timeout' | 'expired';
		at: number;
		late: boolean;
	};
}

export interface FollowUpFire {
	followUp: FollowUp;
	kind: 'ready' | 'wait-timeout' | 'expired';
	at: number;
	late: boolean;
	externalStatus: FollowUpExternalStatus;
}
