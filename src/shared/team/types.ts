import type { FollowUpCondition } from '../followUp';
/**
 * Team chat domain types (PRD section 6). Shared by the main-process runtime,
 * the CLI and the renderer. The contract is described in
 * docs/round2/dev/team-model.md; the PRD wins on any conflict.
 */

import type { CheckBoundary } from '../checkRun';
import type { AgentId } from '../agentIds';
import type {
	AttemptInput,
	Boundary,
	Candidate,
	NextDecision,
	ProgressState,
} from '../progressRules';

export type TeamAction = 'push' | 'draftPr' | 'merge' | 'publish' | 'externalMessage';

export type SeatRole = 'pm' | 'dev' | 'qa';

/** Receipt for durable ingress; delivery and handling remain separate ledger facts. */
export interface QueuedTeamMessage {
	status: 'queued';
	messageId: string;
	to: SeatRole;
}
export const SEAT_ROLES: readonly SeatRole[] = ['pm', 'dev', 'qa'];

/** Tool, model and effort are independent choices (PRD 6.2). `effort` is the vendor's own level id. */
export interface SeatModel {
	tool: AgentId;
	model?: string;
	effort?: string;
}

export interface SeatConfig extends SeatModel {
	/** Optional seat-specific execution settings, including the native account directory. */
	customPath?: string;
	customArgs?: string;
	customEnv?: Record<string, string>;
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

/** The title is derived from the idea by the main process. */
export type CreateTeamInput = Omit<TeamConfig, 'id' | 'createdAt' | 'title'>;

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
	/** Enumerate every place named by this criterion, including separate viewers. */
	locations?: OutputLocation[];
}

export interface OutputLocation {
	label: string;
	target: string;
	kind: 'file' | 'preview' | 'screenshot';
}

export type DecisionLayer = 'fact' | 'implementation' | 'testing' | 'product' | 'commitment';

export interface TeamTopic {
	topic: string;
	why: string;
	participants: SeatRole[];
	owner?: SeatRole;
	layer?: DecisionLayer;
	reversible?: boolean;
	/** Stable question identity; reopens names the earlier discussion when wording changes. */
	question?: string;
	kind?: 'discussion' | 'standard';
	criterionId?: string;
	reopens?: string;
	evidence?: string[];
}

export interface DiscussionAction {
	seat: SeatRole;
	action: string;
	waitFor?: string;
}

export interface DiscussionExperiment {
	command: string;
	boundary?: CheckBoundary;
	basis: string;
	expected: string;
}

export interface StandardChangeRequest {
	criterionId: string;
	change: 'add' | 'tighten' | 'relax' | 'modify' | 'remove';
	criterion?: Criterion;
	reason: string;
	/** PM must justify intent; dev independently estimates cost in turns. */
	withinMeaning?: string;
	extraTurns?: number;
	preservesDeadline?: boolean;
	/** Owner-origin messages confer authority only for this exact pending message. */
	ownerMessageId?: string;
}

export interface OutputCapture {
	files: string[];
	previews: string[];
	locations?: Array<{
		criterion: string;
		location: OutputLocation;
		file?: string;
		preview?: string;
		error?: string;
	}>;
	beforeOutputId?: string;
}

export interface BaselineDiff {
	fromVersion: number | null;
	toVersion: number;
	scope?: { before: string; after: string };
	notDoing?: { before: string[]; after: string[] };
	criteria: Array<{ id: string; before?: Criterion; after?: Criterion }>;
	checks?: { before: CheckCommand[]; after: CheckCommand[] };
}

export interface CheckCommand {
	command: string;
	boundary?: CheckBoundary;
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
	/** A seat-scoped boundary leaves independent work runnable. */
	seat?: SeatRole;
	boundaries?: Boundary[];
	extension?: { hours?: number; turns?: number };
	seatChange?: { seat: SeatRole; model: SeatModel; substitute?: boolean };
	id: string;
	boundary: Boundary;
	title: string;
	/** Where it is stuck and why the remaining paths need the owner. */
	body: string;
	options: CardOption[];
	/** Budget used when raised, for escalations. */
	budgetNote?: string;
	discussionId?: string;
	standardChange?: StandardChangeRequest;
	/** Reference only, never a scheduling threshold. */
	referenceVotes?: string;
}

