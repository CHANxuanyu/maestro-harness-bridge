import { checkCommandBoundary, type CheckBoundary } from '../../shared/checkRun';
import { createHash, randomUUID } from 'crypto';
import { DURATION_MS } from '../../shared/duration';
import { isValidAgentId } from '../../shared/agentIds';
import { decideNext, judgeAttempts } from '../../shared/progressRules';
import {
	isOpenTeamIssue,
	baselineDiff,
	discussionDecider,
	referenceVotes,
	pmMayChange,
	missingOutputLocations,
	teamReadyForDemo,
	teamTurnPermission,
} from '../../shared/team/policy';
import { reduceLedger } from '../../shared/team/ledger';
import { buildTeamTurnPrompt } from '../../shared/team/prompts';
import {
	extractTeamReport,
	validateTeamReport,
	reportRepairPrompt,
	teamReplyMessage,
} from '../../shared/team/report';
import { teamStatus } from '../../shared/team/status';
import {
	SEAT_ROLES,
	type CreateTeamInput,
	type LedgerEvent,
	type M1TurnKind,
	type ReportTurnKind,
	type TeamDiscussion,
	type StandardChangeRequest,
	type OutputCapture,
	type DiscussionAction,
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
	captureOutput(
		cwd: string,
		revision: string,
		criteria?: TeamState['criteria'],
		beforeOutputId?: string
	): Promise<OutputCapture>;
	/** Host-resolved launch configuration; never supplied by a seat report. */
	seatOptions?(
		config: TeamConfig,
		seat: SeatRole
	): Pick<SeatTurnRequest, 'customEnv' | 'customPath' | 'customArgs'>;
	now?: () => number;
	onError(error: unknown): void;
}

