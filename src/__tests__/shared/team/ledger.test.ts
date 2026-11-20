import { describe, expect, it } from 'vitest';
import { reduceLedger } from '../../../shared/team/ledger';
import { type LedgerEvent, type TeamTerminal } from '../../../shared/team/types';
import {
	baseline,
	brief,
	check,
	config,
	goodReports,
	issue,
	ledger,
	proven,
	type EventInput,
} from './fixtures';

const statusOf = (entries: EventInput[], id = 'A1') =>
	reduceLedger(ledger(...entries)).criteria.find((c) => c.id === id)?.status;

describe('reduceLedger', () => {
	it('counts owner messages and wake dispatches once and retains substitute history', () => {
		const events = ledger(
			{ kind: 'team_created', config },
			{
				kind: 'owner_message',
				actor: 'owner',
				messageId: 'note',
				text: 'Keep the scope',
				to: 'pm',
			},
			{ kind: 'message_delivered', messageId: 'note', seat: 'pm' },
			{
				kind: 'owner_message',
				actor: 'owner',
				messageId: 'note',
				text: 'Keep the scope',
				to: 'pm',
			},
			{
				kind: 'turn_dispatched',
				seat: 'pm',
				dispatchId: 'wake',
				turn: 'topic',
				mode: 'wake',
				promptDigest: 'wake',
			},
			{
				kind: 'turn_dispatched',
				seat: 'pm',
				dispatchId: 'wake',
				turn: 'topic',
				mode: 'wake',
				promptDigest: 'wake',
			},
			{
				kind: 'substitute_took_over',
				seat: 'dev',
				model: { tool: 'claude-code', model: 'sonnet' },
			},
			{
				kind: 'seat_bound',
				seat: 'dev',
				model: config.seats.dev,
				workspace: '/project/dev',
				reason: 'restored',
			}
		);
		expect(reduceLedger([...events, ...events]).statistics).toMatchObject({
			ownerMessages: 1,
			wakes: 1,
			substitutions: 1,
			turns: 1,
		});
	});
	it('replays the complete direct path through owner acceptance', () => {
		const entries: EventInput[] = [{ kind: 'team_created', config }];
		for (const seat of ['pm', 'dev', 'qa'] as const)
			entries.push({
				kind: 'seat_bound',
				seat,
				workspace: `/project/${seat}`,
				nativeSessionId: `${seat}-session`,
				model: config.seats[seat],
			});
		const turn = (seat: 'pm' | 'dev' | 'qa', kind: keyof typeof goodReports) => {
			const dispatchId = `${seat}-${kind}`;
			entries.push(
				{ kind: 'turn_dispatched', seat, turn: kind, dispatchId, promptDigest: dispatchId },
				{
					kind: 'turn_finished',
					seat,
					dispatchId,
					exitCode: 0,
					durationMs: 100,
					inputTokens: 10,
					outputTokens: 5,
					costUsd: 0.01,
				},
				{ kind: 'report_accepted', seat, dispatchId, report: goodReports[kind] }
			);
		};
		turn('pm', 'brief');
		entries.push(
			{ kind: 'brief_published', actor: 'pm', brief },
			{ kind: 'phase_changed', to: 'challenge' }
		);
		turn('dev', 'challenge');
		turn('qa', 'challenge');
		entries.push(
			{ kind: 'challenge_submitted', seat: 'dev', objections: [] },
			{
				kind: 'challenge_submitted',
				seat: 'qa',
				objections: [],
				plans: [{ criterion: 'A1', how: 'Test', data: 'hours' }],
			}
		);
		turn('pm', 'respond');
		entries.push(
			{ kind: 'brief_response', decisions: [] },
			check,
			{ kind: 'baseline_proposed', briefVersion: 1 },
			{
				kind: 'decision_card',
				card: {
					id: 'baseline',
					boundary: 'baseline',
					title: 'Confirm scope',
					body: 'Checks ran',
					options: [{ id: 'confirm', label: 'Confirm this baseline' }],
				},
			},
			{ kind: 'card_answered', actor: 'owner', cardId: 'baseline', optionId: 'confirm' },
			{ kind: 'baseline_confirmed', actor: 'owner', cardId: 'baseline', briefVersion: 1 },
			{ kind: 'phase_changed', to: 'implement' },
			{ kind: 'work_item', itemId: 'w1', title: 'Parser', owner: 'dev', state: 'claimed' }
		);
		turn('dev', 'work');
		turn('qa', 'qa_prep');
		entries.push(
			check,
			{ kind: 'work_item', itemId: 'w1', title: 'Parser', owner: 'dev', state: 'done' },
			{ kind: 'phase_changed', to: 'verify' }
		);
		turn('qa', 'verify');
		entries.push(
			{ kind: 'phase_changed', to: 'review' },
			{ kind: 'work_item', itemId: 'w1', title: 'Parser', owner: 'dev', state: 'checked' },
			{
				kind: 'output_captured',
				outputId: 'preview',
				files: ['result.html'],
				previews: ['preview.png'],
			},
			{
				kind: 'criterion_evidence',
				actor: 'pm',
				criterionId: 'E1',
				source: 'pm',
				pass: true,
				evidence: 'preview',
			}
		);
		turn('pm', 'review');
		entries.push(
			{ kind: 'review', actor: 'pm', verdict: 'pass', problems: [], suggestions: [] },
			{ kind: 'phase_changed', to: 'demo' }
		);
		turn('pm', 'demo');
		entries.push(
			{ kind: 'demo' },
			{ kind: 'phase_changed', to: 'accept' },
			{ kind: 'accepted', actor: 'owner' }
		);
		const events = ledger(...entries);
		const before = structuredClone(events);
		const state = reduceLedger(events.reverse());
		expect(state).toMatchObject({
			phase: 'accept',
			terminal: 'all',
			stopped: false,
			baseline: { confirmedVersion: 1 },
			statistics: {
				ownerDecisions: 2,
				discussions: 0,
				rejections: 0,
				retros: 0,
				recoveries: 0,
				turns: 9,
			},
			usage: { turns: 9, inputTokens: 90, outputTokens: 45, durationMs: 900, turnsWithCost: 9 },
		});
		expect(state.usage.costUsd).toBeCloseTo(0.09);
		expect(state.criteria.map((c) => c.status)).toEqual(['pass', 'pass', 'pass']);
		expect(state.workItems[0].state).toBe('checked');
		expect(state.openCards).toEqual([]);
		expect(events.reverse()).toEqual(before);
	});

	it('ignores unknown kinds, dangling events, and duplicate records deterministically', () => {
		const events = ledger(
			...baseline,
			{ kind: 'issue_fixed', actor: 'dev', issueId: 'missing' },
			{ kind: 'issue_verified', actor: 'qa', issueId: 'missing', pass: true, evidence: 'x' }
		);
		const expected = reduceLedger(events);
		events.push(
			{ id: 'future', seq: 50, kind: 'future_kind' } as unknown as LedgerEvent,
			events[0]
		);
		expect(reduceLedger(events.reverse())).toEqual(expected);
		expect(reduceLedger([])).toMatchObject({
			config: null,
			phase: 'clarify',
			terminal: null,
			criteria: [],
			usage: { turns: 0 },
		});
	});

	it('does not infer evidence from developer claims, a PM review, or owner acceptance', () => {
		const entries: EventInput[] = [
			...baseline,
			{ kind: 'report_accepted', seat: 'dev', dispatchId: 'work', report: goodReports.work },
			{ kind: 'report_accepted', seat: 'dev', dispatchId: 'illegal', report: goodReports.verify },
			{
				kind: 'criterion_evidence',
				actor: 'dev',
				source: 'qa',
				criterionId: 'A2',
				pass: true,
				evidence: 'my claim',
			},
			{ ...check, actor: 'dev' } as EventInput,
			{ kind: 'review', actor: 'pm', verdict: 'pass', problems: [], suggestions: [] },
			{ kind: 'accepted', actor: 'owner' },
			{ kind: 'terminal', terminal: 'all', residual: [] },
		];
		const state = reduceLedger(ledger(...entries));
		expect(state.criteria.map((c) => c.status)).toEqual(['unproven', 'unproven', 'unproven']);
		expect(state.terminal).toBeNull();
	});

	it('keeps failed checks until their own rerun passes, even if QA says pass', () => {
		const entries: EventInput[] = [
			...baseline,
			{ ...check, exitCode: 1 } as EventInput,
			{
				kind: 'criterion_evidence',
				actor: 'qa',
				source: 'qa',
				criterionId: 'A1',
				pass: true,
				evidence: 'manual sample',
			},
		];
		expect(statusOf(entries)).toBe('fail');
		expect(statusOf([...entries, { ...check, command: 'different test' } as EventInput])).toBe(
			'fail'
		);
		expect(statusOf([...entries, check])).toBe('pass');
		expect(
			statusOf([
				...baseline,
				{ ...check, exitCode: null, notRun: 'Waiting for check permission' } as EventInput,
			])
		).toBe('pending');
		expect(statusOf([...baseline, { ...check, exitCode: 0, timedOut: true } as EventInput])).toBe(
			'fail'
		);
		expect(statusOf([...baseline, { ...check, covers: ['A2'] } as EventInput], 'A2')).toBe(
			'pending'
		);
	});

	it('requires captured output for PM experience evidence and ignores blank evidence', () => {
		expect(statusOf([...baseline, { ...check, evidenceId: '' } as EventInput])).toBe('pending');
		expect(
			statusOf(
				[
					...baseline,
					{
						kind: 'criterion_evidence',
						actor: 'pm',
						source: 'pm',
						criterionId: 'E1',
						pass: true,
						evidence: 'looks fine',
					},
				],
				'E1'
			)
		).toBe('unproven');
		expect(
			statusOf(
				[
					...baseline,
					{
						kind: 'criterion_evidence',
						actor: 'qa',
						source: 'qa',
						criterionId: 'A2',
						pass: true,
						evidence: '  ',
					},
				],
				'A2'
			)
		).toBe('unproven');
		expect(statusOf(proven, 'E1')).toBe('pass');
	});

	it('keeps baseline command canaries separate from delivery evidence', () => {
		const state = reduceLedger(ledger(...baseline, { ...check, purpose: 'trial' } as EventInput));
		expect(state.checks).toHaveLength(1);
		expect(state.criteria[0].status).toBe('unproven');
	});

	it('preserves the issue chain and permits only evidenced QA closure after a fix claim', () => {
		const opened = [...baseline, issue];
		const premature: EventInput = {
			kind: 'issue_verified',
			actor: 'qa',
			issueId: 'i1',
			pass: true,
			evidence: 'test',
		};
		expect(reduceLedger(ledger(...opened, premature)).issues[0].state).toBe('opened');
		const fixed: EventInput = {
			kind: 'issue_fixed',
			actor: 'dev',
			issueId: 'i1',
			summary: 'Fixed parser',
		};
		expect(
			reduceLedger(ledger(...opened, fixed, { ...premature, actor: 'dev' })).issues[0].state
		).toBe('fixed-claimed');
		const entries: EventInput[] = [
			...opened,
			fixed,
			{ ...premature, pass: false },
			fixed,
			{ kind: 'report_accepted', seat: 'qa', dispatchId: 'reverify', report: goodReports.reverify },
		];
		const state = reduceLedger(ledger(...entries));
		expect(state.issues[0].state).toBe('verified-pass');
		expect(state.issues[0].history.at(-1)).not.toHaveProperty('report');
		expect(state.issues[0].history.map((e) => e.kind)).toEqual([
			'issue_opened',
			'issue_fixed',
			'issue_verified',
			'issue_fixed',
			'issue_verified',
		]);
		expect(state.criteria.find((c) => c.id === 'A2')?.status).toBe('pending');
	});

	it('does not use a narrow issue retest to erase a failed verdict on the whole criterion', () => {
		const entries: EventInput[] = [
			...baseline,
			{
				kind: 'criterion_evidence',
				actor: 'qa',
				criterionId: 'A2',
				source: 'qa',
				pass: false,
				evidence: 'Invalid samples accepted',
			},
			issue,
			{ kind: 'issue_fixed', actor: 'dev', issueId: 'i1' },
			{
				kind: 'issue_verified',
				actor: 'qa',
				issueId: 'i1',
				pass: true,
				evidence: '1z now rejected',
			},
		];
		expect(statusOf(entries, 'A2')).toBe('fail');
		expect(
			statusOf(
				[
					...entries,
					{
						kind: 'criterion_evidence',
						actor: 'qa',
						criterionId: 'A2',
						source: 'qa',
						pass: true,
						evidence: 'All invalid samples rejected',
					},
				],
				'A2'
			)
		).toBe('pass');
	});

	it('marks a decision recorded before the confirmed baseline as superseded by it (real run 5)', () => {
		const closed = (discussionId: string, decision: string): EventInput => ({
			kind: 'discussion_closed',
			discussionId,
			decision,
			decider: 'pm',
			contested: false,
			dissent: '',
			actions: [],
		});
		const state = reduceLedger(
			ledger(
				...baseline.slice(0, 2),
				closed('before', 'Accept e/E exponents'),
				{ kind: 'baseline_confirmed', actor: 'owner', briefVersion: 1 },
				closed('after', 'Keep exponents rejected')
			)
		);
		expect(state.decisions.map((d) => [d.discussionId, d.supersededByBaseline])).toEqual([
			['before', 1],
			['after', undefined],
		]);
	});

	it('passes a check that exits with the code the brief expects, and fails any other', () => {
		const negative = { ...check, command: 'node cli.cjs add 1e3 2', expectedExitCode: 2 };
		expect(statusOf([...baseline, { ...negative, exitCode: 2 }])).toBe('pass');
		expect(statusOf([...baseline, { ...negative, exitCode: 0 }])).toBe('fail');
		expect(statusOf([...baseline, { ...check, exitCode: 2 }])).toBe('fail');
	});

	it('applies owner edits before confirmation and records approved standard changes afterwards', () => {
		const state = reduceLedger(
			ledger(
				...baseline.slice(0, 2),
				{
					kind: 'baseline_edited',
					actor: 'owner',
					criterionId: 'A1',
					before: 'Parses hours',
					after: 'Parses whole hours',
				},
				{ kind: 'baseline_confirmed', actor: 'owner', briefVersion: 1 },
				{
					kind: 'standard_change',
					actor: 'pm',
					criterionId: 'A3',
					change: 'add',
					reason: 'Clarify a boundary',
					approvedBy: 'pm',
					criterion: { id: 'A3', text: 'Reject negative hours', proof: 'qa', how: 'Try -1h' },
				},
				{
					kind: 'standard_change',
					actor: 'owner',
					criterionId: 'E1',
					change: 'remove',
					reason: 'Owner changed scope',
					approvedBy: 'owner',
				}
			)
		);
		expect(state.criteria.map((c) => c.id)).toEqual(['A1', 'A2', 'A3']);
		expect(state.criteria[0]).toMatchObject({
			text: 'Parses whole hours',
			byOwner: true,
			confirmed: true,
		});
		expect(state.criteria[2]).toMatchObject({ proof: 'qa', status: 'unproven' });
		expect(state.standardChanges).toHaveLength(2);
	});

	it.each([undefined, 'model-unavailable', 'login-expired'] as const)(
		'charges %s once despite duplicate finishes and keeps zero cost distinct from unknown',
		(failureKind) => {
			const finish: EventInput = {
				kind: 'turn_finished',
				dispatchId: 't',
				seat: 'dev',
				exitCode: 0,
				durationMs: 10,
				inputTokens: 20,
				outputTokens: 5,
				costUsd: 0,
				failureKind,
			};
			const state = reduceLedger(
				ledger(
					...baseline,
					{
						kind: 'turn_dispatched',
						dispatchId: 't',
						seat: 'dev',
						turn: 'work',
						promptDigest: 'x',
					},
					finish,
					finish,
					{ kind: 'report_rejected', dispatchId: 't', seat: 'dev', reason: 'Missing done' },
					{ kind: 'report_repaired', dispatchId: 't', seat: 'dev' },
					{ kind: 'report_accepted', dispatchId: 't', seat: 'dev', report: goodReports.work }
				)
			);
			expect(state.usage).toEqual({
				turns: 1,
				budgetTurns: 1,
				inputTokens: 20,
				outputTokens: 5,
				costUsd: 0,
				durationMs: 10,
				turnsWithTokens: 1,
				turnsWithCost: 1,
			});
			expect(state.turns[0].repaired).toBe(true);
			expect(state.turns[0].reportError).toBeUndefined();
		}
	);

	it('tracks baseline edits and returns without allowing drafts or unauthorized relaxation to replace it', () => {
		const entries: EventInput[] = [
			...proven,
			{ kind: 'brief_published', actor: 'pm', brief: { ...brief, version: 2, criteria: [] } },
			{ kind: 'baseline_returned', actor: 'owner', note: 'Keep the original scope' },
			{
				kind: 'standard_change',
				actor: 'pm',
				criterionId: 'A1',
				change: 'remove',
				reason: 'Too hard',
				approvedBy: 'pm',
			},
		];
		const state = reduceLedger(ledger(...entries));
		expect(state.baseline.confirmedVersion).toBe(1);
		expect(state.criteria).toHaveLength(3);
		expect(state.baseline.returns[0].note).toBe('Keep the original scope');
		const edited = reduceLedger(
			ledger(...entries, {
				kind: 'baseline_edited',
				actor: 'owner',
				criterionId: 'A1',
				before: 'Parses hours',
				after: 'Parses hours and minutes',
			})
		);
		expect(edited.criteria[0]).toMatchObject({
			text: 'Parses hours and minutes',
			status: 'unproven',
			byOwner: true,
		});
		expect(edited.baseline.edits).toHaveLength(1);
		expect(edited.criteria[0].evidence).toHaveLength(1);
		expect(brief.criteria[0].text).toBe('Parses hours');
	});

	it('keeps card and follow-up lifecycles closed after an out-of-order registration', () => {
		const state = reduceLedger(
			ledger(
				...baseline,
				{ kind: 'card_answered', actor: 'owner', cardId: 'c1', optionId: 'stop' },
				{
					kind: 'decision_card',
					card: {
						id: 'c1',
						boundary: 'budget',
						title: 'Budget',
						body: 'Exhausted',
						options: [{ id: 'stop', label: 'Stop and retain work' }],
					},
				},
				{
					kind: 'decision_card',
					card: {
						id: 'c2',
						boundary: 'login',
						title: 'Log in',
						body: 'Registry login expired',
						options: [],
					},
				},
				{ kind: 'follow_up_fired', followUpId: 'f1', result: 'Done' },
				{
					kind: 'follow_up_registered',
					followUpId: 'f1',
					seat: 'dev',
					reason: 'Build',
					waitFor: 'CI',
				},
				{
					kind: 'follow_up_registered',
					followUpId: 'f2',
					seat: 'qa',
					reason: 'Queue',
					waitFor: 'Test runner',
				}
			)
		);
		expect(state.openCards.map((c) => c.id)).toEqual(['c2']);
		expect(state.followUps.map((f) => f.followUpId)).toEqual(['f2']);
		expect(state.statistics.ownerDecisions).toBe(2);
	});

	it('retains discussion dissent and binding, fault, takeover, recovery, and turn measurements', () => {
		const state = reduceLedger(
			ledger(
				...baseline,
				{
					kind: 'discussion_opened',
					discussionId: 'd1',
					topic: 'Format',
					owner: 'pm',
					participants: ['pm', 'qa'],
					trigger: 'Risk',
				},
				{
					kind: 'position',
					discussionId: 'd1',
					seat: 'qa',
					claim: 'Use words',
					basis: 'Readability',
					wouldChangeMind: 'Readable abbreviations',
				},
				{ kind: 'proposal', discussionId: 'd1', proposal: 'Use tooltips', decider: 'pm' },
				{
					kind: 'response',
					discussionId: 'd1',
					seat: 'qa',
					result: 'reserve',
					reason: 'Extra interaction',
				},
				{
					kind: 'discussion_closed',
					discussionId: 'd1',
					decision: 'Use tooltips',
					decider: 'pm',
					contested: true,
					dissent: 'QA prefers words',
					actions: [{ seat: 'dev', action: 'Add tooltip' }],
				},
				{
					kind: 'member_fault',
					seat: 'pm',
					fault: 'model-unavailable',
					detail: 'Service unavailable',
				},
				{ kind: 'substitute_took_over', seat: 'pm', model: { tool: 'codex' }, temporary: true },
				{
					kind: 'seat_bound',
					seat: 'pm',
					workspace: '/project/pm',
					model: { tool: 'codex' },
					reason: 'temporary',
				},
				{
					kind: 'turn_finished',
					seat: 'pm',
					dispatchId: 't',
					exitCode: 0,
					durationMs: 500,
					inputTokens: 12,
					outputTokens: 3,
				},
				{ kind: 'turn_dispatched', seat: 'pm', dispatchId: 't', turn: 'review', promptDigest: 'x' },
				{ kind: 'member_recovered', seat: 'pm', how: 'Service resumed' }
			)
		);
		expect(state.decisions[0]).toMatchObject({ contested: true, dissent: 'QA prefers words' });
		expect(state.discussions[0].positions).toHaveLength(1);
		expect(state.seats.pm).toMatchObject({
			takeover: 'temporary',
			faultActive: false,
			lastFault: { fault: 'model-unavailable' },
			activeDispatchIds: [],
			usage: { turns: 1, inputTokens: 12, turnsWithCost: 0 },
		});
		expect(state.statistics.recoveries).toBe(1);
	});

	it('uses shared progress rules per problem and resets only the targeted diagnosis', () => {
		const entries: EventInput[] = [...baseline];
		for (const id of ['p1', 'p2'])
			for (let n = 0; n < 3; n++)
				entries.push({
					kind: 'attempt',
					problemId: id,
					initialFailures: ['E'],
					attempt: {
						id: `${id}-${n}`,
						fingerprint: n < 2 ? 'same' : 'other',
						failures: ['E'],
						category: 'locate',
					},
					candidates: [{ plan: 'New experiment', basis: 'E', fingerprint: 'new' }],
				});
		const before = reduceLedger(ledger(...entries));
		expect(before.problems.p1.progress.attempts.map((a) => a.verdict)).toEqual([
			'first',
			'dup',
			'none',
		]);
		expect(before.problems.p1.decision).toMatchObject({ kind: 'diagnose', reason: 'no-progress' });
		const after = reduceLedger(
			ledger(...entries, {
				kind: 'retro',
				problemId: 'p1',
				reason: 'no-progress',
				summary: 'Check new hypothesis',
				progressEvidence: 'Different failure',
			})
		);
		expect(after.problems.p1.decision.kind).toBe('continue');
		expect(after.problems.p2.decision.kind).toBe('diagnose');
		const exhausted = reduceLedger(
			ledger({ kind: 'team_created', config: { ...config, turnBudget: 0 } }, ...entries.slice(1))
		);
		expect(exhausted.problems.p1.decision.kind).toBe('report');
	});

	it('diagnoses consecutive PM rejections using the shared rule and restarts after a retro', () => {
		const rejection: EventInput = {
			kind: 'review',
			actor: 'pm',
			verdict: 'reject',
			problems: [
				{
					title: 'Unreadable',
					location: 'Result',
					criterion: 'E1',
					impact: 'Cannot read',
					expected: 'Readable text',
				},
			],
			suggestions: [],
		};
		const entries = [...baseline, rejection, rejection];
		expect(reduceLedger(ledger(...entries)).reviewDecision).toMatchObject({
			kind: 'diagnose',
			reason: 'rejections',
		});
		const state = reduceLedger(
			ledger(
				...entries,
				{
					kind: 'retro',
					reason: 'rejections',
					summary: 'Use real output',
					progressEvidence: 'QA confirms readability',
				},
				rejection
			)
		);
		expect(state.rejectionCount).toBe(3);
		expect(state.rejectionsInRow).toBe(1);
	});

	it('counts QA confirmation as review progress, never rewording or dropping PM comments', () => {
		const rejection: EventInput = {
			kind: 'review',
			actor: 'pm',
			verdict: 'reject',
			problems: [
				{
					title: 'Unreadable',
					location: 'Result',
					criterion: 'E1',
					impact: 'Cannot read',
					expected: 'Readable text',
				},
			],
			suggestions: [],
		};
		const reworded: EventInput = {
			...rejection,
			problems: [{ ...rejection.problems[0], title: 'Small text', location: 'Footer' }],
		};
		const state = reduceLedger(ledger(...baseline, rejection, reworded));
		expect(state.reviewProgress.attempts.map((a) => a.verdict)).toEqual(['first', 'dup']);
		const improved = reduceLedger(
			ledger(
				...baseline,
				rejection,
				{
					kind: 'criterion_evidence',
					actor: 'qa',
					criterionId: 'E1',
					source: 'qa',
					pass: true,
					evidence: 'qa/readability-retest',
				},
				reworded
			)
		);
		expect(improved.reviewProgress.attempts[1].verdict).toBe('evidence');
		expect(improved.reviewDecision).toMatchObject({ kind: 'diagnose', reason: 'rejections' });
	});

	it('counts separate review problems on one criterion and recognizes independently verified partial progress', () => {
		const problem = (location: string) => ({
			title: 'Unreadable',
			location,
			criterion: 'E1',
			impact: 'Cannot read',
			expected: 'Readable text',
		});
		const first: EventInput[] = [
			...baseline,
			...['Header', 'Footer'].map((location) => ({
				kind: 'issue_opened' as const,
				actor: 'pm' as const,
				issueId: location,
				reviewId: 'r1',
				title: 'Unreadable',
				issueKind: 'defect' as const,
				criterionId: 'E1',
				location,
				expected: 'Readable text',
			})),
			{
				kind: 'review',
				actor: 'pm',
				verdict: 'reject',
				problems: [problem('Header'), problem('Footer')],
				suggestions: [],
			},
		];
		const before = reduceLedger(ledger(...first));
		expect(before.reviewProgress.failures).toHaveLength(2);
		const dropped = reduceLedger(
			ledger(...first, {
				kind: 'review',
				actor: 'pm',
				verdict: 'reject',
				problems: [problem('Footer')],
				suggestions: [],
			})
		);
		expect(dropped.reviewProgress.failures).toHaveLength(2);
		expect(dropped.reviewProgress.attempts.at(-1)?.verdict).toBe('dup');
		const after = reduceLedger(
			ledger(
				...first,
				{ kind: 'issue_fixed', actor: 'dev', issueId: 'Header' },
				{
					kind: 'issue_verified',
					actor: 'qa',
					issueId: 'Header',
					pass: true,
					evidence: 'qa/header-readable',
				},
				{
					kind: 'review',
					actor: 'pm',
					verdict: 'reject',
					problems: [problem('Footer')],
					suggestions: [],
				}
			)
		);
		expect(after.reviewProgress.failures).toHaveLength(1);
		expect(after.reviewProgress.attempts.at(-1)?.verdict).toBe('fewer');
	});
	it.each<TeamTerminal>(['all', 'gaps', 'stopped'])(
		'derives statistics from the actual %s path without turning gaps into passes',
		(terminal) => {
			const entries: EventInput[] =
				terminal === 'all'
					? [...proven]
					: [
							...baseline,
							issue,
							{ kind: 'review', actor: 'pm', verdict: 'reject', problems: [], suggestions: [] },
							{
								kind: 'retro',
								reason: 'rejections',
								summary: 'Need samples',
								progressEvidence: 'Reproducible samples',
							},
							{ kind: 'member_recovered', seat: 'qa', how: 'Restored session' },
						];
			entries.push(
				terminal === 'all'
					? { kind: 'accepted', actor: 'owner' }
					: terminal === 'gaps'
						? { kind: 'accepted', actor: 'owner', withGaps: ['A2 needs follow-up'] }
						: { kind: 'stopped', actor: 'owner' }
			);
			entries.push({
				kind: 'terminal',
				terminal,
				residual: terminal === 'all' ? [] : ['A2 needs follow-up'],
			});
			const state = reduceLedger(ledger(...entries));
			expect(state.terminal).toBe(terminal);
			expect(state.statistics).toEqual({
				ownerDecisions: 2,
				ownerMessages: 0,
				wakes: 0,
				substitutions: 0,
				discussions: 0,
				rejections: terminal === 'all' ? 0 : 1,
				retros: terminal === 'all' ? 0 : 1,
				recoveries: terminal === 'all' ? 0 : 1,
				turns: 0,
			});
			expect(state.criteria.find((c) => c.id === 'A2')?.status).toBe(
				terminal === 'all' ? 'pass' : 'fail'
			);
		}
	);
});
