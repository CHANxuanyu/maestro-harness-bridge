import {
	DEFAULT_TEAM_AUTHORIZATIONS,
	type Brief,
	type LedgerEvent,
	type LedgerEventKind,
	type TeamConfig,
	type TeamEvent,
	type TeamReport,
	type M1TurnKind,
} from '../../../shared/team/types';

export const config: TeamConfig = {
	id: 'team-1',
	title: 'Duration parser',
	idea: 'Parse durations and make results easy to read.',
	projectRoot: '/project',
	createdAt: 1000,
	seats: { pm: { tool: 'claude-code' }, dev: { tool: 'codex' }, qa: { tool: 'claude-code' } },
	turnBudget: 40,
	authorizations: { ...DEFAULT_TEAM_AUTHORIZATIONS },
};
export const brief: Brief = {
	version: 1,
	scope: 'Parse durations',
	notDoing: ['Calendar arithmetic'],
	criteria: [
		{ id: 'A1', text: 'Parses hours', proof: 'app', how: 'Run the test command' },
		{ id: 'A2', text: 'Rejects bad input', proof: 'qa', how: 'Try invalid samples' },
		{
			id: 'E1',
			text: 'Results are readable',
			proof: 'pm',
			how: 'Inspect the rendered preview',
			experience: true,
		},
	],
	checks: [{ command: 'npm test', covers: ['A1'] }],
};
export type EventInput = {
	[K in LedgerEventKind]: Omit<TeamEvent<K>, 'seq' | 'id' | 'at' | 'actor'> & {
		actor?: LedgerEvent['actor'];
	};
}[LedgerEventKind];
export const ledger = (...entries: EventInput[]): LedgerEvent[] =>
	entries.map(
		(entry, index) =>
			({
				actor: 'app',
				...entry,
				id: `e${index + 1}`,
				seq: index + 1,
				at: 1000 + index,
			}) as LedgerEvent
	);
export const baseline: EventInput[] = [
	{ kind: 'team_created', config },
	{ kind: 'brief_published', actor: 'pm', brief },
	{ kind: 'baseline_confirmed', actor: 'owner', briefVersion: 1 },
];
export const check: EventInput = {
	kind: 'check_run',
	command: 'npm test',
	cwd: '/project/dev',
	exitCode: 0,
	outputTail: '1 passed',
	durationMs: 100,
	covers: ['A1'],
	evidenceId: 'check-1',
};
export const proven: EventInput[] = [
	...baseline,
	check,
	{
		kind: 'criterion_evidence',
		actor: 'qa',
		criterionId: 'A2',
		source: 'qa',
		pass: true,
		evidence: 'qa/bad-input.txt',
	},
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
	},
	{ kind: 'review', actor: 'pm', verdict: 'pass', problems: [], suggestions: [] },
];
export const goodReports: Record<M1TurnKind | 'topic', TeamReport> = {
	brief: {
		type: 'brief',
		scope: brief.scope,
		notDoing: brief.notDoing,
		criteria: brief.criteria,
		checks: brief.checks,
	},
	challenge: {
		type: 'challenge',
		objections: [],
		plans: brief.criteria.map((c) => ({
			criterion: c.id,
			how: c.how!,
			data: 'Representative valid and invalid samples',
		})),
	},
	respond: {
		type: 'respond',
		decisions: [],
		brief: {
			scope: brief.scope,
			notDoing: brief.notDoing,
			criteria: brief.criteria,
			checks: brief.checks,
		},
		askOwner: null,
	},
	work: {
		type: 'work',
		done: ['parser'],
		summary: 'Implemented parser',
		claimsComplete: true,
		waiting: null,
	},
	qa_prep: { type: 'qa_prep', tests: ['qa/parser.test.ts'], samples: ['valid and invalid inputs'] },
	verify: {
		type: 'verify',
		criteria: [{ id: 'A2', pass: true, evidence: 'qa/sample-results.txt' }],
		issues: [],
	},
	fix: {
		type: 'fix',
		fixed: ['i1'],
		notFixed: [],
		attempt: {
			basis: 'QA reproduction',
			difference: 'Reject invalid units',
			expectation: 'Invalid sample rejected',
		},
	},
	reverify: {
		type: 'reverify',
		results: [{ issue: 'i1', pass: true, evidence: 'qa/retest.txt' }],
		newIssues: [],
	},
	review: { type: 'review', verdict: 'pass', problems: [], suggestions: [] },
	demo: {
		type: 'demo',
		summary: 'Readable duration results',
		evidence: ['preview'],
		decisions: [],
		changes: [],
	},
	topic: {
		type: 'topic',
		topic: 'Ambiguous unit',
		why: 'Needs a definition',
		participants: ['pm', 'qa'],
	},
};
export const issue: EventInput = {
	kind: 'issue_opened',
	actor: 'qa',
	issueId: 'i1',
	title: 'Accepts invalid unit',
	criterionId: 'A2',
	issueKind: 'defect',
	steps: ['Enter 1z'],
	expected: 'Reject',
	actual: 'Accepted',
};
