import { describe, expect, it } from 'vitest';
import {
	baselineDiff,
	discussionDecider,
	missingOutputLocations,
	pmMayChange,
	referenceVotes,
	topicRejection,
} from '../../../shared/team/policy';
import { validateTeamReport } from '../../../shared/team/report';
import { buildTeamTurnPrompt } from '../../../shared/team/prompts';
import { reduceLedger } from '../../../shared/team/ledger';
import { checkCommandBoundary, checkTestCounts } from '../../../shared/checkRun';
import type { TeamDiscussion, StandardChangeRequest } from '../../../shared/team/types';
import { baseline, brief, check, ledger, proven, goodReports } from './fixtures';

const opened = {
	kind: 'discussion_opened' as const,
	discussionId: 'd1',
	topic: 'Truncation',
	owner: 'dev' as const,
	participants: ['pm', 'dev', 'qa'] as const,
	trigger: 'member',
	layer: 'implementation' as const,
	reversible: true,
};
const discussionState = () =>
	reduceLedger(
		ledger(
			...proven,
			{ ...opened, participants: [...opened.participants] },
			...opened.participants.map((seat) => ({
				kind: 'position' as const,
				discussionId: 'd1',
				seat,
				claim: `${seat}-PRIVATE`,
				basis: 'Measured result',
				wouldChangeMind: 'New sample',
				extraTurns: seat === 'dev' ? 1 : undefined,
				preservesDeadline: true,
			}))
		)
	);

