import { describe, expect, it } from 'vitest';
import {
	baselineDiff,
	discussionDecider,
	missingOutputLocations,
	pmMayChange,
	referenceVotes,
	topicRejection,
	teamEvidence,
	teamEvidenceCatalog,
	teamChallengeRound,
	teamOutputLocation,
	teamWaitRejection,
} from '../../../shared/team/policy';
import { reportEvents } from '../../../main/team/report-events';
import { validateTeamReport } from '../../../shared/team/report';
import { buildTeamTurnPrompt } from '../../../shared/team/prompts';
import { reduceLedger } from '../../../shared/team/ledger';
import { checkCommandBoundary, checkTestCounts } from '../../../shared/checkRun';
import type {
	TeamDiscussion,
	StandardChangeRequest,
	TeamEvent,
	TeamReport,
} from '../../../shared/team/types';
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
	it('records unsupported insistence as a reservation; only new evidence or a baseline violation sustains insistence', () => {
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
		} as const;
		const dispatch = ledger({
			kind: 'turn_dispatched',
			dispatchId: 'r',
			seat: 'qa',
			turn: 'response',
			promptDigest: '',
		})[0] as TeamEvent<'turn_dispatched'>;
		const known = teamEvidence(state)[0];
		for (const candidate of [
			report,
			{ ...report, evidence: 'invented' },
			{ ...report, baselineViolation: 'A1' },
			{ ...report, evidence: known },
		]) {
			expect(validateTeamReport(candidate, 'response', 'qa', state).ok).toBe(true);
			const event = reportEvents(dispatch, candidate, state).find((e) => e.kind === 'response');
			expect(event).toMatchObject({
				result:
					'baselineViolation' in candidate ||
					('evidence' in candidate && candidate.evidence === known)
						? 'insist'
						: 'reserve',
			});
		}
		state.discussions[0].positions[0].evidence = [known];
		expect(
			reportEvents(dispatch, { ...report, evidence: known }, state).find(
				(e) => e.kind === 'response'
			)
		).toMatchObject({ result: 'reserve', requestedResult: 'insist' });
	});
	it.each([undefined, [], ['invented prose basis']])(
		'accepts a position with evidence %j without promoting unknown references',
		(evidence) => {
			const state = reduceLedger(
				ledger(...proven, { ...opened, participants: [...opened.participants] })
			);
			const report: TeamReport = {
				type: 'position',
				discussionId: 'd1',
				claim: 'Use a short display',
				basis: 'A small task needs little chrome',
				wouldChangeMind: 'A readability check',
				...(evidence ? { evidence } : {}),
			};
			expect(validateTeamReport(report, 'position', 'dev', state).ok).toBe(true);
			const dispatch = ledger({
				kind: 'turn_dispatched',
				dispatchId: 'p',
				seat: 'dev',
				turn: 'position',
				promptDigest: '',
			})[0] as TeamEvent<'turn_dispatched'>;
			const event = reportEvents(dispatch, report, state).find((e) => e.kind === 'position');
			expect(event).toMatchObject({
				evidence: evidence ? [] : undefined,
				unverifiedBasis: evidence,
			});
			expect(teamEvidence(state)).not.toContain('invented prose basis');
		}
	);
	it('lists the exact citable ids with observation descriptions and only unused ids for insistence', () => {
		const state = discussionState();
		const catalog = teamEvidenceCatalog(state);
		expect(catalog.map((e) => e.id)).toEqual(teamEvidence(state));
		expect(catalog.some((e) => e.description.startsWith('Check npm test'))).toBe(true);
		expect(catalog.some((e) => e.description.startsWith('Captured output'))).toBe(true);
		expect(catalog.some((e) => e.description.startsWith('Criterion'))).toBe(true);
		state.discussions[0].positions[0].evidence = [catalog[0].id];
		expect(teamEvidence(state, state.discussions[0])).not.toContain(catalog[0].id);
		const prompt = buildTeamTurnPrompt('response', 'qa', state, 'd1');
		for (const entry of catalog) expect(prompt).toContain(JSON.stringify(entry.id));
		expect(prompt).toContain('newEvidenceIds');
	});
	it('a no-op brief does not spend the revision round; removal-only challenges need no unchanged plans', () => {
		const state = reduceLedger(
			ledger(
				...baseline.slice(0, 2),
				{ kind: 'challenge_submitted', seat: 'dev', briefVersion: 1, objections: [] },
				{ kind: 'challenge_submitted', seat: 'qa', briefVersion: 1, objections: [] },
				{ kind: 'brief_response', decisions: [] },
				{ kind: 'brief_published', brief: { ...brief, version: 2 } },
				{ kind: 'brief_response', decisions: [] },
				{
					kind: 'brief_published',
					brief: { ...brief, version: 3, criteria: brief.criteria.filter((c) => c.id !== 'A2') },
				}
			)
		);
		expect(teamChallengeRound(state)).toMatchObject({ round: 2, criteria: ['A2'] });
		expect(
			validateTeamReport({ type: 'challenge', objections: [], plans: [] }, 'challenge', 'qa', state)
				.ok
		).toBe(true);
		expect(buildTeamTurnPrompt('challenge', 'qa', state)).toContain('Rejects bad input');
		expect(buildTeamTurnPrompt('challenge', 'qa', state)).not.toContain('Results are readable');
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

it('selects output workspace by target and keeps normalization stable across a second pass', () => {
	const roots = { dev: '/team/dev', qa: '/team/qa' };
	for (const [target, workspace, normalized] of [
		['qa/clamp.qa.test.cjs', 'qa', 'qa/clamp.qa.test.cjs'],
		['./qa/clamp.qa.test.cjs', 'qa', 'qa/clamp.qa.test.cjs'],
		['/team/qa/qa/clamp.qa.test.cjs', 'qa', 'qa/clamp.qa.test.cjs'],
		['README.md', 'dev', 'README.md'],
		['/team/dev/README.md', 'dev', 'README.md'],
		['/team/dev/qa/explicit.cjs', 'dev', '/team/dev/qa/explicit.cjs'],
		['https://example.test/view', 'dev', 'https://example.test/view'],
	]) {
		const selected = teamOutputLocation(target, roots);
		expect(selected).toEqual({ workspace, target: normalized });
		expect(teamOutputLocation(selected.target, roots)).toEqual(selected);
	}
	expect(
		teamOutputLocation('C:\\team\\qa\\qa\\test.cjs', {
			dev: 'C:\\team\\dev',
			qa: 'C:\\team\\qa',
		})
	).toEqual({ workspace: 'qa', target: 'qa/test.cjs' });
});

it.each([{ recorded: [] }, { recorded: ['check-1'] }])(
	'accepts real topic prose references with recorded ids %j as unverified basis, never as evidence',
	({ recorded }) => {
		const state = reduceLedger(ledger(...baseline, check));
		const topic = {
			type: 'topic' as const,
			topic: 'Expected behavior for decimal edge cases and help placement',
			why: 'C4 requires decisive QA assertions for unspecified inputs.',
			participants: ['pm', 'dev', 'qa'] as Array<'pm' | 'dev' | 'qa'>,
			owner: 'pm' as const,
			layer: 'product' as const,
			kind: 'standard' as const,
			criterionId: 'A2',
			evidence: [...recorded, 'The baseline contract has no cases for add 1e2 3.'],
		};
		expect(topicRejection(topic, state)).toBeUndefined();
		const events = reportEvents(
			{
				kind: 'turn_dispatched',
				seat: 'dev',
				dispatchId: 'topic-prose',
			} as TeamEvent<'turn_dispatched'>,
			topic,
			state
		);
		expect(events.find((e) => e.kind === 'discussion_opened')).toMatchObject({
			evidence: recorded,
			unverifiedBasis: [topic.evidence.at(-1)],
		});
		expect(buildTeamTurnPrompt('topic', 'dev', state)).toContain('citableEvidence');
		expect(buildTeamTurnPrompt('challenge', 'dev', state)).toContain('check-1');
		const reopened = reduceLedger(
			ledger(
				...baseline,
				check,
				{ ...opened, participants: [...opened.participants], question: topic.topic },
				{
					kind: 'discussion_closed',
					discussionId: 'd1',
					decision: 'Keep',
					decider: 'pm',
					actions: [],
				}
			)
		);
		expect(
			topicRejection(
				{ ...topic, reopens: 'd1', evidence: ['New wording is not a recorded observation'] },
				reopened
			)
		).toContain('new recorded evidence');
	}
);

it.each([
	'Dev and QA responses',
	'Responses from dev and QA',
	'discussion d1 proposal',
	'PM turn',
	'app check C1',
	'A1',
	'QA verification',
	'等待开发回复',
	'npm test',
])('refuses app-owned wait %s even when a timer is supplied', (waitFor) => {
	const state = reduceLedger(ledger(...baseline));
	expect(teamWaitRejection({ waitFor, condition: { kind: 'time', at: 123 } }, state)).toContain(
		'app-owned'
	);
});
it('distinguishes genuine external conditions and unobservable prose from app-owned needs', () => {
	for (const wait of [
		{ waitFor: 'CI run', condition: { kind: 'ci' as const, runId: '123', cwd: '/project/dev' } },
		{
			waitFor: 'Command completion',
			condition: { kind: 'command' as const, processId: 'external-process' },
		},
		{ waitFor: 'Quota reset', condition: { kind: 'time' as const, at: 123 } },
		{ waitFor: 'Deadline', condition: { kind: 'time' as const, at: 456 } },
	])
		expect(teamWaitRejection(wait)).toBeUndefined();
	expect(teamWaitRejection({ waitFor: 'New measured output' })).toContain('No external condition');
	expect(teamWaitRejection({ waitFor: 'CI', needs: ['qa'] })).toContain('app-owned');
});

describe('confirmed baseline over pre-baseline decisions', () => {
	// Real run 5 (2026-11-20): QA's report after baseline v3, trimmed to the fields used.
	const realTopic = {
		topic: 'PM decision accepts exponents but confirmed cli-contract v3 rejects them',
		why: 'The ledger decision says to accept e/E exponents. Confirmed criterion cli-contract v3 and the check `add 1e3 2` say to reject exponents.',
		participants: ['pm', 'dev', 'qa'],
		owner: 'pm',
		layer: 'product',
		kind: 'standard',
		criterionId: 'A1',
		question:
			'Which governs: v3 (reject exponents, check `add 1e3 2` expects exit 2) or the PM decision (accept e/E exponents)?',
	} as const;
	const dispatch = ledger({
		kind: 'turn_dispatched',
		dispatchId: 'qa-prep',
		seat: 'qa',
		turn: 'qa_prep',
		promptDigest: '',
	})[0] as TeamEvent<'turn_dispatched'>;
	const stateWith = (decisionBeforeBaseline: boolean) =>
		reduceLedger(
			ledger(
				...baseline.slice(0, 2),
				...(decisionBeforeBaseline
					? [
							{
								kind: 'discussion_closed',
								discussionId: 'early',
								decision: 'Accept e/E exponents',
								decider: 'pm',
								contested: false,
								dissent: '',
								actions: [],
							} as const,
						]
					: []),
				baseline[2]
			)
		);

	it('resolves an authority question about a superseded decision without opening a discussion', () => {
		const events = reportEvents(
			dispatch,
			{ ...goodReports.qa_prep, topic: realTopic } as TeamReport,
			stateWith(true)
		);
		expect(events.map((e) => e.kind)).toEqual(
			expect.arrayContaining(['issue_opened', 'standard_issue_resolved'])
		);
		expect(events.some((e) => e.kind === 'discussion_opened')).toBe(false);
		expect(events.find((e) => e.kind === 'standard_issue_resolved')).toMatchObject({
			baselineVersion: 1,
		});
	});

	it('still routes a genuine standard problem to PM when no decision was superseded', () => {
		const events = reportEvents(
			dispatch,
			{ ...goodReports.qa_prep, topic: realTopic } as TeamReport,
			stateWith(false)
		);
		expect(events.some((e) => e.kind === 'standard_issue_resolved')).toBe(false);
		expect(events.some((e) => e.kind === 'discussion_opened')).toBe(true);
	});

	it('shows a superseded decision to members as historical, with no actions to apply', () => {
		const prompt = buildTeamTurnPrompt('work', 'dev', stateWith(true));
		expect(prompt).toContain('Superseded by baseline v1; historical only, do not apply.');
		expect(prompt).toContain('the owner-confirmed baseline governs');
	});
});
