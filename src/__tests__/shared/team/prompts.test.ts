import { describe, expect, it } from 'vitest';
import {
	buildTeamTurnPrompt,
	TEAM_TURN_PROMPTS,
	TEAM_WORKSPACE_RULES,
	teamReportSchema,
} from '../../../shared/team/prompts';
import { reduceLedger } from '../../../shared/team/ledger';
import { validateTeamReport, reportRepairPrompt } from '../../../shared/team/report';
import { teamEvidence } from '../../../shared/team/policy';
import { REPORT_PERMISSIONS, type M1TurnKind } from '../../../shared/team/types';
import { baseline, ledger, proven, goodReports } from './fixtures';

describe('team turn prompts', () => {
	it.each(Object.keys(TEAM_TURN_PROMPTS) as M1TurnKind[])(
		'includes the shared schema, workspace rule and actionable slice for %s',
		(kind) => {
			const state = reduceLedger(ledger(...proven));
			for (const seat of REPORT_PERMISSIONS[kind]) {
				const prompt = buildTeamTurnPrompt(kind, seat, state);
				expect(prompt).toContain(`You are the team's ${seat.toUpperCase()}`);
				expect(prompt).toContain(TEAM_WORKSPACE_RULES[seat]);
				expect(prompt).toContain(JSON.stringify(teamReportSchema(kind, seat), null, '\t'));
				expect(prompt).toContain('3 consecutive attempts without progress');
				expect(prompt).toContain('2 consecutive review rejections');
				expect(prompt).toContain('team-report');
				expect(prompt).toContain('Parse durations');
				expect(TEAM_TURN_PROMPTS[kind](state, seat)).toBe(prompt);
			}
		}
	);
	it('isolates challenges from other seats and QA preparation from unfinished development', () => {
		const state = reduceLedger(
			ledger(
				...baseline,
				{
					kind: 'challenge_submitted',
					seat: 'qa',
					objections: [{ about: 'A1', kind: 'risk', problem: 'QA_PRIVATE_CHALLENGE' }],
				},
				{
					kind: 'challenge_submitted',
					seat: 'dev',
					objections: [{ about: 'A1', kind: 'risk', problem: 'DEV_PRIVATE_CHALLENGE' }],
				},
				{
					kind: 'work_item',
					itemId: 'dev-work',
					title: 'DEV_UNFINISHED_WORK',
					owner: 'dev',
					state: 'claimed',
				},
				{
					kind: 'seat_bound',
					seat: 'dev',
					workspace: '/private/dev-worktree',
					model: { tool: 'codex' },
				},
				{
					kind: 'report_accepted',
					seat: 'dev',
					dispatchId: 'work',
					report: {
						type: 'work',
						done: ['RAW_CHAT_SENTINEL'],
						summary: 'Private implementation',
						claimsComplete: false,
					},
				}
			)
		);
		expect(buildTeamTurnPrompt('challenge', 'dev', state)).not.toContain('QA_PRIVATE_CHALLENGE');
		expect(buildTeamTurnPrompt('challenge', 'qa', state)).not.toContain('DEV_PRIVATE_CHALLENGE');
		const prep = buildTeamTurnPrompt('qa_prep', 'qa', state);
		for (const secret of ['DEV_UNFINISHED_WORK', '/private/dev-worktree', 'RAW_CHAT_SENTINEL'])
			expect(prep).not.toContain(secret);
		expect(buildTeamTurnPrompt('respond', 'pm', state)).toContain('QA_PRIVATE_CHALLENGE');
	});
	it('includes captured output for review and all changes and contested decisions for demo', () => {
		const state = reduceLedger(
			ledger(
				...proven,
				{
					kind: 'standard_change',
					actor: 'pm',
					criterionId: 'A1',
					change: 'tighten',
					before: 'Hours',
					after: 'Whole hours',
					reason: 'Scope clarification',
					approvedBy: 'pm',
				},
				{
					kind: 'discussion_closed',
					discussionId: 'd1',
					decision: 'Text output',
					decider: 'pm',
					contested: true,
					dissent: 'QA wanted a table',
					actions: [],
				}
			)
		);
		expect(buildTeamTurnPrompt('review', 'pm', state)).toContain('preview.png');
		const demo = buildTeamTurnPrompt('demo', 'pm', state);
		for (const value of [
			'Scope clarification',
			'QA wanted a table',
			'"contested": true',
			'before/after',
			'incomplete progress report',
		])
			expect(demo).toContain(value);
	});
	it('refuses a turn assigned to the wrong seat', () => {
		expect(() => buildTeamTurnPrompt('verify', 'dev', reduceLedger([]))).toThrow('may not');
	});
	it('explains an evidence-free position and quotes exact repair ids', () => {
		const empty = reduceLedger(ledger(...baseline));
		expect(buildTeamTurnPrompt('position', 'pm', empty)).toContain(
			'There is no recorded evidence yet'
		);
		const state = reduceLedger(ledger(...proven));
		const repair = reportRepairPrompt(
			'response',
			'Responses require a proposal.',
			'Previous reply',
			state
		);
		expect(repair).toContain('Responses require a proposal.');
		expect(repair).toContain(
			`Allowed recorded evidence ids: ${JSON.stringify(teamEvidence(state))}`
		);
	});
	it('respond includes a complete standard-change example accepted by validation', () => {
		const state = reduceLedger(ledger(...proven));
		const prompt = buildTeamTurnPrompt('respond', 'pm', state);
		const example = prompt.match(/Example: ("standardChanges":\[.*?\])\. For remove/)!;
		expect(example).not.toBeNull();
		const changes = JSON.parse(`{${example[1]}}`);
		expect(
			validateTeamReport({ ...goodReports.respond, ...changes }, 'respond', 'pm', state).ok
		).toBe(true);
		expect(prompt).toContain('id equal to criterionId');
		expect(prompt).toContain('Before confirmation, put draft edits in brief');
	});
	it('prompt schemas expose only seat-owned fields and leave proposal authority to the app', () => {
		const state = reduceLedger(ledger(...proven));
		for (const seat of ['pm', 'qa'] as const) {
			expect(JSON.stringify(teamReportSchema('position', seat))).not.toContain('extraTurns');
			expect(JSON.stringify(teamReportSchema('position', seat))).not.toContain('preservesDeadline');
		}
		expect(JSON.stringify(teamReportSchema('position', 'dev'))).toContain('extraTurns');
		expect(JSON.stringify(teamReportSchema('position', 'dev'))).toContain('preservesDeadline');
		expect(JSON.stringify(teamReportSchema('proposal', 'pm'))).not.toContain('decider');
		expect(JSON.stringify(teamReportSchema('message', 'qa'))).not.toContain('resolvedStandards');
		expect(JSON.stringify(teamReportSchema('message', 'pm'))).toContain('resolvedStandards');
		expect(
			reportRepairPrompt('position', 'Missing basis', 'reply', state, undefined, 'qa')
		).not.toContain('extraTurns');
	});
});
