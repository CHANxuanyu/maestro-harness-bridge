import { isOpenTeamIssue, missingOutputLocations } from './policy';
import { decideNext, judgeAttempts, type AttemptInput } from '../progressRules';
import { compactToolOutput } from '../toolOutput';
import {
	SEAT_ROLES,
	type Brief,
	type Criterion,
	type CriterionState,
	type LedgerEvent,
	type TeamEvent,
	type TeamState,
	type TeamUsage,
} from './types';

/** Default IPC/CLI replay and append deltas retain facts, not full audit text. */
export function teamEventForTransport(event: LedgerEvent): LedgerEvent {
	if (event.kind === 'turn_dispatched')
		return {
			...event,
			prompt: undefined,
			note: compactToolOutput(event.note).output as typeof event.note,
		};
	if (event.kind === 'turn_finished')
		return {
			...event,
			repairTail: undefined,
			message: compactToolOutput(event.message).output as typeof event.message,
		};
	if (event.kind === 'check_run')
		return { ...event, outputTail: compactToolOutput(event.outputTail).output as string };
	return event;
}

function emptyUsage(): TeamUsage {
	return {
		turns: 0,
		budgetTurns: 0,
		inputTokens: 0,
		outputTokens: 0,
		costUsd: 0,
		durationMs: 0,
		turnsWithTokens: 0,
		turnsWithCost: 0,
	};
}

function copyBrief(brief: Brief): Brief {
	return {
		...brief,
		notDoing: [...brief.notDoing],
		criteria: brief.criteria.map((c) => ({ ...c })),
		checks: brief.checks.map((c) => ({ ...c, covers: [...c.covers] })),
	};
}

function criterionState(
	criterion: Criterion,
	confirmed: boolean,
	seq: number,
	previous?: CriterionState
): CriterionState {
	const unchanged =
		previous &&
		previous.text === criterion.text &&
		previous.proof === criterion.proof &&
		previous.how === criterion.how &&
		previous.experience === criterion.experience &&
		JSON.stringify(previous.locations) === JSON.stringify(criterion.locations);
	return {
		...criterion,
		confirmed,
		definitionSeq: unchanged ? previous.definitionSeq : seq,
		evidence: previous?.evidence ?? [],
		status: 'unproven',
		reason: 'No evidence recorded.',
	};
}

/** Latest results in independent evidence lanes must all agree; a seat cannot erase a failed check. */
function evaluateEvidence(criterion: CriterionState): void {
	const latest = new Map<string, CriterionState['evidence'][number]>();
	for (const evidence of criterion.evidence) {
		if (evidence.seq >= criterion.definitionSeq) latest.set(evidence.key, evidence);
	}
	const results = [...latest.values()];
	const failure = results.find((e) => e.status === 'fail');
	const pending = results.find((e) => e.status === 'pending');
	// Rechecking one defect is narrower than verifying the whole criterion.
	const proof = results.find(
		(e) => e.source === criterion.proof && e.status === 'pass' && !e.key.startsWith('issue:')
	);
	criterion.status = failure
		? 'fail'
		: pending
			? 'pending'
			: proof
				? 'pass'
				: results.length
					? 'pending'
					: 'unproven';
	criterion.reason =
		failure?.reason ??
		pending?.reason ??
		(proof
			? proof.reason
			: results.length
				? `Waiting for ${criterion.proof} evidence for this criterion.`
				: 'No evidence recorded for the current definition.');
}

/**
 * Replay trusted, typed ledger entries. Unknown kinds and dangling references are
 * harmless. Domain events own state; accepted reports only contribute QA verdicts.
 * No clocks, I/O, or completion claims participate in evidence or statistics.
 */
