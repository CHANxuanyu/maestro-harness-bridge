import { describe, expect, it } from 'vitest';
import {
	extractTeamReport,
	reportRepairPrompt,
	validateTeamReport,
	teamReplyMessage,
} from '../../../shared/team/report';
import { reduceLedger } from '../../../shared/team/ledger';
import {
	REPORT_PERMISSIONS,
	type TeamReport,
	type SeatRole,
	type TurnKind,
} from '../../../shared/team/types';
import normalizationFixtures from './real-normalization-fixtures.json';
import { teamEvidence } from '../../../shared/team/policy';
import { reportEvents } from '../../../main/team/report-events';
import { baseline, goodReports, issue, ledger, proven } from './fixtures';

const state = reduceLedger(ledger(...proven));
const block = (report: unknown) => `\`\`\`team-report\n${JSON.stringify(report)}\n\`\`\``;

it('keeps bounded visible prose while hiding valid, malformed and tilde report fences', () => {
	expect(
		teamReplyMessage(`Before\n${block(goodReports.brief)}\nAfter\n~~~team-report\n{bad}\n~~~`)
	).toBe('Before\nAfter');
	expect(teamReplyMessage('  A long visible response  ', 6)).toBe('A long');
	expect(teamReplyMessage('Visible\n```team-report\n{unfinished')).toBe('Visible');
	expect(teamReplyMessage('> ```team-report\n> example\n> ```')).toContain('example');
});

describe('extractTeamReport', () => {
	it('accepts an expected exit code on a brief check, normalizing the expectedExit spelling', () => {
		for (const field of ['expectExit', 'expectedExit'] as const) {
			const brief = {
				...goodReports.brief,
				checks: [
					...goodReports.brief.checks,
					{ command: 'node cli.cjs add 1e3 2', covers: ['A1'], [field]: 2 },
				],
			};
			const result = validateTeamReport(brief, 'brief', 'pm');
			expect(result.ok).toBe(true);
			if (!result.ok || result.report.type !== 'brief') throw new Error('Expected a brief');
			expect(result.report.checks.at(-1)).toEqual({
				command: 'node cli.cjs add 1e3 2',
				covers: ['A1'],
				expectExit: 2,
			});
		}
		const fractional = {
			...goodReports.brief,
			checks: [{ command: 'node cli.cjs', covers: ['A1'], expectExit: 1.5 }],
		};
		expect(validateTeamReport(fractional, 'brief', 'pm').ok).toBe(false);
	});
	it('takes the last report and never falls back to an earlier valid one', () => {
		expect(
			extractTeamReport(`${block(goodReports.work)}\nDone\n${block(goodReports.demo)}`)
		).toEqual({ ok: true, report: goodReports.demo });
		expect(
			extractTeamReport(`${block(goodReports.work)}\n\`\`\`team-report\n{broken}\n\`\`\``)
		).toMatchObject({ ok: false, reason: expect.stringContaining('JSON') });
	});
	it.each([
		'no block',
		'```json\n{}\n```',
		'```team-report extra\n{}\n```',
		'```team-reporting\n{}\n```',
		'````markdown\n```team-report\n{}\n```\n````',
		'> ```team-report\n> {}\n> ```',
	])('refuses missing/explanatory blocks: %s', (text) => {
		expect(extractTeamReport(text)).toMatchObject({
			ok: false,
			reason: expect.stringContaining('Missing'),
		});
	});
	it.each(['~~~', '````'])('supports %s fences, whitespace in info, and CRLF', (fence) => {
		expect(extractTeamReport(`${fence} team-report \r\n{"type":"work"}\r\n${fence}`)).toEqual({
			ok: true,
			report: { type: 'work' },
		});
	});
	it('parses a scalar but leaves object validation to the validator', () => {
		expect(extractTeamReport(block(null))).toEqual({ ok: true, report: null });
	});
	it('refuses an unclosed final fence instead of using an earlier report', () => {
		expect(extractTeamReport(`${block(goodReports.work)}\n\`\`\`team-report\n{}`)).toMatchObject({
			ok: false,
			reason: expect.stringContaining('Unclosed'),
		});
	});
});

