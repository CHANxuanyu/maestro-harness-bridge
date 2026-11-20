import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { NativeApp } from './fixtures/native-app';
import { prepareNativeTeam } from './fixtures/native-team';
import { reduceLedger } from '../src/shared/team/ledger';
import type { TeamConfig, SeatRole, LedgerEvent } from '../src/shared/team/types';

// Never turn this synthetic scenario into a paid run merely by setting REAL.
test.skip(
	process.env.MAESTRO_E2E_REAL === '1',
	'Team M1 acceptance uses isolated synthetic providers only'
);

// eslint-disable-next-line no-empty-pattern
test('team M1: three seats, CLI owner cards, report repair and forced-quit recovery', async ({}, info) => {
	test.setTimeout(240_000);
	const native = new NativeApp(info, { providerCli: false });
	const fixture = prepareNativeTeam(native);
	const { input, accounts, nativeRows } = fixture;
	let team: TeamConfig;
	let open = false;
	let failed = false;
	const events = () => fixture.events(team.id);
	const state = () => fixture.state(team.id);
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
		await native.forceQuit();
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
		fixture.releaseVerification(team.id);
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