interface EventBase {
	/** Monotonic within a team. */
	seq: number;
	id: string;
	at: number;
	actor: LedgerActor;
	/** Link an owner action to its card answer so statistics count the decision once. */
	cardId?: string;
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
				/** Launch settings belong to this seat's account, never the replaced model. */
				configSource?: SeatRole;
		  }
		| { kind: 'phase_changed'; from?: TeamPhase; to: TeamPhase }
		| {
				kind: 'budget_extended';
				hours?: number;
				turns?: number;
				deadline?: number;
				turnBudget: number;
		  }
		| {
				kind: 'seat_configured';
				seat: SeatRole;
				model?: SeatModel;
				substitute?: SeatModel | null;
				wait?: boolean;
		  }
		| { kind: 'model_recovered'; unavailabilityId: string }
		| {
				kind: 'workspace_inspected';
				dispatchId: string;
				revision: string;
				status: string;
				recentCommits: string;
		  }
		| { kind: 'action_requested'; action: TeamAction; detail: string }
		| {
				kind: 'action_receipt';
				action: 'push' | 'draftPr';
				key: string;
				outcome: 'started' | 'succeeded' | 'failed';
				detail: string;
		  }
		| { kind: 'wrap_up'; summary: string; priorities: string[]; generatedBy: 'pm' | 'app' }
		| { kind: 'residual_item'; itemId: string; text: string; owner: string | null }
		| {
				kind: 'turn_progress';
				dispatchId: string;
				seat: SeatRole;
				changed: boolean;
				idleCount: number;
		  }
		| { kind: 'wait_handled'; followUpId: string }
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
				/** Exact assignment survives prompt-template changes between app versions. */
				prompt?: string;
				/** Replay the original ledger slice, including isolated challenge inputs. */
				sourceSeq?: number;
				expectedTurn?: ReportTurnKind;
				recoveryFor?: string;
				repairOf?: string;
				retryOf?: string;
				mode?: 'diagnose' | 'gather' | 'wake';
				problemId?: string;
				fingerprint?: string;
				failures?: string[];
				note?: string;
				discussionId?: string;
				round?: number;
				messageIds?: string[];
				followUpId?: string;
				/** Freeze the launch identity for reconciliation after takeover or restart. */
				binding?: TeamEvent<'seat_bound'>;
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
				/** Bounded visible reply, excluding all top-level team-report fences. */
				message?: string;
				/** Durable ingestion receipt; domain events can be recovered after a crash. */
				report?: TeamReport;
				repairTail?: string;
				canceled?: boolean;
				failureKind?: MemberFaultKind;
				resetsAt?: number;
		  }
		| { kind: 'report_accepted'; seat: SeatRole; dispatchId: string; report: TeamReport }
		| { kind: 'report_repaired'; seat: SeatRole; dispatchId: string }
		| { kind: 'report_rejected'; seat: SeatRole; dispatchId: string; reason: string }
		| { kind: 'workspace_submitted'; dispatchId: string; revision: string; diffHash: string }
		| { kind: 'qa_boundary_checked'; dispatchId: string }
		| { kind: 'qa_boundary_restored'; dispatchId: string; paths: string[] }
		| { kind: 'brief_published'; brief: Brief }
		| {
				kind: 'challenge_submitted';
				seat: SeatRole;
				objections: Objection[];
				plans?: VerificationPlan[];
				briefVersion?: number;
		  }
		| { kind: 'brief_response'; decisions: ObjectionDecision[] }
		| { kind: 'baseline_proposed'; briefVersion: number }
		| { kind: 'baseline_confirmed'; briefVersion: number }
		| { kind: 'baseline_edited'; criterionId: string; before: string; after: string; brief?: Brief }
		| { kind: 'baseline_returned'; note: string }
		| {
				kind: 'standard_change';
				criterionId: string;
				change: 'add' | 'tighten' | 'relax' | 'modify' | 'remove';
				before?: string;
				after?: string;
				reason: string;
				approvedBy: 'owner' | 'pm';
				/** Complete definition for an addition or a change to the proof method. */
				criterion?: Criterion;
				ownerMessageId?: string;
		  }
		| {
				kind: 'work_item';
				itemId: string;
				title: string;
				owner: SeatRole;
				state: 'claimed' | 'done' | 'checked';
				criterionId?: string;
				discussionId?: string;
		  }
		| {
				kind: 'check_run';
				/** A baseline canary proves the command runs, not that the product meets a criterion. */
				purpose?: 'trial' | 'verification';
				command: string;
				cwd: string;
				exitCode: number | null;
				outputTail: string;
				durationMs: number;
				covers: string[];
				evidenceId: string;
				timedOut?: boolean;
				notRun?: string;
				/** Stable batch identity, for restart reconciliation. */
				batchId?: string;
				testsRun?: number;
				testsSkipped?: number;
				dilution?: string[];
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
				reviewId?: string;
				location?: string;
				impact?: string;
		  }
		| { kind: 'issue_fixed'; issueId: string; summary?: string }
		| { kind: 'issue_verified'; issueId: string; pass: boolean; evidence?: string }
		| { kind: 'standard_issue_resolved'; issueId: string; reason: string }
		| {
				kind: 'criterion_evidence';
				criterionId: string;
				pass: boolean;
				source: 'app' | 'qa' | 'pm';
				evidence: string;
		  }
		| {
				kind: 'attempt';
				problemId: string;
				attempt: AttemptInput;
				/** Measured failures before the first attempt; defaults to that attempt's failures. */
				initialFailures?: string[];
				candidates?: Candidate[];
		  }
		| {
				kind: 'discussion_opened';
				discussionId: string;
				topic: string;
				owner: SeatRole;
				participants: SeatRole[];
				trigger: string;
				layer?: DecisionLayer;
				reversible?: boolean;
				question?: string;
				evidence?: string[];
				reopens?: string;
				change?: StandardChangeRequest;
				problemId?: string;
		  }
		| {
				kind: 'position';
				discussionId: string;
				seat: SeatRole;
				claim: string;
				basis: string;
				wouldChangeMind: string;
				evidence?: string[];
				extraTurns?: number;
				preservesDeadline?: boolean;
		  }
		| {
				kind: 'proposal';
				discussionId: string;
				proposal: string;
				decider: LedgerActor;
				round?: number;
				actions?: DiscussionAction[];
				compromise?: string;
				experiment?: DiscussionExperiment;
				options?: CardOption[];
		  }
		| {
				kind: 'response';
				discussionId: string;
				seat: SeatRole;
				result: 'agree' | 'reserve' | 'insist';
				reason: string;
				evidence?: string;
				baselineViolation?: string;
				round?: number;
		  }
		| {
				kind: 'discussion_closed';
				discussionId: string;
				decision: string;
				decider: LedgerActor;
				dissent?: string;
				contested?: boolean;
				actions: DiscussionAction[];
		  }
		| ({ kind: 'output_captured'; outputId: string } & OutputCapture)
		| { kind: 'topic_rejected'; topic: TeamTopic; reason: string }
		| { kind: 'suggestion'; text: string; criterionId?: string }
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
				basis?: string;
				approach?: string;
				difference?: string;
				discussionId?: string;
				/** A targeted diagnosis; omitted for a team-wide retro. */
				problemId?: string;
		  }
		| {
				kind: 'demo';
				criterionIds?: string[];
				changes?: string[];
				contested?: string[];
				suggestions?: string[];
				withEvidence?: number;
				total?: number;
		  }
		| { kind: 'accepted'; withGaps?: string[] }
		| { kind: 'changes_requested'; note: string }
		| {
				kind: 'follow_up_registered';
				followUpId: string;
				seat: SeatRole;
				reason: string;
				waitFor: string;
				untilMs?: number;
				poll?: number;
				unavailabilityId?: string;
				condition?: FollowUpCondition;
				faultId?: string;
		  }
		| { kind: 'follow_up_fired'; followUpId: string; result: string; late?: boolean }
		| {
				kind: 'quota_exhausted';
				seat: SeatRole;
				resetsAt?: number;
				model?: SeatModel;
				configSource?: SeatRole;
				detail?: string;
				login?: boolean;
		  }
		| { kind: 'substitute_took_over'; seat: SeatRole; model: SeatModel; temporary?: boolean }
		| { kind: 'member_fault'; seat: SeatRole; fault: MemberFaultKind; detail?: string }
		| { kind: 'member_recovered'; seat: SeatRole; how: string }
		| { kind: 'decision_card'; card: OwnerCard }
		| { kind: 'card_answered'; cardId: string; optionId: string; note?: string }
		| { kind: 'card_superseded'; cardId: string; reason: string }
		| { kind: 'owner_message'; messageId: string; to?: SeatRole; text: string; scope?: boolean }
		| { kind: 'message_delivered'; messageId: string; seat: SeatRole; dispatchId?: string }
		| { kind: 'message_handled'; messageId: string; seat: SeatRole; summary: string }
		| { kind: 'message_forwarded'; messageId: string; from: SeatRole; summary: string }
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
	| 'message'
	| 'retro'
	| 'recovery'
	| 'wrap_up'
	| 'wait'
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
export type TeamReport = {
	/** Any seat can raise a topic or propose a standard change in its own turn. */
	topic?: TeamTopic | string;
	standardChanges?: StandardChangeRequest[];
	requestedActions?: Array<{ action: TeamAction; detail: string }>;
} & (
	| {
			type: 'brief';
			scope: string;
			notDoing: string[];
			criteria: Array<Omit<Criterion, 'byOwner'>>;
			checks: CheckCommand[];
	  }
	| { type: 'recovery'; summary: string; recoveredJson?: string }
	| { type: 'wrap_up'; summary: string; priorities: string[] }
	| { type: 'wait'; summary: string; status: 'waiting' | 'ready' | 'problem' }
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
			waiting?: {
				reason: string;
				waitFor: string;
				needs?: SeatRole[];
				condition?: FollowUpCondition;
			} | null;
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
	| ({ type: 'topic' } & TeamTopic)
	| {
			type: 'position';
			discussionId: string;
			claim: string;
			basis: string;
			wouldChangeMind: string;
			evidence?: string[];
			extraTurns?: number;
			preservesDeadline?: boolean;
	  }
	| {
			type: 'proposal';
			discussionId: string;
			proposal: string;
			decider: LedgerActor;
			actions: DiscussionAction[];
			compromise?: string;
			experiment?: DiscussionExperiment;
			options?: CardOption[];
	  }
	| {
			type: 'response';
			discussionId: string;
			result: 'agree' | 'reserve' | 'insist';
			reason: string;
			evidence?: string;
			baselineViolation?: string;
	  }
	| {
			type: 'retro';
			discussionId: string;
			causes: string;
			approach: string;
			basis: string;
			difference: string;
			progressEvidence: string;
	  }
	| {
			type: 'message';
			summary: string;
			messages: Array<{
				messageId: string;
				scope: boolean;
				criterion?: Criterion;
				change?: StandardChangeRequest['change'];
				criterionId?: string;
			}>;
			resolvedStandards?: Array<{ issueId: string; reason: string }>;
	  }
);

