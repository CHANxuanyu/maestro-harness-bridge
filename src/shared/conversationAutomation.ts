import type { CheckHost, CheckRun } from './checkRun';
import type {
	FollowUp,
	FollowUpCondition,
	FollowUpExternalStatus,
	FollowUpTarget,
} from './followUp';
import type { AttemptInput, Candidate, NextDecision, ProgressState } from './progressRules';
import { DURATION_MS } from './duration';

export type ConversationTarget = Extract<FollowUpTarget, { kind: 'conversation' }>;
export const CONVERSATION_TOTAL_MS = 2 * DURATION_MS.hour;
export const CONVERSATION_WAIT_MS = 20 * DURATION_MS.minute;
export const CONVERSATION_POLL_MS = 10 * DURATION_MS.minute;

export interface CheckDefinition {
	id: string;
	command: string;
	/** Main classifies this; callers cannot assert that a command is safe. */
	boundary?: 'outside-project' | 'network' | 'unverified-command';
	once?: boolean;
}

export interface ConversationCheckBatch {
	id: string;
	turnId?: string;
	revision: string;
	fingerprint: string;
	checks: CheckRun[];
	createdAt: number;
}

export interface ConversationDelivery {
	id: string;
	followUpId?: string;
	target: ConversationTarget;
	prompt: string;
	state: 'queued' | 'accepted' | 'delivered' | 'undeliverable' | 'canceled';
	error?: string;
}

export interface ConversationAutomationState {
	target: ConversationTarget;
	project: string;
	cwd: string;
	host: CheckHost;
	projectAuthorized: boolean;
	checks: CheckDefinition[];
	batches: ConversationCheckBatch[];
	fix: 'ask' | 'auto' | 'manual';
	startedAt?: number;
	deadline?: number;
	pausedAt?: number;
	stopped?: boolean;
	expired?: boolean;
	/** Persist the final observations before canceling waits, so a restart can finish the report. */
	expiryPending?: string[];
	report?: string;
	expiryReport?: {
		passed: number;
		total: number;
		observations: { reason: string; status?: FollowUpExternalStatus }[];
		recommendation: 'extend' | 'review';
	};
	running?: boolean;
	pendingCheckRun?: boolean;
	attempts: AttemptInput[];
	initialFailures: string[];
	progress: ProgressState;
	decision?: NextDecision;
	proposal?: {
		basis: string;
		difference: string;
		expectation: string;
		candidates: Candidate[];
	};
	pendingTurn?: { id: string; diagnosis: boolean };
	followUps: FollowUp[];
	deliveries: ConversationDelivery[];
	notes: {
		kind:
			| 'checksUpdated'
			| 'grantRequired'
			| 'ownerApproved'
			| 'followCanceled'
			| 'checksRestarted';
		detail?: string;
	}[];
}

export type AutomationAction =
	| { action: 'status' }
	| { action: 'checks-set'; commands: string[] }
	| { action: 'checks-run' }
	| { action: 'authorize'; choice: 'project' | 'once' | 'reject'; checkId?: string }
	| { action: 'fix'; mode: 'auto' | 'manual'; totalMs?: number }
	| { action: 'plan'; proposal: NonNullable<ConversationAutomationState['proposal']> }
	| {
			action: 'follow-add';
			reason: string;
			condition: FollowUpCondition;
			totalMs?: number;
			waitLimitMs?: number;
	  }
	| { action: 'follow-cancel'; id: string }
	| { action: 'extend' }
	| { action: 'answer'; option: number }
	| { action: 'stop' };

export type AutomationRequest = AutomationAction & {
	target: ConversationTarget;
	/** Propagated by the CLI from the injected caller identity. */
	caller?: { agentId: string; tabId?: string };
};

export function conversationKey(target: ConversationTarget): string {
	return JSON.stringify([target.sessionId, target.tabId]);
}

/** One decision point in the transcript, linked from its follow-up panel. */
export function conversationExpiryCardId(target: ConversationTarget): string {
	return `follow-up-expiry:${encodeURIComponent(conversationKey(target))}`;
}
