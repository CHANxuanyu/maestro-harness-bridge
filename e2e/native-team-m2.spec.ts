import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { prepareNativeTeamM2 } from './fixtures/native-team-m2';
import { reduceLedger } from '../src/shared/team/ledger';
import { type LedgerEvent, type SeatRole, type TeamConfig } from '../src/shared/team/types';

test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'M2 is scripted synthetic acceptance; never use real accounts'
);

for (const scenario of [
	'discussion',
	'contested',
	'commitment',
	'relaxation',
	'review',
	'permission',
] as const) {
	// eslint-disable-next-line no-empty-pattern
	test(`team M2 ${scenario}: T5-T10, T13, T15`, async ({}, info) => {
		test.setTimeout(300_000);
		const native = new NativeApp(info, { providerCli: false });
		const fixture = prepareNativeTeamM2(native, scenario);
		const { brief, gate } = fixture;
		let team: TeamConfig | undefined;
		const events = (): LedgerEvent[] => (team ? fixture.events(team.id) : []);
		const state = () => reduceLedger(events());
		let started = false;
		let failed = false;
		try {
			await native.start();
			started = true;
			team = await native.page.evaluate(
				(input) => window.maestro.team.create(input),
				fixture.input
			);
			if (scenario === 'permission') {
				await expect
					.poll(() => state().openCards.some((c) => c.id === 'permission:checks'))
					.toBe(true);
				expect(state().checks).toEqual([]);
				await native.cli('team', 'answer', 'permission:checks', 'allow', '--team', team.id);
			}
			await expect.poll(() => state().openCards.some((c) => c.boundary === 'baseline')).toBe(true);
			if (scenario === 'review') {
				await native.cli(
					'team',
					'baseline',
					'edit',
					'A1',
					'--text',
					'Output contains implemented heading in the document',
					'--team',
					team.id
				);
				await expect
					.poll(() => state().openCards.some((c) => c.boundary === 'baseline'))
					.toBe(true);
				const diff = await native.cli('team', 'baseline', 'diff', '--team', team.id);
				expect(diff.criteria.map((c: { id: string }) => c.id)).toEqual(['A1']);
				await native.cli(
					'team',
					'baseline',
					'return',
					'--note',
					'Include the footer',
					'--team',
					team.id
				);
				await expect
					.poll(() => state().openCards.some((c) => c.boundary === 'baseline'), { timeout: 90_000 })
					.toBe(true);
				const returnedDiff = await native.cli('team', 'baseline', 'diff', '--team', team.id);
				expect(returnedDiff.criteria.map((c: { id: string }) => c.id)).toEqual(['E1']);
			}
			await native.cli('team', 'baseline', 'confirm', '--team', team.id);
			if (scenario === 'review') {
				await expect
					.poll(() => state().turns.some((t) => t.dispatched?.turn === 'work'))
					.toBe(true);
				const work = state().turns.find((t) => t.dispatched?.turn === 'work')!;
				await native.cli(
					'team',
					'say',
					'--to',
					'dev',
					'Please explain the sample',
					'--team',
					team.id
				);
				expect(state().pendingMessages).toHaveLength(1);
				fs.writeFileSync(gate, 'release');
				await expect.poll(() => state().messages.some((m) => m.handled)).toBe(true);
				expect(state().messages[0].delivered!.seq).toBeGreaterThan(
					state().turns.find((t) => t.dispatchId === work.dispatchId)!.finished!.seq
				);
				expect(state().messages[0].handled!.seat).toBe('dev');
			}
			if (scenario === 'commitment' || scenario === 'relaxation') {
				await expect
					.poll(() => state().openCards.some((c) => c.boundary === 'commitment'), {
						timeout: 90_000,
					})
					.toBe(true);
				const card = state().openCards.find((c) => c.boundary === 'commitment')!;
				expect(card.payload).toMatchObject({
					type: 'discussion',
					positions: expect.arrayContaining([
						expect.objectContaining({ claim: expect.stringContaining('sealed position') }),
					]),
				});
				expect(card.body).not.toMatch(/^\s*[[{]/);
				expect(card.referenceVotes).toContain('Reference only');
				if (scenario === 'relaxation') {
					expect(state().criteria[0]).toMatchObject({
						text: brief.criteria[0].text,
						status: 'fail',
					});
					expect(card.payload).toMatchObject({ type: 'discussion', failingNow: true });
				}
				await native.cli('team', 'stop', '--team', team.id);
				return;
			}
			await expect
				.poll(() => state().openCards.some((c) => c.boundary === 'acceptance'), {
					timeout: 180_000,
				})
				.toBe(true);
			expect(state().criteria.every((c) => c.status === 'pass')).toBe(true);
			expect(state().outputs.at(-1)!.previews).toHaveLength(2);
			for (const preview of state().outputs.at(-1)!.previews)
				expect(fs.statSync(preview).size).toBeGreaterThan(100);
			if (scenario === 'discussion' || scenario === 'contested') {
				const meeting = state().discussions.find((d) => d.opened?.trigger === 'member')!;
				expect(meeting.positions).toHaveLength(3);
				expect(meeting.decision).toMatchObject({
					decider: 'dev',
					contested: scenario === 'contested',
				});
				expect(meeting.proposals).toHaveLength(scenario === 'contested' ? 2 : 1);
				expect(
					events()
						.filter((e) => e.kind === 'decision_card')
						.map((e) => e.card.boundary)
				).toEqual(['baseline', 'acceptance']);
				await native.cli(
					'team',
					'say',
					'--to',
					'dev',
					'REOPEN the same decision',
					'--team',
					team.id
				);
				await expect.poll(() => events().some((e) => e.kind === 'topic_rejected')).toBe(true);
			}
			if (scenario === 'review') {
				expect(state().rejectionCount).toBe(3);
				expect(state().retros).toHaveLength(1);
				const third = state().reviews[2];
				const thirdState = reduceLedger(events().filter((e) => e.seq <= third.seq));
				expect(thirdState.reviewProgress.attempts.filter((a) => !a.diagnosis).at(-1)!.verdict).toBe(
					'evidence'
				);
				expect(thirdState.demos).toEqual([]);
				expect(thirdState.openCards).toEqual([]);
				const firstDemo = state().demos[0];
				await native.cli(
					'team',
					'request-changes',
					'--note',
					'Also explain empty input',
					'--team',
					team.id
				);
				await expect
					.poll(() => state().criteria.some((c) => c.text === 'Also explain empty input'))
					.toBe(true);
				await expect.poll(() => state().demos.length === 2, { timeout: 120_000 }).toBe(true);
				expect(state().demos[1].criterionIds).toHaveLength(1);
				expect(state().demos[1].seq).toBeGreaterThan(firstDemo.seq);
				expect(state().outputs.at(-1)!.beforeOutputId).toBeDefined();
			}
			if (scenario === 'permission') {
				expect(state().checks.length).toBeGreaterThan(1);
				expect(
					events().filter((e) => e.kind === 'decision_card' && e.card.boundary === 'permission')
				).toHaveLength(1);
			}
			for (const section of ['decisions', 'meetings', 'changes', 'suggestions'])
				expect(await native.cli('team', 'show', section, '--team', team.id)).toBeDefined();
			for (const seat of ['pm', 'dev', 'qa'] as SeatRole[]) {
				const log = await native.cli('team', 'log', '--seat', seat, '--team', team.id);
				expect(log.length).toBeGreaterThan(0);
				expect(
					log.every(
						(entry: { seat: string; prompt: string }) =>
							entry.seat === seat && entry.prompt.includes('team-dispatch:')
					)
				).toBe(true);
			}
			await native.cli('team', 'accept', '--team', team.id);
			await expect.poll(() => state().terminal).toBe('all');
		} catch (error) {
			failed = true;
			// Keep what the team actually did, so a stuck predicate can be diagnosed.
			try {
				if (team) {
					const file = path.join(native.data, 'teams', team.id, 'ledger.jsonl');
					if (fs.existsSync(file)) fs.copyFileSync(file, test.info().outputPath('ledger.jsonl'));
				}
			} catch {
				// Diagnostics only.
			}
			throw error;
		} finally {
			if (started) await native.close(failed);
		}
	});
}
