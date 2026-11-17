/**
 * Team chat domain types (PRD section 6). Shared by the main-process runtime,
 * the CLI and the renderer. The contract is described in
 * docs/round2/dev/team-model.md; the PRD wins on any conflict.
 */

import type { AgentId } from '../agentIds';
import type { AttemptInput, Boundary } from '../progressRules';

export type SeatRole = 'pm' | 'dev' | 'qa';
export const SEAT_ROLES: readonly SeatRole[] = ['pm', 'dev', 'qa'];

/** Tool, model and effort are independent choices (PRD 6.2). `effort` is the vendor's own level id. */
export interface SeatModel {
	tool: AgentId;
	model?: string;
	effort?: string;
}

export interface SeatConfig extends SeatModel {
	/** Optional substitute taking over when this seat's model is unavailable (PRD 6.8.1, 6.8.2). */
	substitute?: SeatModel;
}

/** One-time authorization chosen at team creation (PRD 6.3). All four default to true. */
export interface TeamAuthorizations {
	/** Run check commands in the task workspaces. */
	checks: boolean;
	/** Commit and push on the task branch. */
	push: boolean;
	/** Open a draft PR. */
	draftPr: boolean;
	/** On a member fault, a model the team already uses takes over in a separate new conversation. */
	temporaryTakeover: boolean;
}

export const DEFAULT_TEAM_AUTHORIZATIONS: TeamAuthorizations = {
	checks: true,
	push: true,
	draftPr: true,
	temporaryTakeover: true,
};

export const DEFAULT_TEAM_TURN_BUDGET = 40;

export interface TeamConfig {
	id: string;
	title: string;
	idea: string;
	projectRoot: string;
	createdAt: number;
	seats: Record<SeatRole, SeatConfig>;
	/** Epoch ms. Optional: a team may run on the turn budget alone. */
	deadline?: number;
	turnBudget: number;
	authorizations: TeamAuthorizations;
	sshRemoteId?: string;
}

export type TeamPhase =
	| 'clarify'
	| 'challenge'
	| 'implement'
	| 'verify'
	| 'review'
	| 'demo'
	| 'accept';
export const TEAM_PHASES: readonly TeamPhase[] = [
	'clarify',
	'challenge',
	'implement',
	'verify',
	'review',
	'demo',
	'accept',
];

/** PRD 3.1.6: three terminal states. */
export type TeamTerminal = 'all' | 'gaps' | 'stopped';

export type LedgerActor = 'app' | 'owner' | SeatRole;

/** How a criterion is proven (PRD 6.4). */
export type ProofKind = 'app' | 'qa' | 'pm';

export interface Criterion {
	id: string;
	text: string;
	proof: ProofKind;
	/** How it will be proven, in the author's words. */
	how?: string;
	/** True for experience criteria judged by the PM against real output. */
	experience?: boolean;
	/** Set when the owner wrote or edited this criterion. */
	byOwner?: boolean;
}

export interface CheckCommand {
	command: string;
	covers: string[];
}

export interface Brief {
	version: number;
	scope: string;
	notDoing: string[];
	criteria: Criterion[];
	checks: CheckCommand[];
}

export type MemberFaultKind =
	| 'still-working'
	| 'turn-failed'
	| 'missing-report'
	| 'bad-report'
	| 'session-broken'
	| 'model-unavailable'
	| 'login-expired'
	| 'idle-turn';

export interface CardOption {
	id: string;
	label: string;
	/** What choosing it costs and who does what (PRD 3.1.5). */
	cost?: string;
	boundary?: Boundary;
	recommended?: boolean;
}

/** A card the owner must answer. Every card names its boundary; none offers a bare "continue". */
export interface OwnerCard {
	id: string;
	boundary: Boundary;
	title: string;
	/** Where it is stuck and why the remaining paths need the owner. */
	body: string;
	options: CardOption[];
	/** Budget used when raised, for escalations. */
	budgetNote?: string;
}

interface EventBase {
	/** Monotonic within a team. */
	seq: number;
	id: string;
	at: number;
	actor: LedgerActor;
}

/**
 * Ledger events. The union lists every kind round 2 needs; M1 emits the
 * lifecycle, turn, requirement, work and card groups, M2 and M3 the rest.
 */
