import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createTeamScheduler,
	TEAM_FALLBACK_MS,
	type TeamSchedulerDependencies,
} from '../../../main/team/scheduler';
import type { SeatTurnRequest, SeatTurnResult } from '../../../main/team/turn-dispatcher';
import type { LedgerEvent, TeamConfig, TeamReport } from '../../../shared/team/types';
import { reduceLedger } from '../../../shared/team/ledger';
import {
	config,
	goodReports,
	baseline,
	proven,
	ledger,
	issue,
	type EventInput,
} from '../../shared/team/fixtures';
import type { NewLedgerEvent } from '../../../main/team/team-store';

vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));

describe('M1 team scheduler', () => {
	let events: LedgerEvent[];
	let teamConfig: TeamConfig;
	let scheduler: ReturnType<typeof createTeamScheduler>;
	let deps: TeamSchedulerDependencies;
	let notify: boolean;
	let listeners: Set<(id: string, event: LedgerEvent) => void>;
	let requests: SeatTurnRequest[];
	let completions: Map<string, (value: SeatTurnResult) => void>;
	let hash: string;
	let followListener: Parameters<TeamSchedulerDependencies['followUps']['onFire']>[0];
	const drain = async () => {
		for (let index = 0; index < 400; index++) await Promise.resolve();
	};
	const state = () => reduceLedger(events);
	const latest = (seat: string, kind: string) =>
		requests.findLast(
			(request) => request.seat === seat && request.prompt.includes(`Turn: ${kind}.`)
		)!;
	const result = (request: SeatTurnRequest, text: string): SeatTurnResult => ({
		dispatchId: request.dispatchId!,
		processId: `process-${request.dispatchId}`,
		nativeSessionId: `native-${request.seat}`,
		text,
		truncated: false,
		usage: null,
		exitCode: 0,
		durationMs: 10,
		lastActivityAt: Date.now(),
		livenessEvents: 1,
		canceled: false,
	});
	const finish = async (
		request: SeatTurnRequest,
		report: TeamReport | string,
		prose = `${request.seat} visible reply`
	) => {
		completions.get(request.dispatchId!)!(
			result(
				request,
				typeof report === 'string'
					? report
					: `${prose}\n\n\`\`\`team-report\n${JSON.stringify(report)}\n\`\`\``
			)
		);
		await drain();
	};
	const emit = async (input: EventInput) => {
		const event = {
			actor: 'app',
			...input,
			id: `external-${events.length}`,
			at: Date.now(),
		} as NewLedgerEvent;
		await deps.store.append(teamConfig.id, event);
		await drain();
	};
	const bindings: EventInput[] = (['pm', 'dev', 'qa'] as const).map((seat) => ({
		kind: 'seat_bound',
		seat,
		workspace: `/project/${seat === 'pm' ? 'dev' : seat}`,
		model: config.seats[seat],
	}));
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		events = [];
		teamConfig = structuredClone(config);
		requests = [];
		completions = new Map();
		listeners = new Set();
		notify = true;
		hash = 'diff-1';
		const store: TeamSchedulerDependencies['store'] = {
			createTeam: vi.fn(async (value) => {
				teamConfig = value;
				return value;
			}),
			listTeams: vi.fn(async () => (events.length ? [teamConfig] : [])),
			loadTeam: vi.fn(async () => ({ config: teamConfig, events: structuredClone(events) })),
			append: vi.fn(async (id, input) => {
				const event = { ...structuredClone(input), seq: events.length + 1 } as LedgerEvent;
				events.push(event);
				if (notify) for (const listener of listeners) listener(id, event);
				return event;
			}),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		};
		const workspaces = {
			initialize: vi.fn(async () => ({
				pm: '/project/dev',
				dev: '/project/dev',
				qa: '/project/qa',
				branch: 'team/test',
				qaRevision: 'a'.repeat(40),
				devGitFile: '',
				qaGitFile: '',
			})),
			advanceQa: vi.fn(async () => {}),
			enforceQaBoundary: vi.fn(async (): Promise<string[]> => []),
			commitDevWork: vi.fn(async () => 'b'.repeat(40)),
			pushDevWork: vi.fn(async () => true),
			diffHash: vi.fn(async () => hash),
		};
		deps = {
			store,
			dispatcher: {
				dispatch: vi.fn((request) => {
					expect(
						events.some((e) => e.kind === 'turn_dispatched' && e.dispatchId === request.dispatchId)
					).toBe(true);
					requests.push(request);
					return new Promise((resolve) => {
						completions.set(request.dispatchId!, resolve);
					});
				}),
			},
			workspaces: () => workspaces,
			checks: {
				run: vi.fn(async (request) => ({
					id: `check-${events.length}`,
					command: request.command,
					cwd: request.cwd,
					host: { kind: 'local' as const },
					startedAt: Date.now(),
					endedAt: Date.now() + 1,
					outcome: 'pass' as const,
					exitCode: 0,
					outputTail: 'passed',
					truncated: false,
				})),
			},
			followUps: {
				register: vi.fn(),
				cancel: vi.fn(),
				list: vi.fn(async () => []),
				onFire: (listener) => {
					followListener = listener;
					return () => {};
				},
				start: vi.fn(async () => {}),
				stop: vi.fn(),
			},
			reconcile: vi.fn(async () => null),
			captureOutput: vi.fn(async () => ({ files: ['/project/dev/result.txt'], previews: [] })),
			onError: vi.fn(),
		};
		scheduler = createTeamScheduler(deps);
	});
	afterEach(() => {
		scheduler.dispose();
		vi.useRealTimers();
	});
	const begin = async () => {
		await scheduler.start();
		await scheduler.create(config);
		await drain();
	};
	it('returns the host-resolved account alongside the native seat locator', async () => {
		deps.seatAccountDir = vi.fn(() => '/synthetic/account');
		await begin();
		const locator = await scheduler.seatTranscript(teamConfig.id, 'pm');
		expect(locator).toMatchObject({ provider: 'claude-code', configDir: '/synthetic/account' });
		expect(deps.seatAccountDir).toHaveBeenCalledWith(teamConfig, 'pm');
	});
	const toBaseline = async () => {
		await begin();
		await finish(latest('pm', 'brief'), goodReports.brief);
		await finish(latest('dev', 'challenge'), {
			type: 'challenge',
			objections: [{ about: 'A1', problem: 'DEV_PRIVATE_CHALLENGE', kind: 'risk' }],
		});
		await finish(latest('qa', 'challenge'), {
			...goodReports.challenge,
			objections: [{ about: 'A1', problem: 'QA_PRIVATE_CHALLENGE', kind: 'risk' }],
		} as TeamReport);
		await finish(latest('pm', 'respond'), goodReports.respond);
	};
	const confirm = async () => {
		await scheduler.answer(teamConfig.id, state().openCards[0].id, 'confirm');
		await drain();
	};
	it('keeps the baseline readable while preserving its structured brief and trial evidence', async () => {
		await toBaseline();
		const card = state().openCards[0];
		expect(card.body).toContain('dry-run in the task workspace');
		expect(card.body).not.toMatch(/"brief"|"trials"|"cwd"|"evidenceId"/);
		expect(card.payload).toMatchObject({
			type: 'baseline',
			brief: state().brief,
			trials: state().checks,
		});
	});
	it('repairs only once when both the reply and its repair are malformed', async () => {
		await begin();
		await finish(latest('pm', 'brief'), 'Missing block');
		await finish(requests.at(-1)!, 'Still missing');
		await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS);
		await drain();
		expect(
			events.filter((event) => event.kind === 'turn_dispatched' && event.repairOf)
		).toHaveLength(1);
		expect(requests.at(-1)!.seat).toBe('pm');
		expect(events.filter((event) => event.kind === 'turn_dispatched').at(-1)?.mode).toBe('wake');
	});

	it('replays an owner answer persisted just before a crash exactly once', async () => {
		await toBaseline();
		const cardId = state().openCards[0].id;
		scheduler.dispose();
		await emit({ kind: 'card_answered', actor: 'owner', cardId, optionId: 'confirm' });
		scheduler = createTeamScheduler(deps);
		await scheduler.start();
		await drain();
		await scheduler.wake(teamConfig.id);
		expect(state().baseline.confirmedVersion).toBeDefined();
		expect(events.filter((event) => event.kind === 'baseline_confirmed')).toHaveLength(1);
		expect(latest('dev', 'work')).toBeDefined();
	});

	it('offers a fresh baseline card after a return even if PM keeps the draft unchanged', async () => {
		await toBaseline();
		const cardId = state().openCards[0].id;
		await scheduler.answer(teamConfig.id, cardId, 'return', 'Explain the check scope');
		await drain();
		await finish(latest('pm', 'respond'), {
			...goodReports.respond,
			askOwner: 'Does this scope meet the request?',
		} as TeamReport);
		expect(state().openCards).toHaveLength(1);
		expect(state().openCards[0].id).not.toBe(cardId);
		expect(state().openCards[0].body).toContain('Does this scope meet the request?');
	});

	it('turns an acceptance change request into an owner criterion and PM restatement before dev work', async () => {
		events = ledger(
			...proven,
			...bindings,
			{ kind: 'phase_changed', to: 'accept' },
			{
				kind: 'decision_card',
				card: {
					id: 'acceptance:test',
					boundary: 'acceptance',
					title: 'Accept',
					body: 'Review',
					options: [{ id: 'changes', label: 'Request changes' }],
				},
			}
		);
		await scheduler.start();
		await scheduler.requestChanges(teamConfig.id, 'Also explain empty input');
		await drain();
		expect(
			state().criteria.some(
				(criterion) => criterion.byOwner && criterion.text === 'Also explain empty input'
			)
		).toBe(true);
		expect(requests).toHaveLength(1);
		expect(requests[0].seat).toBe('pm');
		expect(requests[0].prompt).toContain('Also explain empty input');
		await finish(requests[0], goodReports.topic);
		expect(latest('dev', 'work').prompt).toContain('Also explain empty input');
	});

	it('keeps owner actions responsive while QA restoration is running', async () => {
		await toBaseline();
		await confirm();
		let restore!: (paths: string[]) => void;
		vi.mocked(deps.workspaces(teamConfig, true).enforceQaBoundary).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					restore = resolve;
				})
		);
		await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
		const started = Date.now();
		await scheduler.say(teamConfig.id, 'Keep this message');
		await scheduler.pause(teamConfig.id);
		expect(Date.now() - started).toBeLessThanOrEqual(5000);
		expect(state().paused).toBe(true);
		expect(state().pendingMessages[0].text).toBe('Keep this message');
		restore(['bad.txt']);
		await drain();
		expect(events.some((event) => event.kind === 'qa_boundary_restored')).toBe(true);
	});

	it('registers an observable retry when workspace setup fails instead of spinning', async () => {
		vi.mocked(deps.workspaces(teamConfig, true).initialize).mockRejectedValueOnce(
			new Error('Git unavailable')
		);
		await begin();
		expect(deps.workspaces(teamConfig, true).initialize).toHaveBeenCalledTimes(1);
		expect(state().followUps).toHaveLength(1);
		expect(state().followUps[0].reason).toContain('Git unavailable');
		const followUp = vi.mocked(deps.followUps.register).mock.calls[0][0];
		followListener({
			kind: 'ready',
			at: Date.now(),
			late: false,
			externalStatus: { state: 'completed', observedAt: Date.now() },
			followUp,
		} as Parameters<typeof followListener>[0]);
		await drain();
		expect(latest('pm', 'brief')).toBeDefined();
		expect(state().followUps).toEqual([]);
	});

	it('runs the complete direct path with two isolated seats, app checks, QA fix attribution and two owner cards', async () => {
		await toBaseline();
		expect(latest('dev', 'challenge').prompt).not.toContain('QA_PRIVATE_CHALLENGE');
		expect(latest('qa', 'challenge').prompt).not.toContain('DEV_PRIVATE_CHALLENGE');
		expect(latest('pm', 'respond').prompt).toContain('QA_PRIVATE_CHALLENGE');
		expect(state().openCards.map((c) => c.boundary)).toEqual(['baseline']);
		expect(state().checks[0].purpose).toBe('trial');
		await confirm();
		expect(state().seats.dev.activeDispatchIds).toHaveLength(1);
		expect(state().seats.qa.activeDispatchIds).toHaveLength(1);
		await finish(latest('dev', 'work'), goodReports.work);
		expect(deps.workspaces(teamConfig, true).advanceQa).not.toHaveBeenCalled();
		vi.mocked(deps.workspaces(teamConfig, true).enforceQaBoundary).mockResolvedValueOnce([
			'src/bad.txt',
		]);
		await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
		expect(
			events.some((e) => e.kind === 'qa_boundary_restored' && e.paths.includes('src/bad.txt'))
		).toBe(true);
		expect(deps.workspaces(teamConfig, true).commitDevWork).toHaveBeenCalledTimes(1);
		await finish(latest('qa', 'verify'), {
			...goodReports.verify,
			issues: [
				{
					title: 'Bad input accepted',
					criterion: 'A2',
					kind: 'defect',
					steps: ['Enter bad input'],
				},
			],
		} as TeamReport);
		const issueId = state().issues[0].id;
		await finish(latest('dev', 'fix'), { ...goodReports.fix, fixed: [issueId] } as TeamReport);
		await finish(latest('qa', 'reverify'), {
			type: 'reverify',
			results: [{ issue: issueId, pass: true, evidence: 'qa/retest.txt' }],
			newIssues: [],
		});
		await finish(latest('pm', 'review'), goodReports.review);
		await finish(latest('pm', 'demo'), goodReports.demo);
		expect(state().openCards.map((c) => c.boundary)).toEqual(['acceptance']);
		await scheduler.accept(teamConfig.id);
		await drain();
		expect(state().terminal).toBe('all');
		expect(events.filter((e) => e.kind === 'decision_card').map((e) => e.card.boundary)).toEqual([
			'baseline',
			'acceptance',
		]);
		expect(state().checks.every((c) => c.actor === 'app')).toBe(true);
		expect(state().issues[0].history.at(-1)?.actor).toBe('qa');
		expect(state().turns.find((t) => t.dispatched?.turn === 'brief')?.finished?.message).toBe(
			'pm visible reply'
		);
		expect(JSON.parse(await scheduler.export(teamConfig.id)).events).toEqual(events);
		for (let index = 1; index <= events.length; index++)
			expect(
				Object.values(reduceLedger(events.slice(0, index)).seats).reduce(
					(n, s) => n + s.activeDispatchIds.length,
					0
				)
			).toBeLessThanOrEqual(2);
		expect(deps.onError).not.toHaveBeenCalled();
	});

	it.each(['missing report', '```team-report\n{broken}\n```'])(
		'repairs %s once without repeating work and retains bounded prose',
		async (bad) => {
			await begin();
			const original = latest('pm', 'brief');
			await finish(original, bad);
			const repair = requests.at(-1)!;
			expect(repair.prompt).toContain('Do not redo work');
			await finish(repair, goodReports.brief);
			expect(state().turns.find((t) => t.dispatchId === original.dispatchId)?.repaired).toBe(true);
			expect(
				events.filter((e) => e.kind === 'turn_dispatched' && e.turn === 'report_repair')
			).toHaveLength(1);
			expect(state().briefs).toHaveLength(1);
			expect(deps.onError).not.toHaveBeenCalled();
		}
	);

	it('handles completed turns within five seconds and does not wait for a parallel seat', async () => {
		await begin();
		const started = Date.now();
		await finish(latest('pm', 'brief'), goodReports.brief);
		expect(requests.filter((r) => r.prompt.includes('Turn: challenge.'))).toHaveLength(2);
		expect(Date.now() - started).toBeLessThanOrEqual(5000);
		await scheduler.say(teamConfig.id, 'Owner note while both seats work', 'dev');
		await drain();
		expect(state().pendingMessages).toHaveLength(1);
		expect(requests).toHaveLength(3);
	});

	it('wakes PM within thirty seconds when the append notification is lost', async () => {
		events = ledger({ kind: 'team_created', config }, ...bindings, { kind: 'paused' });
		await scheduler.start();
		await drain();
		notify = false;
		await emit({ kind: 'resumed' });
		expect(requests).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS);
		await drain();
		expect(latest('pm', 'brief')).toBeDefined();
		expect(requests).toHaveLength(1);
	});

	it('remembers a permission grant for all later checks in the team', async () => {
		config.authorizations.checks = false;
		try {
			await toBaseline();
			expect(state().openCards[0].id).toBe('permission:checks');
			await scheduler.answer(teamConfig.id, 'permission:checks', 'allow');
			await drain();
			await confirm();
			await finish(latest('dev', 'work'), goodReports.work);
			await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
			expect(
				events.filter((e) => e.kind === 'decision_card' && e.card.boundary === 'permission')
			).toHaveLength(1);
			expect(deps.checks.run).toHaveBeenCalledTimes(2);
		} finally {
			config.authorizations.checks = true;
		}
	});

	it.each([true, false])(
		'reconciles an unfinished native turn on restart (result present: %s)',
		async (present) => {
			await begin();
			const original = latest('pm', 'brief');
			scheduler.dispose();
			const oldCount = requests.length;
			if (present)
				vi.mocked(deps.reconcile).mockResolvedValueOnce(
					result(original, `Brief\n\`\`\`team-report\n${JSON.stringify(goodReports.brief)}\n\`\`\``)
				);
			scheduler = createTeamScheduler(deps);
			await scheduler.start();
			await drain();
			expect(deps.reconcile).toHaveBeenCalledWith(
				expect.objectContaining({ dispatchId: original.dispatchId, cwd: '/project/dev' })
			);
			if (!present) {
				expect(requests[oldCount].dispatchId).toBe(original.dispatchId);
				expect(requests[oldCount].prompt).toContain('previous attempt may have done part');
				await finish(requests[oldCount], goodReports.brief);
			}
			expect(
				events.filter((e) => e.kind === 'turn_dispatched' && e.dispatchId === original.dispatchId)
			).toHaveLength(1);
			expect(
				events.filter((e) => e.kind === 'turn_finished' && e.dispatchId === original.dispatchId)
			).toHaveLength(1);
			expect(state().briefs).toHaveLength(1);
			expect(deps.onError).not.toHaveBeenCalled();
		}
	);

	it('replays a finished receipt after a crash during domain ingestion without a duplicate brief', async () => {
		await begin();
		await finish(latest('pm', 'brief'), goodReports.brief);
		scheduler.dispose();
		const finished = events.findIndex((e) => e.kind === 'turn_finished');
		events = events.slice(0, finished + 2); // receipt and first domain event, before accepted
		scheduler = createTeamScheduler(deps);
		await scheduler.start();
		await drain();
		expect(state().briefs).toHaveLength(1);
		expect(state().turns[0].report?.type).toBe('brief');
	});

	it.each(['continue', 'diagnose', 'gather'] as const)(
		'uses progressRules to %s, using diff and failure identity',
		async (expected) => {
			const failed = 'issue:i1:Accepted';
			const inputs: EventInput[] = [
				...baseline,
				...bindings,
				{ kind: 'phase_changed', to: 'verify' },
				issue,
				{
					kind: 'turn_dispatched',
					seat: 'qa',
					dispatchId: 'verified',
					turn: 'verify',
					promptDigest: '',
				},
				{ kind: 'turn_finished', seat: 'qa', dispatchId: 'verified', exitCode: 0, durationMs: 1 },
				{ kind: 'report_accepted', seat: 'qa', dispatchId: 'verified', report: goodReports.verify },
			];
			const { createHash } = await import('crypto');
			const fingerprint = createHash('sha256')
				.update(JSON.stringify([hash, [failed]]))
				.digest('hex');
			for (let i = 0; i < (expected === 'diagnose' ? 3 : 1); i++)
				inputs.push({
					kind: 'attempt',
					problemId: 'i1',
					initialFailures: expected === 'continue' ? [failed, 'old'] : [failed],
					attempt: {
						id: `attempt-${i}`,
						fingerprint: expected === 'gather' ? fingerprint : `different-${i}`,
						failures: [failed],
						evidence: [],
					},
				});
			events = ledger(...inputs);
			await scheduler.start();
			await drain();
			const dispatched = events.filter((e) => e.kind === 'turn_dispatched').at(-1)!;
			expect(dispatched.mode).toBe(expected === 'continue' ? undefined : expected);
			if (expected === 'gather') expect(requests.at(-1)!.prompt).toContain('Do not repeat');
			if (expected === 'diagnose') expect(requests.at(-1)!.prompt).toContain('attempt-2');
			expect(state().openCards).toEqual([]);
			expect(deps.onError).not.toHaveBeenCalled();
		}
	);

	it('persists follow-up delivery without consuming an attempt', async () => {
		events = ledger(
			{ kind: 'team_created', config },
			...bindings,
			{ kind: 'paused' },
			{
				kind: 'follow_up_registered',
				followUpId: 'f1',
				seat: 'dev',
				reason: 'Wait',
				waitFor: 'time',
			}
		);
		await scheduler.start();
		followListener({
			kind: 'ready',
			at: Date.now(),
			late: false,
			externalStatus: { state: 'completed', observedAt: Date.now() },
			followUp: { id: 'f1', target: { kind: 'team', teamId: config.id, seat: 'dev' } } as never,
		});
		await drain();
		expect(state().followUps).toEqual([]);
		expect(events.some((e) => e.kind === 'attempt')).toBe(false);
	});
});
