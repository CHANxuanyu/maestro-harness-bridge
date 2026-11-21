import { checkCommandBoundary, type CheckBoundary } from '../../shared/checkRun';
import { createHash, randomUUID } from 'crypto';
import { DURATION_MS } from '../../shared/duration';
import { isValidAgentId } from '../../shared/agentIds';
import { getAgentDisplayName } from '../../shared/agentMetadata';
import { decideNext, judgeAttempts, NO_PROGRESS_LIMIT } from '../../shared/progressRules';
import {
	isOpenTeamIssue,
	baselineDiff,
	discussionDecider,
	referenceVotes,
	pmMayChange,
	repeatedSeatFault,
	missingOutputLocations,
	teamReadyForDemo,
	teamTurnPermission,
	teamModelUnavailable,
	teamRecoveryDecision,
	sameTeamModel,
	teamChallengeRound,
	teamWaitRejection,
} from '../../shared/team/policy';
import { reduceLedger, teamEventForTransport } from '../../shared/team/ledger';
import { buildTeamTurnPrompt } from '../../shared/team/prompts';
import {
	extractTeamReport,
	validateTeamReport,
	reportRepairPrompt,
	teamReplyMessage,
	type TeamReportResult,
} from '../../shared/team/report';
import { teamStatus } from '../../shared/team/status';
import {
	SEAT_ROLES,
	type CreateTeamInput,
	type Criterion,
	type LedgerEvent,
	type M1TurnKind,
	type ReportTurnKind,
	type TeamDiscussion,
	type StandardChangeRequest,
	type OutputCapture,
	type DiscussionAction,
	type OwnerCard,
	type SeatRole,
	type SeatModel,
	type TeamAuthorizations,
	type TeamConfig,
	type TeamEvent,
	type TeamState,
	type TeamSeatTranscript,
	type QueuedTeamMessage,
} from '../../shared/team/types';
import type { FollowUpFire } from '../../shared/followUp';
import type { createCheckRunner } from '../check-runner';
import type { createFollowUpStore } from '../follow-ups';
import { FOLLOW_UP_WAIT_MS } from '../follow-ups';
import { createKeyedWriteQueue } from '../utils/atomic-json-store';
import type { createTeamStore } from './team-store';
import type { SeatTurnRequest, SeatTurnResult } from './turn-dispatcher';
import type { TeamWorkspaces } from './workspaces';
import { tokenExhaustionResetAt } from '../../shared/retryClassification';
import type { TeamQuotaSample } from './quota';
import { reportEvents, type TeamEventInput } from './report-events';

