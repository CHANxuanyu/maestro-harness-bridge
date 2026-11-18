/**
 * Progress and escalation rules shared by a single conversation's fix loop,
 * a team problem and the PM review loop (PRD 3.1.3 to 3.1.5).
 *
 * The rules read only what the app can observe about an attempt:
 *  - `fingerprint`: the concrete change or experiment, so a repeat is found by
 *    content rather than by how the attempt was described;
 *  - `failures`: what still fails afterwards, as measured by the app;
 *  - `evidence`: ids of evidence the attempt produced (a reproduction, a
 *    located cause, a conclusive experiment).
 *
 * An attempt's category ("locate", "small experiment", "change approach") and
 * wording are kept for people to read. Nothing here decides anything from them:
 * a category may be used any number of times, and "every category was used
 * once" is never a reason to stop. The only reasons to involve the owner are
 * the boundaries in {@link Boundary}.
 */

/** How one attempt is judged. */
export type AttemptVerdict =
	/** First attempt and nothing improved yet. Counts towards the no-progress streak. */
	| 'first'
	/** Nothing fails any more. */
	| 'solved'
	/** Fewer failures than before. */
	| 'fewer'
	/** The failure changed and no earlier failure came back. */
	| 'changed'
	/** Failures unchanged, but the attempt produced evidence not seen before. */
	| 'evidence'
	/** Same result, nothing new learned. */
	| 'none'
	/** A failure seen earlier came back. */
	| 'regress'
	/** The same concrete change as an earlier attempt, nothing learned since, same result. */
	| 'dup'
	/** A diagnosis (or team retro) marker. Resets the streaks; not an attempt. */
	| 'diagnosis';

/** Verdicts that count as progress (PRD 3.1.3). */
export const PROGRESS_VERDICTS: readonly AttemptVerdict[] = [
	'solved',
	'fewer',
	'changed',
	'evidence',
];

/** Problem status the app keeps per problem (PRD 3.1.4 item 4). */
export type ProblemStatus = 'unlocated' | 'located' | 'partial' | 'solved';

/** Consecutive attempts without progress that force a diagnosis (PRD 3.1.2). */
export const NO_PROGRESS_LIMIT = 3;
/** Consecutive PM rejections that force a team retro (PRD 6.7). */
export const REJECTION_RETRO_LIMIT = 2;

/**
 * The only reasons work stops to ask the owner (PRD 3.1.5). `baseline` and
 * `acceptance` are the team's fixed owner checkpoints, not escalations.
 */
export type Boundary =
	| 'budget'
	| 'commitment'
	| 'permission'
	| 'model'
	| 'login'
	| 'baseline'
	| 'acceptance';

export const BOUNDARIES: readonly Boundary[] = [
	'budget',
	'commitment',
	'permission',
	'model',
	'login',
	'baseline',
	'acceptance',
];

export interface AttemptInput {
	id: string;
	/** Free-form category for people, for example "locate". Never used by the rules. */
	category?: string;
	/** What was done, in the attempt's own words. */
	plan?: string;
	/** The evidence or hypothesis the attempt is based on. */
	basis?: string;
	/** How it differs from earlier attempts. */
	difference?: string;
	/** What should be observed if it works. */
	expectation?: string;
	/** Identifies the concrete change or experiment. Equal fingerprints mean the same change. */
	fingerprint: string;
	/** What still fails after the attempt, as measured by the app. */
	failures: readonly string[];
	/** Evidence ids produced by the attempt. */
	evidence?: readonly string[];
	/** Problem status after the attempt, when it changed. */
	status?: ProblemStatus;
	/** PM review loop: this attempt was a review that sent the work back. */
	rejected?: boolean;
	/** A diagnosis or team retro marker instead of an attempt. */
	diagnosis?: boolean;
}

export interface JudgedAttempt extends AttemptInput {
	verdict: AttemptVerdict;
	/** For a repeat, the id of the earlier attempt it repeats. */
	repeatOf?: string;
	/** How many distinct evidence ids were known after this attempt. */
	knownAfter: number;
	/** Consecutive attempts without progress, including this one. */
	streak: number;
}