export type LedgerEvent = EventBase &
	(
		| { kind: 'team_created'; config: TeamConfig }
		| {
				kind: 'seat_bound';
				seat: SeatRole;
				nativeSessionId?: string;
				workspace: string;
				model: SeatModel;
				reason?: 'initial' | 'substitute' | 'temporary' | 'restored';
		  }
		| { kind: 'phase_changed'; from?: TeamPhase; to: TeamPhase }
		| { kind: 'paused' }
		| { kind: 'resumed' }
		| { kind: 'stopped' }
		| { kind: 'terminal'; terminal: TeamTerminal; residual: string[] }
		| {
				kind: 'turn_dispatched';
				seat: SeatRole;
				dispatchId: string;
				turn: TurnKind;
				promptDigest: string;
		  }
		| {
				kind: 'turn_finished';
				seat: SeatRole;
				dispatchId: string;
				exitCode: number | null;
				durationMs: number;
				inputTokens?: number;
				outputTokens?: number;
				costUsd?: number;
				reportError?: string;
		  }
		| { kind: 'report_accepted'; seat: SeatRole; dispatchId: string; report: TeamReport }
		| { kind: 'report_rejected'; seat: SeatRole; dispatchId: string; reason: string }
		| { kind: 'brief_published'; brief: Brief }
		| {
				kind: 'challenge_submitted';
				seat: SeatRole;
				objections: Objection[];
				plans?: VerificationPlan[];
		  }
		| { kind: 'brief_response'; decisions: ObjectionDecision[] }
		| { kind: 'baseline_proposed'; briefVersion: number }
		| { kind: 'baseline_confirmed'; briefVersion: number }
		| { kind: 'baseline_edited'; criterionId: string; before: string; after: string }
		| { kind: 'baseline_returned'; note: string }
		| {
				kind: 'standard_change';
				criterionId: string;
				change: 'add' | 'tighten' | 'relax' | 'modify' | 'remove';
				before?: string;
				after?: string;
				reason: string;
				approvedBy: 'owner' | 'pm';
		  }
		| {
				kind: 'work_item';
				itemId: string;
				title: string;
				owner: SeatRole;
				state: 'claimed' | 'done' | 'checked';
		  }
		| {
				kind: 'check_run';
				command: string;
				cwd: string;
				exitCode: number | null;
				outputTail: string;
				durationMs: number;
				covers: string[];
				evidenceId: string;
				timedOut?: boolean;
				notRun?: string;
		  }
		| {
				kind: 'issue_opened';
				issueId: string;
				title: string;
				criterionId?: string;
				issueKind: 'defect' | 'standard';
				steps: string[];
				expected?: string;
				actual?: string;
		  }
		| { kind: 'issue_fixed'; issueId: string; summary?: string }
		| { kind: 'issue_verified'; issueId: string; pass: boolean; evidence?: string }
		| {
				kind: 'criterion_evidence';
				criterionId: string;
				pass: boolean;
				source: 'app' | 'qa' | 'pm';
				evidence: string;
		  }
		| { kind: 'attempt'; problemId: string; attempt: AttemptInput }
		| {
				kind: 'discussion_opened';
				discussionId: string;
				topic: string;
				owner: SeatRole;
				participants: SeatRole[];
				trigger: string;
		  }
		| {
				kind: 'discussion_closed';
				discussionId: string;
				decision: string;
				decider: LedgerActor;
				dissent?: string;
				contested?: boolean;
				actions: Array<{ seat: SeatRole; action: string }>;
		  }
		| { kind: 'output_captured'; outputId: string; files: string[]; previews: string[] }
		| {
				kind: 'review';
				verdict: 'pass' | 'reject';
				problems: ReviewProblem[];
				suggestions: string[];
		  }
		| {
				kind: 'retro';
				reason: 'no-progress' | 'rejections';
				summary: string;
				progressEvidence: string;
		  }
		| { kind: 'demo' }
		| { kind: 'accepted'; withGaps?: string[] }
		| { kind: 'changes_requested'; note: string }
		| {
				kind: 'follow_up_registered';
				followUpId: string;
				seat: SeatRole;
				reason: string;
				waitFor: string;
				untilMs?: number;
		  }
		| { kind: 'follow_up_fired'; followUpId: string; result: string; late?: boolean }
		| { kind: 'quota_exhausted'; seat: SeatRole; resetsAt?: number }
		| { kind: 'member_fault'; seat: SeatRole; fault: MemberFaultKind; detail?: string }
		| { kind: 'member_recovered'; seat: SeatRole; how: string }
		| { kind: 'decision_card'; card: OwnerCard }
		| { kind: 'card_answered'; cardId: string; optionId: string; note?: string }
		| { kind: 'owner_message'; messageId: string; to?: SeatRole; text: string; scope?: boolean }
		| { kind: 'message_delivered'; messageId: string; seat: SeatRole }
	);

