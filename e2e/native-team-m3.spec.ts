import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect, type TestInfo } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { teamM2Brief } from './fixtures/native/team-m2.cjs';
import { reduceLedger } from '../src/shared/team/ledger';
import { decideNext, judgeAttempts, type AttemptInput } from '../src/shared/progressRules';
import {
	DEFAULT_TEAM_AUTHORIZATIONS,
	type CreateTeamInput,
	type LedgerEvent,
	type TeamConfig,
} from '../src/shared/team/types';
import type { FollowUp } from '../src/shared/followUp';

test.skip(process.env.MAESTRO_E2E_REAL === '1', 'M3 uses synthetic seats only, never paid models');

async function fixture(info: TestInfo, scenario: string, turns = 200) {
	const native = new NativeApp(info, { providerCli: false });
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: native.project, encoding: 'utf8' });
	git('init');
	git('config', 'user.name', 'M3 synthetic fixture');
	git('config', 'user.email', 'm3@example.invalid');
	git('config', 'commit.gpgsign', 'false');
	git('config', 'core.hooksPath', path.join(native.root, 'no-hooks'));
	fs.writeFileSync(path.join(native.project, 'result.html'), '<html><body>Initial</body></html>');
	fs.writeFileSync(path.join(native.project, 'other.html'), '<html><body>Initial</body></html>');
	fs.writeFileSync(
		path.join(native.project, 'check.cjs'),
		"console.log('# tests 1\\n# skipped 0'); process.exit(require('node:fs').readFileSync('result.html','utf8').includes('<h1>implemented</h1>') ? 0 : 1);\n"
	);
	git('add', '.');
	git('commit', '-m', 'Synthetic M3 project');
	const gate = path.join(native.root, 'release-m3');
	const seats = Object.fromEntries(
		['pm', 'dev', 'qa'].map((seat) => {
			const tool = seat === 'dev' ? 'codex' : 'claude-code';
			const account = path.join(native.root, `${seat}-account`);
			const script = path.join(native.root, `${seat}-script.json`);
			fs.mkdirSync(account);
			fs.writeFileSync(
				script,
				JSON.stringify({ teamM3: { seat, scenario, gate, brief: teamM2Brief } })
			);
			return [
				seat,
				{
					tool,
					model: tool === 'codex' ? 'gpt-5.3-codex' : 'claude-sonnet-4-6',
					customPath: path.resolve(`e2e/fixtures/native/${tool === 'codex' ? 'codex' : 'claude'}`),
					customEnv: {
						[tool === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']: account,
						MAESTRO_NATIVE_SCRIPT: script,
					},
				},
			];
		})
	) as unknown as CreateTeamInput['seats'];
	if (scenario === 'quota-substitute')
		seats.pm.substitute = { tool: seats.dev.tool, model: seats.dev.model };
	await native.start();
	const team: TeamConfig = await native.page.evaluate(
		(input) => window.maestro.team.create(input),
		{
			idea: `M3 ${scenario}`,
			projectRoot: native.project,
			seats,
			turnBudget: turns,
			authorizations: {
				...DEFAULT_TEAM_AUTHORIZATIONS,
				temporaryTakeover: ['quota-temporary', 'login-expired'].includes(scenario),
			},
		}
	);
	const file = path.join(native.data, 'teams', team.id, 'ledger.jsonl');
	const events = (): LedgerEvent[] =>
		fs
			.readFileSync(file, 'utf8')
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((row) => JSON.parse(row));
	const state = () => reduceLedger(events());
	const cli = (...args: string[]) => native.cli('team', ...args, '--team', team.id);
	const confirm = async () => {
		await expect
			.poll(() => state().openCards.some((c) => c.boundary === 'baseline'), { timeout: 90_000 })
			.toBe(true);
		await cli('baseline', 'confirm');
	};
	// Only mutate stopped fixture persistence to advance a clock or reproduce a crash boundary.
	const restartWith = async (
		change: (rows: LedgerEvent[]) => void,
		waits?: (records: FollowUp[]) => void
	) => {
		await native.close();
		const rows = events();
		change(rows);
		fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
		if (waits) {
			const waitFile = path.join(native.data, 'follow-ups.json');
			const records: FollowUp[] = JSON.parse(fs.readFileSync(waitFile, 'utf8'));
			waits(records);
			fs.writeFileSync(waitFile, JSON.stringify(records));
		}
		await native.start();
	};
	return { native, team, gate, events, state, cli, confirm, restartWith };
}