describe('M2 team policy', () => {
	it('seals positions even from the proposal author; response sees only this topic arguments', () => {
		const state = discussionState();
		for (const kind of ['position', 'proposal'] as const) {
			const prompt = buildTeamTurnPrompt(kind, 'dev', state, 'd1');
			expect(prompt).not.toContain('pm-PRIVATE');
			expect(prompt).not.toContain('qa-PRIVATE');
		}
		const response = buildTeamTurnPrompt('response', 'qa', state, 'd1');
		expect(response).toContain('pm-PRIVATE');
		expect(response).toContain('dev-PRIVATE');
	});
	it.each([
		['fact', 'app'],
		['implementation', 'dev'],
		['testing', 'qa'],
		['product', 'pm'],
		['commitment', 'owner'],
	] as const)('assigns the %s layer to %s', (layer, decider) => {
		const discussion = discussionState().discussions[0];
		discussion.opened!.layer = layer;
		expect(discussionDecider(discussion)).toBe(decider);
		discussion.opened!.reversible = false;
		expect(discussionDecider(discussion)).toBe('owner');
	});
	it('requires new evidence or a baseline violation for insistence', () => {
		const state = discussionState();
		state.discussions[0].proposals.push({
			kind: 'proposal',
			actor: 'dev',
			id: 'p',
			at: 1,
			seq: 100,
			discussionId: 'd1',
			proposal: 'Truncate',
			decider: 'dev',
			round: 1,
		});
		const report = {
			type: 'response',
			discussionId: 'd1',
			result: 'insist',
			reason: 'I prefer it',
		};
		expect(validateTeamReport(report, 'response', 'qa', state).ok).toBe(false);
		expect(
			validateTeamReport({ ...report, evidence: 'invented' }, 'response', 'qa', state).ok
		).toBe(false);
		expect(
			validateTeamReport({ ...report, baselineViolation: 'A1' }, 'response', 'qa', state).ok
		).toBe(true);
	});
	it('refuses a decided question without a fresh observation, including a renamed reopening', () => {
		const entries = ledger(
			...proven,
			{ ...opened, participants: [...opened.participants] },
			{
				kind: 'discussion_closed',
				discussionId: 'd1',
				decision: 'Done',
				decider: 'dev',
				actions: [],
			}
		);
		const topic = { topic: 'Truncation', why: 'Disagree', participants: ['qa' as const] };
		expect(topicRejection(topic, reduceLedger(entries))).toContain('cannot reopen');
		expect(
			topicRejection(
				{ ...topic, topic: 'Different words', reopens: 'd1', evidence: ['check-1'] },
				reduceLedger(entries)
			)
		).toContain('cannot reopen');
		const fresh = [
			...entries,
			{
				...entries.find((e) => e.kind === 'check_run')!,
				id: 'fresh-check',
				seq: 999,
				evidenceId: 'new-observation',
			},
		];
		expect(
			topicRejection({ ...topic, evidence: ['new-observation'] }, reduceLedger(fresh))
		).toBeUndefined();
	});
	it('keeps a failing app check failed despite QA, PM and owner claims', () => {
		const state = reduceLedger(
			ledger(
				...proven,
				{ ...check, exitCode: 1 },
				{
					kind: 'criterion_evidence',
					actor: 'qa',
					criterionId: 'A1',
					source: 'qa',
					pass: true,
					evidence: 'QA opinion',
				},
				{ kind: 'review', actor: 'pm', verdict: 'pass', problems: [], suggestions: [] },
				{ kind: 'accepted', actor: 'owner' }
			)
		);
		expect(state.criteria.find((c) => c.id === 'A1')?.status).toBe('fail');
		expect(state.terminal).toBeNull();
		expect(validateTeamReport(goodReports.demo, 'demo', 'pm', state).ok).toBe(false);
	});
	it('requires all R1-3 conditions and preserves proof, numbers and the old meaning', () => {
		const state = discussionState();
		const change: StandardChangeRequest = {
			criterionId: 'A1',
			change: 'tighten',
			reason: 'Clarify',
			withinMeaning: 'Hours include whole hours',
			criterion: { ...brief.criteria[0], text: `${brief.criteria[0].text}; include whole hours` },
		};
		expect(pmMayChange(change, state, state.discussions[0])).toBe(true);
		for (const invalid of [
			{ ...change, withinMeaning: undefined },
			{ ...change, change: 'relax' as const },
			{ ...change, criterion: { ...change.criterion!, proof: 'pm' as const } },
			{
				...change,
				criterion: { ...change.criterion!, text: `${brief.criteria[0].text} in 5 seconds` },
			},
		])
			expect(pmMayChange(invalid, state, state.discussions[0])).toBe(false);
		expect(pmMayChange(change, state)).toBe(false);
		state.discussions[0].positions.find((p) => p.seat === 'dev')!.preservesDeadline = false;
		expect(pmMayChange(change, state, state.discussions[0])).toBe(false);
	});
	it('counts same-vendor agreement once in owner-card reference votes', () => {
		const state = discussionState();
		const discussion = state.discussions[0];
		discussion.proposals.push({
			kind: 'proposal',
			actor: 'dev',
			id: 'p',
			at: 1,
			seq: 100,
			discussionId: 'd1',
			proposal: 'Choose',
			decider: 'dev',
			round: 1,
		});
		discussion.responses = ['pm', 'qa'].map((seat) => ({
			kind: 'response',
			actor: 'app',
			id: seat,
			seq: 101,
			at: 1,
			discussionId: 'd1',
			seat,
			result: 'agree',
			reason: 'Yes',
			round: 1,
		})) as TeamDiscussion['responses'];
		expect(referenceVotes(discussion, state)).toContain('2 agree (1 vendor group)');
	});
	it('diffs only the changed criterion, including a return with unchanged entries', () => {
		const after = {
			...brief,
			version: 2,
			criteria: brief.criteria.map((c) => (c.id === 'A1' ? { ...c, text: 'New wording' } : c)),
		};
		expect(baselineDiff(brief, after)).toEqual({
			fromVersion: 1,
			toVersion: 2,
			criteria: [{ id: 'A1', before: brief.criteria[0], after: after.criteria[0] }],
		});
	});
	it('blocks a review until every named viewer is captured', () => {
		const state = reduceLedger(ledger(...baseline));
		state.criteria[2].locations = [
			{ label: 'Viewer A', target: 'a.html', kind: 'preview' },
			{ label: 'Viewer B', target: 'https://example.invalid/result', kind: 'screenshot' },
		];
		const output = {
			files: ['a.html'],
			previews: ['a.png'],
			locations: [{ criterion: 'E1', location: state.criteria[2].locations[0], preview: 'a.png' }],
		};
		expect(missingOutputLocations(state, output)).toEqual([
			'E1: Viewer B (https://example.invalid/result)',
		]);
	});
	it('separates declared or explicit boundary checks from the workspace authorization', () => {
		expect(checkCommandBoundary('npm test')).toBeUndefined();
		expect(checkCommandBoundary('npm test -- changed.test.ts')).toBeUndefined();
		expect(checkCommandBoundary('git push origin HEAD')).toBe('external-write');
		expect(checkCommandBoundary('cat ../private.txt')).toBe('outside-workspace');
		expect(checkCommandBoundary('node local-script.cjs', 'external-write')).toBe('external-write');
	});
	it('records observed test totals without inventing a count for arbitrary commands', () => {
		expect(checkTestCounts('# tests 12\n# skipped 2')).toEqual({ testsRun: 10, testsSkipped: 2 });
		expect(checkTestCounts('Tests  4 passed | 1 failed | 2 skipped (7)')).toEqual({
			testsRun: 5,
			testsSkipped: 2,
		});
		expect(checkTestCounts('====== 3 passed, 1 skipped in 0.1s ======')).toEqual({
			testsRun: 3,
			testsSkipped: 1,
		});
		expect(checkTestCounts('All fine')).toEqual({});
	});
});