export function reduceLedger(events: LedgerEvent[]): TeamState {
	const state: TeamState = {
		config: null,
		phase: 'clarify',
		paused: false,
		stopped: false,
		terminal: null,
		residual: [],
		residualItems: [],
		unavailable: [],
		appObservations: [],
		brief: null,
		briefs: [],
		baseline: {
			proposedVersion: null,
			confirmedVersion: null,
			brief: null,
			edits: [],
			returns: [],
		},
		criteria: [],
		challenges: [],
		briefResponses: [],
		workItems: [],
		checks: [],
		issues: [],
		discussions: [],
		decisions: [],
		standardChanges: [],
		followUps: [],
		openCards: [],
		cardAnswers: [],
		seats: {
			pm: { faultActive: false, takeover: null, activeDispatchIds: [], usage: emptyUsage() },
			dev: { faultActive: false, takeover: null, activeDispatchIds: [], usage: emptyUsage() },
			qa: { faultActive: false, takeover: null, activeDispatchIds: [], usage: emptyUsage() },
		},
		problems: {},
		reviews: [],
		rejectionCount: 0,
		rejectionsInRow: 0,
		reviewProgress: judgeAttempts([], []),
		reviewDecision: { kind: 'done' },
		retros: [],
		outputs: [],
		outputObservations: [],
		turns: [],
		pendingMessages: [],
		messages: [],
		suggestions: [],
		demos: [],
		usage: emptyUsage(),
		statistics: {
			ownerDecisions: 0,
			ownerMessages: 0,
			wakes: 0,
			substitutions: 0,
			discussions: 0,
			rejections: 0,
			retros: 0,
			recoveries: 0,
			turns: 0,
		},
	};
	const seen = new Set<string>();
	const answered = new Set<string>();
	const fired = new Set<string>();
	const handled = new Set<string>();
	const ownerDecisions = new Set<string>();
	const ownerMessages = new Set<string>();
	const attempts = new Map<
		string,
		{
			initial: string[];
			inputs: AttemptInput[];
			candidates: NonNullable<TeamEvent<'attempt'>['candidates']>;
		}
	>();
	const reviewAttempts: AttemptInput[] = [];
	let reviewInitial: string[] = [];

	const ownerDecision = (event: LedgerEvent) =>
		ownerDecisions.add(event.cardId ? `card:${event.cardId}` : event.id);
	const syncCriteria = (brief: Brief, confirmed: boolean, seq: number) => {
		state.criteria = brief.criteria.map((c) =>
			criterionState(
				c,
				confirmed,
				seq,
				state.criteria.find((old) => old.id === c.id)
			)
		);
	};
	const addEvidence = (id: string, evidence: CriterionState['evidence'][number]) => {
		state.criteria.find((c) => c.id === id)?.evidence.push(evidence);
	};
	const verifyIssue = (event: TeamEvent<'issue_verified'>) => {
		if (event.actor !== 'qa' && event.actor !== 'app') return;
		const issue = state.issues.find((i) => i.id === event.issueId);
		if (!issue || issue.state !== 'fixed-claimed' || !event.evidence?.trim()) return;
		issue.history.push(event);
		issue.state = event.pass ? 'verified-pass' : 'verified-fail';
		if (issue.opened.criterionId)
			addEvidence(issue.opened.criterionId, {
				eventId: event.id,
				seq: event.seq,
				key: `issue:${issue.id}`,
				source: 'qa',
				status: event.pass ? 'pass' : 'fail',
				evidence: event.evidence,
				reason: `QA ${event.pass ? 'verified' : 'rejected'} fix for ${issue.id}: ${event.evidence}`,
			});
	};
	const allProven = () => {
		state.criteria.forEach(evaluateEvidence);
		return (
			state.baseline.confirmedVersion !== null &&
			state.criteria.length > 0 &&
			state.criteria.every((c) => c.confirmed && c.status === 'pass') &&
			state.reviews.at(-1)?.verdict === 'pass' &&
			!state.issues.some(isOpenTeamIssue)
		);
	};

	for (const event of [...events].sort(
		(a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
	)) {
		if (seen.has(event.id)) continue;
		seen.add(event.id);
		switch (event.kind) {
			case 'team_created':
				if (!state.config) {
					state.config = event.config;
					for (const seat of SEAT_ROLES) state.seats[seat].model ??= event.config.seats[seat];
				}
				break;
			case 'budget_extended':
				if (state.config && event.actor === 'owner') {
					state.config = {
						...state.config,
						deadline: event.deadline,
						turnBudget: event.turnBudget,
					};
					ownerDecision(event);
				}
				break;
			case 'seat_configured':
				if (state.config && event.actor === 'owner') {
					const current = state.config.seats[event.seat];
					state.config = {
						...state.config,
						seats: {
							...state.config.seats,
							[event.seat]: {
								...current,
								...(event.model && event.model.tool !== current.tool
									? { customPath: undefined, customArgs: undefined, customEnv: undefined }
									: {}),
								...event.model,
								...(event.substitute !== undefined
									? { substitute: event.substitute ?? undefined }
									: {}),
							},
						},
					};
					ownerDecision(event);
				}
				break;
			case 'model_recovered':
				state.unavailable = state.unavailable.filter((q) => q.id !== event.unavailabilityId);
				for (const seat of SEAT_ROLES)
					if (state.seats[seat].quota?.id === event.unavailabilityId)
						delete state.seats[seat].quota;
				break;
			case 'wrap_up':
				state.wrapUp = event;
				break;
			case 'residual_item':
				state.residualItems = state.residualItems.filter((item) => item.itemId !== event.itemId);
				state.residualItems.push(event);
				break;
			case 'phase_changed':
				if (!state.terminal) state.phase = event.to;
				break;
			case 'paused':
				if (!state.terminal) state.paused = true;
				break;
			case 'resumed':
				if (!state.terminal) state.paused = false;
				break;
			case 'stopped':
				if (!state.terminal) {
					state.stopped = true;
					state.paused = false;
					state.terminal = 'stopped';
					state.endedAt = event.at;
				}
				if (event.actor === 'owner') ownerDecision(event);
				break;
			case 'terminal':
				if (event.actor !== 'app' && event.actor !== 'owner') break;
				if (event.terminal === 'all' && !allProven()) break;
				if (state.terminal && state.terminal !== event.terminal) break;
				state.terminal = event.terminal;
				state.endedAt ??= event.at;
				state.stopped = event.terminal === 'stopped';
				state.paused = false;
				state.residual = [...event.residual];
				break;
			case 'accepted':
				if (event.actor !== 'owner' || state.terminal) break;
				ownerDecision(event);
				if (event.withGaps?.length || allProven()) {
					state.terminal = event.withGaps?.length ? 'gaps' : 'all';
					state.endedAt = event.at;
					state.residual = [...(event.withGaps ?? [])];
					state.phase = 'accept';
					state.paused = false;
				}
				break;
			case 'changes_requested':
				if (event.actor === 'owner' && !state.terminal) {
					state.phase = 'implement';
					ownerDecision(event);
				}
				break;
			case 'seat_bound': {
				const seat = state.seats[event.seat];
				seat.binding = event;
				seat.model = event.model;
				seat.takeover =
					event.reason === 'temporary'
						? 'temporary'
						: event.reason === 'substitute'
							? 'substitute'
							: null;
				break;
			}
			case 'substitute_took_over':
				state.statistics.substitutions++;
				state.seats[event.seat].takeover = event.temporary ? 'temporary' : 'substitute';
				state.seats[event.seat].model = event.model;
				break;
			case 'member_fault':
				state.seats[event.seat].lastFault = event;
				state.seats[event.seat].faultActive = event.fault !== 'still-working';
				break;
			case 'quota_exhausted':
				state.seats[event.seat].quota = event;
				state.unavailable.push(event);
				break;
			case 'member_recovered':
				state.seats[event.seat].faultActive = false;
				delete state.seats[event.seat].quota;
				// Recovery and switching back are separate facts; seat_bound(restored) ends takeover.
				state.statistics.recoveries++;
				break;
			case 'turn_dispatched':
			case 'turn_finished':
			case 'report_accepted':
			case 'report_rejected':
			case 'report_normalized':
			case 'report_repaired': {
				let turn = state.turns.find((t) => t.dispatchId === event.dispatchId);
				if (!turn) {
					turn = { dispatchId: event.dispatchId, seat: event.seat };
					state.turns.push(turn);
				}
				if (turn.seat !== event.seat) break;
				if (event.kind === 'turn_dispatched') turn.dispatched ??= event;
				if (event.kind === 'turn_finished') {
					turn.finished ??= event;
					turn.reportError ??= event.reportError;
				}
				if (event.kind === 'report_rejected') turn.reportError = event.reason;
				if (event.kind === 'report_repaired') turn.repaired = true;
				if (event.kind === 'report_normalized' && event.actor === 'app')
					turn.normalizations = [...(turn.normalizations ?? []), ...event.changes];
				if (
					event.kind !== 'report_accepted' ||
					turn.report ||
					(event.actor !== 'app' && event.actor !== event.seat)
				)
					break;
				turn.report = event.report;
				delete turn.reportError;
				if (event.seat === 'qa' && event.report.type === 'verify') {
					for (const result of event.report.criteria) {
						if (!result.evidence.trim()) continue;
						addEvidence(result.id, {
							eventId: event.id,
							seq: event.seq,
							key: 'qa',
							source: 'qa',
							status: result.pass ? 'pass' : 'fail',
							evidence: result.evidence,
							reason: `QA: ${result.evidence}`,
						});
					}
				}
				if (event.seat === 'qa' && event.report.type === 'reverify') {
					for (const result of event.report.results)
						verifyIssue({
							id: `${event.id}:${result.issue}`,
							seq: event.seq,
							at: event.at,
							actor: 'qa',
							kind: 'issue_verified',
							issueId: result.issue,
							pass: result.pass,
							evidence: result.evidence,
						});
				}
				break;
			}
			case 'brief_published': {
				const brief = copyBrief(event.brief);
				if (!state.baseline.brief) {
					for (const change of state.standardChanges.filter(
						(c) => c.approvedBy === 'owner' && c.criterion && c.change === 'add'
					))
						if (!brief.criteria.some((c) => c.id === change.criterionId))
							brief.criteria.push({ ...change.criterion! });
				}
				state.briefs.push(copyBrief(brief));
				state.brief = brief;
				if (!state.baseline.brief) syncCriteria(brief, false, event.seq);
				break;
			}
			case 'challenge_submitted':
				state.challenges.push(event);
				break;
			case 'brief_response':
				state.briefResponses.push(event);
				break;
			case 'baseline_proposed':
				state.baseline.proposedVersion = event.briefVersion;
				break;
			case 'baseline_confirmed': {
				if (event.actor !== 'owner') break;
				const brief = [...state.briefs].reverse().find((b) => b.version === event.briefVersion);
				if (!brief) break;
				state.baseline.brief = copyBrief(brief);
				state.baseline.confirmedVersion = event.briefVersion;
				state.baseline.proposedVersion = null;
				syncCriteria(brief, true, event.seq);
				ownerDecision(event);
				break;
			}
			case 'baseline_edited': {
				if (event.actor !== 'owner') break;
				state.baseline.edits.push(event);
				ownerDecision(event);
				if (event.brief && !state.baseline.brief) {
					state.briefs.push(copyBrief(event.brief));
					state.brief = copyBrief(event.brief);
					state.baseline.proposedVersion = event.brief.version;
					syncCriteria(event.brief, false, event.seq);
					break;
				}
				const brief = state.baseline.brief ?? state.brief;
				const criterion = brief?.criteria.find((c) => c.id === event.criterionId);
				if (brief && criterion) {
					criterion.text = event.after;
					criterion.byOwner = true;
					if (!state.baseline.brief)
						state.briefs = state.briefs.map((b) =>
							b.version === brief.version ? copyBrief(brief) : b
						);
					syncCriteria(brief, state.baseline.confirmedVersion !== null, event.seq);
				}
				break;
			}
			case 'baseline_returned':
				if (event.actor === 'owner') {
					state.baseline.returns.push(event);
					state.baseline.proposedVersion = null;
					ownerDecision(event);
				}
				break;
			case 'standard_change': {
				state.standardChanges.push(event);
				const brief = state.baseline.brief ?? (state.brief ? copyBrief(state.brief) : null);
				if (
					!brief ||
					(event.approvedBy !== 'owner' && event.change !== 'add' && event.change !== 'tighten')
				)
					break;
				if (event.actor !== 'app' && event.actor !== event.approvedBy) break;
				if (event.approvedBy === 'owner' && !event.ownerMessageId) ownerDecision(event);
				const index = brief.criteria.findIndex((c) => c.id === event.criterionId);
				if (event.change === 'remove') {
					if (index >= 0) brief.criteria.splice(index, 1);
					brief.checks = brief.checks
						.map((check) => ({
							...check,
							covers: check.covers.filter((id) => id !== event.criterionId),
						}))
						.filter((check) => check.covers.length);
				} else if (index >= 0 && event.after) {
					const old = brief.criteria[index];
					// PM tightening may not silently change the proof method.
					brief.criteria[index] = {
						...old,
						...(event.approvedBy === 'owner' ? event.criterion : undefined),
						id: old.id,
						text: event.after,
					};
				} else if (index < 0 && event.change === 'add' && event.criterion?.id === event.criterionId)
					brief.criteria.push({ ...event.criterion });
				if (!state.baseline.brief) {
					brief.version++;
					state.briefs.push(copyBrief(brief));
					state.brief = brief;
				}
				if (event.approvedBy === 'owner' && ['remove', 'relax', 'modify'].includes(event.change)) {
					for (const issue of state.issues.filter(
						(i) => i.opened.criterionId === event.criterionId && isOpenTeamIssue(i)
					)) {
						issue.state = 'superseded';
						issue.history.push(event);
					}
				}
				syncCriteria(brief, state.baseline.confirmedVersion !== null, event.seq);
				if (state.baseline.confirmedVersion !== null) state.phase = 'implement';
				break;
			}
			case 'work_item': {
				const index = state.workItems.findIndex((item) => item.itemId === event.itemId);
				if (index < 0) state.workItems.push(event);
				else state.workItems[index] = event;
				break;
			}
			case 'check_run': {
				if (event.actor !== 'app') break;
				state.checks.push(event);
				if (event.purpose === 'trial') break;
				const status =
					!event.evidenceId.trim() || event.notRun || (event.exitCode === null && !event.timedOut)
						? 'pending'
						: event.exitCode === 0 && !event.timedOut
							? 'pass'
							: 'fail';
				for (const id of event.covers)
					addEvidence(id, {
						eventId: event.id,
						seq: event.seq,
						key: JSON.stringify(['check', event.cwd, event.command]),
						source: 'app',
						status,
						evidence: event.evidenceId,
						reason:
							(!event.evidenceId.trim() ? 'Check result has no evidence reference.' : '') ||
							event.notRun ||
							`${event.command}: ${event.timedOut ? 'timed out' : event.exitCode === null ? 'no exit result' : `exit ${event.exitCode}`}`,
					});
				break;
			}
			case 'criterion_evidence': {
				if ((event.actor !== 'app' && event.actor !== event.source) || !event.evidence.trim())
					break;
				const criterion = state.criteria.find((c) => c.id === event.criterionId);
				if (
					event.source === 'pm' &&
					(criterion?.proof !== 'pm' ||
						!state.outputs.some(
							(o) =>
								o.outputId === event.evidence ||
								o.files.includes(event.evidence) ||
								o.previews.includes(event.evidence)
						))
				)
					break;
				addEvidence(event.criterionId, {
					eventId: event.id,
					seq: event.seq,
					key: event.source,
					source: event.source,
					status: event.pass ? 'pass' : 'fail',
					evidence: event.evidence,
					reason: `${event.source}: ${event.evidence}`,
				});
				break;
			}
			case 'issue_opened':
				if (
					(event.actor === 'qa' ||
						event.actor === 'app' ||
						(event.actor === 'pm' && !!event.reviewId)) &&
					!state.issues.some((i) => i.id === event.issueId)
				) {
					state.issues.push({
						id: event.issueId,
						opened: event,
						state: 'opened',
						history: [event],
					});
					if (event.criterionId)
						addEvidence(event.criterionId, {
							eventId: event.id,
							seq: event.seq,
							key: `issue:${event.issueId}`,
							source: 'qa',
							status: 'fail',
							evidence: event.id,
							reason: `QA issue ${event.issueId}: ${event.title}`,
						});
				}
				break;
			case 'issue_fixed': {
				const issue = state.issues.find((i) => i.id === event.issueId);
				if (
					issue &&
					issue.opened.issueKind === 'defect' &&
					(event.actor === 'dev' || event.actor === 'app') &&
					isOpenTeamIssue(issue)
				) {
					issue.state = 'fixed-claimed';
					issue.history.push(event);
				}
				break;
			}
			case 'issue_verified':
				verifyIssue(event);
				break;
			case 'standard_issue_resolved': {
				const issue = state.issues.find(
					(i) => i.id === event.issueId && i.opened.issueKind === 'standard'
				);
				if (issue && (event.actor === 'pm' || event.actor === 'app')) {
					issue.state = 'verified-pass';
					issue.history.push(event);
					if (issue.opened.criterionId)
						addEvidence(issue.opened.criterionId, {
							eventId: event.id,
							seq: event.seq,
							key: `issue:${issue.id}`,
							source: 'pm',
							status: 'pass',
							evidence: event.id,
							reason: event.reason,
						});
				}
				break;
			}
			case 'attempt': {
				let problem = attempts.get(event.problemId);
				if (!problem) {
					problem = {
						initial: [...(event.initialFailures ?? event.attempt.failures)],
						inputs: [],
						candidates: [],
					};
					attempts.set(event.problemId, problem);
				}
				if (!problem.inputs.some((a) => a.id === event.attempt.id))
					problem.inputs.push(event.attempt);
				if (event.candidates) problem.candidates = event.candidates;
				break;
			}
			case 'discussion_opened':
			case 'position':
			case 'proposal':
			case 'response':
			case 'discussion_closed': {
				let discussion = state.discussions.find((d) => d.id === event.discussionId);
				if (!discussion) {
					discussion = { id: event.discussionId, positions: [], proposals: [], responses: [] };
					state.discussions.push(discussion);
				}
				if (event.kind === 'discussion_opened') discussion.opened ??= event;
				if (event.kind === 'position') discussion.positions.push(event);
				if (event.kind === 'proposal') discussion.proposals.push(event);
				if (event.kind === 'response') discussion.responses.push(event);
				if (event.kind === 'discussion_closed' && !discussion.decision) {
					discussion.decision = event;
					state.decisions.push(event);
					if (event.decider === 'owner') ownerDecision(event);
				}
				break;
			}
			case 'review': {
				if (event.actor !== 'pm' && event.actor !== 'app') break;
				const previous = state.reviews.at(-1);
				const evidence = state.criteria
					.filter((criterion) => previous?.problems.some((p) => p.criterion === criterion.id))
					.flatMap((criterion) => criterion.evidence)
					.filter(
						(proof) =>
							proof.source === 'qa' &&
							proof.status === 'pass' &&
							proof.seq > (previous?.seq ?? event.seq)
					)
					.map((proof) => proof.evidence);
				state.reviews.push(event);
				state.suggestions.push(...event.suggestions);
				// Outstanding criterion failures remain until independent QA resolves their issues.
				// Rephrasing a PM comment cannot erase a previously recorded problem.
				const reviewIssues = state.issues.filter((i) => i.opened.reviewId);
				const failures =
					event.verdict === 'pass' && allProven()
						? []
						: [
								...new Set([
									...reviewIssues
										.filter((i) => isOpenTeamIssue(i))
										.map((i) =>
											JSON.stringify([i.opened.criterionId, i.opened.location, i.opened.expected])
										),
									...event.problems.map((p) =>
										reviewIssues.some((i) => i.opened.criterionId === p.criterion)
											? JSON.stringify([p.criterion, p.location, p.expected])
											: p.criterion
									),
									...reviewInitial.filter(
										(id) =>
											!reviewIssues.length &&
											!evidence.length &&
											!event.problems.some((p) => p.criterion === id)
									),
								]),
							];
				if (!failures.length && event.verdict !== 'pass') failures.push('review');
				if (!reviewAttempts.length) reviewInitial = [...failures];
				reviewAttempts.push({
					id: event.id,
					fingerprint: JSON.stringify([state.outputs.at(-1)?.outputId, evidence]),
					failures,
					evidence,
					rejected: event.verdict === 'reject',
				});
				if (event.verdict === 'reject') state.rejectionCount++;
				break;
			}
			case 'retro':
				state.retros.push(event);
				for (const [id, problem] of attempts)
					if (!event.problemId || event.problemId === id)
						problem.inputs.push({ id: event.id, fingerprint: '', failures: [], diagnosis: true });
				if (!event.problemId || event.reason === 'rejections')
					reviewAttempts.push({ id: event.id, fingerprint: '', failures: [], diagnosis: true });
				break;
			case 'suggestion':
				state.suggestions.push(event.text);
				break;
			case 'demo':
				if (allProven() && !missingOutputLocations(state, state.outputs.at(-1)).length)
					state.demos.push(event);
				break;
			case 'output_captured':
				if (event.actor === 'app') state.outputs.push(event);
				break;
			case 'output_observation':
				if (event.actor === 'app' && state.outputs.some((o) => o.outputId === event.outputId))
					state.outputObservations.push(event);
				break;
			case 'app_observation':
				if (event.actor === 'app') state.appObservations.push(event);
				break;
			case 'follow_up_registered':
				if (!fired.has(event.followUpId)) {
					state.followUps = state.followUps.filter((f) => f.followUpId !== event.followUpId);
					state.followUps.push(event);
				}
				break;
			case 'follow_up_fired':
			case 'wait_canceled':
				fired.add(event.followUpId);
				state.followUps = state.followUps.filter((f) => f.followUpId !== event.followUpId);
				break;
			case 'decision_card':
				if (!answered.has(event.card.id) && !state.openCards.some((c) => c.id === event.card.id))
					state.openCards.push(event.card);
				break;
			case 'card_superseded':
				answered.add(event.cardId);
				state.openCards = state.openCards.filter((c) => c.id !== event.cardId);
				break;
			case 'card_answered':
				if (event.actor === 'owner' && !answered.has(event.cardId)) {
					answered.add(event.cardId);
					state.openCards = state.openCards.filter((c) => c.id !== event.cardId);
					state.cardAnswers.push(event);
					ownerDecisions.add(`card:${event.cardId}`);
				}
				break;
			case 'owner_message':
				if (event.actor === 'owner') ownerMessages.add(event.messageId);
				if (!state.messages.some((m) => m.message.messageId === event.messageId)) {
					state.messages.push({ message: event });
					if (!handled.has(event.messageId)) state.pendingMessages.push(event);
				}
				break;
			case 'message_delivered': {
				const message = state.messages.find((m) => m.message.messageId === event.messageId);
				if (message) message.delivered = event;
				break;
			}
			case 'message_forwarded': {
				const message = state.messages.find((m) => m.message.messageId === event.messageId);
				if (message) message.forwarded = event;
				break;
			}
			case 'message_handled': {
				handled.add(event.messageId);
				const message = state.messages.find((m) => m.message.messageId === event.messageId);
				if (message) message.handled = event;
				state.pendingMessages = state.pendingMessages.filter(
					(m) => m.messageId !== event.messageId
				);
				break;
			}
		}
	}

	for (const turn of state.turns) {
		const seat = state.seats[turn.seat];
		if (turn.dispatched && !turn.finished) seat.activeDispatchIds.push(turn.dispatchId);
		if (turn.dispatched || turn.finished) {
			for (const usage of [state.usage, seat.usage]) {
				usage.turns++;
				usage.budgetTurns++;
				const finished = turn.finished;
				if (!finished) continue;
				for (const key of ['inputTokens', 'outputTokens', 'costUsd', 'durationMs'] as const) {
					const value = finished[key];
					if (value !== undefined && Number.isFinite(value) && value >= 0) usage[key] += value;
				}
				if (finished.inputTokens !== undefined || finished.outputTokens !== undefined)
					usage.turnsWithTokens++;
				if (finished.costUsd !== undefined) usage.turnsWithCost++;
			}
		}
	}
	const budget = state.config
		? { used: state.usage.turns, total: state.config.turnBudget }
		: undefined;
	for (const [id, problem] of attempts) {
		const progress = judgeAttempts(problem.initial, problem.inputs);
		Object.defineProperty(state.problems, id, {
			value: {
				initialFailures: problem.initial,
				progress,
				candidates: problem.candidates,
				decision: decideNext(progress, { candidates: problem.candidates, budget }),
			},
			enumerable: true,
			configurable: true,
		});
	}
	state.reviewProgress = judgeAttempts(reviewInitial, reviewAttempts);
	state.reviewDecision = decideNext(state.reviewProgress, { budget });
	state.rejectionsInRow = state.reviewProgress.rejectionsInRow;
	state.criteria.forEach(evaluateEvidence);
	state.statistics = {
		...state.statistics,
		ownerDecisions: ownerDecisions.size,
		ownerMessages: ownerMessages.size,
		wakes: state.turns.filter((turn) => turn.dispatched?.mode === 'wake').length,
		discussions: state.discussions.filter((d) => d.opened).length,
		rejections: state.rejectionCount,
		retros: state.retros.length,
		turns: state.usage.turns,
	};
	// Budget is the current decision boundary. Keep earlier cards in the ledger
	// so extending the budget restores pending authorization and baseline choices.
	const budgetCard = state.openCards.find(
		(card) => card.boundary === 'budget' && /^budget(?::\d+)?$/.test(card.id)
	);
	if (budgetCard) state.openCards = [budgetCard];
	return state;
}