for (const scenario of ['quota-wait', 'quota-substitute', 'quota-temporary'] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`M3 T14 T21 priority 0: PM review refusal -> ${scenario}`, async ({}, info) => {
		test.setTimeout(180_000);
		const f = await fixture(info, scenario);
		try {
			await f.confirm();
			await expect.poll(() => f.state().unavailable.length, { timeout: 90_000 }).toBeGreaterThan(0);
			const failed = f.state().turns.find((t) => t.finished?.failureKind === 'model-unavailable')!;
			expect(failed.dispatched?.turn).toBe('review');
			expect(failed.finished?.reportError).toContain('resets 11:10pm');
			const original = failed.dispatched!.binding!;
			const queued = await f.cli('say', 'Queued question for PM');
			expect(queued).toMatchObject({ status: 'queued', to: 'pm', messageId: expect.any(String) });
			if (scenario === 'quota-wait') {
				await expect.poll(() => f.state().followUps.some((w) => !!w.unavailabilityId)).toBe(true);
				for (let index = 0; index < 4; index++) {
					await f.cli('resume');
					expect((await f.cli('status')).generatedBy).toBe('app');
				}
				expect(f.state().turns.filter((t) => t.dispatched!.seq > failed.finished!.seq)).toEqual([]);
				expect(f.state().pendingMessages).toHaveLength(1);
				expect(f.state().openCards).toEqual([]);
				await f.restartWith((rows) => {
					for (const row of rows) if (row.kind === 'quota_exhausted') row.resetsAt = Date.now() - 1;
				});
			} else {
				await expect
					.poll(() => f.events().some((e) => e.kind === 'substitute_took_over'))
					.toBe(true);
				const takeover = f
					.events()
					.find(
						(e) => e.kind === 'seat_bound' && ['substitute', 'temporary'].includes(e.reason ?? '')
					)!;
				expect(takeover.kind === 'seat_bound' && takeover.nativeSessionId).toBeUndefined();
				expect(f.events().some((e) => e.kind === 'workspace_inspected')).toBe(true);
				if (scenario === 'quota-substitute') expect(f.state().seats.pm.model?.tool).toBe('codex');
			}
			await expect
				.poll(() => f.state().openCards.some((c) => c.boundary === 'acceptance'), {
					timeout: 90_000,
				})
				.toBe(true);
			await expect
				.poll(
					() => f.state().messages.find((m) => m.message.messageId === queued.messageId)?.handled
				)
				.toBeDefined();
			const premature = f
				.state()
				.turns.filter(
					(t) =>
						t.dispatched!.seq > failed.finished!.seq &&
						t.dispatched!.at < failed.finished!.resetsAt! &&
						t.dispatched!.binding?.nativeSessionId === original.nativeSessionId &&
						t.finished?.failureKind === 'model-unavailable'
				);
			expect(premature).toEqual([]);
			expect(f.state().usage.budgetTurns).toBe(f.state().usage.turns);
			await f.cli('accept');
			expect(f.state().terminal).toBe('all');
			const cost = await f.cli('show', 'cost');
			expect(cost.statistics.ownerDecisions).toBe(2);
			expect(cost.seats.pm.turns).toBeGreaterThan(0);
			expect(cost.wallTimeMs).toBeGreaterThan(0);
		} finally {
			await f.native.close(test.info().status !== test.info().expectedStatus);
		}
	});
}

