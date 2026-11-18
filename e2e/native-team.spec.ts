import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { NativeApp, type NativeScene } from './fixtures/native-app';
import { reduceLedger } from '../src/shared/team/ledger';
import {
	DEFAULT_TEAM_AUTHORIZATIONS,
	type CreateTeamInput,
	type LedgerEvent,
	type SeatRole,
	type TeamConfig,
	type TeamReport,
} from '../src/shared/team/types';

// Never turn this synthetic scenario into a paid run merely by setting REAL.
test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'Team M1 acceptance uses isolated synthetic providers only'
);

// eslint-disable-next-line no-empty-pattern
test('team M1: three seats, CLI owner cards, report repair and forced-quit recovery', async ({}, info) => {
	test.setTimeout(240_000);
	const native = new NativeApp(info, { providerCli: false });
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
			fs.writeFileSync(scripts[seat as SeatRole], JSON.stringify({ turns }));
	};
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
	let team: TeamConfig;
	let open = false;
	let failed = false;
	const events = (): LedgerEvent[] => {
		if (!team) return [];
		const file = path.join(native.data, 'teams', team.id, 'ledger.jsonl');
		if (!fs.existsSync(file)) return [];
		return fs
			.readFileSync(file, 'utf8')
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	};
	const state = () => reduceLedger(events());
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
	try {
		await native.start();
		open = true;
		team = await native.page.evaluate((value) => window.maestro.team.create(value), input);
		expect(team.title).toBe(input.idea);
		await expect.poll(() => state().openCards.map((c) => c.boundary)).toEqual(['baseline']);
		expect(state().checks).toEqual([
			expect.objectContaining({ actor: 'app', purpose: 'trial', exitCode: 1 }),
		]);
		await native.cli('team', 'baseline', 'confirm', '--team', team.id);
		await expect
			.poll(() => JSON.stringify(nativeRows('dev')).includes('IMPLEMENTATION_READY_FOR_RESTART'))
			.toBe(true);
		await expect.poll(() => events().some((e) => e.kind === 'qa_boundary_restored')).toBe(true);
		const implementing = state().turns.find((turn) => turn.dispatched?.turn === 'work')!;
		expect(implementing.finished).toBeUndefined();
		const beforeQuit = events();
		// Kill Electron before the gated provider exits. Its native result already exists.
		const closed = native.app.waitForEvent('close');
		native.app.process().kill('SIGKILL');
		await closed;
		open = false;
		for (const directory of Object.values(accounts)) {
			const pidFile = path.join(directory, 'fixture-process');
			if (fs.existsSync(pidFile)) {
				try {
					process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL');
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
				}
			}
		}
		await native.start();
		open = true;
		await expect
			.poll(() => state().turns.some((turn) => turn.dispatched?.turn === 'verify'))
			.toBe(true);
		const verifying = state().turns.find((turn) => turn.dispatched?.turn === 'verify')!;
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
		await expect
			.poll(() => state().openCards.map((c) => c.boundary), { timeout: 90_000 })
			.toEqual(['acceptance']);
		await native.cli('team', 'accept', '--team', team.id);
		await expect.poll(() => state().terminal).toBe('all');
		const all = events();
		expect(all.slice(0, beforeQuit.length)).toEqual(beforeQuit);
		expect(new Set(all.map((event) => event.id)).size).toBe(all.length);
		expect(
			all.filter(
				(event) => event.kind === 'turn_finished' && event.dispatchId === implementing.dispatchId
			)
		).toHaveLength(1);
		expect(state().turns.filter((turn) => turn.dispatched?.turn === 'work')).toHaveLength(1);
		expect(
			all.filter((event) => event.kind === 'decision_card').map((event) => event.card.boundary)
		).toEqual(['baseline', 'acceptance']);
		expect(all.filter((event) => event.kind === 'report_repaired')).toHaveLength(2);
		expect(
			all
				.filter((event) => event.kind === 'report_accepted')
				.every((event) => event.actor === event.seat)
		).toBe(true);
		expect(
			state()
				.criteria.flatMap((criterion) => criterion.evidence)
				.every((evidence) => ['app', 'qa'].includes(evidence.source))
		).toBe(true);
		expect(state().issues[0].history.at(-1)?.actor).toBe('qa');
		for (let index = 1; index <= all.length; index++)
			expect(
				Object.values(reduceLedger(all.slice(0, index)).seats).reduce(
					(n, seat) => n + seat.activeDispatchIds.length,
					0
				)
			).toBeLessThanOrEqual(2);
		const qaCwd = state().seats.qa.binding!.workspace;
		expect(fs.existsSync(path.join(qaCwd, 'unauthorized.txt'))).toBe(false);
		expect(fs.readFileSync(path.join(qaCwd, 'qa/sample.txt'), 'utf8')).toBe('bad input\n');
		const prompts = (seat: SeatRole) =>
			nativeRows(seat)
				.filter((row) =>
					seat === 'dev'
						? row.type === 'response_item' && row.payload?.role === 'user'
						: row.type === 'user'
				)
				.map((row) => JSON.stringify(seat === 'dev' ? row.payload?.content : row.message.content));
		expect(prompts('dev').find((text) => text.includes('Turn: challenge.'))).not.toContain(
			'QA_ISOLATED_TEXT'
		);
		expect(prompts('qa').find((text) => text.includes('Turn: challenge.'))).not.toContain(
			'DEV_ISOLATED_TEXT'
		);
		expect(prompts('dev').every((text) => !text.includes(qaCwd))).toBe(true);
		const exported = await native.cli('team', 'export', '--team', team.id);
		expect(JSON.parse(exported).events).toEqual(all);
		const shown = await native.cli('team', 'show', 'events', '--team', team.id);
		expect(shown).toEqual(all);
		const compact = await native.cli('team', 'get', '--team', team.id);
		expect(compact.events.map((event: LedgerEvent) => event.id)).toEqual(
			all.map((event) => event.id)
		);
		for (const event of all) {
			const projected = compact.events.find((item: LedgerEvent) => item.id === event.id);
			if (event.kind === 'turn_dispatched') expect(projected.prompt).toBeUndefined();
			if (event.kind === 'turn_finished') {
				expect(projected.repairTail).toBeUndefined();
				expect(projected.reportError).toBe(event.reportError);
			}
			if (['report_rejected', 'report_normalized', 'member_fault'].includes(event.kind))
				expect(projected).toEqual(event);
		}
		for (const seat of ['pm', 'dev', 'qa'] as const)
			expect(
				await native.page.evaluate(({ id, seat }) => window.maestro.team.seatTranscript(id, seat), {
					id: team.id,
					seat,
				})
			).toMatchObject({ provider: input.seats[seat].tool, nativeSessionId: expect.any(String) });
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (open) await native.close(failed);
	}
});
