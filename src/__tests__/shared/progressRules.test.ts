/**
 * Tests for shared/progressRules - progress judgement and the escalation
 * condition shared by a conversation's fix loop, a team problem and PM review
 * (PRD 3.1.3 to 3.1.5). Each case builds the decision state and asserts the
 * decision, never the wording shown to people.
 */

import { describe, it, expect } from 'vitest';
import {
	decideNext,
	isAlreadyTried,
	judgeAttempts,
	type AttemptInput,
	type Candidate,
} from '../../shared/progressRules';

const at = (
	id: string,
	category: string,
	fingerprint: string,
	failures: string[],
	evidence: string[] = [],
	extra: Partial<AttemptInput> = {}
): AttemptInput => ({
	id,
	category,
	plan: `${category} ${fingerprint}`,
	basis: 'b',
	difference: 'd',
	expectation: 'e',
	fingerprint,
	failures,
	evidence,
	...extra,
});
const diag = (id: string): AttemptInput => ({ id, fingerprint: '', failures: [], diagnosis: true });
const verdicts = (attempts: AttemptInput[], start = ['E']) =>
	judgeAttempts(start, attempts)
		.attempts.filter((a) => a.verdict !== 'diagnosis')
		.map((a) => a.verdict);

describe('judgeAttempts', () => {
	it('counts a located cause and a changed failure as progress', () => {
		expect(
			verdicts([
				at('1', 'locate', 'l1', ['E'], ['cause']),
				at('2', 'change', 'c1', ['E2']),
				at('3', 'split', 's1', ['E2']),
			])
		).toEqual(['evidence', 'changed', 'none']);
	});

	it('treats the same category with different hypotheses as different attempts', () => {
		expect(
			verdicts([
				at('1', 'locate', 'l1', ['E'], ['e1']),
				at('2', 'locate', 'l2', ['E'], ['e2']),
				at('3', 'experiment', 'x1', ['E'], ['e3']),
				at('4', 'experiment', 'x2', ['E'], ['e4']),
			])
		).toEqual(['evidence', 'evidence', 'evidence', 'evidence']);
	});

	it('marks the same change with new wording and nothing learned as a repeat of the original', () => {
		const state = judgeAttempts(
			['E'],
			[
				at('1', 'fix', 'x', ['E']),
				at('2', 'change', 'x', ['E'], [], { plan: 'tidy imports a new way' }),
				at('3', 'fix', 'y', ['E']),
			]
		);
		expect(state.attempts.map((a) => a.verdict)).toEqual(['first', 'dup', 'none']);
		expect(state.attempts[1].repeatOf).toBe('1');
		expect(state.streak).toBe(3);
	});

	it('does not call a repeat what follows new evidence', () => {
		expect(
			verdicts([
				at('1', 'fix', 'x', ['E']),
				at('2', 'locate', 'q', ['E'], ['n']),
				at('3', 'fix', 'x', ['E']),
			])
		).toEqual(['first', 'evidence', 'none']);
	});

	it('treats a returning earlier failure and restated evidence as no progress', () => {
		expect(
			verdicts([at('1', 'change', 'c1', ['B']), at('2', 'change', 'c2', ['A'])], ['A'])
		).toEqual(['changed', 'regress']);
		expect(
			verdicts([at('1', 'locate', 'l1', ['E'], ['e1']), at('2', 'locate', 'l2', ['E'], ['e1'])])
		).toEqual(['evidence', 'none']);
	});

	it('counts fewer failures as progress even when not everything passes', () => {
		expect(verdicts([at('1', 'change', 'c1', ['C'])], ['A', 'B', 'C'])).toEqual(['fewer']);
	});

	it('updates the problem status as attempts report it', () => {
		const state = judgeAttempts(
			['E'],
			[
				at('1', 'locate', 'l1', ['E'], ['cause'], { status: 'located' }),
				at('2', 'change', 'c1', ['E2'], [], { status: 'partial' }),
			]
		);
		expect(state.status).toBe('partial');
		expect(judgeAttempts(['E'], [at('1', 'fix', 'f', [])]).status).toBe('solved');
	});

	it('resets the streaks at a diagnosis', () => {
		const state = judgeAttempts(
			['E'],
			[
				at('1', 'fix', 'x', ['E']),
				at('2', 'fix', 'y', ['E']),
				at('3', 'fix', 'z', ['E']),
				diag('D'),
			]
		);
		expect(state.streak).toBe(0);
	});
});