for (const fault of [
	'still-working',
	'turn-failed',
	'missing-report',
	'bad-report',
	'session-broken',
	'login-expired',
	'idle-turn',
] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`M3 T21 member state ${fault}`, async ({}, info) => {
		test.setTimeout(180_000);
		const f = await fixture(info, fault);
		try {
			await f.confirm();
			if (fault === 'still-working') {
				await expect
					.poll(() => f.state().turns.some((t) => t.dispatched?.turn === 'review' && !t.finished), {
						timeout: 90_000,
					})
					.toBe(true);
				expect(f.state().seats.pm.faultActive).toBe(false);
				fs.writeFileSync(f.gate, 'release');
			} else {
				await expect
					.poll(() => f.events().some((e) => e.kind === 'member_fault' && e.fault === fault), {
						timeout: 90_000,
					})
					.toBe(true);
				if (fault === 'idle-turn') {
					await expect
						.poll(() => f.state().discussions.some((d) => d.opened?.trigger === 'no-progress'))
						.toBe(true);
					expect(f.state().openCards).toEqual([]);
					return;
				}
				if (fault === 'login-expired') {
					await expect
						.poll(() => f.state().openCards.some((c) => c.boundary === 'login'))
						.toBe(true);
					expect(f.state().openCards.find((c) => c.boundary === 'login')!.body).toContain(
						'claude-code'
					);
					await expect.poll(() => f.state().seats.pm.takeover).toBe('temporary');
				}
			}
			await expect
				.poll(() => f.state().openCards.some((c) => c.boundary === 'acceptance'), {
					timeout: 90_000,
				})
				.toBe(true);
			if (fault === 'missing-report' || fault === 'bad-report') {
				const repair = f.state().turns.filter((t) => t.dispatched?.repairOf);
				expect(repair).toHaveLength(1);
				// NativeApp.cli already parses stdout; show prompt returns a JSON string.
				const prompt: string = await f.cli('show', 'prompt', repair[0].dispatchId);
				expect(typeof prompt).toBe('string');
				expect(prompt).toContain('Do not redo work');
			}
			if (fault === 'turn-failed' || fault === 'session-broken') {
				const retry = f.state().turns.find((t) => t.dispatched?.retryOf)!;
				expect(retry.dispatched!.note).toContain('may have done part');
				expect(
					f
						.events()
						.some((e) => e.kind === 'workspace_inspected' && e.dispatchId === retry.dispatchId)
				).toBe(true);
				if (fault === 'session-broken')
					expect(retry.dispatched!.binding?.nativeSessionId).toBeUndefined();
			}
		} finally {
			await f.native.close(test.info().status !== test.info().expectedStatus);
		}
	});
}

// eslint-disable-next-line no-empty-pattern
test('M3 T11 normal 20-minute wait, unchanged lower-frequency polls and pause/resume', async ({}, info) => {
	test.setTimeout(240_000);
	const f = await fixture(info, 'wait');
	try {
		await f.confirm();
		await expect
			.poll(() => f.state().followUps.some((w) => w.seat === 'dev'), { timeout: 60_000 })
			.toBe(true);
		for (let index = 0; index < 3; index++) {
			await f.cli('pause');
			const turns = f.state().turns.length;
			await f.restartWith(
				() => {},
				(records) => {
					for (const wait of records.filter(
						(w) => w.state === 'pending' && w.target.kind === 'team' && w.target.seat === 'dev'
					)) {
						wait.createdAt = Date.now() - wait.waitLimitMs - 1;
						wait.condition = { kind: 'time', at: Date.now() - 1 };
					}
				}
			);
			await expect
				.poll(
					() =>
						f
							.events()
							.filter((e) => e.kind === 'follow_up_fired' && e.result.includes('observedAt')).length
				)
				.toBeGreaterThanOrEqual(index + 1);
			expect(f.state().turns).toHaveLength(turns);
			await f.cli('resume');
			await expect
				.poll(() => f.events().filter((e) => e.kind === 'wait_handled').length)
				.toBe(index + 1);
			expect(f.state().problems).toEqual({});
			expect(f.state().openCards).toEqual([]);
			const wait = f.state().followUps.find((w) => w.seat === 'dev')!;
			expect(wait.untilMs! - wait.at).toBe(10 * 60_000);
		}
	} finally {
		await f.native.close(test.info().status !== test.info().expectedStatus);
	}
});

