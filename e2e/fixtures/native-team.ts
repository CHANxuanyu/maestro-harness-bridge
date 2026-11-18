import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { NativeApp, NativeScene } from './native-app';
import { reduceLedger } from '../../src/shared/team/ledger';
import {
	DEFAULT_TEAM_AUTHORIZATIONS,
	type CreateTeamInput,
	type LedgerEvent,
	type SeatRole,
	type TeamReport,
} from '../../src/shared/team/types';

/** Shared synthetic three-seat path. No provider processes start until NativeApp.start(). */
export function prepareNativeTeam(native: NativeApp, options: { gateRepairs?: boolean } = {}) {
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: native.project, encoding: 'utf8' });
	git('init');
	git('config', 'user.name', 'Team fixture');
	git('config', 'user.email', 'team@example.invalid');
	git('config', 'commit.gpgsign', 'false');
	git('config', 'core.hooksPath', path.join(native.root, 'no-hooks'));
	fs.writeFileSync(path.join(native.project, 'result.txt'), 'initial\n');
	fs.writeFileSync(
		path.join(native.project, 'check.cjs'),
		"const fs = require('node:fs'); process.exit(fs.readFileSync('result.txt', 'utf8').includes('implemented') ? 0 : 1);\n"
	);
	git('add', '.');
	git('commit', '-m', 'Synthetic project');
	const settings = path.join(native.data, 'maestro-settings.json');
	fs.writeFileSync(
		settings,
		JSON.stringify({
			...JSON.parse(fs.readFileSync(settings, 'utf8')),
			newShell: true,
			defaultSaveToHistory: false,
			crashReportingEnabled: false,
		})
	);
	const accounts = Object.fromEntries(
		(['pm', 'dev', 'qa'] as const).map((seat) => [seat, path.join(native.root, `account-${seat}`)])
	) as Record<SeatRole, string>;
	const scripts = Object.fromEntries(
		(['pm', 'dev', 'qa'] as const).map((seat) => [seat, path.join(native.root, `${seat}.json`)])
	) as Record<SeatRole, string>;
	for (const directory of Object.values(accounts)) fs.mkdirSync(directory);
	const heldImplement = path.join(native.root, 'hold-implementation-exit');
	const heldVerify = path.join(native.root, 'release-verification');
	const heldFix = path.join(native.root, 'release-fix');
	const heldRetest = path.join(native.root, 'release-retest');
	const heldMessage = path.join(native.root, 'release-message');
	const brief = {
		scope: 'Deliver a text result',
		notDoing: ['UI and network'],
		criteria: [
			{
				id: 'A1',
				text: 'Result contains implemented',
				proof: 'app' as const,
				how: 'Run node check.cjs',
			},
			{
				id: 'A2',
				text: 'Result handles the bad-input sample',
				proof: 'qa' as const,
				how: 'QA inspects sample',
			},
		],
		checks: [{ command: 'node check.cjs', covers: ['A1'] }],
	};
	const answer = (report: TeamReport, text: string): string =>
		`${text}\n\n\`\`\`team-report\n${JSON.stringify(report)}\n\`\`\``;
	const pm: NativeScene[] = [
		{ answer: 'I inspected the request but omitted my report.' },
		{ answer: answer({ type: 'brief', ...brief }, 'The deliverable and proof methods are ready.') },
		{
			answer: answer(
				{
					type: 'respond',
					decisions: [{ about: 'A1', result: 'accept', reason: 'Keep the check observable' }],
					brief,
					askOwner: null,
				},
				'Both independent challenges are addressed.'
			),
		},
		{
			answer: answer(
				{ type: 'review', verdict: 'pass', problems: [], suggestions: [] },
				'The captured result satisfies the baseline.'
			),
		},
		{
			answer: answer(
				{
					type: 'demo',
					summary: 'The result now handles the requested cases.',
					evidence: ['result.txt', 'qa/sample.txt'],
					decisions: ['Baseline confirmed'],
					changes: [],
				},
				'Here is the implemented result and the independent evidence.'
			),
		},
	];
	const dev: NativeScene[] = [
		{ answer: 'Developer challenge\n```team-report\n{broken}\n```' },
		{
			answer: answer(
				{
					type: 'challenge',
					objections: [{ about: 'A1', problem: 'DEV_ISOLATED_TEXT', kind: 'risk' }],
				},
				'The check needs a stable result.'
			),
		},
		{
			answer: answer(
				{
					type: 'work',
					done: ['result.txt'],
					summary: 'Implemented the result',
					claimsComplete: true,
				},
				'IMPLEMENTATION_READY_FOR_RESTART'
			),
			writes: { 'result.txt': 'implemented\n' },
			exitGate: heldImplement,
		},
		// The test fills the concrete issue identity while QA is held at its tool gate.
		{ answer: '', writes: { 'result.txt': 'implemented with bad-input handling\n' } },
	];
	const qa: NativeScene[] = [
		{
			answer: answer(
				{
					type: 'challenge',
					objections: [{ about: 'A2', problem: 'QA_ISOLATED_TEXT', kind: 'risk' }],
					plans: brief.criteria.map((c) => ({
						criterion: c.id,
						how: c.how,
						data: 'normal and bad-input samples',
					})),
				},
				'I have an independent verification plan.'
			),
		},
		{
			answer: answer(
				{ type: 'qa_prep', tests: ['qa/sample.txt'], samples: ['bad input'] },
				'Independent samples prepared.'
			),
			writes: { 'qa/sample.txt': 'bad input\n', 'unauthorized.txt': 'must be restored\n' },
		},
		{
			answer: answer(
				{
					type: 'verify',
					criteria: [{ id: 'A2', pass: true, evidence: 'Normal samples in qa/sample.txt' }],
					issues: [
						{
							title: 'Bad-input sample fails',
							criterion: 'A2',
							kind: 'defect',
							steps: ['Inspect the bad-input sample'],
							expected: 'Bad input handled',
							actual: 'Bad input omitted',
						},
					],
				},
				'One exploratory case fails.'
			),
			tools: [
				{
					id: 'verify-gate',
					command: 'Inspect samples',
					output: 'One failing sample',
					updates: ['Verifying'],
					gates: [heldVerify],
				},
			],
		},
		{ answer: '' },
	];
	const saveScripts = () => {
		for (const [seat, turns] of Object.entries({ pm, dev, qa }))
			fs.writeFileSync(
				scripts[seat as SeatRole],
				JSON.stringify({
					turns,
					teamMessages: { seat, ...(options.gateRepairs ? { messageGate: heldMessage } : {}) },
				})
			);
	};
	if (options.gateRepairs) {
		dev[3].tools = [
			{ id: 'fix-gate', command: 'Fix sample', output: 'Fix ready', gates: [heldFix] },
		];
		qa[3].tools = [
			{ id: 'retest-gate', command: 'Retest sample', output: 'Retest ready', gates: [heldRetest] },
		];
	}
	saveScripts();
	const input: CreateTeamInput = {
		idea: 'Deliver a text result with independent verification',
		projectRoot: native.project,
		turnBudget: 40,
		authorizations: { ...DEFAULT_TEAM_AUTHORIZATIONS },
		seats: {
			pm: {
				tool: 'claude-code',
				model: 'claude-sonnet-4-6',
				effort: 'high',
				customPath: path.resolve('e2e/fixtures/native/claude'),
				customEnv: { CLAUDE_CONFIG_DIR: accounts.pm, MAESTRO_NATIVE_SCRIPT: scripts.pm },
			},
			dev: {
				tool: 'codex',
				model: 'gpt-5.3-codex',
				effort: 'high',
				customPath: path.resolve('e2e/fixtures/native/codex'),
				customEnv: { CODEX_HOME: accounts.dev, MAESTRO_NATIVE_SCRIPT: scripts.dev },
			},
			qa: {
				tool: 'claude-code',
				model: 'claude-sonnet-4-6',
				effort: 'medium',
				customPath: path.resolve('e2e/fixtures/native/claude'),
				customEnv: { CLAUDE_CONFIG_DIR: accounts.qa, MAESTRO_NATIVE_SCRIPT: scripts.qa },
			},
		},
	};
	const events = (teamId: string): LedgerEvent[] => {
		const file = path.join(native.data, 'teams', teamId, 'ledger.jsonl');
		if (!fs.existsSync(file)) return [];
		return fs
			.readFileSync(file, 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	};
	const state = (teamId: string) => reduceLedger(events(teamId));
	const nativeRows = (
		seat: SeatRole
	): Array<{
		type: string;
		payload?: { role?: string; content?: unknown };
		message: { content: unknown };
	}> =>
		native.files(seat === 'dev' ? 'codex' : 'claude', accounts[seat]).flatMap((file) =>
			fs
				.readFileSync(file, 'utf8')
				.split('\n')
				.filter(Boolean)
				.map((line) => JSON.parse(line))
		);
	const releaseVerification = (teamId: string) => {
		const verifying = state(teamId).turns.find((turn) => turn.dispatched?.turn === 'verify')!;
		const issueId = `${verifying.dispatchId}:issue:0`;
		dev[3].answer = answer(
			{
				type: 'fix',
				fixed: [issueId],
				notFixed: [],
				summary: 'Handled bad input',
				attempt: {
					basis: 'QA sample',
					difference: 'Handle the missing case',
					expectation: 'QA sample passes',
				},
			},
			'The missing case is implemented.'
		);
		qa[3].answer = answer(
			{
				type: 'reverify',
				results: [
					{
						issue: issueId,
						pass: true,
						evidence: 'qa/sample.txt rerun against submitted revision',
					},
				],
				newIssues: [],
			},
			'The submitted fix passes independent reverification.'
		);
		saveScripts();
		fs.writeFileSync(heldVerify, 'ready');
	};
	return {
		input,
		accounts,
		nativeRows,
		events,
		state,
		releaseVerification,
		releaseImplementation: () => fs.writeFileSync(heldImplement, 'ready'),
		releaseFix: () => fs.writeFileSync(heldFix, 'ready'),
		releaseRetest: () => fs.writeFileSync(heldRetest, 'ready'),
		releaseMessage: () => fs.writeFileSync(heldMessage, 'ready'),
	};
}