export type LedgerEventKind = LedgerEvent['kind'];

export type TurnKind =
	| 'brief'
	| 'challenge'
	| 'respond'
	| 'position'
	| 'proposal'
	| 'response'
	| 'work'
	| 'qa_prep'
	| 'verify'
	| 'fix'
	| 'reverify'
	| 'review'
	| 'demo'
	| 'topic'
	| 'report_repair';

export interface Objection {
	about: string;
	problem: string;
	kind: 'unreasonable' | 'unverifiable' | 'risk';
}

export interface VerificationPlan {
	criterion: string;
	how: string;
	data?: string;
}

export interface ObjectionDecision {
	about: string;
	result: 'accept' | 'reject' | 'discuss';
	reason: string;
}

export interface ReviewProblem {
	title: string;
	location: string;
	/** Must name a confirmed criterion; otherwise it is a suggestion (PRD 6.7). */
	criterion: string;
	impact: string;
	expected: string;
}

/** The parsed body of a `team-report` block, discriminated by `type`. */
export type TeamReport =
	| {
			type: 'brief';
			scope: string;
			notDoing: string[];
			criteria: Array<Omit<Criterion, 'byOwner'>>;
			checks: CheckCommand[];
	  }
	| { type: 'challenge'; objections: Objection[]; plans?: VerificationPlan[] }
	| {
			type: 'respond';
			decisions: ObjectionDecision[];
			brief?: {
				scope: string;
				notDoing: string[];
				criteria: Array<Omit<Criterion, 'byOwner'>>;
				checks: CheckCommand[];
			};
			askOwner?: string | null;
	  }
	| {
			type: 'work';
			done: string[];
			summary: string;
			claimsComplete: boolean;
			waiting?: { reason: string; waitFor: string } | null;
	  }
	| { type: 'qa_prep'; tests: string[]; samples: string[] }
	| {
			type: 'verify';
			criteria: Array<{ id: string; pass: boolean; evidence: string }>;
			issues: Array<{
				title: string;
				criterion?: string;
				kind: 'defect' | 'standard';
				steps: string[];
				expected?: string;
				actual?: string;
			}>;
	  }
	| {
			type: 'fix';
			fixed: string[];
			notFixed: Array<{ id: string; why: string }>;
			summary?: string;
			attempt?: { basis: string; difference: string; expectation: string };
	  }
	| {
			type: 'reverify';
			results: Array<{ issue: string; pass: boolean; evidence: string }>;
			newIssues: Array<{
				title: string;
				criterion?: string;
				kind: 'defect' | 'standard';
				steps: string[];
			}>;
	  }
	| { type: 'review'; verdict: 'pass' | 'reject'; problems: ReviewProblem[]; suggestions: string[] }
	| { type: 'demo'; summary: string; evidence: string[]; decisions: string[]; changes: string[] }
	| { type: 'topic'; topic: string; why: string; participants: SeatRole[] };

/** Which seats may submit which report types (PRD R1, R2). */
export const REPORT_PERMISSIONS: Record<TeamReport['type'], readonly SeatRole[]> = {
	brief: ['pm'],
	challenge: ['dev', 'qa'],
	respond: ['pm'],
	work: ['dev'],
	qa_prep: ['qa'],
	verify: ['qa'],
	fix: ['dev'],
	reverify: ['qa'],
	review: ['pm'],
	demo: ['pm'],
	topic: ['pm', 'dev', 'qa'],
};