/** Which seats may submit which report types (PRD R1, R2). */
export const REPORT_PERMISSIONS: Record<TeamReport['type'], readonly SeatRole[]> = {
	recovery: ['pm'],
	wrap_up: ['pm'],
	wait: ['pm', 'dev', 'qa'],
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
	position: ['pm', 'dev', 'qa'],
	proposal: ['pm', 'dev', 'qa'],
	response: ['pm', 'dev', 'qa'],
	retro: ['pm'],
	message: ['pm', 'dev', 'qa'],
};

export type TeamEvent<K extends LedgerEventKind> = Extract<LedgerEvent, { kind: K }>;
export type ReportTurnKind = TeamReport['type'];
export type M1TurnKind = Exclude<
	TurnKind,
	'position' | 'proposal' | 'response' | 'topic' | 'report_repair' | 'message' | 'retro'
>;
export type CriterionEvidenceStatus = 'unproven' | 'pending' | 'pass' | 'fail';

export interface CriterionEvidence {
	eventId: string;
	seq: number;
	source: ProofKind;
	/** Stable check identity or verdict source; a new result supersedes only its own lane. */
	key: string;
	status: Exclude<CriterionEvidenceStatus, 'unproven'>;
	evidence: string;
	reason: string;
}

export interface CriterionState extends Criterion {
	confirmed: boolean;
	status: CriterionEvidenceStatus;
	reason: string;
	evidence: CriterionEvidence[];
	/** Evidence before a definition change is retained, but no longer proves the new wording. */
	definitionSeq: number;
}