describe('decideNext', () => {
	const inAuthority: Candidate = {
		plan: 'locate where E2 comes from',
		fingerprint: 'l2',
		basis: 'E2 points at a dependency',
	};

	it('continues after progress even when every category was used once', () => {
		const state = judgeAttempts(
			['E'],
			[
				at('1', 'locate', 'l1', ['E'], ['cause']),
				at('2', 'change', 'c1', ['E2']),
				at('3', 'split', 's1', ['E2']),
			]
		);
		const d = decideNext(state, { candidates: [inAuthority], budget: { used: 30, total: 120 } });
		expect(d.kind).toBe('continue');
	});

	it('diagnoses after three attempts without progress, repeats included', () => {
		const state = judgeAttempts(
			['E'],
			[at('1', 'fix', 'x', ['E']), at('2', 'change', 'x', ['E']), at('3', 'fix', 'y', ['E'])]
		);
		expect(decideNext(state, { candidates: [inAuthority] })).toMatchObject({
			kind: 'diagnose',
			reason: 'no-progress',
		});
	});

	it('never dispatches again a change already tried with nothing learned since', () => {
		const state = judgeAttempts(
			['E'],
			[
				at('1', 'fix', 'x', ['E']),
				at('2', 'change', 'x', ['E']),
				at('3', 'fix', 'y', ['E']),
				diag('D'),
			]
		);
		const again: Candidate = {
			plan: 'redo attempt 1 in other words',
			fingerprint: 'x',
			basis: 'reworded',
		};
		expect(isAlreadyTried(state, again)).toBe(true);
		expect(decideNext(state, { candidates: [again] }).kind).toBe('gather');
		const d = decideNext(state, {
			candidates: [
				again,
				{ plan: 'check the definition', fingerprint: 'z', basis: 'the name may be gone' },
			],
		});
		expect(d.kind === 'continue' && d.next.fingerprint).toBe('z');
	});

	it('allows the same change again once new evidence arrived', () => {
		const state = judgeAttempts(
			['E'],
			[at('1', 'fix', 'x', ['E']), at('2', 'locate', 'q', ['E'], ['n'])]
		);
		expect(
			decideNext(state, {
				candidates: [
					{ plan: 'redo 1 with the new evidence', fingerprint: 'x', basis: 'attempt 2' },
				],
			}).kind
		).toBe('continue');
	});

	it('keeps "a stronger model might do better" as advice, never a reason to stop', () => {
		const state = judgeAttempts(['E'], [at('1', 'locate', 'l1', ['E'], ['e1'])]);
		const model: Candidate = { plan: 'ask a stronger model', boundary: 'model', advice: true };
		const d = decideNext(state, {
			candidates: [{ plan: 'small experiment', fingerprint: 'x1', basis: 'b' }, model],
		});
		expect(d.kind).toBe('continue');
		expect(d.kind === 'continue' && d.advice).toHaveLength(1);
		expect(decideNext(state, { candidates: [model] }).kind).toBe('gather');
	});

	it('escalates only when every remaining step crosses a boundary, naming exactly those boundaries', () => {
		const state = judgeAttempts(['E'], [at('1', 'locate', 'l1', ['E'], ['e1'])]);
		const d = decideNext(state, {
			candidates: [
				{
					key: 'login',
					plan: 'log in to the private registry',
					fingerprint: 'a',
					boundary: 'login',
					basis: 'b',
				},
				{
					key: 'skip',
					plan: 'turn on skipLibCheck',
					fingerprint: 'b',
					boundary: 'commitment',
					basis: 'b',
				},
				{ plan: 'ask a stronger model', boundary: 'model', advice: true },
			],
		});
		expect(d.kind).toBe('escalate');
		if (d.kind === 'escalate') {
			expect(d.boundaries).toEqual(['login', 'commitment']);
			expect(d.options.map((o) => o.key)).toEqual(['login', 'skip']);
		}
	});

	it('puts the overall budget before everything else', () => {
		const state = judgeAttempts(['E'], [at('1', 'locate', 'l1', ['E'], ['e1'])]);
		expect(
			decideNext(state, { candidates: [inAuthority], budget: { used: 120, total: 120 } })
		).toEqual({ kind: 'report', boundaries: ['budget'] });
	});

	it('runs a retro after two rejections in a row even with progress, then continues on progress', () => {
		const rv = (id: string, failures: string[], rejected: boolean) =>
			at(id, 'review', `v${id}`, failures, [], { rejected });
		const next: Candidate = { plan: 'revise', fingerprint: 'v9', basis: 'b' };
		const two = judgeAttempts(
			['p1', 'p2', 'p3'],
			[rv('1', ['p1', 'p2', 'p3'], true), rv('2', ['p4'], true)]
		);
		expect(decideNext(two, { candidates: [next] })).toMatchObject({
			kind: 'diagnose',
			reason: 'rejections',
		});
		const after = judgeAttempts(
			['p1', 'p2', 'p3'],
			[rv('1', ['p1', 'p2', 'p3'], true), rv('2', ['p4'], true), diag('R'), rv('3', ['p5'], true)]
		);
		expect(decideNext(after, { candidates: [next] }).kind).toBe('continue');
	});

	it('is done when nothing fails', () => {
		expect(decideNext(judgeAttempts(['E'], [at('1', 'fix', 'f', [])])).kind).toBe('done');
	});

	it('never reads the category', () => {
		const src = `${judgeAttempts.toString()}\n${decideNext.toString()}\n${isAlreadyTried.toString()}`;
		expect(src).not.toMatch(/\.category\b/);
	});
});

describe('M3 boundary precedence', () => {
	it('keeps a solved problem done when the budget is spent, and reports the budget otherwise', () => {
		expect(decideNext(judgeAttempts([], []), { budget: { used: 4, total: 4 } }).kind).toBe('done');
		expect(decideNext(judgeAttempts(['E'], []), { budget: { used: 4, total: 4 } })).toEqual({
			kind: 'report',
			boundaries: ['budget'],
		});
	});
	it('never dispatches advice as an in-authority step, even with a basis', () => {
		expect(
			decideNext(judgeAttempts(['E'], []), {
				candidates: [{ plan: 'A stronger model might help', basis: 'Opinion', advice: true }],
			}).kind
		).toBe('gather');
	});
});