/** Main-owned team state machine. Long-running work never holds the event/action queue. */
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
	const recoveryAt = (events: LedgerEvent[], seat: SeatRole) =>
		events.findLast(
			(event) =>
				event.kind === 'card_answered' || (event.kind === 'member_recovered' && event.seat === seat)
		)?.seq ?? 0;
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
		if (dispatch.prompt !== undefined) return dispatch.prompt;
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
		} else
			prompt = buildTeamTurnPrompt(
				expected as ReportTurnKind,
				dispatch.seat,
				state,
				dispatch.discussionId
			);
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
			turn: dispatch.turn,
			cwd: binding.workspace,
			nativeSessionId: ['position', 'proposal', 'response', 'retro'].includes(
				dispatch.expectedTurn ?? dispatch.turn
			)
				? undefined
				: binding.nativeSessionId,
			permissionMode: teamTurnPermission(dispatch.seat, dispatch.turn),
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
	};
	const finish = async (id: string, dispatch: Dispatch, result: SeatTurnResult) => {
		const data = await load(id);
		if (data.events.some((e) => e.kind === 'turn_finished' && e.dispatchId === dispatch.dispatchId))
			return;
		if (result.nativeSessionId && !dispatch.discussionId) {
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
		let parsed = extracted.ok
			? validateTeamReport(
					extracted.report,
					dispatch.expectedTurn ?? dispatch.turn,
					dispatch.seat,
					validationState
				)
			: extracted;
		if (
			parsed.ok &&
			'discussionId' in parsed.report &&
			parsed.report.discussionId !== dispatch.discussionId
		) {
			parsed = { ok: false, reason: 'The report must address the dispatched discussion.' };
		}
		const failureKind = result.failure?.kind ?? (result.exitCode !== 0 ? 'turn-failed' : undefined);
		const good = parsed.ok && !failureKind && !result.canceled;
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
			failureKind,
			id: `${dispatch.dispatchId}:finished`,
		})) as TeamEvent<'turn_finished'>;
		if (good && (dispatch.seat !== 'qa' || teamTurnPermission('qa', dispatch.turn) === 'readonly'))
			await ingest(id, dispatch, finished);
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
				fault: failureKind ?? (extracted.ok ? 'bad-report' : 'missing-report'),
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
						if (dispatch.discussionId) return;
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
		turn: ReportTurnKind,
		options: Partial<
			Pick<
				Dispatch,
				| 'repairOf'
				| 'retryOf'
				| 'mode'
				| 'problemId'
				| 'fingerprint'
				| 'failures'
				| 'note'
				| 'discussionId'
				| 'round'
				| 'messageIds'
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
		// A new dispatch ID is not a new assignment. Derive the latch from durable
		// receipts so fallback wakes, unrelated events and restarts cannot reset it.
		let data = await load(id);
		const resetAt = recoveryAt(data.events, seat);
		const failures = state.turns.filter(
			(attempt) =>
				attempt.seat === seat &&
				attempt.dispatched &&
				attempt.finished &&
				attempt.finished.seq > resetAt &&
				!attempt.finished.canceled &&
				!attempt.finished.report &&
				!attempt.report &&
				!attempt.repaired
		);
		const recoveryOf = options.retryOf ?? options.repairOf;
		if (recoveryOf) {
			const original = state.turns.find((attempt) => attempt.dispatchId === recoveryOf);
			if (
				!original?.finished ||
				original.seat !== seat ||
				original.report ||
				(options.retryOf && original.dispatched?.retryOf) ||
				original.dispatched?.repairOf ||
				state.turns.some(
					(attempt) =>
						attempt.dispatched?.retryOf === recoveryOf ||
						attempt.dispatched?.repairOf === recoveryOf
				)
			)
				return;
			if (options.retryOf) {
				const sameKind = failures.filter(
					(attempt) => (attempt.dispatched!.expectedTurn ?? attempt.dispatched!.turn) === turn
				);
				// Old ledgers may already contain duplicate roots without retryOf.
				// Those attempts have spent the retry too; never retry each UUID anew.
				if (sameKind.length !== 1 || sameKind[0].dispatchId !== recoveryOf) return;
				if (original.finished.failureKind === 'session-broken') {
					const binding = state.seats[seat].binding!;
					await append(id, {
						kind: 'seat_bound',
						actor: 'app',
						seat,
						model: binding.model,
						workspace: binding.workspace,
						reason: 'restored',
						id: `${recoveryOf}:fresh-session`,
					});
					data = await load(id);
				}
			}
		} else if (failures.length) {
			if (
				failures.some(
					(attempt) => (attempt.dispatched!.expectedTurn ?? attempt.dispatched!.turn) === turn
				)
			)
				return;
			const failed = failures.at(-1)!.dispatched!;
			// A different kind may respond to new input, but an automatic PM wake
			// or a different prompt digest alone is not evidence of a changed basis.
			const changedBasis =
				(options.discussionId && options.discussionId !== failed.discussionId) ||
				(options.problemId && options.problemId !== failed.problemId) ||
				options.messageIds?.some((messageId) => !failed.messageIds?.includes(messageId)) ||
				data.events.some(
					(event) =>
						event.seq > (failed.sourceSeq ?? failed.seq) &&
						(event.kind === 'standard_change' ||
							event.kind === 'workspace_submitted' ||
							event.kind === 'output_captured' ||
							event.kind === 'check_run' ||
							event.kind === 'issue_opened')
				);
			if (!changedBasis) return;
		}
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
		input.prompt = promptFor(input, data.events);
		input.promptDigest = createHash('sha256').update(input.prompt).digest('hex');
		const saved = (await append(id, input)) as Dispatch;
		for (const messageId of options.messageIds ?? [])
			await append(id, {
				kind: 'message_delivered',
				actor: 'app',
				messageId,
				seat,
				dispatchId,
				id: `${dispatchId}:delivery:${messageId}`,
			});
		launch({ ...data, events: [...data.events, saved] }, saved);
		return true;
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
	const checkApproval = async (
		id: string,
		command: string,
		key: string,
		declared?: CheckBoundary
	) => {
		const boundary = checkCommandBoundary(command, declared);
		if (!boundary) return 'allow' as const;
		return queue.enqueue(id, async () => {
			const state = await stateFor(id);
			const cardId = `permission:check:${key}`;
			const answer = state.cardAnswers.find((a) => a.cardId === cardId);
			if (answer) return answer.optionId === 'once' ? ('allow' as const) : ('omit' as const);
			await card(id, {
				id: cardId,
				boundary: 'permission',
				title: 'Approve this check once',
				body: JSON.stringify({
					command,
					boundary,
					scope: 'Only this invocation; the team workspace grant is unchanged.',
				}),
				options: [
					{ id: 'once', label: 'Allow only this invocation' },
					{ id: 'omit', label: 'Do not add this check', recommended: true },
				],
			});
			return 'waiting' as const;
		});
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
			const approval = await checkApproval(id, check.command, eventId, check.boundary);
			if (approval === 'waiting') return;
			if (approval === 'omit') {
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
						exitCode: null,
						outputTail: '',
						durationMs: 0,
						evidenceId: eventId,
						notRun: 'Owner declined this boundary-crossing check',
					})
				);
				continue;
			}
			const result = await deps.checks.run({ command: check.command, cwd, signal });
			const previous = (await stateFor(id)).checks.findLast((c) =>
				c.covers.some((criterion) => check.covers.includes(criterion))
			);
			const dilution: string[] = [];
			if (previous && previous.command !== check.command) dilution.push('Check command changed');
			if (
				previous?.testsRun !== undefined &&
				result.testsRun !== undefined &&
				result.testsRun < previous.testsRun
			)
				dilution.push('Fewer tests ran');
			if (
				previous?.testsSkipped !== undefined &&
				result.testsSkipped !== undefined &&
				result.testsSkipped > previous.testsSkipped
			)
				dilution.push('More tests were skipped');
			if (result.testsRun === undefined) dilution.push('Test count unavailable from this command');
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
					testsRun: result.testsRun,
					testsSkipped: result.testsSkipped,
					dilution,
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
			state.checks
				.filter(
					(c) =>
						c.purpose !== 'trial' &&
						state.baseline.brief?.checks.some((check) => check.command === c.command)
				)
				.map((c) => [c.command, c])
		);
		return [
			...[...latest.values()]
				.filter((c) => c.exitCode !== 0 || c.timedOut || c.notRun)
				.map((c) =>
					JSON.stringify([c.command, c.exitCode, c.timedOut, c.notRun, c.outputTail.trim()])
				),
			...state.issues
				.filter((i) => isOpenTeamIssue(i))
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
				submitted.revision,
				state.criteria,
				state.outputs.at(-1)?.outputId
			);
			await queue.enqueue(id, () =>
				append(id, {
					kind: 'output_captured',
					actor: 'app',
					outputId: `${turn.dispatchId}:${submitted!.revision}`,
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
			state.issues.find((i) => isOpenTeamIssue(i) && i.opened.issueKind === 'defect')?.id ??
			'checks';
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
				if (decision.kind === 'diagnose') {
					await openDiscussion(
						id,
						`diagnosis:${problemId}:${progress.attempts.at(-1)?.id}`,
						'Diagnose repeated failures and choose a new basis',
						'no-progress',
						problemId
					);
					return;
				}
				await dispatch(id, current, 'dev', kind, {
					problemId,
					fingerprint: decision.kind === 'continue' ? fingerprint : undefined,
					failures: failing,
					mode: decision.kind === 'gather' ? 'gather' : undefined,
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
				teamTurnPermission('qa', dispatched.turn) === 'full' &&
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
	const openDiscussion = async (
		id: string,
		discussionId: string,
		topic: string,
		trigger: string,
		problemId?: string
	) =>
		append(id, {
			kind: 'discussion_opened',
			actor: 'app',
			id: `${discussionId}:opened`,
			discussionId,
			topic,
			owner: 'pm',
			participants: ['pm', 'dev', 'qa'],
			trigger,
			layer: 'product',
			reversible: true,
			question: discussionId,
			problemId,
		});
	const applyStandardChange = async (
		id: string,
		change: StandardChangeRequest,
		approvedBy: 'pm' | 'owner',
		key: string,
		cardId?: string
	) => {
		const current = await stateFor(id);
		await append(id, {
			kind: 'standard_change',
			actor: approvedBy,
			approvedBy,
			cardId,
			criterionId: change.criterionId,
			change: change.change,
			before: current.criteria.find((c) => c.id === change.criterionId)?.text,
			after: change.criterion?.text,
			criterion: change.criterion,
			reason: change.reason,
			id: `${key}:change`,
		});
		if (change.change !== 'remove')
			await append(id, {
				kind: 'work_item',
				actor: 'app',
				itemId: `${key}:work`,
				title: change.criterion!.text,
				owner: 'dev',
				state: 'claimed',
				criterionId: change.criterionId,
				id: `${key}:work`,
			});
	};
	const concludeDiscussion = async (
		id: string,
		discussion: TeamDiscussion,
		decider: 'app' | 'owner' | SeatRole,
		contested: boolean,
		decision?: string,
		cardId?: string
	) => {
		const proposal = discussion.proposals.at(-1)!;
		const round = proposal.round ?? discussion.proposals.length;
		const responses = discussion.responses.filter((r) => (r.round ?? 1) === round);
		const actions: DiscussionAction[] =
			discussion.decision?.actions ??
			proposal.actions ??
			discussion.opened!.participants.map((seat) => ({
				seat,
				action: 'Apply the recorded decision',
			}));
		const key = `${discussion.id}:conclusion`;
		await append(id, {
			kind: 'discussion_closed',
			actor: 'app',
			discussionId: discussion.id,
			decision: decision ?? proposal.proposal,
			decider,
			contested,
			cardId,
			dissent: responses
				.filter((r) => r.result !== 'agree')
				.map((r) => `${r.seat}: ${r.reason}`)
				.join('\n'),
			actions,
			id: key,
		});
		for (const [index, action] of actions.entries()) {
			const itemId = `${key}:action:${index}`;
			if (action.waitFor) {
				const untilMs = now() + FOLLOW_UP_WAIT_MS;
				if (!(await load(id)).events.some((e) => e.id === itemId)) {
					await deps.followUps.register({
						id: itemId,
						target: { kind: 'team', teamId: id, seat: action.seat },
						reason: action.action,
						condition: { kind: 'time', at: untilMs },
						deadline: untilMs,
					});
					await append(id, {
						kind: 'follow_up_registered',
						actor: 'app',
						followUpId: itemId,
						seat: action.seat,
						reason: action.action,
						waitFor: action.waitFor,
						untilMs,
						id: itemId,
					});
				}
			} else
				await append(id, {
					kind: 'work_item',
					actor: 'app',
					itemId,
					title: action.action,
					owner: action.seat,
					state: 'claimed',
					discussionId: discussion.id,
					id: itemId,
				});
		}
		const current = await stateFor(id);
		if (current.baseline.confirmedVersion && !discussion.decision)
			await transition(
				id,
				current,
				current.issues.some((i) => i.opened.issueKind === 'defect' && isOpenTeamIssue(i))
					? 'verify'
					: 'implement'
			);
	};
	/** Returns true while the topic owns scheduling. Other seats receive no private transcript. */
	const discuss = async (id: string, state: TeamState): Promise<boolean> => {
		const discussion = state.discussions.find((d) => d.opened && !d.decision);
		if (!discussion) return false;
		const opened = discussion.opened!;
		for (const seat of opened.participants) {
			if (discussion.positions.some((p) => p.seat === seat)) continue;
			await dispatch(id, await stateFor(id), seat, 'position', { discussionId: discussion.id });
		}
		if (discussion.positions.length !== opened.participants.length) return true;
		const proposal = discussion.proposals.at(-1);
		if (!proposal) {
			await dispatch(id, state, opened.owner, 'proposal', {
				discussionId: discussion.id,
				round: 1,
			});
			return true;
		}
		const round = proposal.round ?? discussion.proposals.length;
		const responses = discussion.responses.filter((r) => (r.round ?? 1) === round);
		for (const seat of opened.participants) {
			if (responses.some((r) => r.seat === seat)) continue;
			await dispatch(id, await stateFor(id), seat, 'response', {
				discussionId: discussion.id,
				round,
			});
		}
		if (responses.length !== opened.participants.length) return true;
		const decider = discussionDecider(discussion);
		const objections = responses.filter(
			(r) => r.seat !== decider && r.result !== 'agree' && r.evidence
		);
		const observedExperiment = state.checks.some(
			(c) =>
				c.batchId?.startsWith(`discussion:${discussion.id}:`) &&
				!c.notRun &&
				c.exitCode !== null &&
				!c.timedOut &&
				c.seq < proposal.seq
		);
		const needsExperiment =
			new Set(objections.map((r) => r.seat)).size >= 2 &&
			!proposal.compromise &&
			!observedExperiment;
		const experiment = proposal.experiment;
		if (experiment) {
			const batchId = `discussion:${discussion.id}:${createHash('sha256').update(experiment.command).digest('hex')}`;
			if (!state.checks.some((c) => c.batchId === batchId)) {
				if (await permission(id, state, 'checks', `Run a small experiment: ${experiment.command}`))
					await startJob(id, batchId, async (controller) => {
						const cwd = state.seats.dev.binding!.workspace;
						const approval = await checkApproval(
							id,
							experiment.command,
							batchId,
							experiment.boundary
						);
						if (approval === 'waiting') return;
						if (approval === 'omit') {
							await queue.enqueue(id, () =>
								append(id, {
									kind: 'check_run',
									actor: 'app',
									command: experiment.command,
									cwd,
									covers: [],
									batchId,
									exitCode: null,
									outputTail: '',
									durationMs: 0,
									evidenceId: batchId,
									notRun: 'Owner declined this experiment',
									id: `${batchId}:result`,
								})
							);
							return;
						}
						const result = await deps.checks.run({
							command: experiment.command,
							cwd,
							timeoutMs: Math.max(
								1,
								Math.min(TEAM_FALLBACK_MS, (state.config!.deadline ?? Infinity) - now())
							),
							signal: controller.signal,
						});
						await queue.enqueue(id, () =>
							append(id, {
								kind: 'check_run',
								actor: 'app',
								command: experiment.command,
								cwd,
								covers: [],
								batchId,
								exitCode: result.exitCode,
								outputTail: result.outputTail,
								durationMs: result.endedAt - result.startedAt,
								evidenceId: result.id,
								timedOut: result.outcome === 'timeout',
								notRun:
									result.outcome === 'not-run' || result.outcome === 'canceled'
										? (result.error ?? result.outcome)
										: undefined,
								id: `${batchId}:result`,
							})
						);
					});
				return true;
			}
			const result = state.checks.find((c) => c.batchId === batchId)!;
			if (result.seq > proposal.seq && !result.notRun) {
				await dispatch(id, state, opened.owner, 'proposal', {
					discussionId: discussion.id,
					round: round + 1,
					note: `Experiment result: ${JSON.stringify(result)}. Decide from this observation; do not repeat the experiment.`,
				});
				return true;
			}
		}
		if (needsExperiment) {
			await dispatch(id, state, opened.owner, 'proposal', {
				discussionId: discussion.id,
				round: round + 1,
				note: 'Two non-owners object with evidence. Supply a small experiment or a compromise before deciding.',
			});
			return true;
		}
		const insist = responses.some((r) => r.result === 'insist');
		const newEvidence = responses.some(
			(r) =>
				r.evidence &&
				!discussion.responses.some(
					(old) => old.seq < proposal.seq && old.evidence === r.evidence
				) &&
				!discussion.positions.some((p) => p.evidence?.includes(r.evidence!)) &&
				!opened.evidence?.includes(r.evidence)
		);
		if (insist && (round < 2 || newEvidence)) {
			await dispatch(id, state, opened.owner, 'proposal', {
				discussionId: discussion.id,
				round: round + 1,
				note: newEvidence
					? 'New evidence permits another round.'
					: 'Second discussion round. Preserve objections and seek a resolution.',
			});
			return true;
		}
		const change = opened.change;
		const pmChange = change && pmMayChange(change, state, discussion);
		if (decider === 'owner' || (change && !pmChange)) {
			const criterion = state.criteria.find((c) => c.id === change?.criterionId);
			await card(id, {
				id: `discussion:${discussion.id}`,
				boundary: 'commitment',
				title: opened.topic,
				discussionId: discussion.id,
				standardChange: change,
				referenceVotes: referenceVotes(discussion, state),
				body: JSON.stringify({
					before: criterion,
					after: change?.criterion,
					currentCheckResult: criterion?.reason,
					failingNow: criterion?.status === 'fail',
					positions: discussion.positions,
					proposal: proposal.proposal,
					responses,
					boundary: 'The next step is irreversible or changes a commitment.',
				}),
				budgetNote: `${state.usage.turns}/${state.config!.turnBudget} turns used`,
				options: change
					? [
							{ id: 'approve', label: 'Approve this standard change', cost: change.reason },
							{ id: 'keep', label: 'Keep the existing standard', recommended: true },
						]
					: (proposal.options ?? [
							{ id: 'approve', label: 'Approve the proposed commitment', cost: proposal.proposal },
							{ id: 'keep', label: 'Keep the current commitment', recommended: true },
						]),
			});
			return true;
		}
		if (pmChange) await applyStandardChange(id, change, 'pm', discussion.id);
		await concludeDiscussion(
			id,
			discussion,
			decider,
			insist,
			decider === 'app'
				? `Facts remain determined by recorded evidence. ${JSON.stringify(state.checks.map((c) => ({ command: c.command, exitCode: c.exitCode })))}`
				: undefined
		);
		return true;
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
		for (const discussion of state.discussions.filter((d) => d.decision && d.proposals.length)) {
			if (
				discussion.decision!.actions.some(
					(_, index) =>
						!data.events.some((e) => e.id === `${discussion.id}:conclusion:action:${index}`)
				)
			)
				await concludeDiscussion(
					id,
					discussion,
					discussion.decision!.decider,
					!!discussion.decision!.contested,
					discussion.decision!.decision,
					discussion.decision!.cardId
				);
		}
		for (const target of state.openCards.filter((c) => c.boundary === 'baseline')) {
			const raisedAt =
				data.events.find((e) => e.kind === 'decision_card' && e.card.id === target.id)?.seq ?? 0;
			if ((state.standardChanges.at(-1)?.seq ?? 0) > raisedAt) {
				await append(id, {
					kind: 'card_superseded',
					actor: 'app',
					cardId: target.id,
					reason: 'Owner changed the draft baseline.',
				});
				return;
			}
		}
		for (const target of state.openCards.filter((c) => c.boundary === 'acceptance')) {
			if (
				!teamReadyForDemo(state) &&
				state.standardChanges.at(-1) &&
				state.standardChanges.at(-1)!.seq > (state.demos.at(-1)?.seq ?? 0)
			) {
				await append(id, {
					kind: 'card_superseded',
					actor: 'app',
					cardId: target.id,
					reason: 'Owner scope changed after this demo.',
				});
				return;
			}
		}
		if (state.paused || state.terminal || jobs.has(id)) return;
		for (const turn of state.turns)
			if (turn.dispatched && !turn.finished && !live.has(turn.dispatchId))
				launch(data, turn.dispatched, true);
		const wakePm = () =>
			active || SEAT_ROLES.some((seat) => state.seats[seat].faultActive)
				? Promise.resolve()
				: dispatch(id, state, 'pm', 'topic', { mode: 'wake' });
		const active = SEAT_ROLES.reduce(
			(count, seat) => count + state.seats[seat].activeDispatchIds.length,
			0
		);
		if (active >= 2) return;
		// Owner messages remain usable while a card waits; they never auto-answer the card.
		if (state.openCards.length && !state.pendingMessages.length) return;
		if (
			state.usage.turns >= data.config.turnBudget ||
			(data.config.deadline !== undefined && now() >= data.config.deadline)
		) {
			await card(id, {
				id: 'budget',
				boundary: 'budget',
				title: 'Incomplete progress report',
				body: `This is a progress report, not a completion demo. ${JSON.stringify({ missing: teamStatus(state, now()).criteria.missing, changes: state.standardChanges, contested: state.decisions.filter((d) => d.contested), suggestions: state.suggestions, evidenceChanges: state.checks.filter((c) => c.dilution?.length) })}`,
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
				!t.finished.failureKind &&
				!t.finished.canceled &&
				!state.turns.some((r) => r.dispatched?.repairOf === t.dispatchId)
		);
		if (broken?.dispatched && !state.seats[broken.seat].activeDispatchIds.length) {
			await dispatch(
				id,
				state,
				broken.seat,
				(broken.dispatched.expectedTurn ?? broken.dispatched.turn) as M1TurnKind,
				{
					repairOf: broken.dispatchId,
					discussionId: broken.dispatched.discussionId,
					round: broken.dispatched.round,
					messageIds: broken.dispatched.messageIds,
				}
			);
			return;
		}
		const failedTurns = state.turns.filter(
			(turn) =>
				turn.finished &&
				(turn.finished.exitCode !== 0 || turn.finished.failureKind) &&
				!turn.report &&
				!turn.repaired &&
				!turn.finished.canceled &&
				!turn.dispatched?.retryOf &&
				!turn.dispatched?.repairOf &&
				!state.turns.some(
					(retry) =>
						retry.dispatched?.retryOf === turn.dispatchId ||
						retry.dispatched?.repairOf === turn.dispatchId
				)
		);
		for (const failed of failedTurns) {
			if (!failed.dispatched || state.seats[failed.seat].activeDispatchIds.length) continue;
			if (
				await dispatch(
					id,
					await stateFor(id),
					failed.seat,
					(failed.dispatched.expectedTurn ?? failed.dispatched.turn) as M1TurnKind,
					{
						retryOf: failed.dispatchId,
						mode: failed.dispatched.mode,
						problemId: failed.dispatched.problemId,
						fingerprint: failed.dispatched.fingerprint,
						failures: failed.dispatched.failures,
						discussionId: failed.dispatched.discussionId,
						round: failed.dispatched.round,
						messageIds: failed.dispatched.messageIds,
						note: 'The previous attempt may have done part of the work. Inspect existing results first; preserve completed actions. This is the single same-turn retry.',
					}
				)
			)
				return;
		}
		// Explicit recovery or an owner answer can restart an exhausted assignment.
		// Do not revive older failures after a later successful turn (including repair).
		for (const seat of SEAT_ROLES) {
			const lastTurn = state.turns.findLast((turn) => turn.seat === seat);
			if (
				lastTurn?.dispatched &&
				lastTurn.finished &&
				!lastTurn.report &&
				!lastTurn.finished.report &&
				!lastTurn.finished.canceled &&
				lastTurn.finished.seq < recoveryAt(data.events, seat)
			) {
				const previous = lastTurn.dispatched;
				if (
					await dispatch(
						id,
						state,
						seat,
						(previous.expectedTurn ?? previous.turn) as ReportTurnKind,
						{
							mode: previous.mode,
							problemId: previous.problemId,
							fingerprint: previous.fingerprint,
							failures: previous.failures,
							discussionId: previous.discussionId,
							round: previous.round,
							messageIds: previous.messageIds,
							note: 'The owner answered or the seat recovered. Inspect existing results before resuming the failed assignment.',
						}
					)
				)
					return;
			}
		}
		const epoch =
			data.events
				.filter(
					(e) =>
						e.kind === 'changes_requested' ||
						e.kind === 'standard_change' ||
						(e.kind === 'phase_changed' && e.to === 'implement')
				)
				.at(-1)?.seq ?? 0;
		const rejectedAt = state.reviews.findLast((r) => r.verdict === 'reject')?.seq ?? 0;
		const turns = state.turns.filter(
			(t) => !t.dispatched?.repairOf && (t.dispatched?.seq ?? 0) > epoch
		);
		const published = data.events.filter((e) => e.kind === 'brief_published').at(-1);
		const previousBrief =
			published && state.briefs.find((b) => b.version === published.brief.version - 1);
		const revisionDiff =
			published && previousBrief ? baselineDiff(previousBrief, published.brief) : undefined;
		const challengeEpoch =
			revisionDiff &&
			(revisionDiff.criteria.length ||
				revisionDiff.scope ||
				revisionDiff.notDoing ||
				revisionDiff.checks)
				? published!.seq
				: 0;
		const last = (kind: M1TurnKind, seat?: SeatRole) =>
			turns
				.filter(
					(t) =>
						t.dispatched?.turn === kind &&
						(kind !== 'challenge' || t.dispatched.seq > challengeEpoch) &&
						(!seat || t.seat === seat) &&
						(!['fix', 'reverify'].includes(kind) || t.dispatched.seq > rejectedAt) &&
						t.report?.type !== 'topic'
				)
				.at(-1);
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
		// A targeted message wakes only its recipient, after its current turn, before phase work.
		if (state.pendingMessages.length) {
			const message = state.pendingMessages[0];
			const forwarded = state.messages.find(
				(m) => m.message.messageId === message.messageId
			)?.forwarded;
			const seat = forwarded ? 'pm' : (message.to ?? 'pm');
			const messageIds = state.pendingMessages
				.filter(
					(m) =>
						(state.messages.find((item) => item.message.messageId === m.messageId)?.forwarded
							? 'pm'
							: (m.to ?? 'pm')) === seat
				)
				.map((m) => m.messageId);
			await dispatch(id, state, seat, 'message', { messageIds });
			return;
		}
		if (state.openCards.length) return;
		if (await discuss(id, state)) return;
		const retrospective = state.discussions.find(
			(d) =>
				d.decision &&
				['rejections', 'no-progress'].includes(d.opened?.trigger ?? '') &&
				!state.retros.some((r) => r.discussionId === d.id)
		);
		if (retrospective) {
			await dispatch(id, state, 'pm', 'retro', { discussionId: retrospective.id });
			return;
		}
		const actions = state.workItems.filter((item) => item.discussionId && item.state === 'claimed');
		if (actions.length) {
			for (const seat of SEAT_ROLES) {
				const assigned = actions.filter((item) => item.owner === seat);
				if (!assigned.length) continue;
				const turn =
					!state.baseline.confirmedVersion ||
					seat === 'pm' ||
					assigned.some(
						(item) =>
							state.discussions.find((d) => d.id === item.discussionId)?.opened?.trigger ===
							'standard-issue'
					)
						? 'message'
						: seat === 'qa'
							? 'qa_prep'
							: state.issues.some((i) => i.opened.issueKind === 'defect' && isOpenTeamIssue(i))
								? 'fix'
								: 'work';
				await dispatch(id, await stateFor(id), seat, turn, {
					note: `Carry out the decided next steps: ${JSON.stringify(assigned)}. Before baseline confirmation, report preparation only; do not implement.`,
				});
			}
			return;
		}
		const rejected = state.reviews.at(-1);
		if (
			rejected?.verdict === 'reject' &&
			!data.events.some((e) => e.id === `${rejected.id}:discussion:opened`)
		) {
			await openDiscussion(
				id,
				`${rejected.id}:discussion`,
				'Resolve the product review problems',
				state.reviewDecision.kind === 'diagnose' ? state.reviewDecision.reason : 'review'
			);
			return;
		}
		if (
			rejected?.verdict === 'reject' &&
			state.phase === 'review' &&
			rejected.seq > (state.outputs.at(-1)?.seq ?? 0)
		) {
			await transition(id, state, 'verify');
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
			if (
				!last('respond') ||
				last('respond')!.dispatched!.seq <
					Math.max(
						returned,
						last('challenge', 'dev')!.dispatched!.seq,
						last('challenge', 'qa')!.dispatched!.seq
					)
			)
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
			if (
				state.checks.some(
					(c) =>
						c.batchId === batchId &&
						(c.notRun || c.timedOut || c.exitCode === 126 || c.exitCode === 127)
				)
			) {
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
				id: `baseline:${last('respond')!.dispatchId}:v${state.brief.version}`,
				boundary: 'baseline',
				title: 'Confirm the baseline',
				body: JSON.stringify({
					brief: state.brief,
					question: response.type === 'respond' ? response.askOwner : undefined,
					trials: state.checks.filter((c) => c.batchId === batchId),
					diff: baselineDiff(state.briefs.at(-2) ?? null, state.brief),
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
			if (!state.outputs.length) {
				return startJob(id, 'capture-before', async () => {
					const workspace = await ws(state).initialize();
					const revision = workspace.baseRevision ?? workspace.qaRevision;
					const output = await deps.captureOutput(
						state.seats.dev.binding!.workspace,
						revision,
						state.criteria
					);
					await queue.enqueue(id, () =>
						append(id, {
							kind: 'output_captured',
							actor: 'app',
							outputId: `before:${revision}`,
							...output,
							id: `${id}:before-output`,
						})
					);
				});
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
				state.issues.some((i) => isOpenTeamIssue(i) && i.opened.issueKind === 'defect') ||
				!batchPass(state, `submit:${fix?.dispatchId ?? last('work')?.dispatchId}`)
			)
				return fixNext(id, await stateFor(id), 'fix');
			if (state.issues.some((i) => isOpenTeamIssue(i)))
				return dispatch(id, state, 'pm', 'message', {
					mode: 'wake',
					note: 'Resolve standard issues or propose standardChanges. Do not assign an unjudgeable criterion to dev.',
				});
			if (state.criteria.filter((c) => c.proof !== 'pm').every((c) => c.status === 'pass')) {
				const missing = missingOutputLocations(state, state.outputs.at(-1));
				if (missing.length) {
					const resolved = data.events
						.filter(
							(e) =>
								e.kind === 'standard_issue_resolved' && e.seq > (state.outputs.at(-1)?.seq ?? 0)
						)
						.at(-1);
					const submitted = data.events.filter((e) => e.kind === 'workspace_submitted').at(-1);
					if (resolved && submitted)
						return startJob(id, `recapture:${resolved.id}`, async () => {
							const output = await deps.captureOutput(
								state.seats.dev.binding!.workspace,
								submitted.revision,
								state.criteria,
								state.outputs.at(-1)?.outputId
							);
							await queue.enqueue(id, () =>
								append(id, {
									kind: 'output_captured',
									actor: 'app',
									outputId: `recapture:${resolved.id}`,
									...output,
									id: `recapture:${resolved.id}`,
								})
							);
						});
					for (const [index, location] of missing.entries())
						await append(id, {
							kind: 'issue_opened',
							actor: 'app',
							issueId: `output:${state.outputs.at(-1)?.outputId}:${index}`,
							title: `Output cannot be judged: ${location}`,
							issueKind: 'standard',
							steps: [location],
							id: `output:${state.outputs.at(-1)?.outputId}:${index}`,
						});
					return;
				}
				await transition(id, state, 'review');
				return;
			}
			return dispatch(id, state, 'qa', 'verify', {
				note: 'Issue retests are narrower than criterion verification. Supply the remaining criterion evidence.',
			});
		} else if (state.phase === 'review') {
			if (!last('review') || last('review')!.dispatched!.seq < (state.outputs.at(-1)?.seq ?? 0))
				return dispatch(id, state, 'pm', 'review');
			if (accepted('review') && teamReadyForDemo(state)) {
				await transition(id, state, 'demo');
				return;
			}
		} else if (state.phase === 'demo' || state.phase === 'accept') {
			if (!teamReadyForDemo(state)) {
				await transition(id, state, 'verify');
				return;
			}
			if (!last('demo') || last('demo')!.dispatched!.seq < (state.reviews.at(-1)?.seq ?? 0))
				return dispatch(id, state, 'pm', 'demo');
			if (accepted('demo')) {
				await transition(id, state, 'accept');
				await card(id, {
					id: `acceptance:${last('demo')!.dispatchId}`,
					boundary: 'acceptance',
					title: 'Accept the demonstrated result',
					body: JSON.stringify({
						output: state.outputs.at(-1),
						before: state.outputs.at(-2),
						demo: state.demos.at(-1),
						evidence: teamStatus(state, now()).criteria,
						changes: state.standardChanges,
						contested: state.decisions.filter((d) => d.contested),
						suggestions: state.suggestions,
						evidenceChanges: state.checks.filter((c) => c.dilution?.length),
					}),
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
		if (target.boundary === 'baseline' && optionId === 'return')
			await openDiscussion(id, `${target.id}:returned`, note!, 'baseline-return');
		if (target.boundary === 'acceptance' && optionId === 'changes')
			await openDiscussion(id, `${target.id}:requested`, note!, 'requested-changes');
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
					ownerMessageId: `${cardId}:changes`,
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
		} else if (target.discussionId) {
			const discussion = state.discussions.find((d) => d.id === target.discussionId)!;
			if (target.standardChange && optionId !== 'keep')
				await applyStandardChange(id, target.standardChange, 'owner', cardId, cardId);
			if (optionId === 'keep')
				discussion.proposals[discussion.proposals.length - 1] = {
					...discussion.proposals.at(-1)!,
					actions: discussion.opened!.participants.map((seat) => ({
						seat,
						action: 'Find an implementation that preserves the existing confirmed criterion.',
					})),
				};
			await concludeDiscussion(
				id,
				discussion,
				'owner',
				false,
				optionId === 'keep'
					? 'Owner kept the existing commitment. Seek an in-scope solution.'
					: target.options.find((o) => o.id === optionId)?.label,
				cardId
			);
			await append(id, {
				kind: 'message_handled',
				actor: 'app',
				messageId: cardId,
				seat: 'pm',
				summary: 'Owner decision applied',
				id: `${cardId}:action`,
			});
		} else if (target.boundary === 'budget' && optionId === 'gaps') {
			const gaps = state.criteria
				.filter((criterion) => criterion.status !== 'pass')
				.map((criterion) => `${criterion.id}: ${criterion.reason}`)
				.concat(
					state.issues.filter((issue) => isOpenTeamIssue(issue)).map((issue) => issue.opened.title)
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
				(!teamReadyForDemo(state) || !state.demos.length)
			)
				throw new Error('The team is not ready for acceptance');
			if (target.boundary === 'baseline' && optionId === 'confirm') {
				const trials = state.checks.filter((c) => c.batchId === `trial:${state.brief?.version}`);
				if (
					!state.brief ||
					trials.length !== state.brief.checks.length ||
					trials.some((c) => c.notRun || c.timedOut || c.exitCode === 126 || c.exitCode === 127)
				)
					throw new Error('The current baseline commands must run before confirmation');
			}
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
		async baselineDiff(id: string) {
			const { events } = await load(id);
			const state = reduceLedger(events);
			const current = state.baseline.brief ?? state.brief;
			if (!current) throw new Error('No baseline draft');
			const lastChange = events.findLast(
				(e) => e.kind === 'standard_change' || e.kind === 'baseline_edited'
			);
			const before =
				state.baseline.brief && lastChange
					? reduceLedger(events.filter((e) => e.seq < lastChange.seq)).baseline.brief
					: (state.briefs.at(-2) ?? null);
			return baselineDiff(before, current);
		},
		baselineEdit: (id: string, criterionId: string, text: string) =>
			queue.enqueue(id, async () => {
				const state = await stateFor(id);
				if (state.terminal || !text?.trim())
					throw new Error('An active team and nonempty criterion text are required');
				const current = state.baseline.brief ?? state.brief;
				const criterion = current?.criteria.find((c) => c.id === criterionId);
				if (!current || !criterion) throw new Error('Unknown criterion');
				if (state.baseline.brief) {
					await applyStandardChange(
						id,
						{
							criterionId,
							change: 'modify',
							criterion: { ...criterion, text, byOwner: true },
							reason: 'Owner edited the criterion',
						},
						'owner',
						randomUUID()
					);
				} else {
					const brief = {
						...current,
						version: current.version + 1,
						criteria: current.criteria.map((c) =>
							c.id === criterionId ? { ...c, text, byOwner: true } : c
						),
					};
					await append(id, {
						kind: 'baseline_edited',
						actor: 'owner',
						criterionId,
						before: criterion.text,
						after: text,
						brief,
					});
				}
				for (const target of state.openCards.filter(
					(c) => c.boundary === 'baseline' || c.boundary === 'acceptance'
				))
					await append(id, {
						kind: 'card_superseded',
						actor: 'app',
						cardId: target.id,
						reason: 'Owner changed the criterion; recheck the current version.',
					});
				const updated = await stateFor(id);
				return {
					brief: updated.baseline.brief ?? updated.brief,
					diff: baselineDiff(current, (updated.baseline.brief ?? updated.brief)!),
				};
			}),
		async baselineReturn(id: string, note: string) {
			const target = (await stateFor(id)).openCards.find((c) => c.boundary === 'baseline');
			if (!target) throw new Error('No baseline confirmation card');
			await answer(id, target.id, 'return', note);
		},
		async log(id: string, seat?: SeatRole) {
			if (seat && !SEAT_ROLES.includes(seat)) throw new Error('Invalid seat');
			const data = await load(id);
			return reduceLedger(data.events)
				.turns.filter((t) => !seat || t.seat === seat)
				.map((t) => ({
					dispatchId: t.dispatchId,
					seat: t.seat,
					turn: t.dispatched?.turn,
					prompt: t.dispatched ? promptFor(t.dispatched, data.events) : undefined,
					reply: t.finished?.message,
					report: t.report,
					error: t.reportError,
				}));
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
					text,
					to: to ?? 'pm',
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