describe('M3 recovery authority', () => {
	it('identifies the quota account independently of unrelated environment variables', async () => {
		const { teamModelUnavailable } = await import('../../../shared/team/policy');
		const state = reduceLedger(
			ledger(...baseline, {
				kind: 'quota_exhausted',
				seat: 'pm',
				model: { tool: 'claude-code', model: 'same' },
				configSource: 'pm',
			})
		);
		state.config!.seats.pm = {
			tool: 'claude-code',
			model: 'same',
			customEnv: { CLAUDE_CONFIG_DIR: '/synthetic/account', NOTE: 'first' },
		};
		state.config!.seats.qa = {
			tool: 'claude-code',
			model: 'same',
			customEnv: { NOTE: 'different', CLAUDE_CONFIG_DIR: '/synthetic/account' },
		};
		expect(teamModelUnavailable(state, state.config!.seats.qa, 'qa')).toBe(true);
		state.config!.seats.qa.customEnv!.CLAUDE_CONFIG_DIR = '/synthetic/independent';
		expect(teamModelUnavailable(state, state.config!.seats.qa, 'qa')).toBe(false);
	});
	it('prefers an authorized substitute, then an existing model from a different vendor than dev', async () => {
		const { teamRecoveryDecision } = await import('../../../shared/team/policy');
		const state = reduceLedger(
			ledger(...baseline, {
				kind: 'quota_exhausted',
				seat: 'pm',
				model: { tool: 'claude-code', model: 'pm' },
				configSource: 'pm',
				resetsAt: 100_000,
			})
		);
		state.config!.seats.pm = {
			tool: 'claude-code',
			model: 'pm',
			customEnv: { CLAUDE_CONFIG_DIR: '/synthetic/pm' },
		};
		state.config!.seats.qa = {
			tool: 'claude-code',
			model: 'qa',
			customEnv: { CLAUDE_CONFIG_DIR: '/synthetic/qa' },
		};
		state.config!.seats.dev = { tool: 'codex', model: 'gpt-test' };
		expect(teamRecoveryDecision(state, 'pm', true).choices[0]).toMatchObject({
			source: 'qa',
			temporary: true,
		});
		state.config!.seats.pm.substitute = { tool: 'codex', model: 'gpt-test' };
		expect(teamRecoveryDecision(state, 'pm', true).choices[0]).toMatchObject({
			source: 'dev',
			temporary: false,
		});
		state.config!.seats.pm.substitute = undefined;
		state.config!.deadline = 90_000;
		expect(teamRecoveryDecision(state, 'pm', false).decision).toMatchObject({
			kind: 'escalate',
			boundaries: ['permission', 'budget'],
		});
		state.config!.deadline = 110_000;
		expect(teamRecoveryDecision(state, 'pm', false).decision).toMatchObject({
			kind: 'continue',
			next: { key: 'wait' },
		});
	});
});
