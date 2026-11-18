import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { test, expect, type TestInfo } from '@playwright/test';
import { RealAcceptanceApp, acceptanceEnabled } from './fixtures/real-acceptance';
import { readCodexRolloutSync } from '../src/shared/codexRollout';
import { DURATION_MS } from '../src/shared/duration';
import { reduceLedger } from '../src/shared/team/ledger';
import {
	DEFAULT_TEAM_AUTHORIZATIONS,
	SEAT_ROLES,
	type LedgerEvent,
	type TeamConfig,
	type TeamState,
	type TeamStatusView,
} from '../src/shared/team/types';

test.skip(
	!acceptanceEnabled('TEAM'),
	'requires MAESTRO_E2E_REAL=1 and MAESTRO_E2E_TEAM=1 outside CI/smoke'
);
test.describe.configure({ retries: 0 });

// The supplied tests are immutable acceptance contracts, not model-authored evidence.
const smallFiles = {
	'package.json':
		'{"name":"team-clamp","private":true,"scripts":{"test":"node --test --test-reporter=tap clamp.test.cjs"}}\n',
	'clamp.cjs': 'exports.clamp = (value, min, max) => Math.min(max, Math.max(max, value));\n',
	'clamp.test.cjs': `const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clamp } = require('./clamp.cjs');
test('clamp preserves in-range values and includes both bounds', () => {
	for (const [value, min, max, expected] of [
		[5, 0, 10, 5], [-1, 0, 10, 0], [11, 0, 10, 10],
		[0, 0, 10, 0], [10, 0, 10, 10], [-4, -8, -2, -4], [7, 3, 3, 3],
	]) assert.equal(clamp(value, min, max), expected);
});
`,
	'README.md':
		'# Clamp\n\nRun `node --test --test-reporter=tap clamp.test.cjs`. Behaviour documentation is missing.\n',
};

const mediumFiles = {
	'package.json':
		'{"name":"team-calc","private":true,"scripts":{"test":"node --test --test-reporter=tap contract.test.cjs cli.test.cjs"}}\n',
	'numbers.cjs': '// Implement finite decimal operand validation and arithmetic here.\n',
	'cli.cjs': "console.error('Calculator is not implemented');\nprocess.exitCode = 1;\n",
	'cli.test.cjs': '// Add additional node:test coverage without changing contract.test.cjs.\n',
	'usage.txt': 'Usage output has not been captured yet.\n',
	'README.md':
		'# Calculator\n\nA local Node CLI for new users. Implementation and examples are missing.\n',
	'contract.test.cjs': `const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const run = (...args) => spawnSync(process.execPath, ['cli.cjs', ...args], { encoding: 'utf8', timeout: 5000 });
for (const [command, a, b, expected] of [
	['add', '2', '3', '5'], ['add', '-1.5', '2', '0.5'],
	['multiply', '3', '4', '12'], ['multiply', '-2', '0', '0'],
]) test(command + ' ' + a + ' ' + b, () => {
	const result = run(command, a, b);
	assert.equal(result.status, 0);
	assert.equal(result.stdout.trim(), expected);
	assert.equal(result.stderr, '');
});
for (const args of [[], ['divide', '2', '3'], ['add', '2'], ['add', '2', '3', '4'],
	['add', 'nope', '3'], ['multiply', 'Infinity', '2'], ['add', '', '2'], ['add', '0x10', '2'],
]) test('reject ' + JSON.stringify(args), () => {
	const result = run(...args);
	assert.equal(result.status, 2);
	assert.equal(result.stdout, '');
	assert.match(result.stderr, /usage|--help/i);
	assert.doesNotMatch(result.stderr, /at .*\\.cjs:\\d/);
});
test('help is successful, documents both commands, and matches the captured output', () => {
	const result = run('--help');
	assert.equal(result.status, 0);
	assert.equal(result.stderr, '');
	assert.match(result.stdout, /add/);
	assert.match(result.stdout, /multiply/);
	assert.equal(fs.readFileSync('usage.txt', 'utf8'), result.stdout);
});
`,
};