export const TEAM_FAILURE_COOLDOWN_MS = 30 * DURATION_MS.second;
/** PRD 6.8.1: after a normal 20 minute wait, keep following and look again every 10 minutes. */
export const TEAM_WAIT_RECHECK_MS = 10 * DURATION_MS.minute;
export const TEAM_STALL_MS = 10 * DURATION_MS.minute;
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
		beforeOutputId?: string,
		qaCwd?: string
	): Promise<OutputCapture>;
	/** Host-resolved launch configuration; never supplied by a seat report. */
	seatOptions?(
		config: TeamConfig,
		seat: SeatRole,
		model?: SeatModel
	): Pick<SeatTurnRequest, 'customEnv' | 'customPath' | 'customArgs'>;
	seatAccountDir?(config: TeamConfig, seat: SeatRole, model?: SeatModel): string | undefined;
	quota?(config: TeamConfig, source: SeatRole, model: SeatModel): TeamQuotaSample | undefined;
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
	const load = async (id: string) => {
		const data = await deps.store.loadTeam(id);
		return { ...data, config: reduceLedger(data.events).config ?? data.config };
	};
	const append = async (id: string, input: TeamEventInput) => {
		const eventId = input.id ?? randomUUID();
		const prior = (await load(id)).events.find((event) => event.id === eventId);
		return prior ?? deps.store.append(id, { ...input, id: eventId, at: input.at ?? now() });
	};
	const stateFor = async (id: string) => reduceLedger((await load(id)).events);
	const recoveryAt = (events: LedgerEvent[], seat: SeatRole) =>
		events.findLast(
			(event) =>
				event.kind === 'card_answered' ||
				(event.kind === 'member_recovered' && event.seat === seat) ||
				(event.kind === 'seat_bound' &&
					event.seat === seat &&
					!event.nativeSessionId &&
					['restored', 'temporary', 'substitute'].includes(event.reason ?? '')) ||
				(event.kind === 'model_recovered' &&
					events.some(
						(e) =>
							e.kind === 'quota_exhausted' && e.id === event.unavailabilityId && e.seat === seat
					))
		)?.seq ?? 0;
	const authorized = (state: TeamState, action: keyof TeamAuthorizations) =>
		state.config!.authorizations[action] ||
		state.cardAnswers.some(
			(answer) => answer.cardId === `permission:${action}` && answer.optionId === 'allow'
		);
	const ws = (state: TeamState) => deps.workspaces(state.config!, authorized(state, 'push'));
	const card = async (id: string, value: OwnerCard) => {
		const state = await stateFor(id);
		return append(id, {
			kind: 'decision_card',
			actor: 'app',
			id: `card:${value.id}`,
			card: {
				budgetNote: `${state.usage.turns}/${state.config!.turnBudget} turns; deadline ${state.config!.deadline ? new Date(state.config!.deadline).toISOString() : 'not set'}`,
				...value,
			},
		});
	};
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
				payload: { type: 'permission', action, detail, branch: `team/${id}`, touchesMain: false },
				body: `${detail} This action is outside the team's current ${action} authorization. Keeping the work locally preserves the result but does not complete this action. Recommend authorizing this action class if the target and cost are intended. Dependent work waits for this decision.`,
				options: [
					{
						id: 'allow',
						label: `Allow ${action} for this team`,
						cost: 'The app performs this class of action in task workspaces.',
						recommended: true,
					},
					{
						id: 'decline',
						label: 'Decline this action',
						cost: 'Keep the task branch and ledger; this action will not run.',
					},
				],
			});
		return false;
	};
	const registerWait = async (
		id: string,
		wait: Omit<TeamEvent<'follow_up_registered'>, 'seq' | 'id' | 'actor' | 'kind'>
	) => {
		const rejection =
			!wait.unavailabilityId && !wait.faultId && teamWaitRejection(wait, await stateFor(id));
		if (rejection) {
			await cancelAppWait(id, wait.followUpId, wait.waitFor, rejection);
			return false;
		}
		if (!(await deps.followUps.list()).some((f) => f.id === wait.followUpId)) {
			const registration = {
				id: wait.followUpId,
				target: { kind: 'team' as const, teamId: id, seat: wait.seat },
				reason: wait.reason,
				condition: wait.condition ?? { kind: 'time' as const, at: wait.untilMs! },
				deadline: Number.MAX_SAFE_INTEGER,
				waitLimitMs: Math.max(1, wait.untilMs! - wait.at),
			};
			try {
				await deps.followUps.register(registration);
			} catch (error) {
				if (!wait.condition) throw error;
				// An unobservable claimed process is not a registered external wait.
				// Keep a bounded timer to ask for actual status, with the limitation explicit.
				wait = {
					...wait,
					condition: undefined,
					reason: `${wait.reason}. Cannot observe external status: ${String(error)}`,
				};
				await deps.followUps.register({
					...registration,
					reason: wait.reason,
					condition: { kind: 'time', at: wait.untilMs! },
				});
			}
		}
		await append(id, {
			kind: 'follow_up_registered',
			actor: 'app',
			...wait,
			id: `${wait.followUpId}:registered`,
		});
		return true;
	};
	const cancelAppWait = async (id: string, followUpId: string, target: string, reason: string) => {
		await deps.followUps.cancel(followUpId);
		await append(id, {
			kind: 'wait_canceled',
			actor: 'app',
			followUpId,
			reason,
			id: `${followUpId}:canceled`,
		});
		await append(id, {
			kind: 'app_observation',
			actor: 'app',
			category: 'app-owned-wait',
			key: followUpId,
			detail: `Refused wait for ${target}: ${reason}`,
			id: `${followUpId}:observation`,
		});
	};
	const noteUnavailable = async (
		id: string,
		state: TeamState,
		seat: SeatRole,
		detail: string,
		resetsAt?: number,
		login = false,
		key?: string
	) => {
		const health = state.seats[seat];
		const model = health.model ?? state.config!.seats[seat];
		const configSource = health.binding?.configSource ?? seat;
		if (teamModelUnavailable(state, model, configSource)) return;
		await append(id, {
			kind: 'quota_exhausted',
			actor: 'app',
			seat,
			model,
			configSource,
			detail,
			resetsAt,
			login,
			id: key ?? `unavailable:${seat}:${randomUUID()}`,
		});
	};
	const seatAvailable = async (id: string, state: TeamState, seat: SeatRole) => {
		const health = state.seats[seat];
		if (state.openCards.some((c) => c.seat === seat && c.boundary !== 'login')) return false;
		const model = health.model ?? state.config!.seats[seat];
		const source = health.binding?.configSource ?? seat;
		if (teamModelUnavailable(state, model, source)) return false;
		const sample = deps.quota?.(state.config!, source, model);
		if (sample?.exhausted) {
			const events = (await load(id)).events;
			const recovered = events.some((event) => {
				if (event.kind !== 'model_recovered' || event.at < sample.sampledAt) return false;
				const entry = events.find(
					(e): e is TeamEvent<'quota_exhausted'> =>
						e.kind === 'quota_exhausted' && e.id === event.unavailabilityId
				);
				return entry && teamModelUnavailable({ ...state, unavailable: [entry] }, model, source);
			});
			// A cached exhausted sample cannot undo a later reset or confirmed login.
			if (recovered || (!sample.login && sample.resetsAt !== undefined && now() >= sample.resetsAt))
				return true;
			await noteUnavailable(
				id,
				state,
				seat,
				sample.detail ?? 'Quota sample unavailable',
				sample.resetsAt,
				sample.login
			);
			return false;
		}
		return true;
	};
	const recoverAvailability = async (id: string, data: RecordData) => {
		let state = reduceLedger(data.events);
		// Reconstruct availability from the durable finish even after a crash before the fault append.
		for (const turn of state.turns) {
			if (
				!turn.finished ||
				!['model-unavailable', 'login-expired'].includes(turn.finished.failureKind ?? '')
			)
				continue;
			if (data.events.some((e) => e.id === `${turn.dispatchId}:unavailable`)) continue;
			const model = turn.dispatched?.binding?.model ?? state.config!.seats[turn.seat];
			await append(id, {
				kind: 'quota_exhausted',
				actor: 'app',
				seat: turn.seat,
				model,
				configSource: turn.dispatched?.binding?.configSource ?? turn.seat,
				detail: turn.finished.reportError,
				resetsAt: turn.finished.resetsAt,
				login: turn.finished.failureKind === 'login-expired',
				id: `${turn.dispatchId}:unavailable`,
			});
		}
		data = await load(id);
		state = reduceLedger(data.events);
		for (const entry of state.unavailable) {
			const source = entry.configSource ?? entry.seat;
			const model = entry.model ?? state.config!.seats[entry.seat];
			const sample = deps.quota?.(state.config!, source, model);
			// A model that keeps failing this seat is not brought back by a quota reset.
			const restored =
				entry.cause !== 'repeated-fault' &&
				((!entry.login && entry.resetsAt !== undefined && now() >= entry.resetsAt) ||
					(sample && sample.sampledAt > entry.at && !sample.exhausted));
			if (restored) {
				await append(id, {
					kind: 'model_recovered',
					actor: 'app',
					unavailabilityId: entry.id,
					id: `${entry.id}:available`,
				});
				for (const wait of state.followUps.filter((f) => f.unavailabilityId === entry.id)) {
					await deps.followUps.cancel(wait.followUpId);
					await append(id, {
						kind: 'follow_up_fired',
						actor: 'app',
						followUpId: wait.followUpId,
						result: 'Model reset or fresh quota sample confirms recovery',
						id: `${wait.followUpId}:fired`,
					});
				}
				for (const target of state.openCards.filter(
					(c) => c.id === `availability:${entry.id}` || c.id === `login:${entry.id}`
				))
					await append(id, {
						kind: 'card_superseded',
						actor: 'app',
						cardId: target.id,
						reason: 'The original model recovered',
					});
			} else if (!state.followUps.some((f) => f.unavailabilityId === entry.id)) {
				const poll = data.events.filter(
					(e) => e.kind === 'follow_up_registered' && e.unavailabilityId === entry.id
				).length;
				const at = now();
				await registerWait(id, {
					at,
					followUpId: `quota:${entry.id}:${poll}`,
					seat: entry.seat,
					reason: entry.detail ?? 'Waiting for model recovery',
					waitFor:
						'Quota reset or a new account status sample; unchanged observations are normal waiting',
					untilMs: Math.min(
						entry.resetsAt ?? Infinity,
						at + (poll ? TEAM_WAIT_RECHECK_MS : FOLLOW_UP_WAIT_MS)
					),
					poll,
					unavailabilityId: entry.id,
				});
			}
			if (entry.login && !restored) {
				const accountDir = deps.seatAccountDir?.(state.config!, source, model);
				await card(id, {
					id: `login:${entry.id}`,
					seat: entry.seat,
					boundary: 'login',
					title: `Restore ${getAgentDisplayName(model.tool)} login`,
					body: `${getAgentDisplayName(model.tool)} login has expired for ${accountDir ?? `the account configured for ${source}`}. Only the owner can restore this account.`,
					payload: {
						type: 'escalation',
						cause: 'login',
						stuck: entry.detail,
						accountSeat: source,
						provider: model.tool,
						accountDir,
						paths: [
							'The expired credential cannot authenticate. Retrying the same login cannot repair it.',
							'Authorized substitutes are evaluated separately; other seats continue.',
						],
						recommendation:
							'Sign in to the account configured for this seat, then confirm that login is restored.',
					},
					options: [
						{
							id: 'login',
							label: `I restored the ${getAgentDisplayName(model.tool)} login`,
							cost: 'Owner completes provider login.',
							recommended: true,
						},
						{
							id: 'stop',
							label: 'Stop and preserve work',
							cost: 'Unfinished criteria remain unmet.',
						},
					],
				});
			}
		}
		state = await stateFor(id);
		for (const seat of SEAT_ROLES) {
			const health = state.seats[seat];
			if (!health.binding || health.activeDispatchIds.length) continue;
			const original = state.config!.seats[seat];
			const source = health.binding.configSource ?? seat;
			if (health.takeover && !teamModelUnavailable(state, original, seat)) {
				await append(id, {
					kind: 'seat_bound',
					actor: 'app',
					seat,
					model: original,
					workspace: health.binding.workspace,
					configSource: seat,
					reason: 'restored',
				});
				await append(id, {
					kind: 'member_recovered',
					actor: 'app',
					seat,
					how: 'Original model recovered; switched back in a separate conversation',
				});
				return;
			}
			if (!teamModelUnavailable(state, health.model!, source)) {
				if (
					health.faultActive &&
					['model-unavailable', 'login-expired'].includes(health.lastFault?.fault ?? '')
				)
					await append(id, {
						kind: 'member_recovered',
						actor: 'app',
						seat,
						how: 'The reset condition changed; resume the suspended assignment',
					});
				continue;
			}
			const waitOnly = data.events.findLast(
				(e): e is TeamEvent<'seat_configured'> => e.kind === 'seat_configured' && e.seat === seat
			)?.wait;
			const recovery = teamRecoveryDecision(
				state,
				seat,
				!waitOnly && authorized(state, 'temporaryTakeover')
			);
			if (
				recovery.decision.kind === 'continue' &&
				recovery.decision.next.key?.startsWith('takeover:') &&
				!waitOnly
			) {
				const choice = recovery.choices[Number(recovery.decision.next.key.split(':')[1])];
				const sample = deps.quota?.(state.config!, choice.source, choice.model);
				if (sample?.exhausted) {
					await append(id, {
						kind: 'quota_exhausted',
						actor: 'app',
						seat,
						model: choice.model,
						configSource: choice.source,
						resetsAt: sample.resetsAt,
						detail: sample.detail,
						login: sample.login,
					});
					return;
				}
				await append(id, {
					kind: 'seat_bound',
					actor: 'app',
					seat,
					model: choice.model,
					configSource: choice.source,
					workspace: health.binding.workspace,
					reason: choice.temporary ? 'temporary' : 'substitute',
				});
				await append(id, {
					kind: 'substitute_took_over',
					actor: 'app',
					seat,
					model: choice.model,
					temporary: choice.temporary,
				});
				await append(id, {
					kind: 'member_recovered',
					actor: 'app',
					seat,
					how: 'Authorized takeover in a NEW conversation; use the ledger slice and inspect the existing workspace',
				});
				return;
			}
			if (recovery.decision.kind === 'escalate') {
				const entry = state.unavailable.findLast((e) => e.seat === seat)!;
				if (entry.login) continue;
				const extensionHours = Math.max(
					1,
					((entry.resetsAt ?? now()) + DURATION_MS.hour - (state.config!.deadline ?? now())) /
						DURATION_MS.hour
				);
				await card(id, {
					id: `availability:${entry.id}`,
					seat,
					boundary: recovery.decision.boundaries[0],
					boundaries: recovery.decision.boundaries,
					title:
						entry.cause === 'repeated-fault'
							? `${seat} keeps failing on its model`
							: `${seat} recovery would cross the deadline`,
					body:
						entry.cause === 'repeated-fault'
							? 'The same fault recurred after fresh conversations without progress; another attempt would repeat it.'
							: 'The original model is unavailable and waiting for recovery would cross the deadline.',
					payload: {
						type: 'escalation',
						cause: 'availability',
						stuck: entry.detail,
						paths: [
							entry.cause === 'repeated-fault'
								? 'Fresh conversations of this model failed the same way; a further retry would repeat it.'
								: 'The original model is unavailable; another call would repeat the refusal.',
							'No available authorized substitute remains.',
							authorized(state, 'temporaryTakeover')
								? 'Existing team models are also unavailable; waiting for reset needs more time.'
								: 'Temporary takeover needs permission; waiting for reset needs more time.',
						],
						recommendation:
							recovery.decision.options.find((option) => option.recommended)?.plan ??
							recovery.decision.options[0].plan,
						waiting: 'Independent work continues; the deadline is unchanged.',
					},
					extension: { hours: extensionHours },
					options: recovery.decision.options.map((c) => ({
						id: c.key!,
						label: c.plan,
						boundary: c.boundary,
						cost: c.cost,
						recommended: c.recommended,
					})),
				});
			}
		}
	};
	const transition = async (id: string, state: TeamState, to: TeamState['phase']) => {
		if (state.phase !== to)
			await append(id, { kind: 'phase_changed', actor: 'app', from: state.phase, to });
	};
	// All model calls share this boundary, including repair, recovery, takeover and
	// wrap-up. An initial launch uses its already reserved slot; restart may only
	// reconcile receipts at the limit, never invoke another process.
	const dispatchAllowed = (state: TeamState, reservedDispatchId?: string) => {
		const reserved =
			reservedDispatchId &&
			state.turns.some((t) => t.dispatchId === reservedDispatchId && t.dispatched && !t.finished);
		return (
			!state.paused &&
			!state.terminal &&
			!!state.config &&
			(state.config.deadline === undefined || now() < state.config.deadline) &&
			state.usage.turns - (reserved ? 1 : 0) < state.config.turnBudget
		);
	};
	const snapshot = (events: LedgerEvent[], dispatch: Dispatch) =>
		reduceLedger(events.filter((e) => e.seq <= (dispatch.sourceSeq ?? dispatch.seq - 1)));
	const validateReport = async (
		raw: unknown,
		dispatch: Dispatch,
		events: LedgerEvent[]
	): Promise<TeamReportResult> => {
		const original = dispatch.repairOf
			? events.find(
					(e): e is Dispatch => e.kind === 'turn_dispatched' && e.dispatchId === dispatch.repairOf
				)!
			: dispatch;
		const state = snapshot(events, original);
		const paths = new Map<string, string>();
		if (
			raw &&
			typeof raw === 'object' &&
			'type' in raw &&
			raw.type === 'qa_prep' &&
			dispatch.seat === 'qa' &&
			'tests' in raw &&
			Array.isArray(raw.tests) &&
			raw.tests.every((value) => typeof value === 'string')
		) {
			try {
				const workspace = ws(state);
				await workspace.initialize();
				for (const value of raw.tests) paths.set(value, await workspace.resolveQaTestPath(value));
			} catch (error) {
				return { ok: false, reason: error instanceof Error ? error.message : String(error) };
			}
		}
		return validateTeamReport(
			raw,
			dispatch.expectedTurn ?? dispatch.turn,
			dispatch.seat,
			state,
			paths
		);
	};
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
				original?.repairTail ?? original?.message ?? '',
				snapshot(
					events,
					events.find(
						(e): e is Dispatch => e.kind === 'turn_dispatched' && e.dispatchId === dispatch.repairOf
					)!
				),
				dispatch.discussionId,
				dispatch.seat
			);
		} else
			prompt = buildTeamTurnPrompt(
				expected as ReportTurnKind,
				dispatch.seat,
				state,
				dispatch.discussionId
			);
		if (dispatch.mode === 'diagnose' || dispatch.mode === 'gather') {
			const problem = state.problems[dispatch.problemId ?? 'checks'];
			prompt += `\n\n${dispatch.mode === 'diagnose' ? 'Diagnosis required: explain why the previous attempts failed, the new basis, difference and expected observation.' : 'Gather new evidence. Do not repeat the previously tried change.'}\nAttempt record: ${JSON.stringify(problem ? { ...problem, progress: { ...problem.progress, attempts: problem.progress.attempts.slice(-NO_PROGRESS_LIMIT) } } : null)}`;
		}
		return `${prompt}\n\n${dispatch.note ?? ''}\n[team-dispatch:${dispatch.dispatchId}]`;
	};
	const recordedPrompt = async (id: string, dispatch: Dispatch, events: LedgerEvent[]) => {
		// Inline prompts predate sidecars. The oldest ledgers can only reconstruct a snapshot.
		if (!dispatch.promptRef) return promptFor(dispatch, events);
		if (dispatch.promptRef !== `prompts/${dispatch.dispatchId}.txt`)
			throw new Error(`Invalid prompt reference for dispatch ${dispatch.dispatchId}`);
		const prompt = await deps.store
			.readPrompt(id, dispatch.dispatchId)
			.catch((error: NodeJS.ErrnoException) => {
				if (error.code === 'ENOENT')
					throw new Error(
						`Missing prompt sidecar ${dispatch.promptRef} for dispatch ${dispatch.dispatchId}`,
						{ cause: error }
					);
				throw error;
			});
		if (createHash('sha256').update(prompt).digest('hex') !== dispatch.promptDigest)
			throw new Error(`Prompt digest mismatch for dispatch ${dispatch.dispatchId}`);
		return prompt;
	};
	const requestFor = (
		config: TeamConfig,
		events: LedgerEvent[],
		dispatch: Dispatch
	): SeatTurnRequest => {
		const state = reduceLedger(events);
		const binding = dispatch.binding ?? state.seats[dispatch.seat].binding;
		if (!binding) throw new Error(`Unbound team seat: ${dispatch.seat}`);
		return {
			...binding.model,
			...deps.seatOptions?.(config, binding.configSource ?? dispatch.seat, binding.model),
			teamId: config.id,
			dispatchId: dispatch.dispatchId,
			seat: dispatch.seat,
			turn: dispatch.turn,
			cwd: binding.workspace,
			nativeSessionId: ['position', 'proposal', 'response', 'retro', 'recovery'].includes(
				dispatch.expectedTurn ?? dispatch.turn
			)
				? undefined
				: binding.nativeSessionId,
			permissionMode: teamTurnPermission(dispatch.seat, dispatch.turn),
			// Native receipt matching uses identity and the dispatch marker, never audit text.
			prompt: '',
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
					reason: binding.reason,
					configSource: binding.configSource,
				});
		});
	const ingest = async (id: string, dispatch: Dispatch, finished: TeamEvent<'turn_finished'>) => {
		if (!finished.report) return;
		const data = await load(id);
		if (data.events.some((e) => e.id === `${dispatch.dispatchId}:accepted`)) return;
		if (dispatch.recoveryFor && finished.report.type === 'recovery') {
			const failedTurn = reduceLedger(data.events).turns.find(
				(t) => t.dispatchId === dispatch.recoveryFor
			);
			const failed =
				failedTurn?.dispatched && failedTurn.finished
					? { dispatch: failedTurn.dispatched, finished: failedTurn.finished }
					: undefined;
			if (failed) {
				const extracted = extractTeamReport(
					'```team-report\n' + (finished.report.recoveredJson ?? '') + '\n```'
				);
				const recovered = extracted.ok
					? await validateReport(extracted.report, failed.dispatch, data.events)
					: extracted;
				if (recovered.ok) {
					await ingest(id, failed.dispatch, {
						...failed.finished,
						report: recovered.report,
						normalizations: recovered.normalizations,
					});
					await append(id, {
						kind: 'report_repaired',
						actor: 'pm',
						seat: failed.dispatch.seat,
						dispatchId: failed.dispatch.dispatchId,
						id: `${dispatch.dispatchId}:organized`,
					});
				} else
					await openDiscussion(
						id,
						`missing:${failed.dispatch.dispatchId}`,
						`${finished.report.summary} Missing report facts still need evidence; do not repeat completed actions.`,
						'no-progress'
					);
			}
		}
		const original = dispatch.repairOf
			? data.events.find(
					(e): e is Dispatch => e.kind === 'turn_dispatched' && e.dispatchId === dispatch.repairOf
				)!
			: dispatch;
		const before = reduceLedger(data.events);
		if (finished.normalizations?.length)
			await append(id, {
				kind: 'report_normalized',
				actor: 'app',
				seat: original.seat,
				dispatchId: original.dispatchId,
				changes: finished.normalizations,
				id: `${dispatch.dispatchId}:normalized`,
			});
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
		const after = await stateFor(id);
		const facts = (state: TeamState) =>
			JSON.stringify({
				brief: state.brief,
				criteria: state.criteria.map((c) => [c.id, c.text, c.status, c.reason]),
				work: state.workItems.map((w) => [w.itemId, w.state]),
				issues: state.issues.map((i) => [i.id, i.state]),
				discussions: state.discussions.map((d) => [
					d.id,
					d.positions.length,
					d.proposals.length,
					d.responses.length,
					d.decision?.decision,
				]),
				messages: state.messages.map((m) => [
					m.message.messageId,
					m.handled?.summary,
					m.forwarded?.summary,
				]),
				challenges: state.challenges.length,
				responses: state.briefResponses.length,
				reviews: state.reviews.length,
				demos: state.demos.length,
				retros: state.retros.length,
			});
		const wait = data.events.find(
			(e): e is TeamEvent<'follow_up_registered'> =>
				e.kind === 'follow_up_registered' && e.followUpId === dispatch.followUpId
		);
		// A PM poll that merely repeats waiting is idle, not a failed product
		// attempt. Dev/QA monitoring an actual external operation remains normal.
		const normalWait =
			(finished.report.type === 'wait' &&
				!!wait &&
				!teamWaitRejection(wait, before) &&
				(dispatch.seat !== 'pm' || finished.report.status !== 'waiting')) ||
			(finished.report.type === 'work' &&
				!!finished.report.waiting &&
				!teamWaitRejection(finished.report.waiting, before));
		const outputClaim =
			(finished.report.type === 'qa_prep' && finished.report.tests.length > 0) ||
			(finished.report.type === 'work' && finished.report.claimsComplete) ||
			(finished.report.type === 'verify' &&
				(finished.report.criteria.length > 0 || !before.criteria.some((c) => c.proof === 'qa')));
		const changed =
			normalWait ||
			outputClaim ||
			finished.report.type === 'wrap_up' ||
			finished.report.type === 'recovery' ||
			!!finished.report.requestedActions?.length ||
			facts(before) !== facts(after);
		const previous = data.events.findLast(
			(e): e is TeamEvent<'turn_progress'> => e.kind === 'turn_progress' && e.seat === dispatch.seat
		);
		const idleCount = changed ? 0 : (previous?.idleCount ?? 0) + 1;
		await append(id, {
			kind: 'turn_progress',
			actor: 'app',
			dispatchId: original.dispatchId,
			seat: dispatch.seat,
			changed,
			idleCount,
			id: `${dispatch.dispatchId}:progress`,
		});
		if (!changed)
			await append(id, {
				kind: 'member_fault',
				actor: 'app',
				seat: dispatch.seat,
				fault: 'idle-turn',
				detail:
					'Valid report produced no new ledger facts. Name missing evidence or complete an assigned item.',
				id: `${dispatch.dispatchId}:idle`,
			});
		if (dispatch.repairOf)
			await append(id, {
				kind: 'report_repaired',
				actor: 'app',
				seat: dispatch.seat,
				dispatchId: original.dispatchId,
				id: `${dispatch.dispatchId}:repaired`,
			});
		if (changed && reduceLedger(data.events).seats[dispatch.seat].faultActive)
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
				reason: binding.reason,
				configSource: binding.configSource,
				id: `${dispatch.dispatchId}:binding`,
			});
		}
		const extracted = extractTeamReport(result.text);
		let parsed = extracted.ok
			? await validateReport(extracted.report, dispatch, data.events)
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
			normalizations: good && parsed.ok ? parsed.normalizations : undefined,
			reportError: good
				? undefined
				: (result.failure?.detail ?? (parsed.ok ? 'Turn did not complete' : parsed.reason)),
			repairTail: good ? undefined : result.text.slice(-3500),
			canceled: result.canceled,
			failureKind,
			resetsAt:
				result.failure?.resetsAt ??
				(failureKind === 'model-unavailable'
					? tokenExhaustionResetAt(
							{
								type: 'rate_limited',
								recoverable: true,
								message: result.failure?.detail ?? result.text,
							},
							now(),
							Intl.DateTimeFormat().resolvedOptions().timeZone
						)
					: undefined),
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
				fault:
					failureKind ??
					(!extracted.ok && extracted.reason.startsWith('Missing ')
						? 'missing-report'
						: 'bad-report'),
				detail: finished.reportError,
				id: `${dispatch.dispatchId}:fault`,
			});
			const repeated = repeatedSeatFault((await load(id)).events, dispatch.seat);
			const binding = (await stateFor(id)).seats[dispatch.seat].binding;
			if (repeated && binding)
				await append(id, {
					kind: 'quota_exhausted',
					actor: 'app',
					seat: dispatch.seat,
					model: binding.model,
					configSource: binding.configSource ?? dispatch.seat,
					cause: 'repeated-fault',
					detail: `The same ${repeated.fault} recurred without progress: ${repeated.detail ?? 'no detail'}`,
					id: `${dispatch.dispatchId}:repeated-fault`,
				});
		}
	};
	const launch = (data: RecordData, dispatch: Dispatch, recover = false) => {
		if (live.has(dispatch.dispatchId)) return;
		const controller = new AbortController();
		live.set(dispatch.dispatchId, { teamId: data.config.id, controller });
		const request = requestFor(data.config, data.events, dispatch);
		void (async () => {
			const previous = dispatch.retryOf
				? data.events.find(
						(e): e is Dispatch => e.kind === 'turn_dispatched' && e.dispatchId === dispatch.retryOf
					)
				: undefined;
			if (
				recover ||
				dispatch.resumedFrom ||
				(dispatch.binding?.reason &&
					dispatch.binding.reason !== 'initial' &&
					!dispatch.binding.nativeSessionId) ||
				dispatch.recoveryFor ||
				previous ||
				dispatch.repairOf ||
				data.events.some(
					(e) =>
						e.kind === 'substitute_took_over' &&
						e.seat === dispatch.seat &&
						e.seq > (dispatch.sourceSeq ?? 0) - 5
				)
			) {
				const workspace = ws(reduceLedger(data.events));
				await workspace.initialize();
				const failedSeat = dispatch.recoveryFor
					? data.events.find(
							(e): e is Dispatch =>
								e.kind === 'turn_dispatched' && e.dispatchId === dispatch.recoveryFor
						)?.seat
					: dispatch.seat;
				const inspection = await workspace.inspect(failedSeat === 'qa' ? 'qa' : 'dev');
				await queue.enqueue(data.config.id, () =>
					append(data.config.id, {
						kind: 'workspace_inspected',
						actor: 'app',
						dispatchId: dispatch.dispatchId,
						reason: recover ? 'restart' : 'recovery',
						...inspection,
						// A retry can already have an inspection receipt when the app crashes.
						id: `${dispatch.dispatchId}:${recover ? 'restart-inspection' : 'inspection'}`,
					})
				);
				request.prompt += `\nWorkspace inspection (preserve completed external effects): ${JSON.stringify(inspection)}`;
			}
			let result =
				recover || previous
					? await deps.reconcile(
							previous ? requestFor(data.config, data.events, previous) : request
						)
					: null;
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
							how: 'Restart: checked native history and workspace for the incomplete dispatch.',
							id: `${dispatch.dispatchId}:restart`,
						})
					);
				}
				const current = await stateFor(data.config.id);
				if (!dispatchAllowed(current, recover ? undefined : dispatch.dispatchId)) {
					// A pause leaves the reservation available for resume after owner input.
					if (current.paused && !current.terminal) return;
					await queue.enqueue(data.config.id, () =>
						append(data.config.id, {
							kind: 'turn_finished',
							actor: 'app',
							seat: dispatch.seat,
							dispatchId: dispatch.dispatchId,
							canceled: true,
							exitCode: null,
							durationMs: 0,
							message:
								'Dispatch stopped at the budget or terminal boundary after receipt reconciliation.',
							id: `${dispatch.dispatchId}:finished`,
						})
					);
					return;
				}
				request.prompt =
					(await recordedPrompt(data.config.id, dispatch, data.events)) + request.prompt;
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
				| 'recoveryFor'
				| 'repairOf'
				| 'retryOf'
				| 'resumedFrom'
				| 'mode'
				| 'problemId'
				| 'fingerprint'
				| 'failures'
				| 'note'
				| 'discussionId'
				| 'round'
				| 'messageIds'
				| 'followUpId'
			>
		> = {}
	) => {
		if (
			!dispatchAllowed(state) ||
			SEAT_ROLES.reduce((count, role) => count + state.seats[role].activeDispatchIds.length, 0) >=
				2 ||
			state.seats[seat].activeDispatchIds.length
		)
			return;
		if (!(await seatAvailable(id, state, seat))) return;
		if (
			!options.discussionId &&
			!options.problemId &&
			turn !== 'message' &&
			state.followUps.some(
				(f) =>
					f.seat === seat && !f.followUpId.startsWith('job:') && !f.unavailabilityId && !f.faultId
			)
		)
			return;
		const recentFailure = state.turns.findLast(
			(t) => t.seat === seat && t.finished && !t.report && !t.finished.canceled
		);
		if (
			!options.repairOf &&
			recentFailure?.finished &&
			now() - recentFailure.finished.at < TEAM_FAILURE_COOLDOWN_MS &&
			!((state.seats[seat].binding?.seq ?? 0) > recentFailure.finished.seq) &&
			recoveryAt((await load(id)).events, seat) < recentFailure.finished.seq
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
				(!options.resumedFrom &&
					state.turns.some(
						(attempt) =>
							attempt.dispatched?.retryOf === recoveryOf ||
							attempt.dispatched?.repairOf === recoveryOf
					))
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
			const stallDiagnosis =
				turn === 'message' &&
				options.mode === 'diagnose' &&
				data.events.some(
					(e) =>
						e.kind === 'app_observation' && e.category === 'stall' && e.key === options.problemId
				) &&
				!state.turns.some((t) => t.dispatched?.problemId === options.problemId);
			if (
				!stallDiagnosis &&
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
			if (!changedBasis && !stallDiagnosis) return;
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
			binding: reduceLedger(data.events).seats[seat].binding,
			...options,
		};
		const prompt = promptFor(input, data.events);
		input.promptDigest = createHash('sha256').update(prompt).digest('hex');
		input.promptRef = await deps.store.writePrompt(id, dispatchId, prompt);
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
				body: `Run ${command} once. Only this invocation is authorized; the team workspace grant is unchanged.`,
				payload: { type: 'check-permission', command, boundary },
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
			const result = await deps.checks.run({
				command: check.command,
				expectedExitCode: check.expectExit,
				cwd,
				signal,
			});
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
					expectedExitCode: check.expectExit ?? 0,
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
			.every((e) => e.exitCode === (e.expectedExitCode ?? 0) && !e.timedOut && !e.notRun);
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
				.filter((c) => c.exitCode !== (c.expectedExitCode ?? 0) || c.timedOut || c.notRun)
				.map((c) =>
					JSON.stringify([c.command, c.exitCode, c.timedOut, c.notRun, c.outputTail.trim()])
				),
			...state.issues
				.filter((i) => isOpenTeamIssue(i))
				.map((i) => `issue:${i.id}:${i.opened.actual ?? i.opened.title}`),
		].sort();
	};
	const captureOutput = async (state: TeamState, revision: string): Promise<OutputCapture> => {
		try {
			return await deps.captureOutput(
				state.seats.dev.binding!.workspace,
				revision,
				state.criteria,
				state.outputs.at(-1)?.outputId,
				state.seats.qa.binding?.workspace
			);
		} catch (error) {
			deps.onError(error);
			return {
				files: [],
				previews: [],
				error: error instanceof Error ? error.message : String(error),
			};
		}
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
			const output = await captureOutput(state, submitted.revision);
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
		if (
			state.followUps.some(
				(wait) => wait.seat === 'dev' && !wait.faultId && !wait.followUpId.startsWith('job:')
			)
		)
			return;
		// A repair's accepted report is attached to its original turn, but its receipt is valid.
		const lastDevFailure = state.turns.findLast(
			(t) =>
				t.seat === 'dev' && t.finished && !t.report && !t.finished.report && !t.finished.canceled
		);
		if (lastDevFailure?.finished && now() - lastDevFailure.finished.at < TEAM_FAILURE_COOLDOWN_MS)
			return;
		if (!(await seatAvailable(id, state, 'dev'))) return;
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
					candidates: current.problems[problemId]?.candidates.length
						? current.problems[problemId].candidates
						: [{ plan: 'Address observed failures', basis: failing.join('\n'), fingerprint }],
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
				if (decision.kind === 'escalate') {
					await card(id, {
						id: `problem:${problemId}:${progress.attempts.at(-1)?.id ?? 'first'}`,
						seat: 'dev',
						boundary: decision.boundaries[0],
						boundaries: decision.boundaries,
						title: `A boundary blocks ${problemId}`,
						body: 'The remaining paths for this problem require an owner decision.',
						payload: {
							type: 'escalation',
							cause: 'problem',
							problemId,
							stuck: failing,
							paths: progress.attempts,
							recommendation:
								decision.options.find((o) => o.recommended)?.plan ?? decision.options[0].plan,
							waiting: 'This problem waits; independent work continues.',
						},
						options: [
							...decision.options.slice(0, 3).map((c, index) => ({
								id: c.key ?? `path:${index}`,
								label: c.plan,
								cost: c.cost ?? 'Owner supplies the named authority or resource.',
								boundary: c.boundary,
								recommended: c.recommended ?? index === 0,
							})),
							...(decision.options.length === 1
								? [
										{
											id: 'stop',
											label: 'Stop and preserve work',
											cost: 'Keep the branch and ledger; unfinished work stays unfinished.',
										},
									]
								: []),
						],
					});
					return;
				}
				await dispatch(id, current, 'dev', decision.kind === 'gather' ? 'message' : kind, {
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
				const at = now();
				if (
					!(await load(id)).events.some(
						(e) =>
							e.id === `${itemId}:registered` || e.id === `${itemId}:canceled` || e.id === itemId
					)
				) {
					await registerWait(id, {
						at,
						followUpId: itemId,
						seat: action.seat,
						reason: action.action,
						waitFor: action.waitFor,
						condition: action.condition,
						untilMs: at + FOLLOW_UP_WAIT_MS,
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
		let experimentEvidence: string | undefined;
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
							expectedExitCode: experiment.expectExit,
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
				// Everyone already agreed: the observation is evidence for the decision, not a
				// reason for another round, unless it contradicts the exit code the proposal named.
				const unanimous = responses.every((r) => r.result === 'agree');
				const contradicts =
					experiment.expectExit !== undefined && result.exitCode !== experiment.expectExit;
				if (!unanimous || contradicts) {
					await dispatch(id, state, opened.owner, 'proposal', {
						discussionId: discussion.id,
						round: round + 1,
						note: `Experiment result: ${JSON.stringify(result)}. Decide from this observation; do not repeat the experiment.`,
					});
					return true;
				}
				experimentEvidence = `${proposal.proposal} Experiment \`${experiment.command}\` exited ${result.exitCode ?? 'unavailable'} (evidence ${result.evidenceId}).`;
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
				body: change
					? `${change.reason} The existing standard and check result remain unchanged until you decide.`
					: `${proposal.proposal} This step is irreversible or changes a commitment and needs your decision.`,
				payload: {
					type: 'discussion',
					before: criterion,
					after: change?.criterion,
					currentCheckResult: criterion?.reason,
					failingNow: criterion?.status === 'fail',
					positions: discussion.positions,
					proposal: proposal.proposal,
					responses,
					boundary: 'The next step is irreversible or changes a commitment.',
				},
				budgetNote: `${state.usage.budgetTurns}/${state.config!.turnBudget} turns used`,
				options: change
					? [
							{
								id: 'approve',
								label: 'Approve this standard change',
								cost:
									change.change === 'remove'
										? 'This criterion will no longer block acceptance. Its wording and check results remain in the change history.'
										: 'The proposed wording replaces the existing acceptance standard. Fresh evidence must verify the new standard; the old wording and check results remain in the change history.',
							},
							{
								id: 'keep',
								label: 'Keep the existing standard',
								recommended: true,
								cost:
									criterion?.status === 'fail'
										? 'The existing standard stays in force. The check keeps failing and blocks acceptance until fixed and verified.'
										: 'The existing standard stays in force and must be met for acceptance.',
							},
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
			insist || responses.some((r) => r.requestedResult === 'insist'),
			decider === 'app'
				? `Facts remain determined by recorded evidence. ${state.checks.map((c) => `${c.command}: exit ${c.exitCode ?? 'unavailable'}`).join('; ')}`
				: experimentEvidence
		);
		return true;
	};
	const budgetReport = async (id: string, state: TeamState) => {
		const previous = (await load(id)).events.filter((e) => e.kind === 'budget_extended').length;
		const cardId = previous ? `budget:${previous}` : 'budget';
		await card(id, {
			id: cardId,
			boundary: 'budget',
			title: 'Incomplete progress report',
			body: 'This is a progress report, not a completion demo. The listed criteria still need evidence.',
			payload: {
				type: 'progress-report',
				generatedBy: 'app',
				output: state.outputs.at(-1),
				missing: teamStatus(state, now()).criteria.missing,
				appObservations: teamStatus(state, now()).appObservations,
				work: state.workItems.filter((w) => w.state !== 'checked'),
				issues: state.issues.filter(isOpenTeamIssue),
				tried: Object.fromEntries(
					Object.entries(state.problems).map(([key, p]) => [key, p.progress.attempts])
				),
				faults: SEAT_ROLES.map((seat) => ({ seat, fault: state.seats[seat].lastFault })),
				changes: state.standardChanges,
				contested: state.decisions.filter((d) => d.contested),
				suggestions: state.suggestions,
				evidenceChanges: state.checks.filter((c) => c.dilution?.length),
				recommendation:
					state.wrapUp?.summary ??
					'Extend by 1 hour and 10 turns to address the listed gaps; this is an allowance, not a completion estimate.',
			},
			extension: { hours: 1, turns: 10 },
			options: [
				{
					id: 'extend',
					label: 'Add 1 hour and 10 turns',
					cost: 'Owner increases the overall budget; unmet criteria still need proof.',
					recommended: true,
				},
				{
					id: 'gaps',
					label: 'Accept the listed leftovers',
					cost: 'Unmet items stay unmet and enter the follow-up list with an owner to assign.',
				},
				{
					id: 'stop',
					label: 'Stop and preserve work',
					cost: 'Keep the task branch and ledger; unfinished work stays unfinished.',
				},
			],
		});
	};
	const extendBudget = async (
		id: string,
		extension: { hours?: number; turns?: number },
		cardId?: string
	) => {
		const state = await stateFor(id);
		if (
			state.terminal ||
			((!extension.hours || extension.hours <= 0) && (!extension.turns || extension.turns <= 0)) ||
			(extension.hours !== undefined &&
				(!Number.isFinite(extension.hours) || extension.hours <= 0)) ||
			(extension.turns !== undefined &&
				(!Number.isSafeInteger(extension.turns) || extension.turns <= 0))
		)
			throw new Error('Supply positive hours or integer turns for an active team');
		await append(id, {
			kind: 'budget_extended',
			actor: 'owner',
			...extension,
			cardId,
			turnBudget: state.config!.turnBudget + (extension.turns ?? 0),
			deadline: extension.hours
				? Math.max(now(), state.config!.deadline ?? now()) + extension.hours * DURATION_MS.hour
				: state.config!.deadline,
			...(cardId ? { id: `${cardId}:action` } : {}),
		});
		for (const target of state.openCards.filter(
			(c) => c.boundary === 'budget' || c.boundaries?.includes('budget')
		))
			await append(id, {
				kind: 'card_superseded',
				actor: 'app',
				cardId: target.id,
				reason: 'Owner extended the budget',
			});
	};
	const handleWaits = async (id: string, data: RecordData) => {
		const state = reduceLedger(data.events);
		for (const fired of data.events.filter(
			(e): e is TeamEvent<'follow_up_fired'> => e.kind === 'follow_up_fired'
		)) {
			const wait = data.events.find(
				(e): e is TeamEvent<'follow_up_registered'> =>
					e.kind === 'follow_up_registered' && e.followUpId === fired.followUpId
			);
			if (
				!wait ||
				wait.unavailabilityId ||
				/^(job:|job-retry:)/.test(wait.followUpId) ||
				data.events.some((e) => e.kind === 'wait_handled' && e.followUpId === wait.followUpId) ||
				data.events.some((e) => e.kind === 'wait_canceled' && e.followUpId === wait.followUpId)
			)
				continue;
			if (wait.faultId) {
				const failed = state.turns.find((t) => t.dispatchId === wait.faultId);
				if (!failed?.dispatched || !state.seats[wait.seat].faultActive) {
					await append(id, {
						kind: 'wait_handled',
						actor: 'app',
						followUpId: wait.followUpId,
						id: `${wait.followUpId}:handled`,
					});
					continue;
				}
				const originalId =
					failed.dispatched.repairOf ?? failed.dispatched.retryOf ?? failed.dispatchId;
				const original = state.turns.find((t) => t.dispatchId === originalId)!;
				await startJob(id, `inspect:${wait.followUpId}`, async () => {
					const workspaces = ws(state);
					await workspaces.initialize();
					const inspection = await workspaces.inspect(wait.seat === 'qa' ? 'qa' : 'dev');
					const found = await deps.reconcile(
						requestFor(data.config, data.events, original.dispatched!)
					);
					const extracted =
						found && !found.failure && found.exitCode === 0 ? extractTeamReport(found.text) : null;
					const recovered = extracted?.ok
						? await validateReport(extracted.report, original.dispatched!, data.events)
						: null;
					await queue.enqueue(id, async () => {
						await append(id, {
							kind: 'workspace_inspected',
							actor: 'app',
							dispatchId: originalId,
							...inspection,
							id: `${wait.followUpId}:inspection`,
						});
						const latest = await stateFor(id);
						if (latest.seats[wait.seat].faultActive && !latest.terminal) {
							if (recovered?.ok) {
								await ingest(id, original.dispatched!, {
									...original.finished!,
									report: recovered.report,
									normalizations: recovered.normalizations,
								});
								await append(id, {
									kind: 'member_recovered',
									actor: 'app',
									seat: wait.seat,
									how: 'New native results recovered without redispatching the failed model',
									id: `${wait.followUpId}:recovered`,
								});
							} else {
								const at = now();
								await registerWait(id, {
									at,
									seat: wait.seat,
									faultId: wait.faultId,
									reason: wait.reason,
									waitFor: wait.waitFor,
									followUpId: `${wait.followUpId}:next`,
									untilMs: at + TEAM_WAIT_RECHECK_MS,
									poll: (wait.poll ?? 0) + 1,
								});
							}
						}
						await append(id, {
							kind: 'wait_handled',
							actor: 'app',
							followUpId: wait.followUpId,
							id: `${wait.followUpId}:handled`,
						});
					});
				});
				return true;
			}
			const turn = state.turns.findLast((t) => t.dispatched?.followUpId === wait.followUpId);
			if (!turn) {
				if (
					await dispatch(id, state, wait.seat, 'wait', {
						followUpId: wait.followUpId,
						note: `External status for ${wait.waitFor}: ${fired.result}. This is a normal wait if unchanged, not a failed attempt.`,
					})
				)
					return true;
				continue;
			}
			if (turn.report?.type !== 'wait') continue;
			let externallyCompleted = false;
			try {
				externallyCompleted =
					wait.condition?.kind !== 'time' &&
					!!wait.condition &&
					JSON.parse(fired.result).state === 'completed';
			} catch {
				/* Older receipts may contain plain text. */
			}
			if (turn.report.status === 'waiting' && !externallyCompleted) {
				const at = now();
				await registerWait(id, {
					at,
					followUpId: `${wait.followUpId}:next`,
					seat: wait.seat,
					reason: turn.report.summary,
					waitFor: wait.waitFor,
					condition: wait.condition?.kind === 'time' ? undefined : wait.condition,
					untilMs: at + TEAM_WAIT_RECHECK_MS,
					poll: (wait.poll ?? 0) + 1,
				});
			}
			if (turn.report.status === 'problem')
				await openDiscussion(
					id,
					`wait:${wait.followUpId}:problem`,
					turn.report.summary,
					'no-progress',
					`wait:${wait.followUpId}`
				);
			await append(id, {
				kind: 'wait_handled',
				actor: 'app',
				followUpId: wait.followUpId,
				id: `${wait.followUpId}:handled`,
			});
			return true;
		}
		return false;
	};
	const runActions = async (id: string, data: RecordData) => {
		const state = reduceLedger(data.events);
		for (const request of data.events.filter(
			(e): e is TeamEvent<'action_requested'> => e.kind === 'action_requested'
		)) {
			if (
				data.events.some(
					(e) => e.kind === 'action_receipt' && e.key === request.id && e.outcome !== 'started'
				)
			)
				continue;
			if (request.action !== 'push' && request.action !== 'draftPr') {
				await card(id, {
					id: `external:${request.id}`,
					boundary: 'permission',
					title: `Owner decision required: ${request.action}`,
					body: 'This external action is reserved for the owner.',
					payload: {
						type: 'escalation',
						cause: 'external',
						stuck: request.detail,
						paths: ['The team grant covers task-branch pushes and draft PRs only.'],
						recommendation:
							'Keep the task branch; the owner performs this external action separately.',
					},
					options: [
						{
							id: 'decline',
							label: 'Keep work on the task branch',
							cost: 'No external action is performed.',
							recommended: true,
						},
						{
							id: 'stop',
							label: 'Stop and preserve work',
							cost: 'Unfinished criteria remain unmet.',
						},
					],
				});
				continue;
			}
			const action = request.action;
			if (
				state.cardAnswers.some(
					(answer) => answer.cardId === `permission:${action}` && answer.optionId === 'decline'
				)
			) {
				await append(id, {
					kind: 'action_receipt',
					actor: 'app',
					action,
					key: request.id,
					outcome: 'failed',
					detail: 'Owner declined this action; branch and ledger kept.',
					id: `${request.id}:result`,
				});
				continue;
			}
			if (
				!(await permission(
					id,
					state,
					action,
					`${request.detail} Target: task branch team/${id} on the project's configured push remote.`
				))
			)
				return true;
			if (
				action === 'draftPr' &&
				!(await permission(
					id,
					state,
					'push',
					`Push task branch team/${id} before creating its draft PR.`
				))
			)
				return true;
			await startJob(id, `action:${request.id}`, async (controller) => {
				const workspaces = ws(await stateFor(id));
				try {
					await workspaces.initialize();
					const inspection = await workspaces.inspect();
					await queue.enqueue(id, () =>
						append(id, {
							kind: 'action_receipt',
							actor: 'app',
							action,
							key: request.id,
							outcome: 'started',
							detail: JSON.stringify(inspection),
							id: `${request.id}:started`,
						})
					);
					if (controller.signal.aborted) throw new Error('Publication stopped before commit');
					await workspaces.commitDevWork(`Team ${id}: ${action}`);
					if (controller.signal.aborted) throw new Error('Publication stopped before push');
					if (!(await workspaces.pushDevWork()))
						throw new Error('Task branch push was not authorized');
					if (controller.signal.aborted)
						throw new Error('Publication stopped after push; inspect the recorded task branch');
					const detail =
						action === 'draftPr'
							? await workspaces.createDraftPr(state.config!.title, request.detail)
							: `Pushed team/${id} to the configured project remote`;
					await queue.enqueue(id, () =>
						append(id, {
							kind: 'action_receipt',
							actor: 'app',
							action,
							key: request.id,
							outcome: 'succeeded',
							detail,
							id: `${request.id}:result`,
						})
					);
				} catch (error) {
					deps.onError(error);
					await queue.enqueue(id, async () => {
						await append(id, {
							kind: 'action_receipt',
							actor: 'app',
							action,
							key: request.id,
							outcome: 'failed',
							detail: String(error),
							id: `${request.id}:result`,
						});
						if (/auth|log(?:ged)?[ -]?in|credential/i.test(String(error)))
							await card(id, {
								id: `action-login:${request.id}`,
								boundary: 'login',
								title: 'Restore GitHub CLI login for the project remote',
								body: 'GitHub CLI authentication failed for the project remote.',
								payload: {
									type: 'escalation',
									cause: 'publication-login',
									stuck: String(error),
									paths: [
										'The authorized publication failed. Repeating it without restoring GitHub credentials cannot succeed.',
									],
									recommendation:
										'Run gh auth login for the project remote host, then request publication again.',
								},
								options: [
									{
										id: 'decline',
										label: 'Keep work locally while I restore GitHub login',
										cost: 'No automatic publication retry.',
										recommended: true,
									},
									{
										id: 'stop',
										label: 'Stop and preserve work',
										cost: 'Branch and ledger are kept.',
									},
								],
							});
					});
				}
			});
			return true;
		}
		return false;
	};
	const setSeat = async (
		id: string,
		seat: SeatRole,
		model?: SeatModel,
		substitute = false,
		wait = false,
		cardId?: string
	) => {
		const state = await stateFor(id);
		if (state.terminal || !SEAT_ROLES.includes(seat))
			throw new Error('An active team and valid seat are required');
		if (state.seats[seat].activeDispatchIds.length)
			throw new Error('Wait for the active seat turn or pause it before changing models');
		if (
			!wait &&
			(!model ||
				!isValidAgentId(model.tool) ||
				model.tool === 'terminal' ||
				(model.tool === 'codex' && model.effort?.trim().toLowerCase() === 'ultra'))
		)
			throw new Error('Invalid team model');
		const known =
			model &&
			SEAT_ROLES.some(
				(role) =>
					sameTeamModel(state.config!.seats[role], model) ||
					(state.config!.seats[role].substitute &&
						sameTeamModel(state.config!.seats[role].substitute!, model))
			);
		if (model && !known && !cardId) {
			const key = createHash('sha256')
				.update(JSON.stringify([seat, model, substitute]))
				.digest('hex');
			await card(id, {
				id: `model:${key}`,
				seat,
				boundary: 'model',
				title: `Authorize ${model.tool} ${model.model ?? 'default'} for ${seat}`,
				body: 'This model is outside the current team authorization.',
				payload: {
					type: 'escalation',
					cause: 'model',
					stuck: 'This model is not in the team authorization.',
					paths: ['Existing team models remain available under the current grant.'],
					recommendation: 'Approve only if the new model and its usage cost are intended.',
				},
				seatChange: { seat, model, substitute },
				options: [
					{
						id: 'model',
						label: 'Authorize this named model',
						cost: 'Uses this provider account and may incur additional model charges.',
						recommended: true,
					},
					{ id: 'decline', label: 'Keep the current model', cost: 'No new model is used.' },
				],
			});
			return;
		}
		await append(id, {
			kind: 'seat_configured',
			actor: 'owner',
			seat,
			...(wait
				? { wait: true, substitute: null }
				: substitute
					? { substitute: model, wait: false }
					: { model, wait: false }),
			cardId,
			...(cardId ? { id: `${cardId}:action` } : {}),
		});
		if (!substitute && !wait && model) {
			await append(id, {
				kind: 'seat_bound',
				actor: 'app',
				seat,
				workspace: state.seats[seat].binding!.workspace,
				model,
				reason: 'restored',
				configSource: seat,
			});
			await append(id, {
				kind: 'member_recovered',
				actor: 'app',
				seat,
				how: 'Owner selected a model; resume from the ledger in a new conversation',
			});
		}
		if (wait && state.seats[seat].takeover)
			await append(id, {
				kind: 'seat_bound',
				actor: 'app',
				seat,
				workspace: state.seats[seat].binding!.workspace,
				model: state.config!.seats[seat],
				reason: 'restored',
				configSource: seat,
			});
	};
	const advance = async (id: string) => {
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
		data = await load(id);
		if (reduceLedger(data.events).terminal) return;
		// Reconcile already completed effects even when no dispatch budget remains.
		await recoverReceipts(id, data);
		data = await load(id);
		const current = reduceLedger(data.events);
		if (
			!current.terminal &&
			current.config &&
			((current.config.deadline !== undefined && now() >= current.config.deadline) ||
				current.usage.turns >= current.config.turnBudget)
		) {
			if (current.config.deadline !== undefined && now() >= current.config.deadline) {
				for (const item of live.values()) if (item.teamId === id) item.controller.abort();
				jobs.get(id)?.abort();
			} else {
				// Read completed receipts at the limit. launch's shared guard prevents
				// a missing receipt from turning reconciliation into another invocation.
				if (!current.paused)
					for (const turn of current.turns)
						if (turn.dispatched && !turn.finished && !live.has(turn.dispatchId))
							launch(data, turn.dispatched, true);
				if (jobs.has(id) || [...live.values()].some((item) => item.teamId === id)) return;
			}
			await budgetReport(id, current);
			return;
		}
		await recoverAvailability(id, data);
		data = await load(id);
		const recoveredState = reduceLedger(data.events);
		// Also reconcile legacy/fired waits: they may otherwise launch another
		// wait turn after restart, even though the condition is our own next step.
		for (const wait of data.events.filter(
			(e): e is TeamEvent<'follow_up_registered'> => e.kind === 'follow_up_registered'
		)) {
			if (
				wait.unavailabilityId ||
				wait.faultId ||
				/^(job:|job-retry:)/.test(wait.followUpId) ||
				data.events.some(
					(e) =>
						(e.kind === 'wait_handled' || e.kind === 'wait_canceled') &&
						e.followUpId === wait.followUpId
				)
			)
				continue;
			const rejection = teamWaitRejection(wait, recoveredState);
			if (rejection) await cancelAppWait(id, wait.followUpId, wait.waitFor, rejection);
		}
		for (const wait of recoveredState.followUps) {
			if (!wait.faultId || recoveredState.seats[wait.seat].faultActive) continue;
			await deps.followUps.cancel(wait.followUpId);
			await append(id, {
				kind: 'follow_up_fired',
				actor: 'app',
				id: `${wait.followUpId}:recovered`,
				followUpId: wait.followUpId,
				result: 'Seat recovery changed the condition; cancel the fault inspection wait',
			});
		}
		data = await load(id);
		const state = reduceLedger(data.events);
		for (const discussion of state.discussions.filter((d) => d.decision && d.proposals.length)) {
			if (
				discussion.decision!.actions.some(
					(_, index) =>
						!data.events.some((e) =>
							[
								`${discussion.id}:conclusion:action:${index}`,
								`${discussion.id}:conclusion:action:${index}:registered`,
								`${discussion.id}:conclusion:action:${index}:canceled`,
							].includes(e.id)
						)
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
		if (state.openCards.some((c) => !c.seat) && !state.pendingMessages.length) return;
		if (await runActions(id, data)) return;
		if (await handleWaits(id, data)) return;
		if (
			(state.usage.turns >= Math.ceil(data.config.turnBudget * 0.8) ||
				(data.config.deadline !== undefined &&
					now() >= data.config.createdAt + (data.config.deadline - data.config.createdAt) * 0.8)) &&
			!state.wrapUp &&
			!state.turns.some((t) => t.dispatched?.turn === 'wrap_up')
		) {
			if (await dispatch(id, state, 'pm', 'wrap_up')) return;
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
					followUpId: broken.dispatched.followUpId,
				}
			);
			return;
		}
		for (const failed of state.turns.filter(
			(t) =>
				t.finished &&
				!t.finished.report &&
				!t.report &&
				!t.finished.canceled &&
				(t.dispatched?.retryOf || t.dispatched?.repairOf) &&
				state.seats[t.seat].faultActive
		)) {
			if (
				!data.events.some(
					(e) => e.kind === 'follow_up_registered' && e.faultId === failed.dispatchId
				)
			) {
				const at = now();
				await registerWait(id, {
					at,
					followUpId: `fault:${failed.dispatchId}`,
					faultId: failed.dispatchId,
					seat: failed.seat,
					reason:
						'The bounded retry or report repair failed. Do not redispatch unchanged conditions.',
					waitFor:
						'New native results or an explicit recovery condition; app inspects without a model call',
					untilMs: at + FOLLOW_UP_WAIT_MS,
				});
			}
		}
		const unreported = state.turns.find(
			(t) =>
				t.dispatched?.repairOf &&
				state.turns.find((r) => r.dispatchId === t.dispatched!.repairOf)?.dispatched?.turn !==
					'recovery' &&
				t.finished &&
				!t.finished.report &&
				!t.finished.canceled &&
				!t.report &&
				!t.finished.failureKind &&
				!state.turns.find((r) => r.dispatchId === t.dispatched!.repairOf)?.report &&
				!state.turns.some((r) => r.dispatched?.recoveryFor === t.dispatched!.repairOf)
		);
		if (unreported?.dispatched?.repairOf) {
			const original = state.turns.find((t) => t.dispatchId === unreported.dispatched!.repairOf)!;
			if (
				await dispatch(id, state, 'pm', 'recovery', {
					recoveryFor: original.dispatchId,
					problemId: `report:${original.dispatchId}`,
					note: `Organize the missing ${original.dispatched!.expectedTurn ?? original.dispatched!.turn} report from ${original.seat}. Original reply: ${original.finished?.repairTail ?? original.finished?.message}. Repair reply: ${unreported.finished?.repairTail ?? unreported.finished?.message}. Do not redo work. Original workspace: ${original.dispatched!.binding?.workspace ?? state.seats[original.seat].binding?.workspace}.`,
				})
			)
				return;
		}
		const failedTurns = state.turns.filter(
			(turn) =>
				turn.finished &&
				(turn.finished.exitCode !== 0 || turn.finished.failureKind) &&
				!turn.report &&
				!turn.repaired &&
				!turn.finished.canceled &&
				!['model-unavailable', 'login-expired'].includes(turn.finished.failureKind ?? '') &&
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
						followUpId: failed.dispatched.followUpId,
						note: 'The previous attempt may have done part of the work. Inspect existing results first; preserve completed actions. This is the single same-turn retry.',
					}
				)
			)
				return;
		}
		// Availability recovery resumes every held assignment, even if a later
		// wait/message turn ran. A durable link prevents replay after restart.
		for (const seat of SEAT_ROLES) {
			const latest = state.turns.findLast((turn) => turn.seat === seat);
			const lastTurn = state.turns.find((turn) => {
				const previous = turn.dispatched;
				if (
					!previous ||
					turn.seat !== seat ||
					!turn.finished ||
					turn.report ||
					turn.finished.report ||
					turn.finished.canceled ||
					turn.finished.seq >= recoveryAt(data.events, seat)
				)
					return false;
				if (
					turn !== latest &&
					!['model-unavailable', 'login-expired'].includes(turn.finished.failureKind ?? '')
				)
					return false;
				if (
					previous.discussionId &&
					state.discussions.find((d) => d.id === previous.discussionId)?.decision
				)
					return false;
				return !state.turns.some(
					(next) =>
						next.dispatched &&
						next.dispatched.seq > previous.seq &&
						next.seat === seat &&
						(next.dispatched.resumedFrom === turn.dispatchId ||
							(next.report &&
								next.report.type !== 'topic' &&
								(next.dispatched.expectedTurn ?? next.dispatched.turn) ===
									(previous.expectedTurn ?? previous.turn) &&
								next.dispatched.discussionId === previous.discussionId &&
								next.dispatched.round === previous.round &&
								next.dispatched.problemId === previous.problemId &&
								next.dispatched.followUpId === previous.followUpId))
				);
			});
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
							resumedFrom: previous.dispatchId,
							repairOf: previous.repairOf,
							recoveryFor: previous.recoveryFor,
							mode: previous.mode,
							problemId: previous.problemId,
							fingerprint: previous.fingerprint,
							failures: previous.failures,
							discussionId: previous.discussionId,
							round: previous.round,
							messageIds: previous.messageIds,
							followUpId: previous.followUpId,
							note: [
								previous.note,
								'The owner answered or the seat recovered. Inspect existing results before resuming the failed assignment.',
							]
								.filter(Boolean)
								.join('\n'),
						}
					)
				)
					return;
			}
		}
		for (const seat of SEAT_ROLES) {
			const progress = data.events.findLast(
				(e): e is TeamEvent<'turn_progress'> => e.kind === 'turn_progress' && e.seat === seat
			);
			if (!progress || progress.changed || state.seats[seat].activeDispatchIds.length) continue;
			const key = `idle:${seat}:${progress.id}`;
			if (progress.idleCount >= 2) {
				if (!state.discussions.some((d) => d.id === key))
					await openDiscussion(
						id,
						key,
						`${seat} produced two valid reports without changing any ledger facts. Diagnose the missing evidence and choose a new basis.`,
						'no-progress',
						`idle:${seat}`
					);
			} else if (!state.turns.some((t) => t.dispatched?.problemId === key)) {
				if (
					await dispatch(id, state, seat, 'message', {
						problemId: key,
						mode: 'gather',
						note: 'First idle turn: your valid report changed no facts. State precisely what evidence or completed work item is missing. Gather that evidence without repeating the previous change.',
					})
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
		const challengeRound = teamChallengeRound(state);
		const last = (kind: M1TurnKind, seat?: SeatRole) =>
			(kind === 'challenge' ? state.turns.filter((t) => !t.dispatched?.repairOf) : turns)
				.filter(
					(t) =>
						t.dispatched?.turn === kind &&
						(kind !== 'challenge' || t.dispatched.seq > challengeRound.epoch) &&
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
			const message = state.pendingMessages.find((m) => {
				const recipient = state.messages.find((item) => item.message.messageId === m.messageId)
					?.forwarded
					? 'pm'
					: (m.to ?? 'pm');
				const health = state.seats[recipient];
				return (
					!health.activeDispatchIds.length &&
					!teamModelUnavailable(
						state,
						health.model ?? state.config!.seats[recipient],
						health.binding?.configSource ?? recipient
					)
				);
			});
			if (message) {
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
				if (await dispatch(id, state, seat, 'message', { messageIds })) return;
			}
			// Pending messages to a healthy PM precede dependent phase work.
			// An unavailable recipient keeps its queue while independent seats continue.
			if (
				state.pendingMessages.some((m) => {
					const seat = state.messages.find((item) => item.message.messageId === m.messageId)
						?.forwarded
						? 'pm'
						: (m.to ?? 'pm');
					const health = state.seats[seat];
					return !teamModelUnavailable(
						state,
						health.model ?? state.config!.seats[seat],
						health.binding?.configSource ?? seat
					);
				})
			)
				return;
		}
		if (state.openCards.some((c) => !c.seat)) return;
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
				const confirmed = !!state.baseline.confirmedVersion;
				// A standard problem is settled by PM through standard changes, never routed to
				// dev or QA as a fix (PRD 6.6 R1-10), so its decided steps stay message turns.
				const standardIssue = assigned.some(
					(item) =>
						state.discussions.find((d) => d.id === item.discussionId)?.opened?.trigger ===
						'standard-issue'
				);
				const turn =
					!confirmed || seat === 'pm' || standardIssue
						? 'message'
						: seat === 'qa'
							? 'qa_prep'
							: state.issues.some((i) => i.opened.issueKind === 'defect' && isOpenTeamIssue(i))
								? 'fix'
								: 'work';
				const steps = assigned.map((item) => ({
					step: item.title,
					from: state.decisions.find((d) => d.discussionId === item.discussionId)?.decision,
				}));
				await dispatch(id, await stateFor(id), seat, turn, {
					note: confirmed
						? `Decided next steps for you (no message ids in this turn): ${JSON.stringify(steps)}. Carry them out within this turn's rules and report them as done or blocked.`
						: `Decided next steps for you (no message ids in this turn): ${JSON.stringify(steps)}. The baseline is not confirmed yet: report preparation only; do not implement.`,
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
		if (!state.brief) {
			if (!last('brief')) return dispatch(id, state, 'pm', 'brief');
		} else if (!state.baseline.confirmedVersion) {
			await transition(id, state, 'challenge');
			const returned = state.baseline.returns.at(-1)?.seq ?? 0;
			if (returned > (state.briefResponses.at(-1)?.seq ?? 0)) {
				if ((last('respond')?.dispatched?.seq ?? 0) < returned)
					return dispatch(id, state, 'pm', 'respond');
				return;
			}
			for (const seat of ['dev', 'qa'] as const)
				if (!last('challenge', seat)) {
					await dispatch(id, await stateFor(id), seat, 'challenge');
				}
			if (!accepted('challenge', 'dev') || !accepted('challenge', 'qa')) {
				if (!active && last('challenge', 'dev') && last('challenge', 'qa')) return wakePm();
				return;
			}
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
				body: [
					'Review this scope and its criteria before implementation starts.',
					state.brief.checks.length
						? 'The checks were dry-run in the task workspace under your authorization; they can start, and failures before implementation are expected.'
						: '',
					response.type === 'respond' ? response.askOwner : '',
				]
					.filter(Boolean)
					.join(' '),
				payload: {
					type: 'baseline',
					brief: state.brief,
					question: response.type === 'respond' ? response.askOwner : undefined,
					challengeRound: {
						round: challengeRound.round,
						criteria: challengeRound.criteria,
						diff: challengeRound.diff,
					},
					challenges: state.challenges.filter((c) => c.seq > challengeRound.ownerEpoch),
					responses: state.briefResponses.filter((r) => r.seq > challengeRound.ownerEpoch),
					discussions: state.decisions,
					trials: state.checks.filter((c) => c.batchId === batchId),
					diff: baselineDiff(state.briefs.at(-2) ?? null, state.brief),
				},
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
					const output = await captureOutput(state, revision);
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
							(e) =>
								(e.kind === 'follow_up_registered' || e.kind === 'wait_canceled') &&
								e.followUpId === followUpId
						)
					) {
						const at = now();
						await registerWait(id, {
							at,
							followUpId,
							seat: 'dev',
							reason: work.report.waiting.reason,
							waitFor: work.report.waiting.waitFor,
							needs: work.report.waiting.needs,
							condition: work.report.waiting.condition,
							untilMs: at + FOLLOW_UP_WAIT_MS,
							poll: 0,
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
				const output = state.outputs.at(-1);
				const missing = missingOutputLocations(state, output);
				const observation = state.outputObservations.find((o) => o.outputId === output?.outputId);
				const submitted = data.events.filter((e) => e.kind === 'workspace_submitted').at(-1);
				const changed = data.events.some(
					(e) =>
						e.seq > (output?.seq ?? 0) &&
						((missing.length > 0 &&
							['resumed', 'budget_extended', 'standard_issue_resolved', 'standard_change'].includes(
								e.kind
							)) ||
							(e.kind === 'report_accepted' &&
								e.seat === 'qa' &&
								(['reverify', 'qa_prep'].includes(e.report.type) ||
									(missing.length > 0 && e.report.type === 'verify'))))
				);
				// Refresh after QA writes; a read-only successful verify needs no new copy.
				// A capture fault retries in the app,
				// on a changed condition or at the normal recheck interval, never via PM.
				if (submitted && (changed || (observation && now() >= observation.retryAt))) {
					const key = `recapture:${output?.seq ?? 0}:${data.events.at(-1)?.seq ?? 0}`;
					return startJob(id, key, async () => {
						const capture = await captureOutput(state, submitted.revision);
						await queue.enqueue(id, () =>
							append(id, {
								kind: 'output_captured',
								actor: 'app',
								outputId: key,
								...capture,
								id: key,
							})
						);
					});
				}
				if (missing.length) {
					if (output && !observation)
						await append(id, {
							kind: 'output_observation',
							actor: 'app',
							outputId: output.outputId,
							missing,
							retryAt: now() + TEAM_WAIT_RECHECK_MS,
							id: `output-observation:${output.id}`,
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
					body: 'All confirmed criteria have evidence and product review passed. Accept the result or request specific changes.',
					payload: {
						type: 'acceptance',
						output: state.outputs.at(-1),
						before: state.outputs.at(-2),
						demo: state.demos.at(-1),
						evidence: teamStatus(state, now()).criteria,
						changes: state.standardChanges,
						contested: state.decisions.filter((d) => d.contested),
						suggestions: state.suggestions,
						evidenceChanges: state.checks.filter((c) => c.dilution?.length),
					},
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
	const evaluate = async (id: string) => {
		await advance(id);
		let data = await load(id);
		let state = reduceLedger(data.events);
		const canStall = (value: TeamState) =>
			running &&
			!value.paused &&
			!value.terminal &&
			!value.openCards.length &&
			!jobs.has(id) &&
			!SEAT_ROLES.some((seat) => value.seats[seat].activeDispatchIds.length) &&
			!value.followUps.some((wait) => {
				if (wait.faultId || /^(job:|job-retry:)/.test(wait.followUpId)) return false;
				if (wait.unavailabilityId) {
					const health = value.seats[wait.seat];
					return teamModelUnavailable(
						value,
						health.model ?? value.config!.seats[wait.seat],
						health.binding?.configSource ?? wait.seat
					);
				}
				return !teamWaitRejection(wait, value);
			});
		if (!canStall(state)) return;
		// Bookkeeping and repeated wait reports are not progress facts. In
		// particular, a new poll id cannot reset the ten-minute observation clock.
		const factKinds: LedgerEvent['kind'][] = [
			'team_created',
			'resumed',
			'phase_changed',
			'brief_published',
			'baseline_confirmed',
			'baseline_edited',
			'baseline_returned',
			'standard_change',
			'work_item',
			'check_run',
			'issue_opened',
			'issue_fixed',
			'issue_verified',
			'criterion_evidence',
			'discussion_opened',
			'position',
			'proposal',
			'response',
			'discussion_closed',
			'output_captured',
			'review',
			'retro',
			'demo',
			'owner_message',
			'message_handled',
			'model_recovered',
			'seat_bound',
		];
		const fact = data.events.findLast((e) => factKinds.includes(e.kind));
		if (!fact || now() - fact.at < TEAM_STALL_MS) return;
		const key = `stall:${fact.id}`;
		if (state.appObservations.some((o) => o.key === key)) return;
		const discussion = state.discussions.find((d) => d.opened && !d.decision);
		const detail = discussion
			? `Discussion ${discussion.id} (${discussion.opened!.topic}): positions ${discussion.positions.length}/${discussion.opened!.participants.length}, proposals ${discussion.proposals.length}, responses ${discussion.responses.length}.`
			: `Phase ${state.phase}; unfinished work: ${
					state.workItems
						.filter((w) => w.state !== 'checked')
						.map((w) => w.title)
						.join('; ') || 'no runnable assignment found'
				}.`;
		await append(id, {
			kind: 'app_observation',
			actor: 'app',
			category: 'stall',
			key,
			detail: `No new fact for ten minutes. ${detail}`,
			id: key,
		});
		// Retry the normal ledger-derived decision first. This never grants an
		// extra retry or crosses permissions, quota or the dispatch budget guard.
		await advance(id);
		data = await load(id);
		state = reduceLedger(data.events);
		if (!canStall(state) || data.events.some((e) => e.seq > fact.seq && factKinds.includes(e.kind)))
			return;
		await dispatch(id, state, 'pm', 'message', {
			mode: 'diagnose',
			problemId: key,
			note: `App stall diagnostic: ${detail} The scheduler rechecked its next step and could not dispatch it. Diagnose the stuck point from recorded facts and identify the next in-authority action. Do not register a wait for a discussion, seat turn or app check.`,
		});
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
		else if (optionId === 'model' && target.seatChange) {
			await setSeat(
				id,
				target.seatChange.seat,
				target.seatChange.model,
				target.seatChange.substitute,
				false,
				cardId
			);
		} else if (optionId === 'decline') {
			await append(id, {
				kind: 'message_handled',
				actor: 'app',
				messageId: cardId,
				seat: target.seat ?? 'pm',
				summary: 'Owner kept current authority',
				id: `${cardId}:action`,
			});
		} else if (optionId === 'extend' && target.extension) {
			await extendBudget(id, target.extension, cardId);
		} else if (optionId === 'takeover' && target.seat) {
			await append(id, {
				kind: 'card_answered',
				actor: 'owner',
				cardId: 'permission:temporaryTakeover',
				optionId: 'allow',
				id: `${cardId}:grant`,
			});
			await append(id, {
				kind: 'member_recovered',
				actor: 'app',
				seat: target.seat,
				how: 'Owner authorized temporary takeover; availability remains checked',
				id: `${cardId}:action`,
			});
		} else if (optionId === 'login' && target.seat) {
			for (const entry of state.unavailable.filter((q) => q.seat === target.seat && q.login))
				await append(id, {
					kind: 'model_recovered',
					actor: 'app',
					unavailabilityId: entry.id,
					id: `${entry.id}:available`,
				});
			await append(id, {
				kind: 'member_recovered',
				actor: 'app',
				seat: target.seat,
				how: 'Owner confirmed the named login was restored',
				id: `${cardId}:action`,
			});
		} else if (target.boundary === 'baseline') {
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
			if (!gaps.length) gaps.push('The team stopped before completing its review and demo.');
			for (const [index, text] of gaps.entries())
				await append(id, {
					kind: 'residual_item',
					actor: 'owner',
					cardId,
					itemId: `${cardId}:residual:${index}`,
					text,
					owner: null,
					id: `${cardId}:residual:${index}`,
				});
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
		list: async () =>
			Promise.all(
				(await deps.store.listTeams()).map(async (config) => (await load(config.id)).config)
			),
		async get(id: string, full = false): Promise<RecordData | null> {
			let data: RecordData;
			try {
				data = await load(id);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
				throw error;
			}
			return {
				...data,
				events: await Promise.all(
					data.events.map(async (event) =>
						!full
							? teamEventForTransport(event)
							: event.kind === 'turn_dispatched'
								? { ...event, prompt: await recordedPrompt(id, event, data.events) }
								: event
					)
				),
			};
		},
		async status(id: string) {
			const data = await this.get(id);
			return data ? teamStatus(reduceLedger(data.events), now()) : null;
		},
		/** Exact append-log audit, without loading or hydrating separate prompt files. */
		async events(id: string): Promise<LedgerEvent[]> {
			return (await load(id)).events;
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
		baselineEdit: (
			id: string,
			criterionId: string,
			text: string,
			fields: Partial<Pick<Criterion, 'proof' | 'how'>> = {}
		) =>
			queue.enqueue(id, async () => {
				const state = await stateFor(id);
				if (state.terminal || !text?.trim())
					throw new Error('An active team and nonempty criterion text are required');
				if (
					(fields.proof !== undefined && !['app', 'qa', 'pm'].includes(fields.proof)) ||
					(fields.how !== undefined && typeof fields.how !== 'string')
				)
					throw new Error('Invalid criterion proof fields');
				const current = state.baseline.brief ?? state.brief;
				const criterion = current?.criteria.find((c) => c.id === criterionId);
				if (!current || !criterion) throw new Error('Unknown criterion');
				const edited = {
					...criterion,
					text,
					proof: fields.proof ?? criterion.proof,
					how: fields.how ?? criterion.how,
					byOwner: true,
				};
				if (state.baseline.brief) {
					await applyStandardChange(
						id,
						{
							criterionId,
							change: 'modify',
							criterion: edited,
							reason: 'Owner edited the criterion',
						},
						'owner',
						randomUUID()
					);
				} else {
					const brief = {
						...current,
						version: current.version + 1,
						criteria: current.criteria.map((c) => (c.id === criterionId ? edited : c)),
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
			return Promise.all(
				reduceLedger(data.events)
					.turns.filter((t) => !seat || t.seat === seat)
					.map(async (t) => ({
						dispatchId: t.dispatchId,
						seat: t.seat,
						turn: t.dispatched?.turn,
						prompt: t.dispatched ? await recordedPrompt(id, t.dispatched, data.events) : undefined,
						reply: t.finished?.message,
						report: t.report,
						normalizations: t.normalizations,
						error: t.reportError,
					}))
			);
		},
		async prompt(id: string, dispatchId: string) {
			const { events } = await load(id);
			const dispatch = events.find(
				(e): e is Dispatch => e.kind === 'turn_dispatched' && e.dispatchId === dispatchId
			);
			if (!dispatch) throw new Error(`Unknown dispatch ${dispatchId}`);
			return recordedPrompt(id, dispatch, events);
		},
		answer,
		say: (id: string, text: string, to?: SeatRole): Promise<QueuedTeamMessage> =>
			queue.enqueue(id, async () => {
				if (!text?.trim() || (to !== undefined && !SEAT_ROLES.includes(to)))
					throw new Error('Invalid owner message');
				if ((await stateFor(id)).terminal) throw new Error('Team has ended');
				const messageId = randomUUID();
				await append(id, {
					kind: 'owner_message',
					actor: 'owner',
					messageId,
					text,
					to: to ?? 'pm',
				});
				return { status: 'queued', messageId, to: to ?? 'pm' };
			}),
		pause: (id: string) => control(id, 'paused'),
		resume: (id: string) => control(id, 'resumed'),
		stop: (id: string) => control(id, 'stopped'),
		assignResidual: (id: string, itemId: string, owner: string | null) =>
			queue.enqueue(id, async () => {
				const state = await stateFor(id);
				const item = state.residualItems.find((entry) => entry.itemId === itemId);
				if (state.terminal !== 'gaps' || !item || (owner !== null && typeof owner !== 'string'))
					throw new Error('Choose an existing residual item on a team accepted with gaps');
				await append(id, {
					kind: 'residual_item',
					actor: 'owner',
					itemId,
					text: item.text,
					owner: owner?.trim() || null,
				});
			}),
		seatSet: (id: string, seat: SeatRole, model: SeatModel) =>
			queue.enqueue(id, () => setSeat(id, seat, model)),
		seatSub: (id: string, seat: SeatRole, model?: SeatModel, wait = false) =>
			queue.enqueue(id, () => setSeat(id, seat, model, true, wait)),
		action: (id: string, action: import('../../shared/team/types').TeamAction, detail: string) =>
			queue.enqueue(id, async () => {
				if (
					(await stateFor(id)).terminal ||
					!['push', 'draftPr', 'merge', 'publish', 'externalMessage'].includes(action) ||
					!detail?.trim()
				)
					throw new Error('An active team, supported action and concrete detail are required');
				return append(id, { kind: 'action_requested', actor: 'owner', action, detail });
			}),
		extend: (id: string, extension: { hours?: number; turns?: number }) =>
			queue.enqueue(id, () => extendBudget(id, extension)),
		async accept(id: string, withGaps = false) {
			const state = await stateFor(id);
			const target = state.openCards.find((c) =>
				withGaps ? c.boundary === 'budget' : c.boundary === 'acceptance'
			);
			if (!target)
				throw new Error(withGaps ? 'No incomplete progress report' : 'No acceptance card');
			await answer(id, target.id, withGaps ? 'gaps' : 'accept');
		},
		async requestChanges(id: string, note: string) {
			const state = await stateFor(id);
			const target = state.openCards.find((c) => c.boundary === 'acceptance');
			if (!target) throw new Error('No acceptance card');
			await answer(id, target.id, 'changes', note);
		},
		async export(id: string) {
			const data = await load(id);
			const prompts = Object.fromEntries(
				await Promise.all(
					data.events
						.filter((e): e is Dispatch => e.kind === 'turn_dispatched')
						.map(async (e) => [e.dispatchId, await recordedPrompt(id, e, data.events)])
				)
			);
			return JSON.stringify({ ...data, prompts }, null, '\t');
		},
		async seatTranscript(id: string, seat: SeatRole): Promise<TeamSeatTranscript | null> {
			if (!SEAT_ROLES.includes(seat)) throw new Error('Invalid seat');
			const data = await this.get(id);
			if (!data) return null;
			const binding = reduceLedger(data.events).seats[seat].binding;
			return binding
				? {
						provider: binding.model.tool,
						nativeSessionId: binding.nativeSessionId,
						cwd: binding.workspace,
						configDir: deps.seatAccountDir?.(
							data.config,
							binding.configSource ?? seat,
							binding.model
						),
					}
				: null;
		},
	};
}

export type TeamScheduler = ReturnType<typeof createTeamScheduler>;
