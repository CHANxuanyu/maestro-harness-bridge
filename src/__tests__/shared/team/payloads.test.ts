import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { reduceLedger, teamEventForTransport } from '../../../shared/team/ledger';
import { MAX_PERSISTED_TOOL_OUTPUT_CHARS } from '../../../shared/toolOutput';
import { buildTeamTurnPrompt } from '../../../shared/team/prompts';
import {
	REPORT_PERMISSIONS,
	type LedgerEvent,
	type ReportTurnKind,
} from '../../../shared/team/types';
import { baseline, brief, check, config, goodReports, ledger, type EventInput } from './fixtures';

/** Forty turns with long proof instructions, two challenges and independently captured QA files. */
function mediumLedger() {
	const criteria = Array.from({ length: 8 }, (_, i) => ({
		...brief.criteria[i % brief.criteria.length],
		id: `C${i + 1}`,
		text: `Duration parser case ${i + 1}: preserve input validation and readable results`,
		how: 'Run the independent Node test suite with valid hours, minutes, seconds, zero, decimal values, whitespace, invalid units, missing values and negative inputs. Compare the returned value with the expected duration and check that errors identify the invalid input. Run from the task workspace; QA samples live in qa/. Record the command, exit status and observed results. Inspect the rendered output for truncation, confusing labels and inconsistent units. Keep the original behavior for previously accepted inputs.',
	}));
	const current = { ...brief, criteria };
	const entries: EventInput[] = [
		{ kind: 'team_created', config: { ...config, turnBudget: 40 } },
		{ kind: 'brief_published', actor: 'pm', brief: current },
		...(['dev', 'qa'] as const).map(
			(seat): EventInput => ({
				kind: 'challenge_submitted',
				seat,
				briefVersion: 1,
				objections: [],
				plans:
					seat === 'qa'
						? criteria.map((c) => ({
								criterion: c.id,
								how: c.how!,
								data: 'Valid, invalid and boundary samples',
							}))
						: undefined,
			})
		),
		{ ...baseline[2], briefVersion: 1 } as EventInput,
		...(['pm', 'dev', 'qa'] as const).map(
			(seat): EventInput => ({
				kind: 'seat_bound',
				seat,
				workspace: `/project/${seat === 'qa' ? 'qa' : 'dev'}`,
				model: config.seats[seat],
			})
		),
		{
			kind: 'discussion_opened',
			discussionId: 'parser',
			topic: 'Independent test coverage',
			owner: 'pm',
			participants: ['pm', 'dev', 'qa'],
			trigger: 'team-problem',
			layer: 'implementation',
		},
	];
	for (let i = 0; i < 8; i++) {
		entries.push({
			...check,
			command: `node --test qa/case-${i}.test.cjs`,
			covers: [`C${i + 1}`],
			evidenceId: `check-${i}`,
			outputTail: `${'PASS valid, invalid and boundary cases\n'.repeat(75)}17 tests passed`,
		});
	}
	entries.push({
		kind: 'output_captured',
		outputId: 'output-1',
		files: Array.from({ length: 36 }, (_, i) => `/project/qa/qa/parser-case-${i}.test.cjs`),
		previews: [],
	});
	const events = ledger(...entries);
	const kinds = Object.keys(REPORT_PERMISSIONS) as ReportTurnKind[];
	for (let i = 0; i < 40; i++) {
		const turn = kinds[i % kinds.length];
		const seat = REPORT_PERMISSIONS[turn][0];
		const prompt = buildTeamTurnPrompt(turn, seat, reduceLedger(events), 'parser');
		events.push({
			kind: 'turn_dispatched',
			id: `dispatch-${i}`,
			dispatchId: `dispatch-${i}`,
			seq: events.length + 1,
			at: 2000 + i,
			actor: 'app',
			seat,
			turn,
			sourceSeq: events.length,
			prompt,
			promptDigest: createHash('sha256').update(prompt).digest('hex'),
		});
		events.push({
			kind: 'turn_finished',
			id: `finish-${i}`,
			dispatchId: `dispatch-${i}`,
			seq: events.length + 1,
			at: 2000 + i,
			actor: 'app',
			seat,
			exitCode: 0,
			durationMs: 1000,
			message: 'Observed results recorded in the report.',
			report: goodReports.work,
		});
	}
	return events;
}