/** Only test policy lives here; ledger projection, report validation and scheduling stay in product. */
/**
 * Seat vendors are configurable so long runs can keep most turns off the owner's
 * Claude 5-hour pool. Both vendors must still hold at least one seat (PRD V-1).
 */
function seatModel(
	tools: Record<string, { model?: string }>,
	role: 'PM' | 'DEV' | 'QA',
	fallback: 'claude-code' | 'codex'
) {
	const tool =
		(process.env[`MAESTRO_E2E_TEAM_${role}`] as 'claude-code' | 'codex' | undefined) ?? fallback;
	return `${tool}:${tool === 'codex' ? tools.codex?.model : tools.claude?.model}`;
}

async function runTeamTask(info: TestInfo, size: 'small' | 'medium') {
	const medium = size === 'medium';
	const turnBudget = medium ? 40 : 20;
	const wallLimitMs = (medium ? 60 : 30) * DURATION_MS.minute;
	const turnLimitMs = 4 * DURATION_MS.minute;
	info.setTimeout(wallLimitMs + 2 * DURATION_MS.minute);
	const startedAt = Date.now();
	const native = new RealAcceptanceApp(info, 'TEAM', ['claude', 'codex']);
	const files = medium ? mediumFiles : smallFiles;
	const checkCommand = medium
		? 'node --test --test-reporter=tap contract.test.cjs cli.test.cjs'
		: 'node --test --test-reporter=tap clamp.test.cjs';
	const changedFiles = medium
		? ['README.md', 'cli.cjs', 'cli.test.cjs', 'numbers.cjs', 'usage.txt']
		: ['README.md', 'clamp.cjs'];
	const interventions: Array<{
		cardId: string;
		boundary: string;
		basis: unknown;
		option: string | null;
		at: number;
		completed: boolean;
	}> = [];
	const observations: Array<{ at: number; status: TeamStatusView }> = [];
	let team: TeamConfig | undefined;
	let events: LedgerEvent[] = [];
	let completed = false;
	let baselineRevision = '';
	let idleSince: number | undefined;
	let previousStatus = '';
	// CLI get is an atomic read through the app's store, not a second ledger reader.
	const refresh = async () => {
		if (team) {
			const data: { config: TeamConfig; events: LedgerEvent[] } = await native.cli(
				'team',
				'get',
				'--team',
				team.id
			);
			events = data.events;
		}
		return reduceLedger(events);
	};
	const gitAt = (cwd: string, ...args: string[]) => native.git('-C', cwd, ...args).trim();
	const checkpoint = () => {
		const state = reduceLedger(events);
		Object.assign(native.evidence, {
			scenario: `team ${size} task`,
			completed,
			turnBudget,
			deadline: null,
			wallLimitMs,
			turnLimitMs,
			thirdVendor: '待补覆盖',
			seats: team?.seats,
			ledger: events,
			turns: state.turns.map(({ dispatchId, seat, dispatched, finished, report, repaired }) => ({
				dispatchId,
				seat,
				kind: dispatched?.turn,
				expectedKind: dispatched?.expectedTurn,
				durationMs: finished?.durationMs ?? null,
				inputTokens: finished?.inputTokens ?? null,
				outputTokens: finished?.outputTokens ?? null,
				costUsd: finished?.costUsd ?? null,
				exitCode: finished?.exitCode ?? null,
				repairOf: dispatched?.repairOf,
				retryOf: dispatched?.retryOf,
				repaired,
				report,
				error: finished?.reportError,
			})),
			ownerInterventions: interventions,
			statusObservations: observations,
			qaIssues: state.issues,
			pmRejections: state.reviews.filter((review) => review.verdict === 'reject'),
			pmReviewRounds: state.reviews,
			recoveries: events.filter((event) => event.kind === 'member_recovered'),
			discussions: state.discussions,
			contestedDecisions: state.decisions.filter((decision) => decision.contested),
			challenges: state.challenges,
			briefResponses: state.briefResponses,
			checks: state.checks,
			statistics: state.statistics,
			usage: state.usage,
			invocations: Object.fromEntries(
				[...native.records.keys()].map((provider) => [provider, native.invocations(provider)])
			),
			totalTokens:
				state.usage.turnsWithTokens === state.usage.turns && state.usage.turns > 0
					? state.usage.inputTokens + state.usage.outputTokens
					: null,
			totalWallTimeMs: Date.now() - startedAt,
		});
		// Durable checkpoints survive a timeout or an Electron crash; no auth files are copied.
		fs.writeFileSync(
			info.outputPath('real-acceptance.json'),
			JSON.stringify(native.evidence, null, 2)
		);
	};
	const assertDelivered = (state: TeamState) => {
		expect(state.criteria.length).toBeGreaterThan(0);
		expect(
			state.criteria.every((criterion) => criterion.confirmed && criterion.status === 'pass')
		).toBe(true);
		expect(state.criteria.some((criterion) => criterion.proof === 'app')).toBe(true);
		expect(state.criteria.some((criterion) => criterion.proof === 'qa')).toBe(true);
		const lastSubmission = events.filter((event) => event.kind === 'workspace_submitted').at(-1)!;
		expect(lastSubmission).toBeDefined();
		const lastCheck = state.checks
			.filter((check) => check.command === checkCommand && check.purpose === 'verification')
			.at(-1);
		expect(lastCheck).toMatchObject({
			actor: 'app',
			exitCode: 0,
			cwd: state.seats.dev.binding!.workspace,
			batchId: `submit:${lastSubmission.dispatchId}`,
		});
		expect(lastCheck!.evidenceId).toBeTruthy();
		expect(lastCheck!.timedOut).toBeFalsy();
		expect(lastCheck!.notRun).toBeFalsy();
		expect(lastCheck!.outputTail).toMatch(/# fail 0/);
		expect(
			state.turns.some(
				(turn) =>
					turn.seat === 'qa' &&
					(turn.report?.type === 'verify' || turn.report?.type === 'reverify') &&
					turn.finished!.seq > lastSubmission.seq
			)
		).toBe(true);
		expect(
			state.issues.every(
				(issue) => issue.state === 'verified-pass' && issue.history.at(-1)?.actor === 'qa'
			)
		).toBe(true);
		expect(state.reviews.at(-1)).toMatchObject({ actor: 'pm', verdict: 'pass' });
		expect(state.reviews.at(-1)!.seq).toBeGreaterThan(lastCheck!.seq);
		if (medium) {
			const experience = state.criteria.filter(
				(criterion) => criterion.proof === 'pm' && criterion.experience
			);
			expect(experience.length).toBeGreaterThan(0);
			const output = state.outputs.at(-1)!;
			const usageFile = path.join(state.seats.dev.binding!.workspace, 'usage.txt');
			expect(output.files).toContain(usageFile);
			const usage = fs.readFileSync(usageFile, 'utf8');
			const help = state.checks
				.filter(
					(check) => check.command === 'node cli.cjs --help' && check.purpose === 'verification'
				)
				.at(-1)!;
			expect(help).toMatchObject({ actor: 'app', exitCode: 0, batchId: lastCheck!.batchId });
			expect(help.outputTail.trim()).toBe(usage.trim());
			const review = state.turns.filter((turn) => turn.report?.type === 'review').at(-1)!;
			expect(review.finished!.message).toContain(usage.split('\n').find((line) => line.trim())!);
			for (const criterion of experience)
				expect(criterion.evidence).toContainEqual(
					expect.objectContaining({ source: 'pm', status: 'pass', evidence: output.outputId })
				);
		}
	};
	try {
		native.initRepo(files);
		// Hook isolation must persist for product-owned Git commands, too.
		native.git('config', 'core.hooksPath', path.join(native.root, 'no-hooks'));
		baselineRevision = native.git('rev-parse', 'HEAD').trim();
		const initial = spawnSync(process.execPath, checkCommand.split(' ').slice(1), {
			cwd: native.project,
			env: { ...process.env, ...native.env },
			encoding: 'utf8',
			timeout: 10_000,
		});
		native.evidence.initialCheck = {
			command: checkCommand,
			exitCode: initial.status,
			stdout: initial.stdout,
			stderr: initial.stderr,
		};
		expect(initial.error).toBeUndefined();
		expect(initial.status).toBe(1);
		native.evidence.artifact = {
			sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
			version: JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
			node: process.version,
			files: Object.fromEntries(
				['dist/main/index.js', 'dist/cli/maestro-cli.js'].map((file) => [
					file,
					createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
				])
			),
		};
		const budgetDirectory = path.join(native.root, 'paid-launches');
		fs.mkdirSync(budgetDirectory);
		const configs: Record<string, unknown> = {};
		for (const provider of ['claude', 'codex'] as const) {
			const record = path.join(native.root, `${provider}-requests.jsonl`);
			const control = `${record}.control`;
			fs.writeFileSync(
				control,
				JSON.stringify({ record, maxInvocations: turnBudget, budgetDirectory })
			);
			native.records.set(provider, record);
			// CLI team start has no seat custom-path flags. Configure providers before launch.
			// The shim also serves discovery probes, which do not receive provider custom env.
			const shim = path.join(native.root, `team-${provider}`);
			fs.writeFileSync(
				shim,
				`#!${process.execPath}\nObject.assign(process.env, ${JSON.stringify({
					MAESTRO_E2E_CLI: native.tools[provider].executable,
					MAESTRO_E2E_CONTROL: control,
					MAESTRO_E2E_PROCESS: `${record}.pid`,
				})});\nrequire(${JSON.stringify(path.resolve('e2e/fixtures/native/real-cli'))});\n`,
				{ mode: 0o700 }
			);
			configs[provider === 'claude' ? 'claude-code' : 'codex'] = {
				customPath: shim,
				...(provider === 'claude' ? { customArgs: '--max-turns 8' } : {}),
				customEnvVars: {
					CLAUDE_CONFIG_DIR: native.claude,
					CODEX_HOME: native.codex,
					HOME: native.syntheticHome,
				},
			};
		}
		fs.writeFileSync(
			path.join(native.data, 'maestro-agent-configs.json'),
			JSON.stringify({ configs })
		);
		checkpoint();
		await native.start();
		const idea = [
			medium
				? 'Build a small calculator CLI with add and multiply commands, exactly two finite decimal operands, input validation, helpful errors and --help. Follow contract.test.cjs: valid calls print only the result with exit 0; invalid calls print guidance to stderr with exit 2 and no stack trace. Put parsing/arithmetic in numbers.cjs and the CLI in cli.cjs. Add meaningful tests to cli.test.cjs and document commands, examples and errors in README.md. Capture the actual node cli.cjs --help stdout verbatim in usage.txt. Product judgement: the usage message must be clear to a new user, with copyable examples and an understandable recovery from bad input. PM must judge the actual usage.txt output, quote its first nonempty line in review prose, and explain the judgement; passing tests alone is insufficient.'
				: 'Fix the bug so the test passes and document the behaviour in the README. clamp(value, min, max) must preserve in-range values and clamp values outside the inclusive bounds. Inputs are finite numbers with min <= max; validation of other inputs is out of scope. Change only clamp.cjs and README.md in the developer worktree.',
			`Use an app-proof criterion checked by exactly ${checkCommand}. Keep the supplied contract tests and package.json unchanged. Include a QA-proof criterion for independent boundary cases and documentation accuracy.`,
			...(medium
				? [
						'Include a PM-proof experience criterion (experience: true) for new-user clarity. Also propose the app-run command node cli.cjs --help so the ledger captures real output.',
					]
				: []),
			'Work only in the assigned task worktrees, no dependencies, network, delegation, account inspection, push or PR. The temporary repository has no remote. QA may write independent tests only under qa/ in its own worktree. Keep each reply concise; use at most eight tool calls per turn. The app owns all scheduling, checks and owner cards. Never invoke team mutations or ask the owner to nudge the team.',
		].join('\n');
		team = await native.cli(
			'team',
			'start',
			'--path',
			native.project,
			'--idea',
			idea,
			'--pm',
			seatModel(native.tools, 'PM', 'claude-code'),
			'--dev',
			seatModel(native.tools, 'DEV', 'codex'),
			'--qa',
			seatModel(native.tools, 'QA', 'claude-code'),
			'--turns',
			String(turnBudget),
			'--allow',
			'checks,push,pr,temp'
		);
		expect(team).toMatchObject({ turnBudget, authorizations: DEFAULT_TEAM_AUTHORIZATIONS });
		expect(team!.deadline).toBeUndefined();
		while (Date.now() - startedAt < wallLimitMs) {
			// NativeApp.cli appends --json. This poll never sends a model prompt.
			const status: TeamStatusView = await native.cli('team', 'status', '--team', team!.id);
			const state = await refresh();
			const serialized = JSON.stringify(status);
			if (serialized !== previousStatus) {
				observations.push({ at: Date.now(), status });
				previousStatus = serialized;
			}
			checkpoint();
			expect(state.usage.turns).toBeLessThanOrEqual(turnBudget);
			for (const turn of state.turns.filter((turn) => turn.dispatched && !turn.finished))
				expect(
					Date.now() - turn.dispatched!.at,
					`Seat ${turn.seat} exceeded the bounded turn time`
				).toBeLessThan(turnLimitMs);
			if (status.terminal) {
				expect(status.terminal).toBe('all');
				break;
			}
			for (const card of status.openCards) {
				expect(interventions.some((entry) => entry.cardId === card.id)).toBe(false);
				const intervention = {
					cardId: card.id,
					boundary: card.boundary,
					basis: { card, budget: status.budget },
					option: null as string | null,
					at: Date.now(),
					completed: false,
				};
				interventions.push(intervention);
				checkpoint();
				if (card.boundary === 'baseline') {
					expect(state.brief!.checks.map((check) => check.command)).toContain(checkCommand);
					for (const proof of medium ? ['app', 'qa', 'pm'] : ['app', 'qa'])
						expect(state.brief!.criteria.some((criterion) => criterion.proof === proof)).toBe(true);
					if (medium) {
						expect(
							state.brief!.criteria.some(
								(criterion) => criterion.proof === 'pm' && criterion.experience
							)
						).toBe(true);
						expect(state.brief!.checks.map((check) => check.command)).toContain(
							'node cli.cjs --help'
						);
					}
					expect(state.checks).toContainEqual(
						expect.objectContaining({
							command: checkCommand,
							purpose: 'trial',
							actor: 'app',
							exitCode: 1,
							batchId: `trial:${state.brief!.version}`,
						})
					);
					intervention.option = 'confirm';
					await native.cli('team', 'baseline', 'confirm', '--team', team!.id);
				} else if (card.boundary === 'acceptance') {
					assertDelivered(state);
					intervention.option = 'accept';
					await native.cli('team', 'accept', '--team', team!.id);
				} else {
					// No scope/model/login/permission change is needed by these closed local tasks.
					// A real budget crossing is recorded and stopped, never enlarged or accepted with gaps.
					expect(
						card.boundary,
						'Unexpected owner boundary; inspect the recorded card and ledger'
					).toBe('budget');
					expect(status.budget.exhausted).toBe(true);
					expect(status.budget.turnsUsed).toBeGreaterThanOrEqual(turnBudget);
					intervention.option = 'stop';
					await native.cli('team', 'answer', card.id, 'stop', '--team', team!.id);
				}
				intervention.completed = true;
				checkpoint();
			}
			// waitingFor also contains a synthetic "Scheduler to wake the PM" message.
			// Only registered waits or quota waits count; that placeholder must not hide a stall.
			const working = status.seats.some((seat) => seat.status === 'working');
			const waiting =
				state.followUps.length > 0 || status.seats.some((seat) => seat.status === 'waiting');
			if (!working && !waiting && !status.openCards.length) {
				idleSince ??= Date.now();
				expect(
					Date.now() - idleSince,
					'Scheduler bug: no working seat, registered wait or owner card for two minutes'
				).toBeLessThan(2 * DURATION_MS.minute);
			} else idleSince = undefined;
			await delay(2_000);
		}
		const state = await refresh();
		expect(state.terminal, 'Team must finish within the wall-time and turn budgets').toBe('all');
		assertDelivered(state);
		const cards = events.filter((event) => event.kind === 'decision_card');
		expect(cards.map((event) => event.card.id)).toEqual(interventions.map((entry) => entry.cardId));
		expect(
			interventions
				.filter((entry) => ['baseline', 'acceptance'].includes(entry.boundary))
				.map((entry) => entry.boundary)
		).toEqual(['baseline', 'acceptance']);
		expect(state.cardAnswers.map((answer) => [answer.cardId, answer.optionId])).toEqual(
			interventions.map((entry) => [entry.cardId, entry.option])
		);
		expect(events.filter((event) => event.kind === 'owner_message')).toEqual([]);
		expect(state.statistics).toEqual({
			ownerDecisions: interventions.length,
			discussions: events.filter((event) => event.kind === 'discussion_opened').length,
			rejections: events.filter((event) => event.kind === 'review' && event.verdict === 'reject')
				.length,
			retros: events.filter((event) => event.kind === 'retro').length,
			recoveries: events.filter((event) => event.kind === 'member_recovered').length,
			turns: events.filter((event) => event.kind === 'turn_dispatched').length,
		});
		expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
		expect(state.turns.every((turn) => !!turn.finished)).toBe(true);
		const status: TeamStatusView = await native.cli('team', 'status', '--team', team!.id);
		expect(status.usage).toEqual(state.usage);
		for (const seat of status.seats) expect(seat.usage).toEqual(state.seats[seat.seat].usage);
		const requests = [...native.records.keys()].flatMap((provider) =>
			native.invocations(provider).map((invocation) => ({ provider, ...invocation }))
		);
		expect(requests).toHaveLength(state.usage.turns);
		for (const seat of SEAT_ROLES) {
			const provider = seat === 'dev' ? 'codex' : 'claude';
			const binding = state.seats[seat].binding!;
			const launches = requests.filter(
				(request) => request.provider === provider && request.cwd === binding.workspace
			);
			expect(launches).toHaveLength(state.seats[seat].usage.turns);
			for (const launch of launches) {
				const modelFlag = provider === 'codex' ? '-m' : '--model';
				expect(launch.args).toContain(modelFlag);
				expect(launch.args[launch.args.indexOf(modelFlag) + 1]).toBe(native.tools[provider].model);
				if (provider === 'claude') {
					expect(launch.args[launch.args.indexOf('--max-turns') + 1]).toBe('8');
					if (seat === 'pm')
						expect(launch.args[launch.args.indexOf('--permission-mode') + 1]).toBe('plan');
				}
			}
		}
		const dev = state.seats.dev.binding!.workspace;
		const qa = state.seats.qa.binding!.workspace;
		expect(gitAt(native.project, 'rev-parse', 'HEAD')).toBe(baselineRevision);
		expect(gitAt(native.project, 'status', '--porcelain', '--untracked-files=all')).toBe('');
		expect(gitAt(dev, 'branch', '--show-current')).toBe(`team/${team!.id}`);
		expect(gitAt(dev, 'status', '--porcelain', '--untracked-files=all')).toBe('');
		expect(gitAt(dev, 'diff', '--name-only', baselineRevision, 'HEAD').split('\n').sort()).toEqual(
			changedFiles
		);
		for (const [file, content] of Object.entries(files))
			if (!changedFiles.includes(file))
				expect(fs.readFileSync(path.join(dev, file), 'utf8')).toBe(content);
		expect(gitAt(qa, 'rev-parse', 'HEAD')).toBe(gitAt(dev, 'rev-parse', 'HEAD'));
		expect(gitAt(qa, 'branch', '--show-current')).toBe('');
		expect(gitAt(qa, 'diff', 'HEAD', '--', '.', ':!qa')).toBe('');
		expect(
			gitAt(qa, 'ls-files', '--others', '--exclude-standard')
				.split('\n')
				.filter(Boolean)
				.every((file) => file.startsWith('qa/'))
		).toBe(true);
		native.checked(
			'App-run check passes on the submitted dev revision; QA verified; PM reviewed actual output.'
		);
		native.checked(
			'CLI-only owner cards, no nudges, bounded launches, ledger statistics and isolated branch diff verified.'
		);
		completed = true;
	} catch (error) {
		native.evidence.failure = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		// Keep the tested path's ledger separate from the cleanup stop event,
		// but retain the canceled turns' final usage receipts when available.
		try {
			if (team) {
				try {
					await refresh();
					checkpoint();
					if (!completed && !reduceLedger(events).terminal) {
						const beforeCleanup = events.at(-1)?.seq ?? 0;
						await native.cli('team', 'stop', '--team', team.id);
						const cleanupDeadline = Date.now() + 10_000;
						while (Date.now() < cleanupDeadline) {
							const stopped = await refresh();
							if (SEAT_ROLES.every((seat) => !stopped.seats[seat].activeDispatchIds.length)) break;
							await delay(250);
						}
						native.evidence.cleanup = events.filter(
							(event) => event.seq > beforeCleanup && event.kind === 'stopped'
						);
						events = events.filter(
							(event) => event.seq <= beforeCleanup || event.kind !== 'stopped'
						);
					}
				} catch (error) {
					native.evidence.collectionError = String(error);
				}
			}
			const state = reduceLedger(events);
			native.evidence.transcripts = [];
			for (const seat of SEAT_ROLES) {
				const binding = state.seats[seat].binding;
				if (!binding?.nativeSessionId) continue;
				const provider = seat === 'dev' ? 'codex' : 'claude';
				for (const file of native
					.files(provider)
					.filter((file) => path.basename(file).includes(binding.nativeSessionId!))) {
					const rows = (
						provider === 'codex' ? readCodexRolloutSync(file) : fs.readFileSync(file, 'utf8')
					)
						.split('\n')
						.filter(Boolean)
						.map((line) => JSON.parse(line));
					(native.evidence.transcripts as unknown[]).push({
						seat,
						provider,
						file,
						nativeId: binding.nativeSessionId,
						rows: rows.length,
						models: [
							...new Set(
								rows
									.map(
										(row) =>
											row.message?.model ??
											(row.type === 'turn_context' ? row.payload?.model : undefined)
									)
									.filter(Boolean)
							),
						],
					});
				}
			}
			const dev = state.seats.dev.binding?.workspace;
			if (dev && fs.existsSync(dev))
				native.evidence.diff = gitAt(dev, 'diff', baselineRevision, '--', '.');
		} catch (error) {
			native.evidence.collectionError = String(error);
		} finally {
			try {
				checkpoint();
			} finally {
				await native.finish(completed);
			}
		}
	}
}

// eslint-disable-next-line no-empty-pattern
test('team small task', async ({}, info) => runTeamTask(info, 'small'));

// eslint-disable-next-line no-empty-pattern
test('team medium task', async ({}, info) => runTeamTask(info, 'medium'));
