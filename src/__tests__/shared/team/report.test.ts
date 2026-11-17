import { describe, expect, it } from 'vitest';
import {
	extractTeamReport,
	reportRepairPrompt,
	validateTeamReport,
	teamReplyMessage,
} from '../../../shared/team/report';
import { reduceLedger } from '../../../shared/team/ledger';
import { REPORT_PERMISSIONS, type TeamReport } from '../../../shared/team/types';
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
		'qa/./test.ts',
		'/qa/test.ts',
		'qa\\test.ts',
		'qa/',
	])('rejects QA write path %s', (path) => {
		expect(validateTeamReport({ ...goodReports.qa_prep, tests: [path] }, 'qa_prep', 'qa').ok).toBe(
			false
		);
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