for (const limit of ['deadline', 'turns'] as const) {
	for (const terminal of ['gaps', 'stopped'] as const) {
		// eslint-disable-next-line no-empty-pattern
		test(`M3 T16 T22 ${limit}: app report, extend, ${terminal} statistics`, async ({}, info) => {
			test.setTimeout(180_000);
			const f = await fixture(info, 'wait');
			try {
				await f.confirm();
				await expect
					.poll(() => f.state().followUps.some((w) => w.seat === 'dev'), { timeout: 60_000 })
					.toBe(true);
				await f.cli('pause');
				await f.restartWith((rows) => {
					const created = rows.find((e) => e.kind === 'team_created')!;
					if (created.kind !== 'team_created') throw new Error('Missing fixture config');
					if (limit === 'deadline') created.config.deadline = Date.now() - 1;
					else created.config.turnBudget = reduceLedger(rows).usage.budgetTurns;
				});
				await expect
					.poll(() => f.state().openCards.some((c) => c.boundary === 'budget'))
					.toBe(true);
				const used = f.state().usage.turns;
				expect(f.state().openCards[0].body).toContain('not a completion demo');
				await f.cli('extend', '--hours', '1', '--turns', '10');
				expect(f.state().usage.turns).toBe(used);
				expect(f.state().openCards).toEqual([]);
				// A second exhausted boundary after extension has its own durable report.
				await f.restartWith((rows) => {
					const extension = rows.findLast((e) => e.kind === 'budget_extended')!;
					if (extension.kind === 'budget_extended') extension.deadline = Date.now() - 1;
				});
				await expect
					.poll(() => f.state().openCards.some((c) => c.boundary === 'budget'))
					.toBe(true);
				if (terminal === 'gaps') await f.cli('accept', '--with-gaps');
				else await f.cli('stop');
				expect(f.state().terminal).toBe(terminal);
				expect(f.state().criteria.some((c) => c.status !== 'pass')).toBe(true);
				expect((await f.cli('show', 'cost')).statistics.ownerDecisions).toBe(3);
				if (terminal === 'gaps')
					expect(f.state().residualItems.every((r) => r.owner === null)).toBe(true);
				expect(f.state().usage.turns).toBe(used);
			} finally {
				await f.native.close(test.info().status !== test.info().expectedStatus);
			}
		});
	}
}

// eslint-disable-next-line no-empty-pattern
test('M3 T17 restart inspects interrupted external effects and reconciles the exact dispatch', async ({}, info) => {
	test.setTimeout(180_000);
	const f = await fixture(info, 'restart');
	try {
		await f.confirm();
		await expect
			.poll(() => f.state().turns.some((t) => t.dispatched?.turn === 'work' && !t.finished))
			.toBe(true);
		const work = f.state().turns.find((t) => t.dispatched?.turn === 'work')!;
		await expect
			.poll(() =>
				fs.readFileSync(path.join(work.dispatched!.binding!.workspace, 'result.html'), 'utf8')
			)
			.toContain('implemented');
		expect(f.state().turns.find((t) => t.dispatchId === work.dispatchId)?.finished).toBeUndefined();
		// Interrupt before the logical completion event. Closing normally can drain
		// the provider and finish the turn, which would not exercise recovery.
		const closed = f.native.app.waitForEvent('close');
		f.native.app.process().kill('SIGKILL');
		await closed;
		for (const seat of ['pm', 'dev', 'qa'] as const) {
			const pidFile = path.join(f.native.root, `${seat}-account`, 'fixture-process');
			if (!fs.existsSync(pidFile)) continue;
			try {
				process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
			}
		}
		fs.writeFileSync(f.gate, 'release');
		await f.native.start();
		await expect
			.poll(() => f.state().turns.find((t) => t.dispatchId === work.dispatchId)?.report?.type)
			.toBe('work');
		expect(
			f.events().filter((e) => e.kind === 'turn_dispatched' && e.dispatchId === work.dispatchId)
		).toHaveLength(1);
		expect(
			f.events().some((e) => e.kind === 'workspace_inspected' && e.dispatchId === work.dispatchId)
		).toBe(true);
		const inspection = f
			.events()
			.find((e) => e.kind === 'workspace_inspected' && e.dispatchId === work.dispatchId)!;
		expect(inspection.kind === 'workspace_inspected' && inspection.status).toContain('result.html');
	} finally {
		await f.native.close(test.info().status !== test.info().expectedStatus);
	}
});