describe('team payload size', () => {
	it('preserves small diagnostics and fact notes in default JSON while omitting raw repair text', () => {
		const events = ledger(
			{
				kind: 'turn_finished',
				seat: 'dev',
				dispatchId: 'failed',
				exitCode: 0,
				durationMs: 1,
				message: 'Developer challenge',
				reportError: 'Invalid team-report JSON: broken',
				repairTail: 'Developer challenge\n```team-report\n{broken}\n```',
			},
			{
				kind: 'report_rejected',
				seat: 'dev',
				dispatchId: 'failed',
				reason: 'Invalid team-report JSON: broken',
			},
			{
				kind: 'report_normalized',
				seat: 'pm',
				dispatchId: 'normalized',
				changes: [
					{
						field: 'decider',
						before: 'pm',
						after: 'owner',
						reason: 'The app owns the decision layer',
					},
				],
			},
			{
				kind: 'member_fault',
				seat: 'dev',
				fault: 'bad-report',
				detail: 'The report contains malformed JSON',
			}
		);
		const projected = JSON.parse(JSON.stringify(events.map(teamEventForTransport)));
		expect(projected[0]).toEqual({ ...events[0], repairTail: undefined });
		expect(projected[0].reportError).toBe('Invalid team-report JSON: broken');
		expect(projected.slice(1)).toEqual(events.slice(1));
	});
	it('measures a reproducible forty-turn ledger and each prompt kind', () => {
		const events = mediumLedger();
		const prompts = Object.fromEntries(
			events
				.filter((e) => e.kind === 'turn_dispatched')
				.map((e) => [e.turn, Buffer.byteLength(e.prompt!)])
		);
		const sidecarEvents = events.map((event) =>
			event.kind === 'turn_dispatched'
				? { ...event, prompt: undefined, promptRef: `prompts/${event.dispatchId}.txt` }
				: event
		);
		const getBytes = Buffer.byteLength(
			JSON.stringify({ config, events: sidecarEvents.map(teamEventForTransport) })
		);
		const getPrettyBytes = Buffer.byteLength(
			JSON.stringify({ config, events: sidecarEvents.map(teamEventForTransport) }, null, '\t')
		);
		const measurements: Record<string, unknown> = {
			turns: 40,
			ledgerBytes: Buffer.byteLength(JSON.stringify(events)),
			durableLedgerBytes: Buffer.byteLength(JSON.stringify(sidecarEvents)),
			getBytes,
			getPrettyBytes,
			inlineGetPrettyBytes: Buffer.byteLength(JSON.stringify({ config, events }, null, '\t')),
			prompts,
		};
		if (process.env.TEAM_MEASURE_REAL) {
			const real = JSON.parse(readFileSync(process.env.TEAM_MEASURE_REAL, 'utf8')) as {
				ledger: LedgerEvent[];
			};
			measurements.realLedgerBytes = Buffer.byteLength(JSON.stringify(real.ledger));
			measurements.realDefaultEventsBytes = Buffer.byteLength(
				JSON.stringify(real.ledger.map(teamEventForTransport))
			);
			measurements.real = real.ledger
				.filter((e) => e.kind === 'turn_dispatched')
				.map((e) => ({
					seat: e.seat,
					turn: e.turn,
					recordedBytes: Buffer.byteLength(e.prompt ?? ''),
					builtBytes: Buffer.byteLength(
						buildTeamTurnPrompt(
							(e.expectedTurn ?? e.turn) as ReportTurnKind,
							e.seat,
							reduceLedger(real.ledger.filter((prior) => prior.seq <= (e.sourceSeq ?? e.seq - 1))),
							e.discussionId
						)
					),
				}));
		}
		if (process.env.TEAM_MEASURE_OUT)
			writeFileSync(process.env.TEAM_MEASURE_OUT, JSON.stringify(measurements, null, '\t'));
		expect(events.filter((e) => e.kind === 'turn_dispatched')).toHaveLength(40);
		expect(getBytes).toBeLessThan(1_000_000);
		expect(getPrettyBytes).toBeLessThan(1_000_000);
		expect(Buffer.byteLength(JSON.stringify(events.map(teamEventForTransport)))).toBeLessThan(
			100_000
		);
		expect(Math.max(...Object.values(prompts))).toBeLessThan(25_000);
		const rawState = reduceLedger(events);
		const transported = reduceLedger(sidecarEvents.map(teamEventForTransport));
		for (const key of [
			'criteria',
			'usage',
			'baseline',
			'openCards',
			'issues',
			'outputs',
			'decisions',
			'discussions',
		] as const)
			expect(transported[key]).toEqual(rawState[key]);
	});
	it('caps legacy reply/check tails without mutating the durable audit or evidence', () => {
		const events = ledger(
			{ ...check, outputTail: 'Legacy long tail '.repeat(4000) },
			{
				kind: 'turn_finished',
				dispatchId: 'old',
				seat: 'dev',
				exitCode: 0,
				durationMs: 1,
				message: 'Legacy long reply '.repeat(4000),
				repairTail: 'Original repair context'.repeat(4000),
			}
		);
		const snapshot = structuredClone(events);
		const [run, finished] = events.map(teamEventForTransport);
		expect(run).toMatchObject({ evidenceId: 'check-1', covers: ['A1'], exitCode: 0 });
		if (run.kind === 'check_run')
			expect(run.outputTail.length).toBeLessThanOrEqual(MAX_PERSISTED_TOOL_OUTPUT_CHARS);
		if (finished.kind === 'turn_finished') {
			expect(finished.message!.length).toBeLessThanOrEqual(MAX_PERSISTED_TOOL_OUTPUT_CHARS);
			expect(finished.repairTail).toBeUndefined();
		}
		expect(events).toEqual(snapshot);
	});
});