export interface ProgressState {
	attempts: JudgedAttempt[];
	/** What still fails after the last attempt. */
	failures: string[];
	/** Consecutive attempts without progress at the end of the list. */
	streak: number;
	/** Consecutive rejections at the end of the list, since the last diagnosis. */
	rejectionsInRow: number;
	/** Distinct evidence ids known after the last attempt. */
	knownEvidence: number;
	status: ProblemStatus;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((x) => b.includes(x));

/** Judge a problem's attempts in order (PRD 3.1.3, 3.1.4). */
export function judgeAttempts(
	initialFailures: readonly string[],
	attempts: readonly AttemptInput[]
): ProgressState {
	let prev = [...initialFailures];
	const seen = new Set<string>(initialFailures);
	const known = new Set<string>();
	let streak = 0;
	let rejections = 0;
	let status: ProblemStatus = initialFailures.length ? 'unlocated' : 'solved';
	const out: JudgedAttempt[] = [];
	for (const a of attempts) {
		if (a.diagnosis) {
			streak = 0;
			rejections = 0;
			out.push({ ...a, verdict: 'diagnosis', knownAfter: known.size, streak });
			continue;
		}
		const failures = [...a.failures];
		const fresh = (a.evidence ?? []).filter((e) => !known.has(e));
		// The same concrete change, nothing learned since, the same result: a repeat,
		// whatever it is called this time.
		const twin = out.find(
			(o) =>
				o.verdict !== 'diagnosis' &&
				o.fingerprint === a.fingerprint &&
				o.knownAfter === known.size &&
				sameSet(o.failures, failures)
		);
		let verdict: AttemptVerdict;
		if (twin && fresh.length === 0) verdict = 'dup';
		else if (failures.length === 0) verdict = 'solved';
		else if (failures.some((f) => seen.has(f) && !prev.includes(f))) verdict = 'regress';
		else if (failures.length < prev.length) verdict = 'fewer';
		else if (!sameSet(failures, prev)) verdict = 'changed';
		else if (fresh.length > 0) verdict = 'evidence';
		else verdict = out.some((o) => o.verdict !== 'diagnosis') ? 'none' : 'first';
		fresh.forEach((e) => known.add(e));
		failures.forEach((f) => seen.add(f));
		streak = PROGRESS_VERDICTS.includes(verdict) ? 0 : streak + 1;
		rejections = a.rejected ? rejections + 1 : 0;
		if (a.status) status = a.status;
		else if (verdict === 'solved') status = 'solved';
		out.push({ ...a, failures, verdict, repeatOf: twin?.id, knownAfter: known.size, streak });
		prev = failures;
	}
	return {
		attempts: out,
		failures: prev,
		streak,
		rejectionsInRow: rejections,
		knownEvidence: known.size,
		status,
	};
}

/** A next step someone could take, with the basis they would give. */
export interface Candidate {
	key?: string;
	plan: string;
	/** Identifies the concrete change, so a step already tried with nothing learned since is never dispatched again. */
	fingerprint?: string;
	basis?: string;
	/** Set when taking this step needs the owner. */
	boundary?: Boundary;
	/**
	 * Advice only, such as "a stronger model might do better". Shown to people,
	 * never a reason to stop on its own.
	 */
	advice?: boolean;
	/** What it costs and who does what if chosen, for an escalation card. */
	cost?: string;
	recommended?: boolean;
}

export interface Budget {
	used: number;
	total: number;
}

export type NextDecision =
	| { kind: 'done' }
	| { kind: 'report'; boundaries: ['budget'] }
	| { kind: 'diagnose'; reason: 'no-progress' | 'rejections'; advice: Candidate[] }
	| { kind: 'continue'; next: Candidate; advice: Candidate[] }
	| { kind: 'escalate'; boundaries: Boundary[]; options: Candidate[]; advice: Candidate[] }
	| { kind: 'gather'; advice: Candidate[] };

export interface DecideContext {
	candidates?: readonly Candidate[];
	budget?: Budget;
}

/** True when the step is the same change as an earlier attempt and nothing was learned since. */
export function isAlreadyTried(state: ProgressState, candidate: Candidate): boolean {
	if (!candidate.fingerprint) return false;
	return state.attempts.some(
		(o) =>
			o.verdict !== 'diagnosis' &&
			o.fingerprint === candidate.fingerprint &&
			o.knownAfter === state.knownEvidence
	);
}

/**
 * What happens next (PRD 3.1.4, 3.1.5). Order matters: done, then the overall
 * budget, then forced diagnosis, then any in-authority step with a basis, and
 * only then a boundary. With nothing left that has a basis, gather evidence.
 * A solved problem is done even when the budget is spent: the budget stops
 * further dispatch, it does not turn met criteria into an unfinished report.
 */
export function decideNext(state: ProgressState, ctx: DecideContext = {}): NextDecision {
	const candidates = ctx.candidates ?? [];
	const advice = candidates.filter((c) => c.advice);
	if (state.failures.length === 0) return { kind: 'done' };
	if (ctx.budget && ctx.budget.used >= ctx.budget.total)
		return { kind: 'report', boundaries: ['budget'] };
	if (state.streak >= NO_PROGRESS_LIMIT) return { kind: 'diagnose', reason: 'no-progress', advice };
	if (state.rejectionsInRow >= REJECTION_RETRO_LIMIT)
		return { kind: 'diagnose', reason: 'rejections', advice };
	const open = candidates.filter(
		(c) => !c.advice && !c.boundary && !!c.basis && !isAlreadyTried(state, c)
	);
	if (open.length > 0) return { kind: 'continue', next: open[0], advice };
	const blocked = candidates.filter((c) => c.boundary && !c.advice);
	if (blocked.length > 0) {
		const boundaries = [...new Set(blocked.map((c) => c.boundary as Boundary))];
		return { kind: 'escalate', boundaries, options: blocked, advice };
	}
	return { kind: 'gather', advice };
}

/** Convenience: judge and decide in one call. */
export function progressDecision(
	initialFailures: readonly string[],
	attempts: readonly AttemptInput[],
	ctx: DecideContext = {}
): { state: ProgressState; decision: NextDecision } {
	const state = judgeAttempts(initialFailures, attempts);
	return { state, decision: decideNext(state, ctx) };
}
