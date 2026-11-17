export type CheckOutcome = 'pass' | 'fail' | 'timeout' | 'canceled' | 'not-run';

export type CheckHost = { kind: 'local' } | { kind: 'ssh'; remoteId: string };

/** Application-observed evidence, never a provider's claim about a check. */
export interface CheckRun {
	id: string;
	command: string;
	cwd: string;
	host: CheckHost;
	startedAt: number;
	endedAt: number;
	exitCode: number | null;
	outcome: CheckOutcome;
	outputTail: string;
	truncated: boolean;
	error?: string;
}