describe('validateTeamReport', () => {
	it.each(Object.keys(goodReports) as Array<keyof typeof goodReports>)(
		'accepts a good %s report for every permitted seat',
		(kind) => {
			for (const seat of REPORT_PERMISSIONS[kind]) {
				const context =
					kind === 'fix' || kind === 'reverify'
						? reduceLedger(
								ledger(...baseline, issue, { kind: 'issue_fixed', actor: 'dev', issueId: 'i1' })
							)
						: state;
				expect(validateTeamReport(goodReports[kind], kind, seat, context)).toEqual({
					ok: true,
					report: goodReports[kind],
				});
			}
		}
	);
	it.each([
		['verify', 'dev'],
		['reverify', 'dev'],
		['fix', 'qa'],
		['brief', 'qa'],
		['review', 'dev'],
		['work', 'pm'],
	] as const)('refuses %s from %s', (kind, seat) => {
		expect(validateTeamReport(goodReports[kind], kind, seat, state)).toMatchObject({
			ok: false,
			reason: expect.stringContaining('may not'),
		});
	});
	it.each([
		[null, 'brief', 'pm'],
		[{ ...goodReports.work, type: 'verify' }, 'work', 'dev'],
		[{ type: 'work', summary: 'Done', claimsComplete: true }, 'work', 'dev'],
		[{ ...goodReports.work, done: 'done' }, 'work', 'dev'],
		[{ ...goodReports.work, claimsComplete: 'true' }, 'work', 'dev'],
		[{ ...goodReports.work, criteria: [{ id: 'A1', pass: true }] }, 'work', 'dev'],
		[{ ...goodReports.demo, criteria: [{ id: 'A1', pass: true }] }, 'demo', 'pm'],
		[
			{ ...goodReports.verify, criteria: [{ id: 'A2', pass: true, evidence: '  ' }] },
			'verify',
			'qa',
		],
		[{ ...goodReports.verify, criteria: [{ id: 'A2', pass: true }] }, 'verify', 'qa'],
		[
			{ ...goodReports.reverify, results: [{ issue: 'i1', pass: true, evidence: '' }] },
			'reverify',
			'qa',
		],
		[{ ...goodReports.respond, brief: undefined }, 'respond', 'pm'],
	] as const)('refuses malformed or overclaiming report %#', (report, kind, seat) => {
		expect(validateTeamReport(report, kind, seat, state).ok).toBe(false);
	});
	it('rejects every missing required array', () => {
		for (const kind of Object.keys(goodReports) as Array<keyof typeof goodReports>) {
			for (const key of Object.keys(goodReports[kind])) {
				if (
					!Array.isArray((goodReports[kind] as unknown as Record<string, unknown>)[key]) ||
					(kind === 'challenge' && key === 'plans')
				)
					continue;
				const raw = { ...goodReports[kind] } as Record<string, unknown>;
				delete raw[key];
				expect(
					validateTeamReport(raw, kind, REPORT_PERMISSIONS[kind][0]).ok,
					`${kind}.${key}`
				).toBe(false);
			}
		}
	});
	it('requires QA plans and sample data, with per-criterion coverage or an unverifiable objection', () => {
		for (const plans of [
			undefined,
			[],
			[{ criterion: 'A1', how: 'Test' }],
			[{ criterion: 'A1', how: 'Test', data: 'Sample' }],
		]) {
			expect(
				validateTeamReport({ type: 'challenge', objections: [], plans }, 'challenge', 'qa', state)
					.ok
			).toBe(false);
		}
		expect(
			validateTeamReport(
				{
					type: 'challenge',
					objections: [],
					plans: [{ criterion: 'A1', how: 'Test', data: 'Sample' }],
				},
				'challenge',
				'qa'
			).ok
		).toBe(true);
		expect(
			validateTeamReport(
				{
					type: 'challenge',
					objections: [{ about: 'E1', kind: 'unverifiable', problem: 'No agreed preview' }],
					plans: [
						{ criterion: 'A1', how: 'Test', data: 'hours' },
						{ criterion: 'A2', how: 'Test', data: 'bad input' },
					],
				},
				'challenge',
				'qa',
				state
			).ok
		).toBe(true);
		expect(
			validateTeamReport({ type: 'challenge', objections: [] }, 'challenge', 'dev', state).ok
		).toBe(true);
	});
	it('demotes missing or unconfirmed review criteria to suggestions without mutating input', () => {
		const problem = {
			title: 'Add animation',
			location: 'Results',
			criterion: 'NEW',
			impact: 'More delightful',
			expected: 'Animated result',
		};
		const raw = {
			type: 'review',
			verdict: 'reject',
			problems: [problem, { ...problem, criterion: undefined }],
			suggestions: ['Consider themes'],
		};
		delete raw.problems[1].criterion;
		const result = validateTeamReport(raw, 'review', 'pm', state);
		expect(result).toMatchObject({
			ok: true,
			report: {
				verdict: 'pass',
				problems: [],
				suggestions: [
					'Consider themes',
					expect.stringContaining('Add animation'),
					expect.stringContaining('criterion: none'),
				],
			},
		});
		expect(raw.problems).toHaveLength(2);
		const mixed = validateTeamReport(
			{ ...raw, problems: [problem, { ...problem, criterion: 'E1' }] },
			'review',
			'pm',
			state
		);
		expect(mixed).toMatchObject({
			ok: true,
			report: { verdict: 'reject', problems: [{ ...problem, criterion: 'E1' }] },
		});
	});
	it('does not treat a draft criterion or absent state as confirmed', () => {
		const review = {
			type: 'review',
			verdict: 'reject',
			problems: [
				{
					title: 'Words',
					location: 'Result',
					criterion: 'E1',
					impact: 'Unreadable',
					expected: 'Words',
				},
			],
			suggestions: [],
		};
		for (const context of [
			undefined,
			reduceLedger(
				ledger(...baseline.slice(0, 2), {
					kind: 'output_captured',
					outputId: 'draft',
					files: ['result.html'],
					previews: ['result.png'],
				})
			),
		])
			expect(validateTeamReport(review, 'review', 'pm', context)).toMatchObject({
				ok: true,
				report: { verdict: 'pass', problems: [], suggestions: [expect.any(String)] },
			});
	});
	it.each([
		'src/test.ts',
		'../qa/test.ts',
		'qa/../src/test.ts',
		'/qa/test.ts',
		'qa\\test.ts',
		'qa/',
	])('rejects QA write path %s', (path) => {
		expect(validateTeamReport({ ...goodReports.qa_prep, tests: [path] }, 'qa_prep', 'qa').ok).toBe(
			false
		);
	});
	it.each(normalizationFixtures)(
		'normalizes the real $seat $turn report without changing its factual claims',
		(fixture) => {
			const context = reduceLedger(
				ledger(...baseline, {
					kind: 'discussion_opened',
					discussionId: 'location-discussion',
					topic: 'C3 location correction',
					owner: 'pm',
					participants: ['pm', 'dev', 'qa'],
					trigger: 'standard-change',
					layer: 'commitment',
				})
			);
			if (fixture.turn === 'proposal')
				context.discussions[0].positions = (['pm', 'dev', 'qa'] as const).map((seat, index) => ({
					kind: 'position',
					actor: seat,
					seat,
					id: `position-${index}`,
					seq: 10 + index,
					at: 1,
					discussionId: 'location-discussion',
					claim: 'Keep the proof',
					basis: 'Recorded results',
					wouldChangeMind: 'Changed proof',
				}));
			const before = JSON.stringify(fixture.report);
			const result = validateTeamReport(
				fixture.report,
				fixture.turn as TurnKind,
				fixture.seat as SeatRole,
				context,
				new Map([['clamp.boundary.test.cjs', 'qa/clamp.boundary.test.cjs']])
			);
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.reason);
			expect(result.normalizations?.length).toBeGreaterThan(0);
			if (result.report.type === 'qa_prep') {
				expect(result.report.tests).toEqual(['qa/clamp.boundary.test.cjs']);
				expect(result.normalizations).toContainEqual(
					expect.objectContaining({
						field: 'tests[0]',
						before: 'clamp.boundary.test.cjs',
						after: 'qa/clamp.boundary.test.cjs',
					})
				);
			}
			if (result.report.type === 'position') {
				expect(result.report).not.toHaveProperty('extraTurns');
				expect(result.report).not.toHaveProperty('preservesDeadline');
				expect(result.normalizations?.map((n) => n.field)).toEqual([
					'extraTurns',
					'preservesDeadline',
				]);
				expect(result.report.basis).toBe(fixture.report.basis);
				const projected = reportEvents(
					{
						kind: 'turn_dispatched',
						actor: 'app',
						id: 'd',
						seq: 20,
						at: 1,
						dispatchId: 'd',
						seat: fixture.seat as SeatRole,
						turn: 'position',
						promptDigest: '',
					},
					result.report,
					context
				);
				expect(projected.find((e) => e.kind === 'position')?.evidence ?? []).toEqual([]);
				expect(teamEvidence(context)).toEqual([]);
			}
			if (result.report.type === 'proposal') {
				expect(result.report.decider).toBe('owner');
				expect(result.normalizations).toEqual([
					{ field: 'decider', before: 'pm', after: 'owner', reason: expect.any(String) },
				]);
				const withoutHint = { ...fixture.report } as Record<string, unknown>;
				delete withoutHint.decider;
				expect(validateTeamReport(withoutHint, 'proposal', 'pm', context)).toMatchObject({
					ok: true,
					report: { decider: 'owner' },
					normalizations: [{ field: 'decider', after: 'owner' }],
				});
			}
			expect(JSON.stringify(fixture.report)).toBe(before);
		}
	);
	it.each(['./qa/test.ts', 'qa/./test.ts', '/workspace/qa/qa/test.ts'])(
		'normalizes safe QA path %s',
		(value) => {
			const context = reduceLedger(
				ledger(...baseline, {
					kind: 'seat_bound',
					seat: 'qa',
					workspace: '/workspace/qa',
					model: { tool: 'claude-code' },
				})
			);
			expect(
				validateTeamReport({ ...goodReports.qa_prep, tests: [value] }, 'qa_prep', 'qa', context)
			).toMatchObject({
				ok: true,
				report: { tests: ['qa/test.ts'] },
				normalizations: [{ field: 'tests[0]', before: value, after: 'qa/test.ts' }],
			});
		}
	);
	it('normalizes native Windows paths with the same qa boundary', () => {
		const context = reduceLedger(
			ledger(...baseline, {
				kind: 'seat_bound',
				seat: 'qa',
				workspace: 'C:\\Team\\qa',
				model: { tool: 'claude-code' },
			})
		);
		expect(
			validateTeamReport(
				{ ...goodReports.qa_prep, tests: ['C:\\Team\\qa\\qa\\test.ts', '.\\qa\\test.ts'] },
				'qa_prep',
				'qa',
				context
			)
		).toMatchObject({ ok: true, report: { tests: ['qa/test.ts', 'qa/test.ts'] } });
		expect(
			validateTeamReport(
				{ ...goodReports.qa_prep, tests: ['C:\\Team\\qa-other\\qa\\test.ts'] },
				'qa_prep',
				'qa',
				context
			).ok
		).toBe(false);
	});
	it('ignores another seat standard-resolution field without closing an issue', () => {
		const context = reduceLedger(ledger(...baseline, { ...issue, issueKind: 'standard' }));
		const result = validateTeamReport(
			{
				type: 'message',
				summary: 'No messages',
				messages: [],
				resolvedStandards: [{ issueId: 'i1', reason: 'I consider this fixed' }],
			},
			'message',
			'qa',
			context
		);
		expect(result).toMatchObject({
			ok: true,
			report: { messages: [] },
			normalizations: [{ field: 'resolvedStandards' }],
		});
		if (result.ok) expect(result.report).not.toHaveProperty('resolvedStandards');
		expect(context.issues[0].state).toBe('opened');
	});
	it('normalizes other workspace path fields without relocating external references', () => {
		const context = reduceLedger(
			ledger(...baseline, {
				kind: 'seat_bound',
				seat: 'dev',
				workspace: '/workspace/dev',
				model: { tool: 'codex' },
			})
		);
		const targets = [
			'./result.html',
			'/workspace/dev/result.html',
			'/workspace/qa/qa/test.ts',
			'https://example.test/result',
		];
		const brief = {
			...goodReports.brief,
			criteria: goodReports.brief.criteria.map((criterion) => ({
				...criterion,
				locations: targets.map((target) => ({ target, label: 'Result', kind: 'file' })),
			})),
		};
		const result = validateTeamReport(brief, 'brief', 'pm', context);
		expect(result.ok).toBe(true);
		if (!result.ok || result.report.type !== 'brief') throw new Error('Expected normalized brief');
		expect(result.report.criteria[0].locations?.map((l) => l.target)).toEqual([
			'result.html',
			'result.html',
			...targets.slice(2),
		]);
		expect(result.normalizations).toHaveLength(2 * brief.criteria.length);
		expect(brief.criteria[0].locations.map((l) => l.target)).toEqual(targets);
		expect(
			validateTeamReport(
				{
					...goodReports.work,
					waiting: {
						reason: 'CI is running',
						waitFor: 'CI completion',
						condition: { kind: 'ci', runId: '123', cwd: './' },
					},
				},
				'work',
				'dev',
				context
			)
		).toMatchObject({
			ok: true,
			report: { waiting: { condition: { cwd: '/workspace/dev' } } },
			normalizations: [{ field: 'waiting.condition.cwd', before: './', after: '/workspace/dev' }],
		});
	});
	it('fact guards still reject QA closure before a developer fix and dev self-verification', () => {
		const context = reduceLedger(
			ledger(
				...baseline,
				{ ...issue, actor: 'qa' },
				{ kind: 'issue_fixed', actor: 'qa', issueId: 'i1' }
			)
		);
		expect(validateTeamReport(goodReports.reverify, 'reverify', 'qa', context)).toMatchObject({
			ok: false,
			reason: expect.stringContaining('developer fix claim'),
		});
		expect(validateTeamReport(goodReports.reverify, 'reverify', 'dev', context)).toMatchObject({
			ok: false,
			reason: 'dev may not submit reverify.',
		});
		expect(validateTeamReport(goodReports.verify, 'verify', 'dev', context)).toMatchObject({
			ok: false,
			reason: 'dev may not submit verify.',
		});
	});
	it('requires attempt rationale from the second fix and refuses premature QA closure', () => {
		const opened = reduceLedger(ledger(...baseline, issue));
		const fixed = reduceLedger(
			ledger(...baseline, issue, { kind: 'issue_fixed', actor: 'dev', issueId: 'i1' })
		);
		expect(
			validateTeamReport({ type: 'fix', fixed: ['i1'], notFixed: [] }, 'fix', 'dev', opened).ok
		).toBe(true);
		expect(
			validateTeamReport({ type: 'fix', fixed: ['i1'], notFixed: [] }, 'fix', 'dev', fixed)
		).toMatchObject({ ok: false, reason: expect.stringContaining('second') });
		expect(validateTeamReport(goodReports.reverify, 'reverify', 'qa', opened).ok).toBe(false);
		expect(validateTeamReport(goodReports.reverify, 'reverify', 'qa', fixed).ok).toBe(true);
		const notFixed = reduceLedger(
			ledger(...baseline, issue, {
				kind: 'report_accepted',
				seat: 'dev',
				dispatchId: 'first-fix',
				report: { type: 'fix', fixed: [], notFixed: [{ id: 'i1', why: 'Need a new approach' }] },
			})
		);
		expect(
			validateTeamReport({ type: 'fix', fixed: ['i1'], notFixed: [] }, 'fix', 'dev', notFixed).ok
		).toBe(false);
	});
	it('requires known defect criteria, routes standard issues to PM, and gates demos on evidence', () => {
		const defect = { title: 'Bug', kind: 'defect', steps: ['Try it'] };
		expect(
			validateTeamReport({ ...goodReports.verify, issues: [defect] }, 'verify', 'qa', state).ok
		).toBe(false);
		expect(
			validateTeamReport(
				{ ...goodReports.verify, issues: [{ ...defect, kind: 'standard' }] },
				'verify',
				'qa',
				state
			).ok
		).toBe(true);
		expect(
			validateTeamReport(goodReports.demo, 'demo', 'pm', reduceLedger(ledger(...baseline))).ok
		).toBe(false);
		expect(validateTeamReport(goodReports.demo, 'demo', 'pm', state).ok).toBe(true);
	});
	it('requires the original schema for repair transport', () => {
		for (const kind of ['report_repair'] as const)
			expect(validateTeamReport({}, kind, 'pm')).toMatchObject({
				ok: false,
				reason: expect.stringContaining('No report schema'),
			});
	});
});