export interface TeamIssue {
	id: string;
	opened: TeamEvent<'issue_opened'>;
	state: 'opened' | 'fixed-claimed' | 'verified-pass' | 'verified-fail' | 'superseded';
	history: Array<
		TeamEvent<
			| 'issue_opened'
			| 'issue_fixed'
			| 'issue_verified'
			| 'standard_issue_resolved'
			| 'standard_change'
		>
	>;
}

export interface TeamDiscussion {
	id: string;
	opened?: TeamEvent<'discussion_opened'>;
	positions: TeamEvent<'position'>[];
	proposals: TeamEvent<'proposal'>[];
	responses: TeamEvent<'response'>[];
	decision?: TeamEvent<'discussion_closed'>;
}

export interface TeamUsage {
	turns: number;
	/** Dispatches charged to the limit; quota refusals are recorded but not charged. */
	budgetTurns: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	/** Sum of measured member time, not wall-clock team effort. */
	durationMs: number;
	turnsWithTokens: number;
	turnsWithCost: number;
}

export interface TeamSeatState {
	binding?: TeamEvent<'seat_bound'>;
	model?: SeatModel;
	lastFault?: TeamEvent<'member_fault'>;
	faultActive: boolean;
	quota?: TeamEvent<'quota_exhausted'>;
	takeover: 'substitute' | 'temporary' | null;
	activeDispatchIds: string[];
	usage: TeamUsage;
}

