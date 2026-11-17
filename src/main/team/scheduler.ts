import { createHash, randomUUID } from 'crypto';
import { DURATION_MS } from '../../shared/duration';
import { isValidAgentId } from '../../shared/agentIds';
import { decideNext, judgeAttempts } from '../../shared/progressRules';
import { reduceLedger } from '../../shared/team/ledger';
import { buildTeamTurnPrompt } from '../../shared/team/prompts';
import {
	extractTeamReport,
	validateTeamReport,
	reportRepairPrompt,
	teamReplyMessage,
} from '../../shared/team/report';
import { teamReportSchema } from '../../shared/team/schemas';
import { teamStatus } from '../../shared/team/status';
import {
	SEAT_ROLES,
	type CreateTeamInput,
	type LedgerEvent,
	type M1TurnKind,
	type OwnerCard,
	type SeatRole,
	type TeamAuthorizations,
	type TeamConfig,
	type TeamEvent,
	type TeamState,
} from '../../shared/team/types';
import type { FollowUpFire } from '../../shared/followUp';
import type { createCheckRunner } from '../check-runner';
import type { createFollowUpStore } from '../follow-ups';
import { FOLLOW_UP_WAIT_MS } from '../follow-ups';
import { createKeyedWriteQueue } from '../utils/atomic-json-store';
import type { createTeamStore } from './team-store';
import type { SeatTurnRequest, SeatTurnResult } from './turn-dispatcher';
import type { TeamWorkspaces } from './workspaces';
import { reportEvents, type TeamEventInput } from './report-events';

export const TEAM_FALLBACK_MS = 30 * DURATION_MS.second;
type Dispatch = TeamEvent<'turn_dispatched'>;
type RecordData = { config: TeamConfig; events: LedgerEvent[] };

export interface TeamSchedulerDependencies {
	store: ReturnType<typeof createTeamStore>;
	dispatcher: { dispatch(request: SeatTurnRequest): Promise<SeatTurnResult> };
	checks: Pick<ReturnType<typeof createCheckRunner>, 'run'>;
	followUps: ReturnType<typeof createFollowUpStore>;
	workspaces(config: TeamConfig, pushAuthorized: boolean): TeamWorkspaces;
	/** Read-only native transcript reconciliation, matched to the exact dispatch marker. */
	reconcile(request: SeatTurnRequest): Promise<SeatTurnResult | null>;
	captureOutput(cwd: string, revision: string): Promise<{ files: string[]; previews: string[] }>;
	/** Host-resolved launch configuration; never supplied by a seat report. */
	seatOptions?(
		config: TeamConfig,
		seat: SeatRole
	): Pick<SeatTurnRequest, 'customEnv' | 'customPath' | 'customArgs'>;
	now?: () => number;
	onError(error: unknown): void;
}

