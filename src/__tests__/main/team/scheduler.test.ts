import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTeamWorkspaces } from '../../../main/team/workspaces';
import {
	createTeamScheduler,
	TEAM_FALLBACK_MS,
	TEAM_FAILURE_COOLDOWN_MS,
	type TeamSchedulerDependencies,
} from '../../../main/team/scheduler';
import type { SeatTurnRequest, SeatTurnResult } from '../../../main/team/turn-dispatcher';
import type { LedgerEvent, TeamConfig, TeamReport } from '../../../shared/team/types';
import { reduceLedger } from '../../../shared/team/ledger';
import { teamStatus } from '../../../shared/team/status';
import { teamTurnPermission } from '../../../shared/team/policy';
import {
	config,
	check,
	goodReports,
	baseline,
	proven,
	ledger,
	issue,
	type EventInput,
} from '../../shared/team/fixtures';
import type { NewLedgerEvent } from '../../../main/team/team-store';
const { createNativeTempDir } = require('../../../../e2e/fixtures/native/temp-root.cjs');
const { teamM2Brief, teamM2Scene } = require('../../../../e2e/fixtures/native/team-m2.cjs');

vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));

describe('team scheduler', () => {
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
		for (let index = 0; index < 2000; index++) await Promise.resolve();
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
		config.turnBudget = 200;
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
			loadTeam: async () => ({ config: teamConfig, events: structuredClone(events) }),
			append: vi.fn(async (id, input) => {
				const event = { ...structuredClone(input), seq: events.length + 1 } as LedgerEvent;
				if (events.length > 2000)
					throw new Error(
						`Unbounded test ledger: ${JSON.stringify(events.slice(-12).map((e) => [e.kind, e.id]))}`
					);
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
			createDraftPr: vi.fn(async () => 'https://github.example/test/pull/1'),
			inspect: vi.fn(async () => ({
				revision: 'a'.repeat(40),
				status: '',
				recentCommits: 'fixture commit',
			})),
			diffHash: vi.fn(async () => hash),
		};
		deps = {
			store,
			dispatcher: {
				dispatch: vi.fn((request) => {
					expect(request.permissionMode).toBe(teamTurnPermission(request.seat, request.turn));
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
			captureOutput: vi.fn(async () => ({
				files: ['/project/dev/result.txt'],
				previews: ['/project/dev/result.png'],
			})),
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
	const completeDiscussion = async (
		options: {
			rounds?: number;
			insist?: boolean;
			layer?: 'implementation' | 'testing' | 'product' | 'commitment';
			evidence?: string;
			evidenceByRound?: Record<number, string>;
			waitForQa?: string;
			experiment?: string;
			compromise?: string;
		} = {}
	) => {
		const discussion = state().discussions.find((d) => d.opened && !d.decision)!;
		const opened = discussion.opened!;
		for (const seat of opened.participants) {
			if (discussion.positions.some((p) => p.seat === seat)) continue;
			await finish(latest(seat, 'position'), {
				type: 'position',
				discussionId: discussion.id,
				claim: `${seat} position`,
				basis: `${seat} basis`,
				wouldChangeMind: 'A conclusive experiment',
				...(seat === 'dev' ? { extraTurns: 1, preservesDeadline: true } : {}),
			});
		}
		for (let round = discussion.proposals.length + 1; round <= (options.rounds ?? 1); round++) {
			const decider =
				opened.layer === 'commitment' || opened.reversible === false
					? 'owner'
					: opened.layer === 'implementation'
						? 'dev'
						: opened.layer === 'testing'
							? 'qa'
							: opened.layer === 'fact'
								? 'app'
								: 'pm';
			await finish(latest(opened.owner, 'proposal'), {
				type: 'proposal',
				discussionId: discussion.id,
				proposal: `Proposal ${round}`,
				decider,
				actions: opened.participants.map((seat) => ({
					seat,
					action: `${seat} implements the conclusion`,
					...(seat === 'qa' && options.waitForQa ? { waitFor: options.waitForQa } : {}),
				})),
				...(options.compromise ? { compromise: options.compromise } : {}),
				...(options.experiment
					? {
							experiment: {
								command: options.experiment,
								basis: 'Two objections',
								expected: 'One observed result',
							},
						}
					: {}),
			});
			for (const seat of opened.participants)
				await finish(latest(seat, 'response'), {
					type: 'response',
					discussionId: discussion.id,
					result: options.insist && seat !== opened.owner ? 'insist' : 'agree',
					reason: 'Concrete response',
					...(options.insist && seat !== opened.owner ? { baselineViolation: 'A1' } : {}),
					...((options.evidenceByRound?.[round] ?? options.evidence) && seat !== opened.owner
						? { evidence: options.evidenceByRound?.[round] ?? options.evidence }
						: {}),
				});
		}
		return discussion.id;
	};
	const completeActions = async () => {
		for (let step = 0; step < 10; step++) {
			const turn = state().turns.find(
				(t) => !t.finished && t.dispatched?.note?.startsWith('Carry out the decided')
			);
			if (!turn) return;
			const request = requests.find((r) => r.dispatchId === turn.dispatchId)!;
			const kind = turn.dispatched!.turn;
			await finish(
				request,
				kind === 'message'
					? { type: 'message', summary: 'Prepared the agreed step', messages: [] }
					: kind === 'fix'
						? {
								type: 'fix',
								fixed: state()
									.issues.filter(
										(i) => i.opened.issueKind === 'defect' && i.state !== 'verified-pass'
									)
									.map((i) => i.id),
								notFixed: [],
								attempt: {
									basis: 'Review and discussion',
									difference: 'Apply the agreed approach',
									expectation: 'Recheck all locations',
								},
							}
						: kind === 'qa_prep'
							? goodReports.qa_prep
							: goodReports.work
			);
		}
	};
	const toReview = async () => {
		await toBaseline();
		await confirm();
		await finish(latest('dev', 'work'), goodReports.work);
		await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
		await finish(latest('qa', 'verify'), goodReports.verify);
	};
	it.each(['discussion', 'contested', 'commitment', 'relaxation', 'review'])(
		'completes the native M2 %s script through real report validation and scheduling',
		async (scenario) => {
			const root = createNativeTempDir('maestro-team-m2-unit-');
			const files = new Map<string, string>();
			const handled = new Set<string>();
			for (const seat of ['pm', 'dev', 'qa']) fs.mkdirSync(path.join(root, seat));
			vi.mocked(deps.checks.run).mockImplementation(async (request) => {
				const pass = files.get('result.html')?.includes('<h1>implemented</h1>') ?? false;
				return {
					id: `check-${events.length}`,
					command: request.command,
					cwd: request.cwd,
					host: { kind: 'local' },
					startedAt: Date.now(),
					endedAt: Date.now() + 1,
					outcome: pass ? 'pass' : 'fail',
					exitCode: pass ? 0 : 1,
					outputTail: '# tests 1\n# skipped 0',
					truncated: false,
				};
			});
			vi.mocked(deps.captureOutput).mockImplementation(
				async (_cwd, _revision, criteria, beforeOutputId) => ({
					files: [...files.keys()],
					previews: ['first.png', 'second.png'],
					beforeOutputId,
					locations: criteria?.flatMap((criterion) =>
						(criterion.locations ?? []).map((location, i) => ({
							criterion: criterion.id,
							location,
							preview: i ? 'second.png' : 'first.png',
						}))
					),
				})
			);
			const pump = async (done: () => boolean) => {
				for (let i = 0; i < 150 && !done(); i++) {
					await drain();
					if (done()) break;
					const request = requests.find((r) => !handled.has(r.dispatchId!));
					expect(
						request,
						JSON.stringify({
							phase: state().phase,
							turns: state()
								.turns.slice(-3)
								.map((t) => ({ seat: t.seat, turn: t.dispatched?.turn, error: t.reportError })),
							cards: state().openCards.map((c) => c.id),
							errors: vi
								.mocked(deps.onError)
								.mock.calls.slice(-2)
								.map((e) => String(e[0])),
						})
					).toBeDefined();
					if (!request) break;
					handled.add(request.dispatchId!);
					const scene = teamM2Scene(
						{ seat: request.seat, scenario, brief: teamM2Brief },
						request.prompt,
						path.join(root, request.seat)
					) as { answer: string; writes?: Record<string, string> };
					for (const [name, text] of Object.entries(scene.writes ?? {})) {
						expect(request.permissionMode).toBe('full');
						if (request.seat === 'qa') expect(name.startsWith('qa/')).toBe(true);
						files.set(name, text);
					}
					if (scene.writes && request.seat === 'dev') hash = `script-${handled.size}`;
					await finish(request, scene.answer);
					expect(events.filter((e) => e.kind === 'report_rejected')).toEqual([]);
				}
				expect(done()).toBe(true);
			};
			const baselineCard = () => state().openCards.some((c) => c.boundary === 'baseline');
			const demoCard = () => state().openCards.some((c) => c.boundary === 'acceptance');
			try {
				await scheduler.start();
				await scheduler.create({ ...config, turnBudget: 200 });
				await pump(baselineCard);
				if (scenario === 'review') {
					await scheduler.baselineEdit(
						teamConfig.id,
						'A1',
						'Output contains implemented heading in the document'
					);
					await pump(baselineCard);
					expect((await scheduler.baselineDiff(teamConfig.id)).criteria.map((c) => c.id)).toEqual([
						'A1',
					]);
					await scheduler.baselineReturn(teamConfig.id, 'Include the footer');
					await pump(baselineCard);
					expect((await scheduler.baselineDiff(teamConfig.id)).criteria.map((c) => c.id)).toEqual([
						'E1',
					]);
				}
				await confirm();
				if (scenario === 'review') {
					const work = latest('dev', 'work');
					expect(work).toBeDefined();
					await scheduler.say(teamConfig.id, 'Please explain the sample', 'dev');
					await drain();
					expect(state().pendingMessages).toHaveLength(1);
					expect(state().messages[0].delivered).toBeUndefined();
				}
				if (scenario === 'commitment' || scenario === 'relaxation') {
					await pump(() => state().openCards.some((c) => c.boundary === 'commitment'));
					const card = state().openCards.find((c) => c.boundary === 'commitment')!;
					expect(card.body).toContain('sealed position');
					expect(card.referenceVotes).toContain('Reference only');
					if (scenario === 'relaxation') {
						expect(state().criteria[0]).toMatchObject({
							text: teamM2Brief.criteria[0].text,
							status: 'fail',
						});
						expect(card.body).toContain('"failingNow":true');
					}
					return;
				}
				await pump(demoCard);
				expect(state().criteria.every((c) => c.status === 'pass')).toBe(true);
				if (scenario === 'discussion' || scenario === 'contested') {
					const meeting = state().discussions.find((d) => d.opened?.trigger === 'member')!;
					expect(meeting.positions).toHaveLength(3);
					expect(meeting.proposals).toHaveLength(scenario === 'contested' ? 2 : 1);
					expect(meeting.decision).toMatchObject({
						decider: 'dev',
						contested: scenario === 'contested',
					});
					expect(
						events.filter((e) => e.kind === 'decision_card').map((e) => e.card.boundary)
					).toEqual(['baseline', 'acceptance']);
					await scheduler.say(teamConfig.id, 'REOPEN the same decision', 'dev');
					await pump(() => events.some((e) => e.kind === 'topic_rejected'));
				} else {
					expect(state().messages[0].handled?.seat).toBe('dev');
					expect(state().rejectionCount).toBe(3);
					expect(state().retros).toHaveLength(1);
					const third = state().reviews[2];
					const thirdState = reduceLedger(events.filter((e) => e.seq <= third.seq));
					expect(
						thirdState.reviewProgress.attempts.filter((a) => !a.diagnosis).at(-1)!.verdict
					).toBe('evidence');
					expect(thirdState.demos).toEqual([]);
					expect(thirdState.openCards).toEqual([]);
					await scheduler.requestChanges(teamConfig.id, 'Also explain empty input');
					await pump(() => state().demos.length === 2);
					expect(state().demos[1].criterionIds).toHaveLength(1);
					expect(state().criteria.some((c) => c.text === 'Also explain empty input')).toBe(true);
					expect(state().outputs.at(-1)?.beforeOutputId).toBeDefined();
					await drain();
				}
				await scheduler.answer(
					teamConfig.id,
					state().openCards.find((c) => c.boundary === 'acceptance')!.id,
					'accept'
				);
				await drain();
				expect(state().terminal).toBe('all');
			} finally {
				fs.rmSync(root, { recursive: true, force: true });
			}
		},
		// Full scripted flows through real scheduling and validation; slow on loaded or Windows hosts.
		60_000
	);
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
		expect(requests).toHaveLength(3);
		expect(requests[2].turn).toBe('recovery');
		expect(requests[2].permissionMode).toBe('readonly');
	});

	it.each(['turn-failed'] as const)(
		'latches immediate %s discussion failures after one retry across fallback wakes and restart',
		async (kind) => {
			await toBaseline();
			const before = requests.length;
			const dispatch = vi.mocked(deps.dispatcher.dispatch).getMockImplementation()!;
			vi.mocked(deps.dispatcher.dispatch).mockImplementation((request) => {
				if (request.turn !== 'position' || request.seat === 'pm') return dispatch(request);
				requests.push(request);
				if (kind === 'turn-failed')
					return Promise.reject(
						new Error('PM must be read-only; dev and QA require write permissions')
					);
				return Promise.resolve({
					...result(request, ''),
					exitCode: null,
					durationMs: 0,
					livenessEvents: 0,
					failure: { kind, detail: 'Requested model is unavailable' },
				});
			});
			await scheduler.baselineReturn(teamConfig.id, 'Include the footer');
			await drain();
			const discussionId = state().discussions.at(-1)!.id;
			await finish(latest('pm', 'position'), {
				type: 'position',
				discussionId,
				claim: 'Keep the footer',
				basis: 'Confirmed criterion',
				wouldChangeMind: 'New output',
			});
			await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS * 10);
			await drain();
			scheduler.dispose();
			scheduler = createTeamScheduler(deps);
			await scheduler.start();
			await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS * 10);
			await drain();
			expect(requests.slice(before)).toHaveLength(5); // PM position plus two attempts per failed seat.
			for (const seat of ['dev', 'qa'] as const) {
				const attempts = state().turns.filter(
					(turn) => turn.seat === seat && turn.dispatched?.turn === 'position'
				);
				expect(attempts).toHaveLength(2);
				expect(attempts[1].dispatched?.retryOf).toBe(attempts[0].dispatchId);
				expect(attempts.every((turn) => turn.finished?.failureKind === kind)).toBe(true);
				expect(teamStatus(state(), Date.now()).seats.find((s) => s.seat === seat)).toMatchObject({
					status: 'fault',
					lastFault: kind,
				});
			}
			expect(state().openCards).toEqual([]);
			expect(teamStatus(state(), Date.now()).waitingFor.join('\n')).not.toContain(
				'Scheduler to wake'
			);
			expect(deps.workspaces(teamConfig, false).enforceQaBoundary).not.toHaveBeenCalled();

			// Explicit recovery re-enables only that seat, even after replay.
			vi.mocked(deps.dispatcher.dispatch).mockImplementation(dispatch);
			await emit({ kind: 'member_recovered', seat: 'qa', how: 'Provider became available' });
			const positions = requests.slice(before).filter((r) => r.turn === 'position');
			expect(positions.filter((r) => r.seat === 'qa')).toHaveLength(3);
			expect(positions.filter((r) => r.seat === 'dev')).toHaveLength(2);
			// A targeted owner message is a different assignment with new input.
			await scheduler.say(teamConfig.id, 'Explain the failure', 'dev');
			await drain();
			expect(latest('dev', 'message')).toBeDefined();
		}
	);

	it.each(['owner answer', 'member recovery'])(
		'restarts an exhausted phase assignment only after %s changes its condition',
		async (reset) => {
			await begin();
			for (let i = 0; i < 2; i++) {
				const request = latest('pm', 'brief');
				completions.get(request.dispatchId!)!({
					...result(request, ''),
					exitCode: 1,
					durationMs: 0,
				});
				await drain();
				await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS);
				await drain();
			}
			expect(requests).toHaveLength(2);
			expect(state().seats.pm.lastFault?.fault).toBe('turn-failed');
			// An unrelated observation must not turn another UUID into permission to retry.
			await emit(check);
			await scheduler.wake(teamConfig.id);
			expect(requests).toHaveLength(2);
			if (reset === 'member recovery') {
				await emit({ kind: 'member_recovered', seat: 'pm', how: 'Provider recovered' });
			} else {
				await emit({
					kind: 'decision_card',
					card: {
						id: 'permission:checks',
						boundary: 'permission',
						title: 'Allow checks',
						body: 'Checks need authorization',
						options: [{ id: 'allow', label: 'Allow' }],
					},
				});
				await scheduler.answer(teamConfig.id, 'permission:checks', 'allow');
				await drain();
			}
			expect(requests).toHaveLength(3);
			expect(requests[2].turn).toBe('brief');
			await finish(requests[2], goodReports.brief);
			expect(state().seats.pm.faultActive).toBe(false);
			expect(state().brief).not.toBeNull();
		}
	);

	it.each(['turn-failed', 'model-unavailable'] as const)(
		'does not grant fresh retries to duplicate %s roots already persisted by the old scheduler',
		async (kind) => {
			events = ledger(
				...baseline,
				...bindings,
				{
					kind: 'discussion_opened',
					discussionId: 'returned-baseline',
					trigger: 'baseline-return',
					topic: 'Include the footer',
					owner: 'dev',
					participants: ['dev'],
					layer: 'implementation',
				},
				...['old-root', 'duplicate-root'].flatMap((dispatchId): EventInput[] => [
					{
						kind: 'turn_dispatched',
						dispatchId,
						seat: 'dev',
						turn: 'position',
						discussionId: 'returned-baseline',
						promptDigest: 'old-policy',
					},
					{
						kind: 'turn_finished',
						dispatchId,
						seat: 'dev',
						exitCode: null,
						durationMs: 0,
						failureKind: kind,
					},
					{ kind: 'member_fault', seat: 'dev', fault: kind },
				])
			);
			for (const event of events)
				if (event.kind === 'team_created')
					event.config = {
						...event.config,
						authorizations: { ...event.config.authorizations, temporaryTakeover: false },
					};
			await scheduler.start();
			await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS * 10);
			await drain();
			expect(requests).toEqual([]);
			expect(state().usage.turns).toBe(2);
			expect(state().seats.dev.faultActive).toBe(true);
			expect(state().openCards).toEqual([]);
		}
	);

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
		await completeDiscussion();
		await completeActions();
		await finish(latest('pm', 'respond'), {
			...goodReports.respond,
			askOwner: 'Does this scope meet the request?',
		} as TeamReport);
		await finish(latest('dev', 'challenge'), { type: 'challenge', objections: [] });
		await finish(latest('qa', 'challenge'), goodReports.challenge);
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
		await finish(requests[0], {
			type: 'message',
			summary: 'Restated request',
			messages: [{ messageId: state().pendingMessages[0].messageId, scope: false }],
		});
		await completeDiscussion();
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
			expect(requests.filter((r) => r.turn === 'recovery')).toEqual([]);
			expect(deps.onError).not.toHaveBeenCalled();
		}
	);

	it('M1 repaired brief and challenge reach the default-authorized baseline without PM recovery', async () => {
		await begin();
		await finish(latest('pm', 'brief'), 'The brief was written without its report block');
		await finish(requests.at(-1)!, goodReports.brief);
		expect(requests.filter((r) => r.turn === 'recovery')).toEqual([]);
		await finish(latest('qa', 'challenge'), goodReports.challenge);
		await finish(latest('dev', 'challenge'), '```team-report\n{broken}\n```');
		await finish(requests.at(-1)!, { type: 'challenge', objections: [] });
		await finish(latest('pm', 'respond'), goodReports.respond);
		expect(state().openCards.map((c) => c.boundary)).toEqual(['baseline']);
		expect(requests.filter((r) => r.turn === 'recovery')).toEqual([]);
	});

	it.each(['Missing report text', '```team-report\n{broken}\n```'])(
		'M3 successful review repair resumes demo after %s',
		async (bad) => {
			await toReview();
			const original = latest('pm', 'review');
			await finish(original, bad);
			const repair = requests.at(-1)!;
			const rejected = state().turns.find((t) => t.dispatchId === original.dispatchId)!;
			expect(repair.prompt).toContain(rejected.finished!.reportError);
			expect(repair.prompt).toContain('Do not redo work');
			await finish(repair, goodReports.review);
			expect(requests.filter((r) => r.turn === 'recovery')).toEqual([]);
			expect(latest('pm', 'demo')).toBeDefined();
			await finish(latest('pm', 'demo'), goodReports.demo);
			expect(state().openCards.map((c) => c.boundary)).toEqual(['acceptance']);
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

	it.each([true, false])(
		'M3 restart inspects the real interrupted workspace before reconciliation (native result: %s)',
		async (present) => {
			scheduler.dispose();
			vi.useRealTimers();
			const root = createNativeTempDir('team-restart-workspace-');
			const project = path.join(root, 'project');
			fs.mkdirSync(project);
			try {
				for (const args of [
					['init'],
					['config', 'user.name', 'Team fixture'],
					['config', 'user.email', 'fixture@example.invalid'],
					['config', 'commit.gpgsign', 'false'],
					['config', 'core.hooksPath', path.join(root, 'no-hooks')],
				])
					execFileSync('git', args, { cwd: project, stdio: 'pipe' });
				fs.writeFileSync(path.join(project, 'result.txt'), 'initial');
				execFileSync('git', ['add', '.'], { cwd: project });
				execFileSync('git', ['commit', '-m', 'Initial'], { cwd: project });
				const options = {
					root: path.join(root, 'owned'),
					projectRoot: project,
					slug: config.id,
					pushAuthorized: true,
				};
				const original = await createTeamWorkspaces(options).initialize();
				fs.writeFileSync(path.join(original.dev, 'result.txt'), 'Completed external effect');
				teamConfig = { ...teamConfig, projectRoot: project, turnBudget: 2 };
				events = ledger(
					{ kind: 'team_created', config: teamConfig },
					// Keep independent scheduling on hold while testing the interrupted turn.
					{
						kind: 'decision_card',
						card: {
							id: 'hold',
							boundary: 'permission',
							title: 'Hold new assignments',
							body: 'Await owner decision',
							options: [{ id: 'allow', label: 'Authorize' }],
						},
					},
					...(['pm', 'dev', 'qa'] as const).map((seat) => ({
						kind: 'seat_bound' as const,
						seat,
						workspace: original[seat],
						model: config.seats[seat],
					})),
					{
						kind: 'turn_dispatched',
						seat: 'dev',
						dispatchId: 'interrupted',
						turn: 'work',
						promptDigest: '',
					}
				);
				deps.workspaces = () => createTeamWorkspaces(options);
				const text = `\`\`\`team-report\n${JSON.stringify(goodReports.work)}\n\`\`\``;
				vi.mocked(deps.reconcile).mockImplementation(async (request) => {
					expect(events).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								kind: 'workspace_inspected',
								dispatchId: 'interrupted',
								status: expect.stringContaining('result.txt'),
							}),
						])
					);
					expect(fs.readFileSync(path.join(request.cwd, 'result.txt'), 'utf8')).toBe(
						'Completed external effect'
					);
					return present ? result(request, text) : null;
				});
				vi.mocked(deps.dispatcher.dispatch).mockImplementation(async (request) => {
					expect(request.dispatchId).toBe('interrupted');
					expect(request.prompt).toContain('Workspace inspection');
					return result(request, text);
				});
				scheduler = createTeamScheduler(deps);
				await scheduler.start();
				await vi.waitFor(() => expect(state().turns[0].report?.type).toBe('work'));
				expect(deps.dispatcher.dispatch).toHaveBeenCalledTimes(present ? 0 : 1);
				expect(events.filter((e) => e.kind === 'turn_dispatched')).toHaveLength(1);
				expect(fs.readFileSync(path.join(original.dev, 'result.txt'), 'utf8')).toBe(
					'Completed external effect'
				);
				expect(deps.onError).not.toHaveBeenCalled();
			} finally {
				scheduler.dispose();
				fs.rmSync(root, { recursive: true, force: true });
			}
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

	it.each(['continue', 'diagnose', 'gather', 'escalate'] as const)(
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
					...(expected === 'escalate'
						? {
								candidates: [
									{
										plan: 'Change the promised output',
										boundary: 'commitment' as const,
										cost: 'A smaller deliverable',
										recommended: true,
									},
								],
							}
						: {}),
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
			expect(dispatched.mode).toBe(expected === 'gather' ? 'gather' : undefined);
			if (expected === 'gather') expect(requests.at(-1)!.prompt).toContain('Do not repeat');
			if (expected === 'diagnose') {
				expect(state().discussions[0].opened?.trigger).toBe('no-progress');
				expect(dispatched.turn).toBe('position');
			}
			if (expected === 'escalate') {
				expect(requests).toEqual([]);
				expect(state().openCards).toHaveLength(1);
				expect(state().openCards[0]).toMatchObject({
					boundary: 'commitment',
					boundaries: ['commitment'],
				});
				expect(state().openCards[0].budgetNote).toContain('/');
				expect(state().openCards[0].options).toHaveLength(2);
				expect(state().openCards[0].body).toContain('attempt-0');
			} else expect(state().openCards).toEqual([]);
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
	it('T5 accepts a member topic, seals positions and turns an in-scope conclusion into per-seat work', async () => {
		await toReview();
		await finish(latest('pm', 'review'), {
			...goodReports.review,
			topic: {
				topic: 'Implementation choice',
				why: 'Two valid approaches',
				layer: 'implementation',
				participants: ['dev', 'qa'],
				evidence: [],
			},
		} as TeamReport);
		const id = await completeDiscussion();
		const meeting = state().discussions.find((d) => d.id === id)!;
		expect(meeting.positions).toHaveLength(2);
		expect(meeting.decision).toMatchObject({ decider: 'dev', contested: false });
		expect(state().openCards).toEqual([]);
		expect(state().workItems.filter((w) => w.discussionId === id)).toHaveLength(2);
		expect(latest('dev', 'work').prompt).toContain('dev implements the conclusion');
		expect(latest('qa', 'qa_prep').prompt).toContain('qa implements the conclusion');
		const positions = requests.filter((r) => r.prompt.includes('Turn: position.'));
		expect(positions.every((r) => r.nativeSessionId === undefined)).toBe(true);
		expect(positions.find((r) => r.seat === 'qa')!.prompt).not.toContain('dev basis');
	});
	it('T5 decides a reversible question as contested after two rounds without new evidence', async () => {
		await toReview();
		await finish(latest('pm', 'review'), {
			...goodReports.review,
			topic: {
				topic: 'Implementation',
				why: 'Objection',
				layer: 'implementation',
				participants: ['dev', 'qa'],
			},
		} as TeamReport);
		const id = await completeDiscussion({ rounds: 2, insist: true });
		expect(state().discussions.find((d) => d.id === id)!.decision).toMatchObject({
			decider: 'dev',
			contested: true,
		});
		expect(state().openCards).toEqual([]);
	});
	it('requires an experiment for two evidenced objections, records it once, then decides from its result', async () => {
		await toReview();
		await finish(latest('pm', 'review'), {
			...goodReports.review,
			topic: {
				topic: 'Layout strategy',
				why: 'Measured objections',
				layer: 'implementation',
				participants: ['pm', 'dev', 'qa'],
			},
		} as TeamReport);
		const id = await completeDiscussion({ insist: true, evidence: state().checks[0].evidenceId });
		expect(latest('dev', 'proposal').prompt).toContain('Two non-owners object with evidence');
		expect(state().discussions.find((d) => d.id === id)!.decision).toBeUndefined();
		await completeDiscussion({
			rounds: 3,
			insist: true,
			experiment: 'measure-layout',
			waitForQa: 'New measured output',
		});
		expect(state().checks.filter((c) => c.command === 'measure-layout')).toHaveLength(1);
		expect(state().discussions.find((d) => d.id === id)!.decision).toMatchObject({
			decider: 'dev',
			contested: true,
		});
		expect(
			state().followUps.some((f) => f.seat === 'qa' && f.waitFor === 'New measured output')
		).toBe(true);
		expect(deps.followUps.register).toHaveBeenCalled();
		expect(state().openCards).toEqual([]);
	});
	it('allows a third round for newly introduced evidence without reopening a closed decision', async () => {
		await toReview();
		await finish(latest('pm', 'review'), {
			...goodReports.review,
			topic: {
				topic: 'Formatting',
				why: 'Measured disagreement',
				layer: 'implementation',
				participants: ['dev', 'qa'],
			},
		} as TeamReport);
		const id = await completeDiscussion({
			rounds: 3,
			insist: true,
			evidenceByRound: { 2: state().checks[0].evidenceId },
		});
		expect(state().discussions.find((d) => d.id === id)!.proposals).toHaveLength(3);
		expect(state().discussions.find((d) => d.id === id)!.decision?.contested).toBe(true);
		expect(state().openCards).toEqual([]);
	});
	it('records a PM tightening only after a dev estimate and returns to implementation without an owner card', async () => {
		await toReview();
		await finish(latest('pm', 'review'), {
			...goodReports.review,
			standardChanges: [
				{
					criterionId: 'E1',
					change: 'tighten',
					reason: 'Clarify readability',
					withinMeaning: 'Readability already promised',
					criterion: {
						id: 'E1',
						text: 'Results are readable; include the footer',
						proof: 'pm',
						how: 'Inspect the rendered preview',
						experience: true,
					},
				},
			],
		} as TeamReport);
		await completeDiscussion();
		expect(state().standardChanges.at(-1)).toMatchObject({ approvedBy: 'pm', change: 'tighten' });
		expect(state().criteria.find((c) => c.id === 'E1')?.status).toBe('unproven');
		expect(state().phase).toBe('implement');
		expect(state().openCards).toEqual([]);
	});
	it('T5 sends a commitment decision to the owner with positions and reference votes', async () => {
		await toReview();
		await finish(latest('pm', 'review'), {
			...goodReports.review,
			topic: {
				topic: 'Remove promised output',
				why: 'Cannot fit',
				layer: 'commitment',
				participants: ['pm', 'dev', 'qa'],
			},
		} as TeamReport);
		await completeDiscussion();
		expect(state().openCards).toHaveLength(1);
		expect(state().openCards[0]).toMatchObject({
			boundary: 'commitment',
			referenceVotes: expect.stringContaining('2 vendor groups'),
		});
		expect(state().openCards[0].body).toContain('qa position');
		expect(state().decisions).toEqual([]);
	});
	it('T6 preserves a failing criterion while a relaxation application awaits the owner', async () => {
		await toReview();
		await emit({ ...check, exitCode: 1 });
		await finish(latest('pm', 'review'), {
			...goodReports.review,
			standardChanges: [
				{
					criterionId: 'A1',
					change: 'relax',
					criterion: {
						id: 'A1',
						text: 'Hours optional',
						proof: 'app',
						how: 'Run the test command',
					},
					reason: 'Failing implementation',
				},
			],
		} as TeamReport);
		await completeDiscussion();
		expect(state().criteria.find((c) => c.id === 'A1')).toMatchObject({
			text: 'Parses hours',
			status: 'fail',
		});
		const target = state().openCards[0];
		expect(target.body).toContain('"failingNow":true');
		expect(target.body).toContain('Hours optional');
		await scheduler.answer(teamConfig.id, target.id, 'keep');
		await drain();
		expect(state().criteria[0].text).toBe('Parses hours');
		expect(
			state()
				.workItems.filter((w) => w.discussionId)
				.every((w) => w.title.includes('preserves'))
		).toBe(true);
	});
	it('PM revisions cap challenges at two rounds, show only changed criteria, and survive restart', async () => {
		await begin();
		await finish(latest('pm', 'brief'), goodReports.brief);
		await finish(latest('dev', 'challenge'), { type: 'challenge', objections: [] });
		await finish(latest('qa', 'challenge'), goodReports.challenge);
		const source = (goodReports.respond as Extract<TeamReport, { type: 'respond' }>).brief!;
		const revised = {
			...source,
			criteria: source.criteria.map((c) =>
				c.id === 'A1' ? { ...c, text: 'Parses whole hours' } : c
			),
		};
		await finish(latest('pm', 'respond'), { type: 'respond', decisions: [], brief: revised });
		for (const seat of ['dev', 'qa'] as const) {
			const prompt = latest(seat, 'challenge').prompt;
			expect(prompt).toContain('"round": 2');
			expect(prompt).toContain('Parses hours');
			expect(prompt).toContain('Parses whole hours');
			expect(prompt).not.toContain('Results are readable');
			expect(prompt).not.toContain('Rejects bad input');
		}
		await finish(latest('dev', 'challenge'), {
			type: 'challenge',
			objections: [{ about: 'A1', kind: 'risk', problem: 'What about fractional hours?' }],
		});
		await finish(latest('qa', 'challenge'), {
			type: 'challenge',
			objections: [],
			plans: [{ criterion: 'A1', how: 'Check integers', data: '1h' }],
		});
		await finish(latest('pm', 'respond'), {
			type: 'respond',
			decisions: [
				{ about: 'A1', result: 'reject', reason: 'Fractional input is outside this draft scope' },
			],
			brief: {
				...revised,
				criteria: revised.criteria.map((c) =>
					c.id === 'A1' ? { ...c, text: 'Accept integer hours only' } : c
				),
			},
			askOwner: 'Confirm the integer-only boundary or add fractional input to scope.',
		});
		expect(requests.filter((r) => r.turn === 'challenge')).toHaveLength(4);
		expect(state().openCards.map((c) => c.boundary)).toEqual(['baseline']);
		expect(state().openCards[0].body).toContain('What about fractional hours?');
		expect(state().openCards[0].body).toContain('integer-only boundary');
		scheduler.dispose();
		scheduler = createTeamScheduler(deps);
		await scheduler.start();
		await drain();
		expect(requests.filter((r) => r.turn === 'challenge')).toHaveLength(4);
		expect(events.some((e) => e.kind === 'report_rejected')).toBe(false);
	});
	it('T7 owner baseline edit starts a fresh full challenge, keeps history and reruns canaries', async () => {
		await toBaseline();
		const originalVersion = state().brief!.version;
		await scheduler.baselineEdit(teamConfig.id, 'A1', 'Parses whole hours');
		await drain();
		expect(state().briefs.find((b) => b.version === originalVersion)!.criteria[0].text).toBe(
			'Parses hours'
		);
		expect((await scheduler.baselineDiff(teamConfig.id)).criteria.map((c) => c.id)).toEqual(['A1']);
		expect(latest('qa', 'challenge').prompt).toContain('"round": 1');
		expect(latest('qa', 'challenge').prompt).toContain('Results are readable');
		await finish(latest('dev', 'challenge'), { type: 'challenge', objections: [] });
		await finish(latest('qa', 'challenge'), goodReports.challenge);
		const source = (goodReports.respond as Extract<TeamReport, { type: 'respond' }>).brief!;
		const edited = {
			...source,
			criteria: source.criteria.map((c) =>
				c.id === 'A1' ? { ...c, text: 'Parses whole hours' } : c
			),
		};
		await finish(latest('pm', 'respond'), { type: 'respond', decisions: [], brief: edited });
		expect(state().checks.filter((c) => c.purpose === 'trial')).toHaveLength(2);
		await confirm();
		expect(state().criteria[0].text).toBe('Parses whole hours');
	});
	it('re-challenges an amended brief after a return and preserves its minimal diff after PM acknowledges it', async () => {
		await toBaseline();
		await scheduler.baselineReturn(teamConfig.id, 'Include the footer');
		await drain();
		await completeDiscussion();
		await completeActions();
		const source = (goodReports.respond as Extract<TeamReport, { type: 'respond' }>).brief!;
		const amended = {
			...source,
			criteria: source.criteria.map((c) =>
				c.id === 'E1' ? { ...c, text: `${c.text}; footer included` } : c
			),
		};
		await finish(latest('pm', 'respond'), { type: 'respond', decisions: [], brief: amended });
		expect(latest('qa', 'challenge').prompt).toContain('"round": 1');
		expect(latest('qa', 'challenge').prompt).toContain('Rejects bad input');
		await finish(latest('dev', 'challenge'), goodReports.challenge);
		await finish(latest('qa', 'challenge'), goodReports.challenge);
		await finish(latest('pm', 'respond'), { type: 'respond', decisions: [], brief: amended });
		expect((await scheduler.baselineDiff(teamConfig.id)).criteria.map((c) => c.id)).toEqual(['E1']);
		expect(state().openCards[0].boundary).toBe('baseline');
		expect(state().challenges).toHaveLength(4);
	});
	it('T7 refuses baseline confirmation until the edited version has runnable commands', async () => {
		await toBaseline();
		await scheduler.pause(teamConfig.id);
		await scheduler.baselineEdit(teamConfig.id, 'A1', 'Parses whole hours');
		await expect(
			scheduler.answer(teamConfig.id, state().cardAnswers[0]?.cardId ?? 'old-card', 'confirm')
		).rejects.toThrow();
		expect(state().baseline.confirmedVersion).toBeNull();
	});
	it('T8 approves a boundary-crossing check per invocation without widening the workspace grant', async () => {
		await begin();
		const checks = [
			{ command: 'node inspect-remote.cjs', covers: ['A1'], boundary: 'external-write' as const },
		];
		await finish(latest('pm', 'brief'), { ...goodReports.brief, checks } as TeamReport);
		await finish(latest('dev', 'challenge'), goodReports.challenge);
		await finish(latest('qa', 'challenge'), goodReports.challenge);
		await finish(latest('pm', 'respond'), {
			...goodReports.respond,
			brief: {
				...(goodReports.respond as Extract<TeamReport, { type: 'respond' }>).brief!,
				checks,
			},
		} as TeamReport);
		const target = state().openCards[0];
		expect(target).toMatchObject({ boundary: 'permission', title: 'Approve this check once' });
		expect(target.body).toContain('external-write');
		expect(deps.checks.run).not.toHaveBeenCalled();
		await scheduler.answer(teamConfig.id, target.id, 'once');
		await drain();
		expect(deps.checks.run).toHaveBeenCalledOnce();
		await confirm();
		await finish(latest('dev', 'work'), goodReports.work);
		await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
		expect(state().openCards[0].boundary).toBe('permission');
		expect(state().openCards[0].id).not.toBe(target.id);
		expect(deps.checks.run).toHaveBeenCalledOnce();
	});
	it('T9 delivers only to the addressed seat after its current turn and records delivered/handled states', async () => {
		await toBaseline();
		await confirm();
		const before = requests.length;
		await scheduler.say(teamConfig.id, 'Please explain the sample', 'qa');
		await drain();
		expect(requests).toHaveLength(before);
		const messageId = state().pendingMessages[0].messageId;
		await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
		expect(requests.at(-1)!.seat).toBe('qa');
		expect(requests.at(-1)!.prompt).toContain('Please explain the sample');
		expect(state().messages[0].delivered?.seat).toBe('qa');
		await finish(requests.at(-1)!, {
			type: 'message',
			summary: 'Explained it',
			messages: [{ messageId, scope: false }],
		});
		expect(state().messages[0].handled?.summary).toBe('Explained it');
		expect(state().pendingMessages).toEqual([]);
		expect(requests.slice(before).every((r) => r.seat === 'qa')).toBe(true);
	});
	it('T9 routes a member conversation requirement to PM, which applies owner scope directly', async () => {
		await toBaseline();
		await scheduler.say(teamConfig.id, 'Also handle empty input', 'dev');
		await drain();
		const messageId = state().pendingMessages[0].messageId;
		await finish(latest('dev', 'message'), {
			type: 'message',
			summary: 'This adds scope; PM must record it',
			messages: [{ messageId, scope: true }],
		});
		expect(state().messages[0].forwarded?.from).toBe('dev');
		expect(requests.at(-1)!.seat).toBe('pm');
		// Confirm the baseline first so the owner addition has a committed target.
		await confirm();
		await finish(latest('pm', 'message'), {
			type: 'message',
			summary: 'Recorded empty input',
			messages: [{ messageId, scope: true }],
		});
		expect(state().standardChanges.at(-1)).toMatchObject({
			approvedBy: 'owner',
			ownerMessageId: messageId,
		});
		expect(state().criteria.find((c) => c.id === `owner:${messageId}`)?.text).toBe(
			'Also handle empty input'
		);
		expect(state().workItems.some((w) => w.criterionId === `owner:${messageId}`)).toBe(true);
		expect(state().openCards.some((c) => c.boundary === 'commitment')).toBe(false);
	});
	it('applies an owner removal to its existing criterion and retains superseded issues as history', async () => {
		await toBaseline();
		await scheduler.say(teamConfig.id, 'Remove the hours requirement');
		await drain();
		const messageId = state().pendingMessages[0].messageId;
		await confirm();
		await emit({
			kind: 'issue_opened',
			actor: 'qa',
			issueId: 'hours',
			issueKind: 'defect',
			criterionId: 'A1',
			title: 'Hours fail',
		});
		await finish(latest('pm', 'message'), {
			type: 'message',
			summary: 'Removed A1 as instructed',
			messages: [{ messageId, scope: true, change: 'remove', criterionId: 'A1' }],
		});
		expect(state().criteria.some((c) => c.id === 'A1')).toBe(false);
		expect(state().standardChanges.at(-1)).toMatchObject({
			approvedBy: 'owner',
			change: 'remove',
			reason: 'Remove the hours requirement',
		});
		expect(state().issues.find((i) => i.id === 'hours')?.state).toBe('superseded');
		expect(state().baseline.brief!.checks).toEqual([]);
		expect(state().openCards.some((c) => c.boundary === 'commitment')).toBe(false);
	});
	it('recaptures real output after PM resolves a missing-viewer issue before allowing review', async () => {
		vi.mocked(deps.captureOutput).mockResolvedValue({ files: ['result.txt'], previews: [] });
		await toBaseline();
		await confirm();
		await finish(latest('dev', 'work'), goodReports.work);
		await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
		await finish(latest('qa', 'verify'), goodReports.verify);
		const unresolved = state().issues.find((i) => i.opened.issueKind === 'standard')!;
		expect(unresolved.opened.title).toContain('Output cannot be judged');
		expect(requests.some((r) => r.prompt.includes('Turn: review.'))).toBe(false);
		vi.mocked(deps.captureOutput).mockResolvedValue({
			files: ['result.txt'],
			previews: ['real-preview.png'],
		});
		await finish(latest('pm', 'message'), {
			type: 'message',
			summary: 'Opened the named viewer',
			messages: [],
			resolvedStandards: [{ issueId: unresolved.id, reason: 'Viewer is ready' }],
		});
		expect(state().outputs.at(-1)?.outputId).toContain('recapture:');
		expect(latest('pm', 'review')).toBeDefined();
		expect(deps.onError).not.toHaveBeenCalled();
	});
	it('routes an unjudgeable standard raised by dev to a PM discussion and preparation, never a dev fix', async () => {
		await toBaseline();
		await confirm();
		await finish(latest('dev', 'work'), {
			...goodReports.work,
			topic: {
				topic: 'Meaning of readable is contradictory',
				why: 'The two examples conflict',
				kind: 'standard',
				criterionId: 'E1',
				participants: ['dev', 'pm'],
			},
		} as TeamReport);
		await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
		const id = await completeDiscussion();
		expect(state().discussions.find((d) => d.id === id)?.opened).toMatchObject({
			owner: 'pm',
			trigger: 'standard-issue',
		});
		expect(state().issues[0].opened).toMatchObject({ issueKind: 'standard', criterionId: 'E1' });
		expect(latest('dev', 'message')).toBeDefined();
		expect(requests.some((r) => r.prompt.includes('Turn: fix.'))).toBe(false);
	});
	it('marks reduced or skipped tests against the baseline canary without inventing evidence totals', async () => {
		const original = vi.mocked(deps.checks.run).getMockImplementation()!;
		let run = 0;
		vi.mocked(deps.checks.run).mockImplementation(async (request) => ({
			...(await original(request)),
			testsRun: ++run === 1 ? 12 : 8,
			testsSkipped: run === 1 ? 0 : 4,
		}));
		await toReview();
		expect(state().checks.at(-1)?.dilution).toEqual(['Fewer tests ran', 'More tests were skipped']);
		await finish(latest('pm', 'review'), goodReports.review);
		expect(latest('pm', 'demo').prompt).toContain('Fewer tests ran');
	});
	it('preserves the recorded assignment when reading a member log across prompt-template versions', async () => {
		events = ledger(...baseline, ...bindings, {
			kind: 'turn_dispatched',
			seat: 'dev',
			dispatchId: 'previous-version',
			turn: 'work',
			promptDigest: 'old-digest',
			prompt: 'Exact assignment from an earlier version',
		});
		expect((await scheduler.log(teamConfig.id, 'dev'))[0].prompt).toBe(
			'Exact assignment from an earlier version'
		);
	});
	it('T10 exposes the exact assigned prompts and visible replies for each member', async () => {
		await toBaseline();
		const log = await scheduler.log(teamConfig.id, 'qa');
		expect(log).toHaveLength(1);
		expect(log[0]).toMatchObject({
			seat: 'qa',
			prompt: latest('qa', 'challenge').prompt,
			reply: 'qa visible reply',
		});
	});
	it('T13 rejects any criterion violation, turns unconfirmed ideas into suggestions, and never demos early', async () => {
		await toReview();
		expect(latest('pm', 'review').prompt).toContain('/project/dev/result.png');
		await finish(latest('pm', 'review'), {
			type: 'review',
			verdict: 'pass',
			problems: [
				{
					title: 'Tiny overlap',
					location: 'Footer',
					criterion: 'E1',
					impact: 'One word unreadable',
					expected: 'Readable footer',
				},
				{
					title: 'Animation',
					location: 'Header',
					criterion: 'FUTURE',
					impact: 'Could feel nicer',
					expected: 'Animate',
				},
			],
			suggestions: [],
		});
		expect(state().reviews.at(-1)!.verdict).toBe('reject');
		expect(state().issues[0].opened).toMatchObject({
			criterionId: 'E1',
			location: 'Footer',
			impact: 'One word unreadable',
			expected: 'Readable footer',
		});
		expect(state().workItems.some((w) => w.title === 'Tiny overlap')).toBe(true);
		expect(state().workItems.some((w) => w.title === 'Animation')).toBe(false);
		expect(state().suggestions.join(' ')).toContain('Animation');
		expect(state().demos).toEqual([]);
		expect(state().openCards).toEqual([]);
	});
	it('T15 requires implement, verify and review for a requested change and demos only the added criterion', async () => {
		await toReview();
		await finish(latest('pm', 'review'), goodReports.review);
		await finish(latest('pm', 'demo'), goodReports.demo);
		await scheduler.requestChanges(teamConfig.id, 'Also explain empty input');
		await drain();
		const added = state().criteria.find((c) => c.text === 'Also explain empty input')!;
		expect(added.status).toBe('unproven');
		expect(state().workItems.some((w) => w.itemId === added.id)).toBe(true);
		expect(state().demos).toHaveLength(1);
		await finish(latest('pm', 'message'), {
			type: 'message',
			summary: 'Recorded the owner request',
			messages: state().pendingMessages.map((m) => ({ messageId: m.messageId, scope: true })),
		});
		await completeDiscussion();
		await completeActions();
		expect(state().demos).toHaveLength(1);
		await finish(latest('qa', 'verify'), {
			type: 'verify',
			criteria: state()
				.criteria.filter((c) => c.proof === 'qa')
				.map((c) => ({ id: c.id, pass: true, evidence: 'qa/empty-input-independent' })),
			issues: [],
		});
		await finish(latest('pm', 'review'), goodReports.review);
		await finish(latest('pm', 'demo'), goodReports.demo);
		expect(state().demos).toHaveLength(2);
		expect(state().demos[1].criterionIds).toEqual([added.id]);
		expect(state().standardChanges.filter((c) => c.criterionId === added.id)).toHaveLength(1);
		expect(state().openCards[0].boundary).toBe('acceptance');
	});
	it('T13 loops through two rejections, an internal retro, progress in review three, and another retro', async () => {
		config.turnBudget = 160;
		try {
			await toReview();
			for (let round = 1; round <= 4; round++) {
				await finish(latest('pm', 'review'), {
					type: 'review',
					verdict: 'reject',
					problems: [
						{
							title: `Readable output round ${round}`,
							location: 'Footer',
							criterion: 'E1',
							impact: 'Unreadable word',
							expected: 'Readable footer',
						},
					],
					suggestions: [],
				});
				const discussionId = await completeDiscussion();
				if (round % 2 === 0) {
					expect(requests.at(-1)!.prompt).toContain('Turn: retro.');
					await finish(requests.at(-1)!, {
						type: 'retro',
						discussionId,
						causes: 'Only one viewer was checked',
						approach: `Approach ${round}`,
						basis: `Independent reproduction ${round}`,
						difference: 'Inspect all views',
						progressEvidence: 'Every named location readable',
					});
				}
				await completeActions();
				const fixed = state()
					.issues.filter((i) => i.state === 'fixed-claimed')
					.map((i) => i.id);
				expect(fixed.length).toBeGreaterThan(0);
				await finish(latest('qa', 'reverify'), {
					type: 'reverify',
					results: fixed.map((issue) => ({ issue, pass: true, evidence: `qa/progress-${round}` })),
					newIssues: [],
				});
				expect(state().demos).toEqual([]);
				expect(state().openCards).toEqual([]);
				if (round === 3) {
					expect(
						state()
							.reviewProgress.attempts.filter((a) => !a.diagnosis)
							.at(-1)?.verdict
					).toBe('evidence');
					expect(state().phase).not.toBe('demo');
				}
			}
			expect(state().retros).toHaveLength(2);
			await finish(latest('pm', 'review'), goodReports.review);
			await finish(latest('pm', 'demo'), goodReports.demo);
			expect(state().openCards[0].boundary).toBe('acceptance');
			expect(deps.onError).not.toHaveBeenCalled();
		} finally {
			config.turnBudget = 40;
		}
	});
	it.each(['wait', 'substitute', 'temporary', 'deadline'] as const)(
		'M3 priority 0: review -> resets 11:10pm -> %s, never a topic retry loop',
		async (mode) => {
			await toReview();
			const original = latest('pm', 'review');
			const created = events.find((e) => e.kind === 'team_created')!;
			if (created.kind !== 'team_created') throw new Error('fixture');
			created.config.authorizations.temporaryTakeover = mode === 'temporary';
			if (mode === 'substitute') created.config.seats.pm.substitute = { tool: 'codex' };
			if (mode === 'deadline') created.config.deadline = Date.now() + 60_000;
			const reset = Date.now() + 2 * 60 * 60_000;
			const used = state().usage.budgetTurns;
			completions.get(original.dispatchId!)!({
				...result(original, ''),
				exitCode: 1,
				durationMs: 20,
				failure: {
					kind: 'model-unavailable',
					detail: "You've hit your 5-hour limit; resets 11:10pm",
					resetsAt: reset,
				},
			});
			await drain();
			for (let i = 0; i < 10; i++) {
				await scheduler.wake(teamConfig.id);
				await drain();
			}
			expect(
				requests.filter(
					(r) =>
						r.seat === 'pm' &&
						r.tool === 'claude-code' &&
						r.turn !== 'brief' &&
						r.turn !== 'respond'
				)
			).toHaveLength(1);
			expect(requests.some((r) => r.turn === 'topic')).toBe(false);
			expect(state().problems).toEqual({});
			expect(state().unavailable[0]).toMatchObject({
				resetsAt: reset,
				detail: expect.stringContaining('resets 11:10pm'),
			});
			expect(state().openCards.some((c) => c.id === 'budget')).toBe(false);
			if (mode === 'wait' || mode === 'deadline') {
				expect(state().usage.turns).toBe(used);
				expect(state().followUps.some((f) => f.unavailabilityId)).toBe(true);
				if (mode === 'deadline')
					expect(state().openCards[0]).toMatchObject({
						boundaries: ['permission', 'budget'],
						options: expect.arrayContaining([
							expect.objectContaining({ id: 'takeover' }),
							expect.objectContaining({ id: 'extend' }),
						]),
					});
				else {
					expect(state().openCards).toEqual([]);
					const receipt = await scheduler.say(teamConfig.id, 'Keep this queued for PM');
					expect(receipt).toMatchObject({
						status: 'queued',
						to: 'pm',
						messageId: expect.any(String),
					});
					await drain();
					expect(state().pendingMessages).toHaveLength(1);
					await scheduler.pause(teamConfig.id);
					scheduler.dispose();
					scheduler = createTeamScheduler(deps);
					await scheduler.start();
					await drain();
					expect(state().pendingMessages).toHaveLength(1);
					vi.setSystemTime(reset);
					await scheduler.resume(teamConfig.id);
					await scheduler.wake(teamConfig.id);
					await drain();
					expect(requests.filter((r) => r.seat === 'pm' && r.turn === 'review')).toHaveLength(2);
				}
			} else {
				const takeover = requests.at(-1)!;
				expect(takeover).toMatchObject({
					seat: 'pm',
					tool: 'codex',
					turn: 'review',
					nativeSessionId: undefined,
				});
				expect(takeover.prompt).toContain('Workspace inspection');
				expect(takeover.prompt).toContain(config.idea);
				expect(takeover.prompt).toContain('decisions');
				expect(state().openCards).toEqual([]);
				expect(state().usage.turns).toBe(used + 1);
			}
			if (mode !== 'deadline') {
				if (mode !== 'wait') await scheduler.say(teamConfig.id, 'Queued question for PM');
				for (
					let step = 0;
					step < 6 && !state().openCards.some((c) => c.boundary === 'acceptance');
					step++
				) {
					await drain();
					const request = requests.find(
						(r) =>
							r.seat === 'pm' && !state().turns.find((t) => t.dispatchId === r.dispatchId)?.finished
					)!;
					expect(request).toBeDefined();
					if (request.turn === 'message')
						await finish(request, {
							type: 'message',
							summary: 'Handled queued question',
							messages: state().pendingMessages.map((m) => ({
								messageId: m.messageId,
								scope: false,
							})),
						});
					else if (request.turn === 'review') await finish(request, goodReports.review);
					else if (request.turn === 'demo') await finish(request, goodReports.demo);
					else throw new Error(`Unexpected recovery turn: ${request.turn}`);
				}
				expect(state().pendingMessages).toEqual([]);
				expect(state().messages.every((m) => !!m.handled)).toBe(true);
				expect(state().openCards.map((c) => c.boundary)).toEqual(['acceptance']);
			}
		}
	);

	it('M3 uses the final reserved turn once and reports a deadline even with an unfinished dispatch', async () => {
		config.turnBudget = 1;
		await begin();
		expect(requests).toHaveLength(1);
		expect(state().openCards).toEqual([]);
		await finish(requests[0], goodReports.brief);
		expect(requests).toHaveLength(1);
		expect(state().openCards[0].boundary).toBe('budget');
		await scheduler.extend(teamConfig.id, { turns: 1 });
		await drain();
		const created = events.find((e) => e.kind === 'team_created')!;
		if (created.kind === 'team_created') created.config.deadline = Date.now();
		// The effective extension carries the deadline as well.
		const extended = events.find((e) => e.kind === 'budget_extended')!;
		if (extended.kind === 'budget_extended') extended.deadline = Date.now();
		await scheduler.resume(teamConfig.id);
		await drain();
		expect(state().openCards.some((c) => c.boundary === 'budget')).toBe(true);
		expect(state().usage.budgetTurns).toBeLessThanOrEqual(2);
	});

	it('M3 failed report repair goes once to PM for organization, without repeating the original work', async () => {
		await begin();
		const original = requests[0];
		await finish(original, 'The scope and criteria were observed but the block was omitted');
		await finish(requests.at(-1)!, 'Still missing a report block');
		await vi.advanceTimersByTimeAsync(TEAM_FAILURE_COOLDOWN_MS);
		await drain();
		const review = requests.at(-1)!;
		expect(review.turn).toBe('recovery');
		expect(review.nativeSessionId).toBeUndefined();
		expect(review.permissionMode).toBe('readonly');
		expect(review.prompt).toContain('Still missing a report');
		await finish(review, {
			type: 'recovery',
			summary: 'Organized the reported facts',
			recoveredJson: JSON.stringify(goodReports.brief),
		});
		expect(state().brief).toBeDefined();
		expect(state().turns.find((t) => t.dispatchId === original.dispatchId)?.report?.type).toBe(
			'brief'
		);
		expect(requests.filter((r) => r.turn === 'brief')).toHaveLength(1);
	});

	it('M3 samples quota before dispatch and keeps non-PM work runnable with a queued PM message', async () => {
		await toBaseline();
		await confirm();
		await finish(latest('dev', 'work'), {
			...goodReports.work,
			claimsComplete: false,
			waiting: {
				reason: 'CI running',
				waitFor: 'CI run',
				condition: { kind: 'ci', runId: '123', cwd: '/project/dev' },
			},
		} as TeamReport);
		await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
		const created = events.find((e) => e.kind === 'team_created')!;
		if (created.kind === 'team_created') created.config.authorizations.temporaryTakeover = false;
		deps.quota = (_config, source) =>
			source === 'pm'
				? { sampledAt: Date.now(), exhausted: true, resetsAt: Date.now() + 60_000 }
				: undefined;
		await scheduler.say(teamConfig.id, 'Queue this for PM');
		await drain();
		expect(requests.some((r) => r.seat === 'pm' && r.turn === 'message')).toBe(false);
		expect(state().pendingMessages).toHaveLength(1);
		expect(state().unavailable).toHaveLength(1);
		expect(state().followUps.some((f) => f.seat === 'dev')).toBe(true);
		expect(state().openCards).toEqual([]);
	});

	it('M3 immediate failure waits N seconds, inspects results, retries once, then holds across restart', async () => {
		await begin();
		const original = requests[0];
		completions.get(original.dispatchId!)!({ ...result(original, ''), exitCode: 1, durationMs: 0 });
		await drain();
		for (let i = 0; i < 5; i++) {
			await scheduler.wake(teamConfig.id);
			await drain();
		}
		expect(requests).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS);
		await drain();
		expect(requests).toHaveLength(2);
		expect(requests[1].prompt).toContain('may have done part');
		expect(requests[1].prompt).toContain('Workspace inspection');
		completions.get(requests[1].dispatchId!)!({
			...result(requests[1], ''),
			exitCode: 1,
			durationMs: 0,
		});
		await drain();
		scheduler.dispose();
		scheduler = createTeamScheduler(deps);
		await scheduler.start();
		await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS * 5);
		await drain();
		expect(requests).toHaveLength(2);
		for (let poll = 0; poll < 2; poll++) {
			const wait = state().followUps.find((f) => f.faultId)!;
			expect(wait).toBeDefined();
			vi.setSystemTime(wait.untilMs!);
			followListener({
				kind: 'wait-timeout',
				at: Date.now(),
				late: false,
				externalStatus: { state: 'waiting', observedAt: Date.now() },
				followUp: {
					id: wait.followUpId,
					target: { kind: 'team', teamId: teamConfig.id, seat: 'pm' },
				} as never,
			});
			await drain();
			expect(requests).toHaveLength(2);
			expect(state().usage.budgetTurns).toBe(2);
			expect(state().followUps.some((f) => !!f.faultId)).toBe(true);
		}
	});

	it('M3 session damage restores the same model in a fresh conversation', async () => {
		await begin();
		const original = requests[0];
		completions.get(original.dispatchId!)!({
			...result(original, ''),
			exitCode: 1,
			failure: { kind: 'session-broken', detail: 'Native session not found' },
		});
		await drain();
		await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS);
		await drain();
		expect(requests[1]).toMatchObject({ tool: original.tool, nativeSessionId: undefined });
		expect(deps.reconcile).toHaveBeenCalled();
		expect(events.some((e) => e.kind === 'workspace_inspected')).toBe(true);
	});

	it('M3 still-working is not a fault, login identifies the account while authorized takeover works', async () => {
		await begin();
		const original = requests[0];
		await emit({ kind: 'member_fault', seat: 'pm', fault: 'still-working' });
		await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS * 3);
		await drain();
		expect(requests).toHaveLength(1);
		expect(state().seats.pm.faultActive).toBe(false);
		completions.get(original.dispatchId!)!({
			...result(original, ''),
			exitCode: 1,
			failure: { kind: 'login-expired', detail: 'claude-code PM account login expired' },
		});
		await drain();
		expect(state().openCards.find((c) => c.boundary === 'login')?.body).toContain('claude-code');
		expect(requests.at(-1)).toMatchObject({ tool: 'codex', nativeSessionId: undefined });
	});

	it('M3 idle report gets one nudge, then a diagnosis without an owner card', async () => {
		await toBaseline();
		await confirm();
		await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
		await finish(latest('dev', 'work'), {
			type: 'work',
			done: [],
			summary: 'Nothing changed',
			claimsComplete: false,
		});
		const nudge = requests.at(-1)!;
		expect(nudge).toMatchObject({ seat: 'dev', turn: 'message', permissionMode: 'readonly' });
		expect(nudge.prompt).toContain('First idle turn');
		await finish(nudge, { type: 'message', summary: 'Still nothing', messages: [] });
		expect(state().discussions.some((d) => d.opened?.trigger === 'no-progress')).toBe(true);
		expect(state().openCards).toEqual([]);
	});

	it('M3 wait timeout and three unchanged polls remain normal waits, rechecked every 10 minutes', async () => {
		await toBaseline();
		await confirm();
		await finish(latest('dev', 'work'), {
			type: 'work',
			done: [],
			summary: 'CI running',
			claimsComplete: false,
			waiting: {
				reason: 'CI running',
				waitFor: 'CI run',
				condition: { kind: 'ci', runId: '123', cwd: '/project/dev' },
			},
		});
		await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
		expect(deps.followUps.register).toHaveBeenCalledWith(
			expect.objectContaining({ condition: { kind: 'ci', runId: '123', cwd: '/project/dev' } })
		);
		for (let i = 0; i < 4; i++) {
			const wait = state().followUps.find((f) => f.seat === 'dev')!;
			expect(wait.untilMs! - Date.now()).toBe((i ? 10 : 20) * 60_000);
			vi.setSystemTime(wait.untilMs!);
			followListener({
				kind: 'wait-timeout',
				at: Date.now(),
				late: false,
				externalStatus: { state: 'running', observedAt: Date.now() },
				followUp: {
					id: wait.followUpId,
					target: { kind: 'team', teamId: teamConfig.id, seat: 'dev' },
				} as never,
			});
			await drain();
			const wake = requests.at(-1)!;
			expect(wake.turn).toBe('wait');
			expect(wake.prompt).toContain('running');
			await finish(wake, {
				type: 'wait',
				status: 'waiting',
				summary: 'CI is still normally running',
			});
		}
		expect(state().problems).toEqual({});
		expect(state().openCards).toEqual([]);
		expect(state().seats.dev.faultActive).toBe(false);
	});

	it('M3 wait receipts use one timestamp even when persistence advances the clock', async () => {
		let clock = Date.now();
		scheduler.dispose();
		deps.now = () => clock++;
		scheduler = createTeamScheduler(deps);
		await toBaseline();
		await confirm();
		await finish(latest('qa', 'qa_prep'), goodReports.qa_prep);
		await finish(latest('dev', 'work'), {
			type: 'work',
			done: [],
			summary: 'CI running',
			claimsComplete: false,
			waiting: { reason: 'Normal wait', waitFor: 'CI' },
		});
		let wait = state().followUps.find((w) => w.seat === 'dev')!;
		expect(wait.untilMs! - wait.at).toBe(20 * 60_000);
		clock = wait.untilMs!;
		followListener({
			kind: 'wait-timeout',
			at: clock,
			late: false,
			externalStatus: { state: 'running', observedAt: clock },
			followUp: {
				id: wait.followUpId,
				target: { kind: 'team', teamId: teamConfig.id, seat: 'dev' },
			} as never,
		});
		await drain();
		await finish(requests.at(-1)!, {
			type: 'wait',
			status: 'waiting',
			summary: 'Still normally running',
		});
		wait = state().followUps.find((w) => w.seat === 'dev')!;
		expect(wait.untilMs! - wait.at).toBe(10 * 60_000);
	});

	it.each(['deadline', 'turns'] as const)(
		'M3 %s budget produces a free unfinished report, extends and persists',
		async (limit) => {
			events = ledger(...baseline, ...bindings, { kind: 'paused' });
			const created = events[0];
			if (created.kind !== 'team_created') throw new Error('fixture');
			created.config = {
				...config,
				deadline: limit === 'deadline' ? Date.now() : undefined,
				turnBudget: limit === 'turns' ? 1 : 40,
			};
			if (limit === 'turns')
				events = [
					...events,
					...ledger(
						{
							kind: 'turn_dispatched',
							dispatchId: 'spent',
							seat: 'pm',
							turn: 'brief',
							promptDigest: '',
						},
						{ kind: 'turn_finished', dispatchId: 'spent', seat: 'pm', exitCode: 0, durationMs: 1 }
					).map((e, i) => ({ ...e, id: `spent-${i}`, seq: events.length + i + 1 })),
				];
			await scheduler.start();
			await drain();
			const target = state().openCards.find((c) => c.boundary === 'budget')!;
			expect(target.body).toContain('not a completion demo');
			expect(target.options.map((o) => o.id)).toEqual(['extend', 'gaps', 'stop']);
			expect(requests).toEqual([]);
			await scheduler.extend(config.id, { hours: 1, turns: 10 });
			await drain();
			expect(state().openCards).toEqual([]);
			expect(state().config!.turnBudget).toBe(limit === 'turns' ? 11 : 50);
			scheduler.dispose();
			scheduler = createTeamScheduler(deps);
			await scheduler.start();
			await drain();
			expect(state().openCards).toEqual([]);
			expect(requests).toEqual([]);
		}
	);
	it.each([false, true])(
		'real-run budget 20 stops pending recovery with wrap-up recorded=%s',
		async (wrapped) => {
			const sequence = [
				'brief',
				'challenge',
				'challenge',
				'respond',
				'challenge',
				'challenge',
				'respond',
				'challenge',
				'challenge',
				'respond',
				'report_repair',
				'position',
				'position',
				'position',
				'report_repair',
				'position',
				'report_repair',
				'report_repair',
				'recovery',
				'wrap_up',
			] as const;
			const rows: EventInput[] = sequence.flatMap((turn, index): EventInput[] => [
				{
					kind: 'turn_dispatched',
					dispatchId: `real-${index}`,
					seat: 'pm',
					turn,
					promptDigest: '',
					...(turn === 'report_repair'
						? { repairOf: `real-${index - 1}`, expectedTurn: 'position' as const }
						: {}),
				},
				{
					kind: 'turn_finished',
					dispatchId: `real-${index}`,
					seat: 'pm',
					exitCode: index === 11 ? 1 : 0,
					durationMs: index === 11 ? 49 : 100,
					reportError: 'Missing report',
					...(index === 11
						? {
								failureKind: 'model-unavailable' as const,
								reportError: "You've hit your 5-hour limit · resets 4:10am (Europe/Paris)",
							}
						: {}),
				},
			]);
			events = ledger(
				...baseline,
				...bindings,
				...rows,
				...(wrapped
					? [
							{
								kind: 'wrap_up',
								generatedBy: 'pm',
								summary: 'Preserve remaining work',
								priorities: ['Report gaps'],
							} as const,
						]
					: [])
			);
			const created = events[0];
			if (created.kind !== 'team_created') throw new Error('fixture');
			created.config.turnBudget = 20;
			await scheduler.start();
			await drain();
			for (let index = 0; index < 3; index++) await scheduler.wake(config.id);
			expect(requests).toEqual([]);
			expect(state().usage.turns).toBe(20);
			expect(state().usage.budgetTurns).toBe(20);
			expect(state().openCards.map((c) => c.boundary)).toEqual(['budget']);
			expect(JSON.parse(state().openCards[0].body).generatedBy).toBe('app');
		}
	);
	it('restart at the last reserved slot reconciles effects without invoking another process', async () => {
		events = ledger(...baseline, ...bindings, {
			kind: 'turn_dispatched',
			dispatchId: 'last-reservation',
			seat: 'pm',
			turn: 'recovery',
			promptDigest: '',
		});
		const created = events[0];
		if (created.kind !== 'team_created') throw new Error('fixture');
		created.config.turnBudget = 1;
		await scheduler.start();
		await drain();
		expect(deps.reconcile).toHaveBeenCalledOnce();
		expect(deps.workspaces(teamConfig).inspect).toHaveBeenCalledOnce();
		expect(requests).toEqual([]);
		expect(state().turns[0].finished?.canceled).toBe(true);
		expect(state().usage.turns).toBe(1);
		expect(state().openCards.map((c) => c.boundary)).toEqual(['budget']);
	});
	it('a paused last reservation gets a free budget report and resumes only after extension', async () => {
		events = ledger(
			...baseline,
			...bindings,
			{ kind: 'paused', actor: 'owner' },
			{
				kind: 'turn_dispatched',
				dispatchId: 'paused-last',
				seat: 'pm',
				turn: 'brief',
				promptDigest: '',
			}
		);
		const created = events[0];
		if (created.kind !== 'team_created') throw new Error('fixture');
		created.config.turnBudget = 1;
		await scheduler.start();
		await drain();
		expect(requests).toEqual([]);
		expect(state().openCards.map((c) => c.boundary)).toEqual(['budget']);
		await scheduler.extend(config.id, { turns: 10 });
		await drain();
		expect(requests).toEqual([]);
		await scheduler.resume(config.id);
		await drain();
		expect(requests.some((r) => r.dispatchId === 'paused-last')).toBe(true);
	});
	it('two parallel challenges reserve the final two slots without dispatching respond or wrap-up', async () => {
		config.turnBudget = 3;
		await begin();
		await finish(latest('pm', 'brief'), goodReports.brief);
		expect(requests).toHaveLength(3);
		await finish(latest('dev', 'challenge'), { type: 'challenge', objections: [] });
		await finish(latest('qa', 'challenge'), goodReports.challenge);
		expect(requests).toHaveLength(3);
		expect(state().usage.turns).toBe(3);
		expect(state().openCards.map((c) => c.boundary)).toEqual(['budget']);
	});
	it('the last allowed invocation counts an immediate quota failure once and cannot take over or wrap up', async () => {
		config.turnBudget = 1;
		await begin();
		expect(requests).toHaveLength(1);
		completions.get(requests[0].dispatchId!)!({
			...result(requests[0], ''),
			exitCode: 1,
			durationMs: 49,
			failure: {
				kind: 'model-unavailable',
				detail: "You've hit your 5-hour limit · resets 4:10am (Europe/Paris)",
				resetsAt: Date.now() + 60_000,
			},
		});
		await drain();
		await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS * 3);
		expect(requests).toHaveLength(1);
		expect(state().usage.turns).toBe(1);
		expect(state().problems).toEqual({});
		expect(state().openCards.map((c) => c.boundary)).toEqual(['budget']);
		expect(state().wrapUp).toBeUndefined();
	});
	it('real-run positions preserve unknown basis without repairs; unsupported insistence concludes with a reservation', async () => {
		events = ledger(...baseline, ...bindings, {
			kind: 'discussion_opened',
			discussionId: 'basis',
			topic: 'Choose formatting',
			owner: 'pm',
			participants: ['pm', 'dev', 'qa'],
			trigger: 'challenge',
			layer: 'product',
			reversible: true,
		});
		await scheduler.start();
		await drain();
		for (const seat of ['pm', 'dev', 'qa'] as const) {
			await finish(latest(seat, 'position'), {
				type: 'position',
				discussionId: 'basis',
				claim: 'Use a concise display',
				basis: 'Readable for a small task',
				wouldChangeMind: 'A captured output that is unreadable',
				...(seat === 'pm' ? {} : { evidence: ['The brief describes a small task'] }),
			});
		}
		expect(state().discussions[0].positions).toHaveLength(3);
		expect(state().discussions[0].positions.find((p) => p.seat === 'dev')).toMatchObject({
			evidence: [],
			unverifiedBasis: ['The brief describes a small task'],
		});
		await finish(latest('pm', 'proposal'), {
			type: 'proposal',
			discussionId: 'basis',
			proposal: 'Use concise formatting',
			decider: 'pm',
			actions: ['pm', 'dev', 'qa'].map((seat) => ({
				seat: seat as 'pm' | 'dev' | 'qa',
				action: 'Use the chosen format',
			})),
		});
		for (const seat of ['pm', 'dev', 'qa'] as const)
			await finish(latest(seat, 'response'), {
				type: 'response',
				discussionId: 'basis',
				result: seat === 'qa' ? 'insist' : 'agree',
				reason: 'Prefer a table',
				evidence: 'My preference is easier to read',
			});
		const discussion = state().discussions[0];
		expect(discussion.responses.find((r) => r.seat === 'qa')).toMatchObject({
			result: 'reserve',
			requestedResult: 'insist',
			evidence: undefined,
			unverifiedBasis: ['My preference is easier to read'],
		});
		expect(discussion.decision).toMatchObject({ decider: 'pm', contested: true });
		expect(discussion.decision?.dissent).toContain('Prefer a table');
		expect(discussion.proposals).toHaveLength(1);
		expect(events.filter((e) => e.kind === 'report_rejected' || e.kind === 'member_fault')).toEqual(
			[]
		);
		expect(requests.some((r) => r.turn === 'report_repair')).toBe(false);
	});

	it('M3 budget boundary preserves a pending permission through extension and restart', async () => {
		await begin();
		const created = events.find((e) => e.kind === 'team_created')!;
		if (created.kind !== 'team_created') throw new Error('fixture');
		created.config.authorizations.push = false;
		await scheduler.action(teamConfig.id, 'push', 'Push the task branch');
		await drain();
		expect(state().openCards.map((c) => c.id)).toContain('permission:push');
		created.config.deadline = Date.now();
		scheduler.dispose();
		scheduler = createTeamScheduler(deps);
		await scheduler.start();
		await drain();
		expect(state().openCards.map((c) => c.id)).toEqual(['budget']);
		await scheduler.extend(teamConfig.id, { hours: 1 });
		await drain();
		expect(state().openCards.map((c) => c.id)).toContain('permission:push');
		await scheduler.answer(teamConfig.id, 'permission:push', 'allow');
		await drain();
		expect(deps.workspaces(teamConfig, true).pushDevWork).toHaveBeenCalledOnce();
		expect(
			events.filter((e) => e.kind === 'decision_card' && e.card.id === 'permission:push')
		).toHaveLength(1);
	});

	it.each(['gaps', 'stopped'] as const)(
		'M3 %s preserves unmet criteria and actual statistics',
		async (terminal) => {
			events = ledger(...baseline, ...bindings);
			const created = events[0];
			if (created.kind === 'team_created') created.config = { ...config, deadline: Date.now() };
			await scheduler.start();
			await drain();
			if (terminal === 'gaps') await scheduler.accept(config.id, true);
			else await scheduler.stop(config.id);
			await drain();
			expect(state().terminal).toBe(terminal);
			expect(state().criteria.some((c) => c.status !== 'pass')).toBe(true);
			expect(state().statistics.ownerDecisions).toBe(2); // Baseline confirmation and terminal choice.
			if (terminal === 'gaps') {
				expect(state().residualItems).toHaveLength(3);
				expect(state().residualItems.every((r) => r.owner === null)).toBe(true);
			}
		}
	);

	it('M3 80 percent requests one informational PM wrap-up plan', async () => {
		await toReview();
		const created = events.find((e) => e.kind === 'team_created')!;
		if (created.kind === 'team_created') {
			created.config.deadline = Date.now() + 100_000;
			created.config.createdAt = Date.now() - 500_000;
		}
		await finish(latest('pm', 'review'), goodReports.review);
		expect(requests.at(-1)?.turn).toBe('wrap_up');
		await finish(requests.at(-1)!, {
			type: 'wrap_up',
			summary: 'Finish proof and prepare the result',
			priorities: ['A1', 'A2', 'E1'],
		});
		expect(state().wrapUp?.generatedBy).toBe('pm');
		expect(state().openCards.some((c) => c.boundary === 'budget')).toBe(false);
	});

	it('M3 push and draft PR execute once per request with remembered class grants; external actions always ask', async () => {
		await begin();
		const created = events.find((e) => e.kind === 'team_created')!;
		if (created.kind === 'team_created')
			created.config.authorizations = { ...config.authorizations, push: false, draftPr: false };
		const workspace = deps.workspaces(teamConfig, true);
		await scheduler.action(teamConfig.id, 'push', 'Push the task branch');
		await drain();
		expect(workspace.pushDevWork).not.toHaveBeenCalled();
		await scheduler.answer(teamConfig.id, 'permission:push', 'allow');
		await drain();
		expect(workspace.pushDevWork).toHaveBeenCalledTimes(1);
		await scheduler.action(teamConfig.id, 'push', 'Push the next revision');
		await drain();
		expect(workspace.pushDevWork).toHaveBeenCalledTimes(2);
		await scheduler.action(teamConfig.id, 'draftPr', 'Review this concrete result');
		await drain();
		await scheduler.answer(teamConfig.id, 'permission:draftPr', 'allow');
		await drain();
		expect(workspace.createDraftPr).toHaveBeenCalledOnce();
		expect(
			events.filter((e) => e.kind === 'action_receipt' && e.outcome === 'succeeded')
		).toHaveLength(3);
		await scheduler.action(teamConfig.id, 'merge', 'Merge the task');
		await drain();
		expect(state().openCards[0].boundary).toBe('permission');
		expect(workspace.pushDevWork).toHaveBeenCalledTimes(3);
	});

	it('M3 failed draft PR records a loud failure without retrying or silently succeeding', async () => {
		await begin();
		const workspace = deps.workspaces(teamConfig, true);
		vi.mocked(workspace.createDraftPr).mockRejectedValue(
			new Error('GitHub CLI missing: gh ENOENT')
		);
		await scheduler.action(teamConfig.id, 'draftPr', 'Review task');
		await drain();
		await vi.advanceTimersByTimeAsync(TEAM_FALLBACK_MS * 3);
		await drain();
		expect(workspace.createDraftPr).toHaveBeenCalledOnce();
		expect(events.find((e) => e.kind === 'action_receipt' && e.outcome === 'failed')).toMatchObject(
			{ detail: expect.stringContaining('ENOENT') }
		);
		expect(deps.onError).toHaveBeenCalled();
	});
});