export interface TeamProblem {
	initialFailures: string[];
	progress: ProgressState;
	candidates: Candidate[];
	decision: NextDecision;
}

export interface TeamStatistics {
	ownerDecisions: number;
	discussions: number;
	rejections: number;
	retros: number;
	recoveries: number;
	turns: number;
}

/** Replay output only. Runtime commands validate and append events, never mutate this snapshot. */
export interface TeamState {
	config: TeamConfig | null;
	phase: TeamPhase;
	paused: boolean;
	stopped: boolean;
	terminal: TeamTerminal | null;
	residual: string[];
	residualItems: TeamEvent<'residual_item'>[];
	unavailable: TeamEvent<'quota_exhausted'>[];
	wrapUp?: TeamEvent<'wrap_up'>;
	endedAt?: number;
	brief: Brief | null;
	briefs: Brief[];
	baseline: {
		proposedVersion: number | null;
		confirmedVersion: number | null;
		/** Effective confirmed baseline, including explicitly approved edits. */
		brief: Brief | null;
		edits: TeamEvent<'baseline_edited'>[];
		returns: TeamEvent<'baseline_returned'>[];
	};
	criteria: CriterionState[];
	challenges: TeamEvent<'challenge_submitted'>[];
	briefResponses: TeamEvent<'brief_response'>[];
	workItems: TeamEvent<'work_item'>[];
	checks: TeamEvent<'check_run'>[];
	issues: TeamIssue[];
	discussions: TeamDiscussion[];
	decisions: TeamEvent<'discussion_closed'>[];
	standardChanges: TeamEvent<'standard_change'>[];
	followUps: TeamEvent<'follow_up_registered'>[];
	openCards: OwnerCard[];
	cardAnswers: TeamEvent<'card_answered'>[];
	seats: Record<SeatRole, TeamSeatState>;
	problems: Record<string, TeamProblem>;
	reviews: TeamEvent<'review'>[];
	rejectionCount: number;
	rejectionsInRow: number;
	reviewProgress: ProgressState;
	reviewDecision: NextDecision;
	retros: TeamEvent<'retro'>[];
	outputs: TeamEvent<'output_captured'>[];
	turns: Array<{
		dispatchId: string;
		seat: SeatRole;
		dispatched?: TeamEvent<'turn_dispatched'>;
		finished?: TeamEvent<'turn_finished'>;
		report?: TeamReport;
		reportError?: string;
		repaired?: boolean;
	}>;
	pendingMessages: TeamEvent<'owner_message'>[];
	messages: Array<{
		message: TeamEvent<'owner_message'>;
		delivered?: TeamEvent<'message_delivered'>;
		handled?: TeamEvent<'message_handled'>;
		forwarded?: TeamEvent<'message_forwarded'>;
	}>;
	suggestions: string[];
	demos: TeamEvent<'demo'>[];
	usage: TeamUsage;
	statistics: TeamStatistics;
}

export interface TeamTurnLog {
	dispatchId: string;
	seat: SeatRole;
	turn?: TurnKind;
	prompt?: string;
	reply?: string;
	report?: TeamReport;
	error?: string;
}

export interface TeamStatusView {
	wrapUp?: TeamEvent<'wrap_up'>;
	generatedBy: 'app';
	title: string;
	phase: TeamPhase;
	paused: boolean;
	stopped: boolean;
	terminal: TeamTerminal | null;
	residual: string[];
	criteria: {
		total: number;
		/** Confirmed criteria with passing evidence, never member completion claims. */
		withEvidence: number;
		missing: Array<{ id: string; text: string; status: CriterionEvidenceStatus; reason: string }>;
	};
	openWorkItems: TeamState['workItems'];
	waitingFor: string[];
	openCards: OwnerCard[];
	budget: {
		turnsUsed: number;
		turnsTotal: number;
		deadline?: number;
		remainingMs?: number;
		exhausted: boolean;
	};
	seats: Array<{
		seat: SeatRole;
		status: 'unbound' | 'ready' | 'working' | 'waiting' | 'fault';
		model?: SeatModel;
		lastFault?: MemberFaultKind;
		detail?: string;
		takeover: TeamSeatState['takeover'];
		usage: TeamUsage;
	}>;
	usage: TeamUsage;
}