// eslint-disable-next-line no-empty-pattern
test('M3 T11 three persisted no-progress attempts include a reworded repeat and force PM diagnosis', async ({}, info) => {
	test.setTimeout(180_000);
	const f = await fixture(info, 'no-progress');
	try {
		await expect
			.poll(() => f.state().openCards.some((c) => c.boundary === 'baseline'), { timeout: 90_000 })
			.toBe(true);
		await f.cli('pause');
		await f.restartWith((rows) => {
			for (let index = 0; index < 3; index++)
				rows.push({
					id: `synthetic-attempt:${index}`,
					at: Date.now(),
					seq: rows.length + 1,
					actor: 'app',
					kind: 'attempt',
					problemId: 'checks',
					initialFailures: ['synthetic-check'],
					attempt: {
						id: `synthetic-attempt:${index}`,
						category: ['locate', 'experiment', 'change'][index],
						plan: `Different wording ${index}`,
						basis: 'Synthetic persisted app observation',
						difference: 'No observed improvement',
						expectation: 'The check should pass',
						fingerprint: index === 1 ? 'change:0' : `change:${index}`,
						failures: ['synthetic-check'],
					},
				});
		});
		await f.cli('baseline', 'confirm');
		await f.cli('resume');
		await expect
			.poll(() => f.state().discussions.some((d) => d.opened?.trigger === 'no-progress'), {
				timeout: 90_000,
			})
			.toBe(true);
		expect(
			f
				.state()
				.problems.checks.progress.attempts.slice(0, 3)
				.map((a) => a.verdict)
		).toEqual(['first', 'dup', 'none']);
		expect(f.state().openCards).toEqual([]);
		expect(f.state().turns.filter((t) => t.dispatched?.turn === 'work')).toHaveLength(1);
	} finally {
		await f.native.close(test.info().status !== test.info().expectedStatus);
	}
});

test('M3 T11 T23 identical decision rules for fix, team problem and PM review', async () => {
	for (const context of ['fix', 'team', 'review']) {
		const attempts: AttemptInput[] = ['locate', 'experiment', 'change', 'split'].map(
			(category, i) => ({
				id: `${context}:${i}`,
				category,
				fingerprint: `change:${i}`,
				failures: ['E'],
				evidence: [`observed:${i}`],
			})
		);
		const current = judgeAttempts(['E'], attempts);
		expect(
			decideNext(current, {
				candidates: [
					{
						plan: 'Inspect the actual output',
						basis: 'A new reproduction exists',
						fingerprint: 'new',
					},
				],
			}).kind
		).toBe('continue');
		const repeated = judgeAttempts(
			['E'],
			[
				...attempts,
				{ ...attempts[3], id: 'reworded', plan: 'A differently worded plan', evidence: [] },
			]
		);
		expect(repeated.attempts.at(-1)!.verdict).toBe('dup');
		expect(
			decideNext(repeated, {
				candidates: [{ plan: 'Again', basis: 'Reworded', fingerprint: 'change:3' }],
			}).kind
		).toBe('gather');
		const boundaries = [
			{
				plan: 'Use an unapproved model',
				boundary: 'model' as const,
				cost: 'New paid model',
				recommended: true,
			},
			{ plan: 'Change a commitment', boundary: 'commitment' as const, cost: 'Reduced deliverable' },
		];
		expect(decideNext(repeated, { candidates: boundaries })).toMatchObject({
			kind: 'escalate',
			boundaries: ['model', 'commitment'],
		});
		expect(
			decideNext(repeated, { candidates: boundaries, budget: { used: 10, total: 10 } })
		).toEqual({ kind: 'report', boundaries: ['budget'] });
		const stagnant = judgeAttempts(
			['E'],
			[0, 1, 2].map((i) => ({
				id: String(i),
				fingerprint: i === 1 ? 'same' : i === 0 ? 'same' : 'other',
				failures: ['E'],
			}))
		);
		expect(stagnant.attempts[1].verdict).toBe('dup');
		expect(decideNext(stagnant).kind).toBe('diagnose');
	}
});