describe('reportRepairPrompt', () => {
	it('asks only for a bounded resubmission of the original report without redoing work', () => {
		const prompt = reportRepairPrompt(
			'verify',
			'criteria[0].evidence is required',
			'START'.repeat(1000) + 'observed result'
		);
		expect(prompt).toContain('criteria[0].evidence is required');
		expect(prompt).toContain('Do not redo work, change files, or call tools');
		expect(prompt).toContain('only one fenced team-report');
		expect(prompt).toContain('"const": "verify"');
		expect(prompt).toContain('observed result');
		expect(prompt).not.toContain('START'.repeat(1000));
	});
});

it('normalizes a proposal CI wait against its assigned seat workspace', () => {
	const context = reduceLedger(
		ledger(
			...baseline,
			{
				kind: 'seat_bound',
				seat: 'qa',
				workspace: '/workspace/qa',
				model: { tool: 'claude-code' },
			},
			{
				kind: 'discussion_opened',
				discussionId: 'ci',
				topic: 'External CI proof',
				owner: 'pm',
				participants: ['pm', 'qa'],
				trigger: 'member',
				layer: 'product',
			},
			...(['pm', 'qa'] as const).map((seat) => ({
				kind: 'position' as const,
				discussionId: 'ci',
				seat,
				claim: 'Wait for CI',
				basis: 'Running external job',
				wouldChangeMind: 'Completion',
			}))
		)
	);
	const result = validateTeamReport(
		{
			type: 'proposal',
			discussionId: 'ci',
			proposal: 'Keep tracking the external run',
			decider: 'pm',
			actions: [
				{ seat: 'pm', action: 'Document the decision' },
				{
					seat: 'qa',
					action: 'Read the external CI result',
					waitFor: 'CI run',
					condition: { kind: 'ci', runId: '123', cwd: './' },
				},
			],
		},
		'proposal',
		'pm',
		context
	);
	expect(result).toMatchObject({
		ok: true,
		normalizations: [{ field: 'actions[1].condition.cwd', before: './', after: '/workspace/qa' }],
	});
	if (!result.ok || result.report.type !== 'proposal') throw new Error('Expected a valid proposal');
	expect(result.report.actions[1].condition).toMatchObject({ cwd: '/workspace/qa' });
	expect(validateTeamReport(result.report, 'proposal', 'pm', context)).toMatchObject({ ok: true });
});