/** Main-owned M1 state machine. Long-running work never holds the event/action queue. */
export function createTeamScheduler(deps: TeamSchedulerDependencies) {
	const now = deps.now ?? Date.now;
	const queue = createKeyedWriteQueue();
	const queued = new Map<string, Promise<void>>();
	const live = new Map<string, { teamId: string; controller: AbortController }>();
	const jobs = new Map<string, AbortController>();
	let running = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let unsubscribe: (() => void) | undefined;
	let unsubscribeFollow: (() => void) | undefined;
	const load = (id: string) => deps.store.loadTeam(id);
	const append = async (id: string, input: TeamEventInput) => {
		const eventId = input.id ?? randomUUID();
		const prior = (await load(id)).events.find((event) => event.id === eventId);
		return prior ?? deps.store.append(id, { ...input, id: eventId, at: input.at ?? now() });
	};
	const stateFor = async (id: string) => reduceLedger((await load(id)).events);
	const authorized = (state: TeamState, action: keyof TeamAuthorizations) =>
		state.config!.authorizations[action] ||
		state.cardAnswers.some(
			(answer) => answer.cardId === `permission:${action}` && answer.optionId === 'allow'
		);
	const ws = (state: TeamState) => deps.workspaces(state.config!, authorized(state, 'push'));
	const card = (id: string, value: OwnerCard) =>
		append(id, { kind: 'decision_card', actor: 'app', id: `card:${value.id}`, card: value });
	const permission = async (
		id: string,
		state: TeamState,
		action: keyof TeamAuthorizations,
		detail: string
	) => {
		if (authorized(state, action)) return true;
		if (!state.cardAnswers.some((answer) => answer.cardId === `permission:${action}`))
			await card(id, {
				id: `permission:${action}`,
				boundary: 'permission',
				title: `Authorize ${action} for this team`,
				body: `${detail} This action is outside the team's current ${action} authorization. Dependent work waits for this decision.`,
				options: [
					{
						id: 'allow',
						label: `Allow ${action} for this team`,
						cost: 'The app performs this class of action in task workspaces.',
						recommended: true,
					},
					{
						id: 'stop',
						label: 'Stop and preserve the task branch',
						cost: 'The task remains incomplete.',
					},
				],
			});
		return false;
	};
	const transition = async (id: string, state: TeamState, to: TeamState['phase']) => {
		if (state.phase !== to)
			await append(id, { kind: 'phase_changed', actor: 'app', from: state.phase, to });
	};
	const snapshot = (events: LedgerEvent[], dispatch: Dispatch) =>
		reduceLedger(events.filter((e) => e.seq <= (dispatch.sourceSeq ?? dispatch.seq - 1)));
	const promptFor = (dispatch: Dispatch, events: LedgerEvent[]) => {
		const state = snapshot(events, dispatch);
		const expected = dispatch.expectedTurn ?? dispatch.turn;
		let prompt: string;
		if (dispatch.repairOf) {
			const original = events.find(
				(e) => e.kind === 'turn_finished' && e.dispatchId === dispatch.repairOf
			) as TeamEvent<'turn_finished'> | undefined;
			prompt = reportRepairPrompt(
				expected,
				original?.reportError ?? 'Invalid report',
				original?.repairTail ?? original?.message ?? ''
			);
		} else if (expected === 'topic') {
			prompt = [
				'You are the PM. Diagnose why the team has no actionable work. Inspect the ledger and real output, identify the next concrete step. Do not change files or standards. End with one team-report block using this schema:',
				JSON.stringify(teamReportSchema('topic')),
				JSON.stringify(teamStatus(state, now())),
				JSON.stringify({
					messages: state.pendingMessages,
					recentTurns: state.turns
						.slice(-3)
						.map((t) => ({ seat: t.seat, message: t.finished?.message, error: t.reportError })),
					issues: state.issues,
				}),
			].join('\n\n');
		} else prompt = buildTeamTurnPrompt(expected as M1TurnKind, dispatch.seat, state);
		if (dispatch.mode === 'diagnose' || dispatch.mode === 'gather')
			prompt += `\n\n${dispatch.mode === 'diagnose' ? 'Diagnosis required: explain why the previous attempts failed, the new basis, difference and expected observation.' : 'Gather new evidence. Do not repeat the previously tried change.'}\nAttempt record: ${JSON.stringify(state.problems[dispatch.problemId ?? 'checks'] ?? null)}`;
		return `${prompt}\n\n${dispatch.note ?? ''}\n[team-dispatch:${dispatch.dispatchId}]`;
	};
	const requestFor = (
		config: TeamConfig,
		events: LedgerEvent[],
		dispatch: Dispatch
	): SeatTurnRequest => {
		const state = reduceLedger(events);
		const binding = state.seats[dispatch.seat].binding;
		if (!binding) throw new Error(`Unbound team seat: ${dispatch.seat}`);
		return {
			...binding.model,
			...deps.seatOptions?.(config, dispatch.seat),
			teamId: config.id,
			dispatchId: dispatch.dispatchId,
			seat: dispatch.seat,
			cwd: binding.workspace,
			nativeSessionId: binding.nativeSessionId,
			permissionMode: dispatch.seat === 'pm' ? 'readonly' : 'full',
			prompt: promptFor(dispatch, events),
		};
	};
	const bindNative = (id: string, seat: SeatRole, nativeSessionId: string) =>
		queue.enqueue(id, async () => {
			const state = await stateFor(id);
			const binding = state.seats[seat].binding!;
			if (binding.nativeSessionId !== nativeSessionId)
				await append(id, {
					kind: 'seat_bound',
					actor: 'app',
					seat,
					workspace: binding.workspace,
					model: binding.model,
					nativeSessionId,
					reason: 'restored',
				});
		});
	const ingest = async (id: string, dispatch: Dispatch, finished: TeamEvent<'turn_finished'>) => {
		if (!finished.report) return;
		const data = await load(id);
		if (data.events.some((e) => e.id === `${dispatch.dispatchId}:accepted`)) return;
		const original = dispatch.repairOf
			? data.events.find(
					(e): e is Dispatch => e.kind === 'turn_dispatched' && e.dispatchId === dispatch.repairOf
				)!
			: dispatch;
		for (const event of reportEvents(original, finished.report, snapshot(data.events, original)))
			await append(id, event);
		await append(id, {
			kind: 'report_accepted',
			actor: dispatch.seat,
			seat: dispatch.seat,
			dispatchId: original.dispatchId,
			report: finished.report,
			id: `${dispatch.dispatchId}:accepted`,
		});
		if (dispatch.repairOf)
			await append(id, {
				kind: 'report_repaired',
				actor: 'app',
				seat: dispatch.seat,
				dispatchId: original.dispatchId,
				id: `${dispatch.dispatchId}:repaired`,
			});
		if (reduceLedger(data.events).seats[dispatch.seat].faultActive)
			await append(id, {
				kind: 'member_recovered',
				actor: 'app',
				seat: dispatch.seat,
				how: 'A valid turn report was ingested.',
				id: `${dispatch.dispatchId}:recovered`,
			});
		if (dispatch.seat === 'pm')
			for (const message of snapshot(data.events, original).pendingMessages)
				await append(id, {
					kind: 'message_delivered',
					actor: 'app',
					messageId: message.messageId,
					seat: 'pm',
					id: `${original.dispatchId}:message:${message.messageId}`,
				});
	};
	const finish = async (id: string, dispatch: Dispatch, result: SeatTurnResult) => {
		const data = await load(id);
		if (data.events.some((e) => e.kind === 'turn_finished' && e.dispatchId === dispatch.dispatchId))
			return;
		if (result.nativeSessionId) {
			const binding = reduceLedger(data.events).seats[dispatch.seat].binding!;
			await append(id, {
				kind: 'seat_bound',
				actor: 'app',
				seat: dispatch.seat,
				workspace: binding.workspace,
				model: binding.model,
				nativeSessionId: result.nativeSessionId,
				reason: 'restored',
				id: `${dispatch.dispatchId}:binding`,
			});
		}
		const extracted = extractTeamReport(result.text);
		const validationState = snapshot(
			data.events,
			dispatch.repairOf
				? data.events.find(
						(e): e is Dispatch => e.kind === 'turn_dispatched' && e.dispatchId === dispatch.repairOf
					)!
				: dispatch
		);
		const parsed = extracted.ok
			? validateTeamReport(
					extracted.report,
					dispatch.expectedTurn ?? dispatch.turn,
					dispatch.seat,
					validationState
				)
			: extracted;
		const good = parsed.ok && result.exitCode === 0 && !result.canceled;
		const finished = (await append(id, {
			kind: 'turn_finished',
			actor: dispatch.seat,
			seat: dispatch.seat,
			dispatchId: dispatch.dispatchId,
			exitCode: result.exitCode,
			durationMs: result.durationMs,
			inputTokens: result.usage?.inputTokens,
			outputTokens: result.usage?.outputTokens,
			costUsd: result.usage?.costUsd,
			message: teamReplyMessage(result.text),
			report: good && parsed.ok ? parsed.report : undefined,
			reportError: good
				? undefined
				: (result.failure?.detail ?? (parsed.ok ? 'Turn did not complete' : parsed.reason)),
			repairTail: good ? undefined : result.text.slice(-3500),
			canceled: result.canceled,
			failureKind: result.failure?.kind,
			id: `${dispatch.dispatchId}:finished`,
		})) as TeamEvent<'turn_finished'>;
		if (good && dispatch.seat !== 'qa') await ingest(id, dispatch, finished);
		else if (!good) {
			await append(id, {
				kind: 'report_rejected',
				actor: 'app',
				seat: dispatch.seat,
				dispatchId: dispatch.dispatchId,
				reason: finished.reportError!,
				id: `${dispatch.dispatchId}:rejected`,
			});
			await append(id, {
				kind: 'member_fault',
				actor: 'app',
				seat: dispatch.seat,
				fault: result.failure?.kind ?? (extracted.ok ? 'bad-report' : 'missing-report'),
				detail: finished.reportError,
				id: `${dispatch.dispatchId}:fault`,
			});
		}
	};
	const launch = (data: RecordData, dispatch: Dispatch, recover = false) => {
		if (live.has(dispatch.dispatchId)) return;
		const controller = new AbortController();
		live.set(dispatch.dispatchId, { teamId: data.config.id, controller });
		const request = requestFor(data.config, data.events, dispatch);
		void (async () => {
			let result = recover ? await deps.reconcile(request) : null;
			if (!running || controller.signal.aborted) return;
			if (!result) {
				if (recover) {
					request.prompt +=
						'\nRestart recovery: the previous attempt may have done part of the work. Inspect the workspace and native conversation first; preserve completed actions.';
					await queue.enqueue(data.config.id, () =>
						append(data.config.id, {
							kind: 'member_recovered',
							actor: 'app',
							seat: dispatch.seat,
							how: 'Restart: checked native history and workspace; resuming incomplete dispatch.',
							id: `${dispatch.dispatchId}:restart`,
						})
					);
				}
				result = await deps.dispatcher.dispatch({
					...request,
					signal: controller.signal,
					onNativeSessionId: (nativeId) => {
						void bindNative(data.config.id, dispatch.seat, nativeId).catch(deps.onError);
					},
				});
			}
			if (running)
				await queue.enqueue(data.config.id, () => finish(data.config.id, dispatch, result!));
		})()
			.catch(async (error) => {
				deps.onError(error);
				if (running)
					await queue
						.enqueue(data.config.id, () =>
							finish(data.config.id, dispatch, {
								dispatchId: dispatch.dispatchId,
								processId: '',
								text: '',
								truncated: false,
								usage: null,
								exitCode: null,
								durationMs: 0,
								lastActivityAt: now(),
								livenessEvents: 0,
								canceled: controller.signal.aborted,
								failure: { kind: 'turn-failed', detail: String(error) },
							})
						)
						.catch(deps.onError);
			})
			.finally(() => {
				live.delete(dispatch.dispatchId);
				if (running) void wake(data.config.id).catch(deps.onError);
			});
	};
	const dispatch = async (
		id: string,
		state: TeamState,
		seat: SeatRole,
		turn: M1TurnKind | 'topic',
		options: Partial<
			Pick<
				Dispatch,
				'repairOf' | 'retryOf' | 'mode' | 'problemId' | 'fingerprint' | 'failures' | 'note'
			>
		> = {}
	) => {
		if (
			state.usage.turns >= state.config!.turnBudget ||
			SEAT_ROLES.reduce((count, role) => count + state.seats[role].activeDispatchIds.length, 0) >=
				2 ||
			state.seats[seat].activeDispatchIds.length
		)
			return;
		const data = await load(id);
		const dispatchId = randomUUID();
		const input: Dispatch = {
			kind: 'turn_dispatched',
			actor: 'app',
			seat,
			turn: options.repairOf ? 'report_repair' : turn,
			expectedTurn: turn,
			dispatchId,
			sourceSeq: data.events.at(-1)?.seq ?? 0,
			id: dispatchId,
			at: now(),
			seq: 0,
			promptDigest: '',
			...options,
		};
		input.promptDigest = createHash('sha256').update(promptFor(input, data.events)).digest('hex');
		const saved = (await append(id, input)) as Dispatch;
		launch({ ...data, events: [...data.events, saved] }, saved);
	};
	const startJob = async (
		id: string,
		jobId: string,
		action: (controller: AbortController) => Promise<void>
	) => {
		if (jobs.has(id)) return;
		if ((await stateFor(id)).followUps.some((wait) => wait.followUpId.startsWith('job-retry:')))
			return;
		const controller = new AbortController();
		jobs.set(id, controller);
		const waitId = `job:${randomUUID()}`;
		await append(id, {
			kind: 'follow_up_registered',
			actor: 'app',
			followUpId: waitId,
			seat: 'pm',
			reason: 'Application work in progress',
			waitFor: jobId,
			id: `${waitId}:wait`,
		});
		void action(controller)
			.catch(async (error) => {
				deps.onError(error);
				if (!running || controller.signal.aborted) return;
				const retryId = `job-retry:${waitId}`;
				const untilMs = now() + TEAM_FALLBACK_MS;
				await deps.followUps.register({
					id: retryId,
					target: { kind: 'team', teamId: id, seat: 'pm' },
					reason: `Retry application operation ${jobId}: ${String(error).slice(0, 1000)}`,
					condition: { kind: 'time', at: untilMs },
					deadline: untilMs,
				});
				await queue.enqueue(id, () =>
					append(id, {
						kind: 'follow_up_registered',
						actor: 'app',
						followUpId: retryId,
						seat: 'pm',
						reason: `Application operation failed: ${String(error).slice(0, 1000)}`,
						waitFor: `Retry ${jobId}`,
						untilMs,
					})
				);
			})
			.finally(async () => {
				if (running)
					await queue
						.enqueue(id, () =>
							append(id, {
								kind: 'follow_up_fired',
								actor: 'app',
								followUpId: waitId,
								result: 'Application work settled',
								id: `${waitId}:settled`,
							})
						)
						.catch(deps.onError);
				jobs.delete(id);
				if (running) void wake(id).catch(deps.onError);
			})
			.catch(deps.onError);
	};
	const checksFor = async (
		id: string,
		state: TeamState,
		batchId: string,
		trial: boolean,
		signal: AbortSignal
	) => {
		const brief = trial ? state.brief! : state.baseline.brief!;
		const cwd = state.seats.dev.binding!.workspace;
		for (const [index, check] of brief.checks.entries()) {
			if (signal.aborted || !running) return;
			const eventId = `${batchId}:check:${index}`;
			if ((await load(id)).events.some((e) => e.id === eventId)) continue;
			const result = await deps.checks.run({ command: check.command, cwd, signal });
			if (!running) return;
			await queue.enqueue(id, () =>
				append(id, {
					kind: 'check_run',
					actor: 'app',
					id: eventId,
					batchId,
					purpose: trial ? 'trial' : 'verification',
					command: check.command,
					cwd,
					covers: check.covers,
					exitCode: result.exitCode,
					outputTail: result.outputTail,
					durationMs: result.endedAt - result.startedAt,
					evidenceId: result.id,
					timedOut: result.outcome === 'timeout',
					notRun:
						result.outcome === 'not-run' || result.outcome === 'canceled'
							? (result.error ?? result.outcome)
							: undefined,
				})
			);
		}
	};
	const batchDone = (events: LedgerEvent[], batchId: string, count: number) =>
		events.filter((e) => e.kind === 'check_run' && e.batchId === batchId).length === count;
	const batchPass = (state: TeamState, batchId: string) =>
		state.checks
			.filter((e) => e.batchId === batchId)
			.every((e) => e.exitCode === 0 && !e.timedOut && !e.notRun);
	const failures = (state: TeamState) => {
		const latest = new Map(
			state.checks.filter((c) => c.purpose !== 'trial').map((c) => [c.command, c])
		);
		return [
			...[...latest.values()]
				.filter((c) => c.exitCode !== 0 || c.timedOut || c.notRun)
				.map((c) =>
					JSON.stringify([c.command, c.exitCode, c.timedOut, c.notRun, c.outputTail.trim()])
				),
			...state.issues
				.filter((i) => i.state !== 'verified-pass')
				.map((i) => `issue:${i.id}:${i.opened.actual ?? i.opened.title}`),
		].sort();
	};
	const submit = async (id: string, state: TeamState, turn: TeamState['turns'][number]) => {
		const batchId = `submit:${turn.dispatchId}`;
		if (
			!(await permission(
				id,
				state,
				'push',
				`Commit the developer's submitted work on team/${id} and advance QA to that revision.`
			))
		)
			return;
		if (
			!(await permission(
				id,
				state,
				'checks',
				'Run the confirmed check commands in the developer workspace.'
			))
		)
			return;
		await startJob(id, batchId, async (controller) => {
			const workspaces = ws(state);
			await workspaces.initialize();
			let submitted = (await load(id)).events.find(
				(e): e is TeamEvent<'workspace_submitted'> =>
					e.kind === 'workspace_submitted' && e.dispatchId === turn.dispatchId
			);
			if (!submitted) {
				const diffHash = await workspaces.diffHash();
				const revision = await workspaces.commitDevWork(`Team ${id}: ${turn.dispatched!.turn}`);
				if (!running || controller.signal.aborted) return;
				submitted = (await queue.enqueue(id, () =>
					append(id, {
						kind: 'workspace_submitted',
						actor: 'app',
						dispatchId: turn.dispatchId,
						revision,
						diffHash,
						id: `${batchId}:revision`,
					})
				)) as TeamEvent<'workspace_submitted'>;
			}
			await workspaces.advanceQa(submitted.revision);
			if (!running || controller.signal.aborted) return;
			const output = await deps.captureOutput(
				state.seats.dev.binding!.workspace,
				submitted.revision
			);
			await queue.enqueue(id, () =>
				append(id, {
					kind: 'output_captured',
					actor: 'app',
					outputId: submitted!.revision,
					...output,
					id: `${batchId}:output`,
				})
			);
			await checksFor(id, state, batchId, false, controller.signal);
		});
	};
	const recordAttempt = async (id: string, state: TeamState, turn: TeamState['turns'][number]) => {
		if (!turn.dispatched?.problemId || turn.dispatched.mode === 'diagnose') return;
		const current = failures(state);
		const data = await load(id);
		const submission = data.events.find(
			(e): e is TeamEvent<'workspace_submitted'> =>
				e.kind === 'workspace_submitted' && e.dispatchId === turn.dispatchId
		);
		if (!submission) return;
		await append(id, {
			kind: 'attempt',
			actor: 'app',
			problemId: turn.dispatched.problemId,
			initialFailures: turn.dispatched.failures,
			id: `${turn.dispatchId}:attempt`,
			attempt: {
				id: turn.dispatchId,
				fingerprint: createHash('sha256')
					.update(JSON.stringify([submission.diffHash, current]))
					.digest('hex'),
				failures: current,
				...(turn.report?.type === 'fix' ? turn.report.attempt : {}),
				// New row IDs alone are not new evidence. A changed failing signature is judged by progressRules.
				evidence: [],
			},
		});
	};
	const fixNext = async (id: string, state: TeamState, kind: 'fix' | 'work') => {
		const problemId =
			state.issues.find((i) => i.state !== 'verified-pass' && i.opened.issueKind === 'defect')
				?.id ?? 'checks';
		await startJob(id, `plan:${randomUUID()}`, async () => {
			const workspaces = ws(state);
			await workspaces.initialize();
			const diff = await workspaces.diffHash();
			await queue.enqueue(id, async () => {
				const current = await stateFor(id);
				if (current.paused || current.terminal || !running) return;
				const failing = failures(current);
				const fingerprint = createHash('sha256')
					.update(JSON.stringify([diff, failing]))
					.digest('hex');
				const progress = current.problems[problemId]?.progress ?? judgeAttempts(failing, []);
				const decision = decideNext(progress, {
					budget: { used: current.usage.turns, total: current.config!.turnBudget },
					candidates: [
						{ plan: 'Address observed failures', basis: failing.join('\n'), fingerprint },
					],
				});
				if (decision.kind === 'report' || decision.kind === 'done') return;
				await dispatch(id, current, 'dev', kind, {
					problemId,
					fingerprint: decision.kind === 'continue' ? fingerprint : undefined,
					failures: failing,
					mode:
						decision.kind === 'diagnose'
							? 'diagnose'
							: decision.kind === 'gather'
								? 'gather'
								: undefined,
				});
			});
		});
	};
	const recoverReceipts = async (id: string, data: RecordData) => {
		for (const event of data.events) {
			if (event.kind !== 'turn_finished') continue;
			const dispatched = data.events.find(
				(e): e is Dispatch => e.kind === 'turn_dispatched' && e.dispatchId === event.dispatchId
			);
			if (!dispatched) continue;
			if (
				event.seat === 'qa' &&
				!data.events.some((e) => e.id === `${event.dispatchId}:boundary-checked`)
			) {
				await startJob(id, `boundary:${event.dispatchId}`, async () => {
					const workspaces = ws(reduceLedger(data.events));
					await workspaces.initialize();
					const paths = await workspaces.enforceQaBoundary();
					if (!running) return;
					await queue.enqueue(id, async () => {
						if (paths.length)
							await append(id, {
								kind: 'qa_boundary_restored',
								actor: 'app',
								dispatchId: event.dispatchId,
								paths,
								id: `${event.dispatchId}:boundary`,
							});
						await append(id, {
							kind: 'qa_boundary_checked',
							actor: 'app',
							dispatchId: event.dispatchId,
							id: `${event.dispatchId}:boundary-checked`,
						});
						if (event.report) await ingest(id, dispatched, event);
					});
				});
				return;
			}
			if (event.report && !data.events.some((e) => e.id === `${event.dispatchId}:accepted`))
				await ingest(id, dispatched, event);
		}
	};
	const evaluate = async (id: string) => {
		if (!running) return;
		let data = await load(id);
		for (const event of data.events)
			if (event.kind === 'card_answered') {
				const target = data.events.find(
					(e): e is TeamEvent<'decision_card'> =>
						e.kind === 'decision_card' && e.card.id === event.cardId
				)?.card;
				if (target) await applyAnswer(id, target, event.optionId, event.note);
			}
		await recoverReceipts(id, data);
		data = await load(id);
		const state = reduceLedger(data.events);
		if (state.paused || state.terminal || jobs.has(id)) return;
		for (const turn of state.turns)
			if (turn.dispatched && !turn.finished && !live.has(turn.dispatchId))
				launch(data, turn.dispatched, true);
		const wakePm = () =>
			active ? Promise.resolve() : dispatch(id, state, 'pm', 'topic', { mode: 'wake' });
		const active = SEAT_ROLES.reduce(
			(count, seat) => count + state.seats[seat].activeDispatchIds.length,
			0
		);
		if (active >= 2) return;
		if (state.openCards.length) return;
		if (
			state.usage.turns >= data.config.turnBudget ||
			(data.config.deadline !== undefined && now() >= data.config.deadline)
		) {
			await card(id, {
				id: 'budget',
				boundary: 'budget',
				title: 'Incomplete progress report',
				body: `This is a progress report, not a completion demo. ${JSON.stringify(teamStatus(state, now()).criteria.missing)}`,
				options: [
					{ id: 'stop', label: 'Stop and preserve work', cost: 'Keep the branch and ledger.' },
					{
						id: 'gaps',
						label: 'Accept the listed gaps',
						cost: 'Missing evidence remains unproven.',
					},
				],
			});
			return;
		}
		// One repair for each original turn, never a repair of a repair.
		const broken = state.turns.find(
			(t) =>
				t.finished &&
				!t.report &&
				!t.dispatched?.repairOf &&
				t.finished.exitCode === 0 &&
				!t.finished.canceled &&
				!state.turns.some((r) => r.dispatched?.repairOf === t.dispatchId)
		);
		if (broken?.dispatched && !state.seats[broken.seat].activeDispatchIds.length) {
			await dispatch(
				id,
				state,
				broken.seat,
				(broken.dispatched.expectedTurn ?? broken.dispatched.turn) as M1TurnKind,
				{ repairOf: broken.dispatchId }
			);
			return;
		}
		const failed = state.turns.find(
			(turn) =>
				turn.finished &&
				turn.finished.exitCode !== 0 &&
				!turn.finished.canceled &&
				!turn.dispatched?.retryOf &&
				!turn.dispatched?.repairOf &&
				!state.turns.some((retry) => retry.dispatched?.retryOf === turn.dispatchId)
		);
		if (failed?.dispatched && !state.seats[failed.seat].activeDispatchIds.length) {
			if (failed.finished?.failureKind === 'session-broken') {
				const binding = state.seats[failed.seat].binding!;
				await append(id, {
					kind: 'seat_bound',
					actor: 'app',
					seat: failed.seat,
					model: binding.model,
					workspace: binding.workspace,
					reason: 'restored',
				});
			}
			return dispatch(
				id,
				await stateFor(id),
				failed.seat,
				(failed.dispatched.expectedTurn ?? failed.dispatched.turn) as M1TurnKind,
				{
					retryOf: failed.dispatchId,
					note: 'The previous attempt may have done part of the work. Inspect existing results first; preserve completed actions. This is the single same-turn retry.',
				}
			);
		}
		const epoch = data.events.filter((e) => e.kind === 'changes_requested').at(-1)?.seq ?? 0;
		const turns = state.turns.filter(
			(t) => !t.dispatched?.repairOf && (t.dispatched?.seq ?? 0) > epoch
		);
		const last = (kind: M1TurnKind, seat?: SeatRole) =>
			turns.filter((t) => t.dispatched?.turn === kind && (!seat || t.seat === seat)).at(-1);
		const accepted = (kind: M1TurnKind, seat?: SeatRole) => last(kind, seat)?.report;
		if (!state.seats.pm.binding || !state.seats.dev.binding || !state.seats.qa.binding) {
			await startJob(id, `initialize:${id}`, async () => {
				const paths = await ws(state).initialize();
				for (const seat of SEAT_ROLES)
					await queue.enqueue(id, () =>
						append(id, {
							kind: 'seat_bound',
							actor: 'app',
							seat,
							workspace: paths[seat],
							model: data.config.seats[seat],
							reason: 'initial',
							id: `${id}:seat:${seat}`,
						})
					);
			});
			return;
		}
		if (
			state.followUps.some(
				(f) =>
					!f.followUpId.startsWith('initialize:') &&
					!f.followUpId.startsWith('submit:') &&
					!f.followUpId.startsWith('trial:') &&
					!f.followUpId.startsWith('plan:') &&
					!f.followUpId.startsWith('job:')
			)
		)
			return;
		if (!state.brief) {
			if (!last('brief')) return dispatch(id, state, 'pm', 'brief');
		} else if (!state.baseline.confirmedVersion) {
			await transition(id, state, 'challenge');
			for (const seat of ['dev', 'qa'] as const)
				if (!last('challenge', seat)) {
					await dispatch(id, await stateFor(id), seat, 'challenge');
				}
			if (!accepted('challenge', 'dev') || !accepted('challenge', 'qa')) {
				if (!active && last('challenge', 'dev') && last('challenge', 'qa')) return wakePm();
				return;
			}
			const returned = state.baseline.returns.at(-1)?.seq ?? 0;
			if (!last('respond') || last('respond')!.dispatched!.seq < returned)
				return dispatch(id, state, 'pm', 'respond');
			const response = accepted('respond');
			if (!response) return wakePm();
			const batchId = `trial:${state.brief.version}`;
			if (!batchDone(data.events, batchId, state.brief.checks.length)) {
				if (
					!(await permission(
						id,
						state,
						'checks',
						`Dry-run these commands before baseline confirmation: ${state.brief.checks.map((c) => c.command).join('; ')}`
					))
				)
					return;
				return startJob(id, batchId, (controller) =>
					checksFor(id, state, batchId, true, controller.signal)
				);
			}
			if (state.checks.some((c) => c.batchId === batchId && (c.notRun || c.timedOut))) {
				if (!active)
					return dispatch(id, state, 'pm', 'respond', {
						note: 'The baseline check command could not run. Repair the check definition without claiming product success.',
					});
				return;
			}
			await append(id, {
				kind: 'baseline_proposed',
				actor: 'app',
				briefVersion: state.brief.version,
				id: `${batchId}:proposed`,
			});
			await card(id, {
				id: `baseline:${last('respond')!.dispatchId}`,
				boundary: 'baseline',
				title: 'Confirm the baseline',
				body: JSON.stringify({
					brief: state.brief,
					question: response.type === 'respond' ? response.askOwner : undefined,
					trials: state.checks.filter((c) => c.batchId === batchId),
				}),
				options: [
					{ id: 'confirm', label: 'Confirm this scope and criteria', recommended: true },
					{ id: 'return', label: 'Return with specific changes' },
				],
			});
			return;
		} else if (state.phase === 'challenge' || state.phase === 'clarify') {
			await transition(id, state, 'implement');
			return;
		} else if (state.phase === 'implement') {
			if (epoch && state.pendingMessages.length) {
				if (!state.seats.pm.activeDispatchIds.length)
					await dispatch(id, state, 'pm', 'topic', {
						note: 'Restate the owner requested changes and the corresponding work item before implementation.',
					});
				return;
			}
			if (!last('work')) await dispatch(id, state, 'dev', 'work');
			if (!last('qa_prep')) await dispatch(id, await stateFor(id), 'qa', 'qa_prep');
			const work = last('work');
			if (active || !work || !last('qa_prep')) return;
			if (!work.report || !accepted('qa_prep')) return wakePm();
			if (work.report.type === 'work' && !work.report.claimsComplete) {
				if (work.report.waiting) {
					const followUpId = `${work.dispatchId}:follow-up`;
					if (
						!data.events.some(
							(e) => e.kind === 'follow_up_registered' && e.followUpId === followUpId
						)
					) {
						// The report cannot name an arbitrary process. A bounded time recheck is observable.
						await deps.followUps.register({
							id: followUpId,
							target: { kind: 'team', teamId: id, seat: 'dev' },
							reason: work.report.waiting.reason,
							condition: { kind: 'time', at: now() + FOLLOW_UP_WAIT_MS },
							deadline: data.config.deadline ?? Number.MAX_SAFE_INTEGER,
						});
						await append(id, {
							kind: 'follow_up_registered',
							actor: 'app',
							followUpId,
							seat: 'dev',
							reason: work.report.waiting.reason,
							waitFor: 'Timed recheck of the reported wait',
							untilMs: now() + FOLLOW_UP_WAIT_MS,
						});
						return;
					}
				}
				return dispatch(id, state, 'dev', 'work', {
					note: 'Continue incomplete work; a previous claim did not complete the task.',
				});
			}
			const batchId = `submit:${work.dispatchId}`;
			if (
				!data.events.some((e) => e.id === `${batchId}:output`) ||
				!batchDone(data.events, batchId, state.baseline.brief!.checks.length)
			)
				return submit(id, state, work);
			await recordAttempt(id, state, work);
			if (!batchPass(state, batchId)) return fixNext(id, await stateFor(id), 'work');
			await transition(id, state, 'verify');
			return;
		} else if (state.phase === 'verify') {
			if (!last('verify')) return dispatch(id, state, 'qa', 'verify');
			if (active) return;
			const fix = last('fix');
			const reverify = last('reverify');
			if (fix?.report && (!reverify || reverify.dispatched!.seq < fix.dispatched!.seq)) {
				const batchId = `submit:${fix.dispatchId}`;
				if (
					!data.events.some((e) => e.id === `${batchId}:output`) ||
					!batchDone(data.events, batchId, state.baseline.brief!.checks.length)
				)
					return submit(id, state, fix);
				if (state.issues.some((i) => i.state === 'fixed-claimed'))
					return dispatch(id, state, 'qa', 'reverify');
				await recordAttempt(id, state, fix);
			}
			if (reverify?.report && fix) await recordAttempt(id, state, fix);
			if (
				state.issues.some((i) => i.state !== 'verified-pass' && i.opened.issueKind === 'defect') ||
				!batchPass(state, `submit:${fix?.dispatchId ?? last('work')?.dispatchId}`)
			)
				return fixNext(id, await stateFor(id), 'fix');
			if (state.issues.some((i) => i.state !== 'verified-pass'))
				return dispatch(id, state, 'pm', 'topic', {
					mode: 'wake',
					note: 'Triage standard issues without changing the confirmed baseline.',
				});
			if (state.criteria.filter((c) => c.proof !== 'pm').every((c) => c.status === 'pass')) {
				await transition(id, state, 'review');
				return;
			}
			return dispatch(id, state, 'qa', 'verify', {
				note: 'Issue retests are narrower than criterion verification. Supply the remaining criterion evidence.',
			});
		} else if (state.phase === 'review') {
			if (!last('review')) return dispatch(id, state, 'pm', 'review');
			if (
				accepted('review') &&
				state.reviews.at(-1)?.verdict === 'pass' &&
				state.criteria.every((c) => c.status === 'pass')
			) {
				await transition(id, state, 'demo');
				return;
			}
		} else if (state.phase === 'demo' || state.phase === 'accept') {
			if (!last('demo')) return dispatch(id, state, 'pm', 'demo');
			if (accepted('demo')) {
				await transition(id, state, 'accept');
				await card(id, {
					id: `acceptance:${last('demo')!.dispatchId}`,
					boundary: 'acceptance',
					title: 'Accept the demonstrated result',
					body: 'All confirmed criteria have evidence and PM review passed. Accept this result or request specific changes.',
					options: [
						{ id: 'accept', label: 'Accept the result', recommended: true },
						{ id: 'changes', label: 'Request specific changes' },
					],
				});
				return;
			}
		}
		if (!active && !state.followUps.length) await wakePm();
	};
	function wake(id: string): Promise<void> {
		const pending = queued.get(id);
		if (pending) return pending;
		const task = queue.enqueue(id, async () => {
			queued.delete(id);
			await evaluate(id);
		});
		queued.set(id, task);
		return task;
	}
	const followFired = (event: FollowUpFire) => {
		const target = event.followUp.target;
		if (target.kind !== 'team') return;
		void queue
			.enqueue(target.teamId, () =>
				append(target.teamId, {
					kind: 'follow_up_fired',
					actor: 'app',
					followUpId: event.followUp.id,
					result: JSON.stringify(event.externalStatus),
					late: event.late,
					id: `${event.followUp.id}:fired`,
				})
			)
			.catch(deps.onError);
	};
	async function applyAnswer(id: string, target: OwnerCard, optionId: string, note?: string) {
		const data = await load(id);
		if (data.events.some((event) => event.id === `${target.id}:action`)) return;
		const state = reduceLedger(data.events);
		const cardId = target.id;
		if (optionId === 'stop')
			await append(id, { kind: 'stopped', actor: 'owner', cardId, id: `${cardId}:action` });
		else if (target.boundary === 'baseline') {
			if (optionId === 'confirm')
				await append(id, {
					kind: 'baseline_confirmed',
					actor: 'owner',
					cardId,
					briefVersion: state.baseline.proposedVersion!,
					id: `${cardId}:action`,
				});
			else
				await append(id, {
					kind: 'baseline_returned',
					actor: 'owner',
					cardId,
					note: note!,
					id: `${cardId}:action`,
				});
		} else if (target.boundary === 'acceptance') {
			if (optionId === 'accept') {
				await append(id, { kind: 'accepted', actor: 'owner', cardId, id: `${cardId}:action` });
			} else {
				await append(id, {
					kind: 'owner_message',
					actor: 'owner',
					messageId: `${cardId}:changes`,
					text: note!,
					to: 'pm',
					id: `${cardId}:message`,
				});
				await append(id, {
					kind: 'standard_change',
					actor: 'owner',
					cardId,
					criterionId: `owner:${cardId}`,
					change: 'add',
					after: note!,
					reason: 'Owner requested changes',
					approvedBy: 'owner',
					criterion: {
						id: `owner:${cardId}`,
						text: note!,
						proof: 'qa',
						how: 'Independently verify the owner request',
						byOwner: true,
					},
					id: `${cardId}:criterion`,
				});
				await append(id, {
					kind: 'work_item',
					actor: 'owner',
					cardId,
					itemId: `owner:${cardId}`,
					title: note!,
					owner: 'dev',
					state: 'claimed',
					id: `${cardId}:work`,
				});
				await append(id, {
					kind: 'changes_requested',
					actor: 'owner',
					cardId,
					note: note!,
					id: `${cardId}:action`,
				});
			}
		} else if (target.boundary === 'budget' && optionId === 'gaps') {
			const gaps = state.criteria
				.filter((criterion) => criterion.status !== 'pass')
				.map((criterion) => `${criterion.id}: ${criterion.reason}`)
				.concat(
					state.issues
						.filter((issue) => issue.state !== 'verified-pass')
						.map((issue) => issue.opened.title)
				);
			await append(id, {
				kind: 'accepted',
				actor: 'owner',
				cardId,
				withGaps: gaps.length ? gaps : ['The team stopped before completing its review and demo.'],
				id: `${cardId}:action`,
			});
		}
		if (optionId === 'stop') {
			for (const item of live.values()) if (item.teamId === id) item.controller.abort();
			jobs.get(id)?.abort();
		}
	}
	const answer = (id: string, cardId: string, optionId: string, note?: string) =>
		queue.enqueue(id, async () => {
			const state = await stateFor(id);
			const target = state.openCards.find((c) => c.id === cardId);
			if (!target || !target.options.some((o) => o.id === optionId) || state.terminal)
				throw new Error('Card or option is no longer available');
			if (['return', 'changes'].includes(optionId) && !note?.trim())
				throw new Error('Specific changes are required');
			if (
				target.boundary === 'acceptance' &&
				optionId === 'accept' &&
				(state.criteria.some((c) => c.status !== 'pass') ||
					state.issues.some((i) => i.state !== 'verified-pass') ||
					state.reviews.at(-1)?.verdict !== 'pass')
			)
				throw new Error('The team is not ready for acceptance');
			// The durable answer is the intent. Startup completes any missing semantic events.
			await append(id, {
				kind: 'card_answered',
				actor: 'owner',
				cardId,
				optionId,
				note,
				id: `${cardId}:answer`,
			});
			await applyAnswer(id, target, optionId, note);
		});
	const control = (id: string, kind: 'paused' | 'resumed' | 'stopped') =>
		queue.enqueue(id, async () => {
			const state = await stateFor(id);
			if (state.terminal) throw new Error('Team has ended');
			await append(id, { kind, actor: 'owner' });
			if (kind === 'stopped') {
				for (const item of live.values()) if (item.teamId === id) item.controller.abort();
				jobs.get(id)?.abort();
			}
		});
	return {
		async start() {
			if (running) return;
			running = true;
			unsubscribe = deps.store.subscribe((id) => {
				void wake(id).catch(deps.onError);
			});
			unsubscribeFollow = deps.followUps.onFire(followFired);
			for (const config of await deps.store.listTeams()) {
				const data = await load(config.id);
				for (const wait of reduceLedger(data.events).followUps)
					if (wait.followUpId.startsWith('job:'))
						await append(config.id, {
							kind: 'follow_up_fired',
							actor: 'app',
							followUpId: wait.followUpId,
							result: 'Restart: application work will be reconciled from its durable receipts.',
							id: `${wait.followUpId}:settled`,
						});
				if (!data.events.some((e) => e.kind === 'team_created'))
					await append(config.id, {
						kind: 'team_created',
						actor: 'app',
						config,
						id: `${config.id}:created`,
					});
				await wake(config.id);
			}
			// Reconcile the durable fire receipt if a quit happened before event delivery.
			for (const entry of await deps.followUps.list())
				if (entry.state === 'fired' && entry.fire)
					followFired({ ...entry.fire, followUp: entry, externalStatus: entry.externalStatus });
			await deps.followUps.start();
			timer = setInterval(() => {
				void deps.store
					.listTeams()
					.then((teams) => Promise.all(teams.map((team) => wake(team.id))))
					.catch(deps.onError);
			}, TEAM_FALLBACK_MS);
		},
		dispose() {
			running = false;
			if (timer) clearInterval(timer);
			unsubscribe?.();
			unsubscribeFollow?.();
			deps.followUps.stop();
			for (const item of live.values()) item.controller.abort();
			for (const controller of jobs.values()) controller.abort();
		},
		wake,
		async create(input: CreateTeamInput): Promise<TeamConfig> {
			if (!input?.idea?.trim() || !input.projectRoot?.trim())
				throw new Error('Idea and project root are required');
			if (input.sshRemoteId) throw new Error('SSH team workspaces are not implemented');
			if (
				!Number.isSafeInteger(input.turnBudget) ||
				input.turnBudget < 1 ||
				(input.deadline !== undefined && !Number.isFinite(input.deadline))
			)
				throw new Error('Invalid team budget');
			for (const seat of SEAT_ROLES)
				for (const model of [input.seats?.[seat], input.seats?.[seat]?.substitute].filter(
					(m) => m !== undefined
				)) {
					if (
						!isValidAgentId(model.tool) ||
						model.tool === 'terminal' ||
						(model.tool === 'codex' && model.effort?.toLowerCase().trim() === 'ultra')
					)
						throw new Error('Invalid team provider or effort');
				}
			if (
				SEAT_ROLES.some((seat) => !input.seats?.[seat]) ||
				['checks', 'push', 'draftPr', 'temporaryTakeover'].some(
					(key) => typeof input.authorizations?.[key as keyof TeamAuthorizations] !== 'boolean'
				)
			)
				throw new Error('Three seats and explicit authorizations are required');
			const config: TeamConfig = {
				...structuredClone(input),
				id: randomUUID(),
				createdAt: now(),
				title: input.idea.trim().replace(/\s+/g, ' ').slice(0, 100),
			};
			await deps.store.createTeam(config);
			await append(config.id, {
				kind: 'team_created',
				actor: 'app',
				config,
				id: `${config.id}:created`,
			});
			void wake(config.id).catch(deps.onError);
			return config;
		},
		list: () => deps.store.listTeams(),
		async get(id: string): Promise<RecordData | null> {
			try {
				return await load(id);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
				throw error;
			}
		},
		async status(id: string) {
			const data = await this.get(id);
			return data ? teamStatus(reduceLedger(data.events), now()) : null;
		},
		answer,
		say: (id: string, text: string, to?: SeatRole) =>
			queue.enqueue(id, async () => {
				if (!text?.trim() || (to !== undefined && !SEAT_ROLES.includes(to)))
					throw new Error('Invalid owner message');
				if ((await stateFor(id)).terminal) throw new Error('Team has ended');
				await append(id, {
					kind: 'owner_message',
					actor: 'owner',
					messageId: randomUUID(),
					text: to && to !== 'pm' ? `To ${to}: ${text}` : text,
					to: 'pm',
				});
			}),
		pause: (id: string) => control(id, 'paused'),
		resume: (id: string) => control(id, 'resumed'),
		stop: (id: string) => control(id, 'stopped'),
		async accept(id: string) {
			const state = await stateFor(id);
			const target = state.openCards.find((c) => c.boundary === 'acceptance');
			if (!target) throw new Error('No acceptance card');
			await answer(id, target.id, 'accept');
		},
		async requestChanges(id: string, note: string) {
			const state = await stateFor(id);
			const target = state.openCards.find((c) => c.boundary === 'acceptance');
			if (!target) throw new Error('No acceptance card');
			await answer(id, target.id, 'changes', note);
		},
		async export(id: string) {
			const data = await load(id);
			return JSON.stringify(data, null, '\t');
		},
		async seatTranscript(id: string, seat: SeatRole) {
			if (!SEAT_ROLES.includes(seat)) throw new Error('Invalid seat');
			const data = await this.get(id);
			if (!data) return null;
			const binding = reduceLedger(data.events).seats[seat].binding;
			return binding
				? {
						provider: binding.model.tool,
						nativeSessionId: binding.nativeSessionId,
						cwd: binding.workspace,
					}
				: null;
		},
	};
}

export type TeamScheduler = ReturnType<typeof createTeamScheduler>;
