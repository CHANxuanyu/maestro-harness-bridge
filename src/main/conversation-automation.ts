import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import path from 'path';
import {
	CONVERSATION_TOTAL_MS,
	CONVERSATION_WAIT_MS,
	CONVERSATION_POLL_MS,
	conversationKey,
	type AutomationRequest,
	type ConversationAutomationState,
	type ConversationTarget,
	type ConversationCheckBatch,
} from '../shared/conversationAutomation';
import { DURATION_MS } from '../shared/duration';
import { decideNext, judgeAttempts } from '../shared/progressRules';
import { stripAnsiCodes } from '../shared/stringUtils';
import type { FollowUpFire } from '../shared/followUp';
import type { createFollowUpStore } from './follow-ups';
import type { createCheckRunner } from './check-runner';
import { followUpPrompt, type createConversationTurns } from './conversation-turns';
import { checkCommandBoundary } from './check-authorization';
import { atomicWriteJson, createKeyedWriteQueue } from './utils/atomic-json-store';
import { logger } from './utils/logger';

export interface ConversationAutomationDependencies {
	userData: string;
	now?: () => number;
	resolve: (
		target: ConversationTarget
	) => Promise<Pick<ConversationAutomationState, 'project' | 'cwd' | 'host'>>;
	snapshot: (target: ConversationTarget) => Promise<{ revision: string; fingerprint: string }>;
	checks: ReturnType<typeof createCheckRunner>;
	followUps: ReturnType<typeof createFollowUpStore>;
	turns: ReturnType<typeof createConversationTurns>;
	changed: () => void;
	onError: (error: unknown, context?: Record<string, unknown>) => void;
	cancelAutomatic?: (target: ConversationTarget) => void;
}

export function createConversationAutomation(deps: ConversationAutomationDependencies) {
	const now = deps.now ?? Date.now;
	const file = path.join(deps.userData, 'conversation-automation.json');
	const writes = createKeyedWriteQueue();
	const runs = createKeyedWriteQueue();
	const events = createKeyedWriteQueue();
	const controllers = new Map<string, AbortController>();
	type StoredAutomation = {
		grants: string[];
		conversations: Record<string, ConversationAutomationState>;
	};
	let data: StoredAutomation | undefined;
	let unsubscribe: (() => void) | undefined;
	const load = async () => {
		if (data) return data;
		try {
			const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as StoredAutomation;
			if (!parsed || !Array.isArray(parsed.grants) || !parsed.conversations)
				throw new Error('Invalid conversation automation store');
			return (data = parsed);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			return (data = { grants: [], conversations: {} });
		}
	};
	const mutate = <T>(fn: (store: NonNullable<typeof data>) => T | Promise<T>) =>
		writes.enqueue(file, async () => {
			const next = structuredClone(await load());
			const result = await fn(next);
			await fs.mkdir(deps.userData, { recursive: true });
			await atomicWriteJson(file, next);
			data = next;
			deps.changed();
			return structuredClone(result);
		});
	const grantKey = (s: Pick<ConversationAutomationState, 'project' | 'host'>) =>
		JSON.stringify([s.host, s.project]);
	const ensure = async (target: ConversationTarget) => {
		if (target?.kind !== 'conversation' || !target.sessionId || !target.tabId)
			throw new Error('An exact conversation is required');
		const scope = await deps.resolve(target);
		return mutate((store) => {
			const key = conversationKey(target);
			let state = store.conversations[key];
			if (!state)
				state = store.conversations[key] = {
					target,
					...scope,
					checks: [],
					batches: [],
					fix: 'ask',
					attempts: [],
					initialFailures: [],
					progress: judgeAttempts([], []),
					projectAuthorized: false,
					followUps: [],
					deliveries: [],
					notes: [],
				};
			if (grantKey(state) !== grantKey(scope) || state.cwd !== scope.cwd) {
				state.checks.forEach((check) => {
					check.once = false;
					check.boundary = 'unverified-command';
				});
				Object.assign(state, scope);
			}
			state.projectAuthorized = store.grants.includes(grantKey(state));
			return state;
		});
	};
	const update = (target: ConversationTarget, fn: (state: ConversationAutomationState) => void) =>
		mutate((store) => {
			const state = store.conversations[conversationKey(target)];
			if (!state) throw new Error('Unknown conversation');
			fn(state);
			return state;
		});
	const read = (target: ConversationTarget) =>
		writes.enqueue(file, async () =>
			structuredClone((await load()).conversations[conversationKey(target)])
		);
	const view = async (target: ConversationTarget) => {
		const state = await read(target);
		if (!state) throw new Error('Unknown conversation');
		state.followUps = (await deps.followUps.list()).filter(
			(entry) =>
				entry.target.kind === 'conversation' &&
				conversationKey(entry.target) === conversationKey(target) &&
				!entry.id.startsWith('budget:')
		);
		state.deliveries = (await deps.turns.list()).filter(
			(entry) => conversationKey(entry.target) === conversationKey(target)
		);
		return state;
	};
	const syncBudget = async (state: ConversationAutomationState) => {
		if (!state.deadline) return;
		const pending = (await deps.followUps.list()).filter(
			(entry) =>
				entry.state === 'pending' &&
				entry.target.kind === 'conversation' &&
				conversationKey(entry.target) === conversationKey(state.target)
		);
		const sameBudget = pending.find(
			(entry) => entry.id.startsWith('budget:') && entry.deadline === state.deadline
		);
		for (const entry of pending.filter(
			(entry) => entry.id.startsWith('budget:') && entry.id !== sameBudget?.id
		))
			await deps.followUps.cancel(entry.id);
		await deps.followUps.setDeadline(
			pending.map((entry) => entry.id),
			state.deadline
		);
		const id = `budget:${conversationKey(state.target)}:${state.deadline}:${randomUUID()}`;
		if (!sameBudget)
			await deps.followUps.register({
				id,
				target: state.target,
				reason: 'The shared time limit for automatic fixes and follow-ups has expired.',
				condition: { kind: 'time', at: state.deadline },
				deadline: state.deadline,
				waitLimitMs: Math.max(1, state.deadline - now()),
			});
	};
	const budget = async (target: ConversationTarget, totalMs?: number) => {
		if (totalMs !== undefined && (!Number.isFinite(totalMs) || totalMs <= 0))
			throw new Error('Invalid total time limit');
		const state = await update(target, (s) => {
			if (s.expired || s.stopped)
				throw new Error('The total limit has stopped this work; the owner must extend it');
			s.startedAt ??= now();
			if (totalMs !== undefined || !s.deadline)
				s.deadline = s.startedAt + (totalMs ?? CONVERSATION_TOTAL_MS);
		});
		await syncBudget(state);
		return state;
	};
	const stop = async (target: ConversationTarget, report?: string) => {
		controllers.get(conversationKey(target))?.abort();
		deps.cancelAutomatic?.(target);
		await update(target, (s) => {
			s.stopped = true;
			s.report = report ?? s.report;
			s.pendingTurn = undefined;
		});
		await deps.turns.cancel(target);
		for (const entry of (await view(target)).followUps)
			if (entry.state === 'pending') await deps.followUps.cancel(entry.id);
	};
	const expire = async (event: FollowUpFire) => {
		if (event.followUp.target.kind !== 'conversation') return;
		const target = event.followUp.target;
		const state = await read(target);
		if (state?.expired && state.report) {
			await deps.turns.enqueue({
				id: `expiry:${target.sessionId}:${target.tabId}:${state.deadline}`,
				followUpId: event.followUp.id,
				target,
				prompt: `${followUpPrompt(event)}\nApplication report: ${state.report}`,
			});
			return;
		}
		if (
			!state ||
			state.expired ||
			(state.stopped && !state.expiryPending) ||
			state.pausedAt ||
			(state.deadline ?? Infinity) > now()
		)
			return;
		const pending = (await view(target)).followUps.filter((entry) =>
			state.expiryPending
				? state.expiryPending.includes(entry.id)
				: entry.state === 'pending' ||
					entry.id === event.followUp.id ||
					(entry.fire?.kind === 'expired' && entry.fire.at >= state.deadline!)
		);
		await update(target, (s) => {
			s.expiryPending = pending.map((entry) => entry.id);
		});
		await stop(target);
		const observations: NonNullable<ConversationAutomationState['expiryReport']>['observations'] =
			[];
		for (const entry of pending)
			observations.push({ reason: entry.reason, status: await deps.followUps.observe(entry.id) });
		const latest = state.batches.at(-1);
		const report = JSON.stringify({
			status: 'stopped-incomplete',
			reason: 'Total time limit reached',
			passed: latest?.checks.filter((check) => check.outcome === 'pass').length ?? 0,
			total: latest?.checks.length ?? 0,
			observations,
			recommendation: observations.some((item) =>
				['running', 'waiting'].includes(item.status?.state ?? '')
			)
				? 'Extend one hour if the external work is still needed.'
				: 'Review the remaining evidence before extending.',
		});
		await update(target, (s) => {
			s.report = report;
			s.expiryReport = {
				passed: latest?.checks.filter((check) => check.outcome === 'pass').length ?? 0,
				total: latest?.checks.length ?? 0,
				observations,
				recommendation: observations.some((item) =>
					['running', 'waiting'].includes(item.status?.state ?? '')
				)
					? 'extend'
					: 'review',
			};
			s.expired = true;
			s.expiryPending = undefined;
			s.decision = { kind: 'report', boundaries: ['budget'] };
		});
		await deps.turns.enqueue({
			id: `expiry:${target.sessionId}:${target.tabId}:${state.deadline}`,
			followUpId: event.followUp.id,
			target,
			prompt: `${followUpPrompt(event)}\nApplication report: ${report}`,
		});
	};
	const drive = async (target: ConversationTarget) => {
		let state = await read(target);
		if (!state || state.fix !== 'auto' || state.stopped || state.pausedAt || state.pendingTurn)
			return;
		const decision = decideNext(state.progress, {
			candidates: state.proposal?.candidates,
			budget: {
				used: now() - (state.startedAt ?? now()),
				total: (state.deadline ?? now()) - (state.startedAt ?? now()),
			},
		});
		state = await update(target, (s) => {
			s.decision = decision;
		});
		logger.info('Conversation fix decision', 'ConversationAutomation', {
			stage: 'decide',
			target,
			decision: decision.kind,
			streak: state.progress.streak,
			attempts: state.progress.attempts
				.slice(-3)
				.map(({ id, fingerprint, failures, knownAfter, verdict }) => ({
					id,
					fingerprint,
					failures,
					knownAfter,
					verdict,
				})),
		});
		if (decision.kind === 'done' || decision.kind === 'report') return;
		if (decision.kind === 'escalate') {
			await update(target, (s) => {
				s.pausedAt = now();
			});
			// Pause the single-conversation budget until the owner answers a concrete option.
			return;
		}
		const id = `fix:${randomUUID()}`;
		const diagnosis = decision.kind === 'diagnose';
		await update(target, (s) => {
			s.pendingTurn = { id, diagnosis };
		});
		const latest = state.batches.at(-1);
		await deps.turns.enqueue({
			id,
			target,
			prompt: [
				`[${id}] Application checks: ${JSON.stringify(latest?.checks.filter((check) => check.outcome !== 'pass'))}`,
				diagnosis
					? 'Diagnose why the last three attempts made no progress. Do not repeat a previous change.'
					: decision.kind === 'continue'
						? `Next supported step: ${decision.next.plan}`
						: 'Gather new evidence or make a different, evidence-based repair. Do not repeat any recorded change.',
				'Before the attempt, state its basis, difference from earlier attempts and expected observation. Record these with maestro-cli checks plan --proposal <JSON> (basis, difference, expectation, candidates). Candidate fields: plan, basis, fingerprint, optional boundary and cost. Advice is not a boundary.',
				`Previous attempts: ${JSON.stringify(state.progress.attempts)}`,
				`Total deadline: ${new Date(state.deadline!).toISOString()}. The app runs the checks and judges results; do not claim checks passed without that evidence.`,
			].join('\n'),
		});
	};
	const run = (target: ConversationTarget, turnId?: string, completedDelivery?: string) =>
		runs.enqueue(conversationKey(target), async () => {
			let state = await ensure(target);
			if (state.stopped || state.pausedAt || !state.checks.length) return view(target);
			if (!state.projectAuthorized) return view(target);
			const definitions = await Promise.all(
				state.checks.map(async (check) => ({
					...check,
					boundary: await checkCommandBoundary(check.command, state),
				}))
			);
			state = await update(target, (s) => {
				s.checks = definitions;
			});
			if (definitions.some((check) => check.boundary && !check.once)) return view(target);
			let snapshot: Awaited<ReturnType<typeof deps.snapshot>>;
			try {
				snapshot = await deps.snapshot(target);
			} catch (error) {
				await update(target, (s) => {
					s.batches.push({
						id: randomUUID(),
						turnId,
						revision: 'unavailable',
						fingerprint: '',
						createdAt: now(),
						checks: definitions.map((check) => ({
							id: randomUUID(),
							command: check.command,
							cwd: s.cwd,
							host: s.host,
							startedAt: now(),
							endedAt: now(),
							exitCode: null,
							outcome: 'not-run',
							outputTail: '',
							truncated: false,
							error: String(error),
						})),
					});
					s.pendingTurn = undefined;
				});
				return view(target);
			}
			const controller = new AbortController();
			controllers.set(conversationKey(target), controller);
			await update(target, (s) => {
				s.running = true;
				s.pendingCheckRun = false;
				s.checks.forEach((check) => {
					check.once = false;
				});
			});
			const batch: ConversationCheckBatch = {
				id: randomUUID(),
				...snapshot,
				turnId,
				checks: [],
				createdAt: now(),
			};
			try {
				for (const check of definitions) {
					if (state.deadline && now() >= state.deadline) controller.abort();
					batch.checks.push(
						await deps.checks.run({
							command: check.command,
							cwd: state.cwd,
							host: state.host,
							signal: controller.signal,
							timeoutMs: Math.max(
								1,
								Math.min(10 * DURATION_MS.minute, (state.deadline ?? Infinity) - now())
							),
						})
					);
				}
				state = await update(target, (s) => {
					s.running = false;
					const previousEvidence = new Set(
						s.batches.flatMap((batch) =>
							batch.checks
								.filter((check) => check.outcome === 'pass')
								.map((check) => JSON.stringify([check.command, stripAnsiCodes(check.outputTail)]))
						)
					);
					const evidence = batch.checks
						.filter((check) => check.outcome === 'pass')
						.map((check) => JSON.stringify([check.command, stripAnsiCodes(check.outputTail)]))
						.filter((value) => !previousEvidence.has(value))
						.map((value) => createHash('sha256').update(value).digest('hex'));
					s.batches.push(batch);
					// Infrastructure failures are visible evidence, never a code failure or a pass.
					if (
						batch.checks.some((check) => !['pass', 'fail'].includes(check.outcome)) ||
						batch.checks.length !== definitions.length
					) {
						s.pendingTurn = undefined;
						return;
					}
					const failures = batch.checks
						.filter((check) => check.outcome === 'fail')
						.map((check) =>
							createHash('sha256')
								.update(
									JSON.stringify([check.command, check.exitCode, stripAnsiCodes(check.outputTail)])
								)
								.digest('hex')
						);
					if (!s.pendingTurn && !s.progress.failures.length && failures.length) {
						// A later edit can introduce a new problem after a previous loop passed.
						s.initialFailures = failures;
						s.attempts = [];
						s.proposal = undefined;
					}
					if (!s.initialFailures.length && failures.length) s.initialFailures = failures;
					if (s.pendingTurn && s.pendingTurn.id === completedDelivery) {
						s.attempts.push({
							id: batch.id,
							fingerprint: createHash('sha256')
								.update(JSON.stringify([snapshot.fingerprint, failures]))
								.digest('hex'),
							failures,
							evidence,
							basis: s.proposal?.basis,
							difference: s.proposal?.difference,
							expectation: s.proposal?.expectation,
							status:
								failures.length === 0
									? 'solved'
									: failures.length < s.progress.failures.length
										? 'partial'
										: undefined,
						});
						if (s.pendingTurn.diagnosis)
							s.attempts.push({
								id: `${batch.id}:diagnosis`,
								fingerprint: '',
								failures,
								diagnosis: true,
								basis: s.proposal?.basis,
							});
						s.pendingTurn = undefined;
					}
					s.progress = judgeAttempts(s.initialFailures, s.attempts);
					if (!failures.length) {
						s.progress.failures = [];
						s.progress.status = 'solved';
					}
				});
			} finally {
				controllers.delete(conversationKey(target));
				await update(target, (s) => {
					s.running = false;
				});
			}
			if (
				batch.checks.length === definitions.length &&
				batch.checks.every((check) => ['pass', 'fail'].includes(check.outcome))
			)
				await drive(target);
			return view(target);
		});
	const fired = async (event: FollowUpFire) => {
		if (event.followUp.target.kind !== 'conversation') return;
		const target = event.followUp.target;
		const context = {
			stage: 'fire',
			followUpId: event.followUp.id,
			target,
			kind: event.kind,
			late: event.late,
		};
		const state = await read(target);
		if (!state) throw new Error('Fired follow-up has no conversation automation state');
		logger.info('Processing fired conversation follow-up', 'ConversationAutomation', {
			...context,
			stopped: !!state.stopped,
			pausedAt: state.pausedAt,
		});
		if (event.kind === 'expired') return expire(event);
		if (state.stopped || state.pausedAt) {
			logger.info(
				'Follow-up delivery held by conversation state',
				'ConversationAutomation',
				context
			);
			return;
		}
		await deps.turns.enqueue({
			id: `follow:${event.followUp.id}`,
			followUpId: event.followUp.id,
			target,
			prompt: followUpPrompt(event),
		});
		if (
			event.kind === 'wait-timeout' &&
			['waiting', 'running'].includes(event.externalStatus.state)
		) {
			const id = `${event.followUp.id}:poll`;
			if (!(await deps.followUps.list()).some((entry) => entry.id === id))
				await deps.followUps.register({
					id,
					target,
					reason: event.followUp.reason,
					condition: event.followUp.condition,
					deadline: state.deadline!,
					waitLimitMs: CONVERSATION_POLL_MS,
					pollIntervalMs: CONVERSATION_POLL_MS,
				});
			// An unchanged external poll never enters judgeAttempts.
		}
		deps.changed();
	};
	return {
		tracksTurn(processId: string): boolean {
			return Object.values(data?.conversations ?? {}).some(
				(state) =>
					state.checks.length > 0 &&
					!state.stopped &&
					`${state.target.sessionId}-ai-${state.target.tabId}` === processId
			);
		},
		async execute(request: AutomationRequest): Promise<ConversationAutomationState> {
			const { target, caller } = request;
			if (caller && (caller.agentId !== target.sessionId || caller.tabId !== target.tabId))
				throw new Error('Caller must address its own exact conversation');
			if (request.action === 'status' && (await read(target))) return view(target);
			let state = await ensure(target);
			if (
				caller &&
				['authorize', 'fix', 'extend', 'answer', 'stop', 'follow-cancel', 'checks-run'].includes(
					request.action
				)
			)
				throw new Error('This action requires the owner');
			switch (request.action) {
				case 'status':
					break;
				case 'checks-set': {
					if (
						!Array.isArray(request.commands) ||
						request.commands.length > 40 ||
						request.commands.some(
							(command) => typeof command !== 'string' || !command.trim() || command.length > 16_000
						)
					)
						throw new Error('Provide up to 40 nonempty check commands');
					if (state.running) throw new Error('Checks are running');
					const checks = await Promise.all(
						request.commands.map(async (command) => ({
							id: randomUUID(),
							command,
							boundary: await checkCommandBoundary(command, state),
						}))
					);
					await update(target, (s) => {
						s.checks = checks;
						s.pendingCheckRun = true;
						s.notes.push({ kind: s.projectAuthorized ? 'checksUpdated' : 'grantRequired' });
					});
					if (!caller && state.projectAuthorized) return run(target);
					break;
				}
				case 'authorize': {
					if (request.choice === 'project')
						await mutate((store) => {
							const key = grantKey(state);
							if (!store.grants.includes(key)) store.grants.push(key);
							for (const s of Object.values(store.conversations))
								if (grantKey(s) === key) s.projectAuthorized = true;
						});
					else
						await update(target, (s) => {
							if (!s.checks.some((check) => check.id === request.checkId))
								throw new Error('Unknown check');
							if (request.choice === 'reject')
								s.checks = s.checks.filter((check) => check.id !== request.checkId);
							else
								s.checks = s.checks.map((check) =>
									check.id === request.checkId ? { ...check, once: true } : check
								);
						});
					return run(target);
				}
				case 'checks-run':
					return run(target);
				case 'fix':
					await update(target, (s) => {
						s.fix = request.mode;
					});
					if (request.mode === 'auto') {
						await budget(target, request.totalMs);
						await drive(target);
					}
					break;
				case 'plan':
					if (
						!request.proposal?.basis ||
						!request.proposal.difference ||
						!request.proposal.expectation ||
						!Array.isArray(request.proposal.candidates) ||
						request.proposal.candidates.some(
							(candidate) =>
								!candidate ||
								typeof candidate.plan !== 'string' ||
								!candidate.plan.trim() ||
								(candidate.boundary &&
									(!['budget', 'commitment', 'permission', 'model', 'login'].includes(
										candidate.boundary
									) ||
										(!candidate.advice && (!candidate.basis || !candidate.cost))))
						)
					)
						throw new Error('State basis, difference, expectation and candidates');
					await update(target, (s) => {
						s.proposal = request.proposal;
					});
					break;
				case 'answer': {
					if (state.decision?.kind !== 'escalate')
						throw new Error('No boundary decision is pending');
					const option = state.decision.options[request.option];
					if (!option) throw new Error('Unknown boundary option');
					const pausedWaits = (await view(target)).followUps.filter(
						(entry) => entry.fire && entry.fire.at >= (state.pausedAt ?? Infinity)
					);
					state = await update(target, (s) => {
						s.deadline = (s.deadline ?? now()) + (now() - (s.pausedAt ?? now()));
						s.startedAt = (s.startedAt ?? now()) + (now() - (s.pausedAt ?? now()));
						s.pausedAt = undefined;
						s.proposal = {
							basis: option.basis!,
							difference: option.plan,
							expectation: s.proposal?.expectation ?? option.plan,
							candidates: [{ ...option, boundary: undefined }],
						};
						s.notes.push({ kind: 'ownerApproved', detail: option.plan });
					});
					await syncBudget(state);
					for (const entry of pausedWaits)
						await deps.followUps.register({
							target,
							reason: entry.reason,
							condition: entry.condition,
							deadline: state.deadline!,
							waitLimitMs: entry.waitLimitMs,
							pollIntervalMs: entry.pollIntervalMs,
						});
					await drive(target);
					break;
				}
				case 'follow-add':
					if (
						caller &&
						request.totalMs !== undefined &&
						(state.deadline || request.totalMs > CONVERSATION_TOTAL_MS)
					)
						throw new Error('Only the owner may change the shared total limit');
					state = await budget(target, request.totalMs);
					await deps.followUps.register({
						target,
						reason: request.reason,
						condition: request.condition,
						deadline: state.deadline!,
						waitLimitMs: request.waitLimitMs ?? CONVERSATION_WAIT_MS,
					});
					break;
				case 'follow-cancel': {
					const entry = (await view(target)).followUps.find((entry) => entry.id === request.id);
					if (!entry) throw new Error('Unknown follow-up');
					if (!(await deps.followUps.cancel(entry.id)))
						throw new Error('This follow-up is no longer pending');
					await update(target, (s) => {
						s.notes.push({ kind: 'followCanceled', detail: entry.reason });
					});
					break;
				}
				case 'extend': {
					const previous = (await view(target)).followUps
						.filter((entry) => entry.fire?.kind === 'expired' || entry.state === 'canceled')
						.at(-1);
					state = await update(target, (s) => {
						s.deadline = Math.max(now(), s.deadline ?? now()) + DURATION_MS.hour;
						s.expired = false;
						s.stopped = false;
						s.pausedAt = undefined;
						s.report = undefined;
						s.expiryReport = undefined;
					});
					await syncBudget(state);
					if (previous)
						await deps.followUps.register({
							target,
							reason: previous.reason,
							condition: previous.condition,
							deadline: state.deadline!,
							waitLimitMs: CONVERSATION_POLL_MS,
							pollIntervalMs: CONVERSATION_POLL_MS,
						});
					await drive(target);
					break;
				}
				case 'stop':
					await stop(target, 'Stopped by the owner; unfinished checks remain unverified.');
					await update(target, (s) => {
						s.expired = false;
						s.expiryPending = undefined;
						s.decision = undefined;
					});
					break;
				default:
					throw new Error('Unknown conversation automation action');
			}
			deps.changed();
			return view(target);
		},
		async list() {
			const targets = await writes.enqueue(file, async () =>
				Object.values(await load().then((store) => store.conversations)).map((s) => s.target)
			);
			return Promise.all(targets.map(view));
		},
		async afterTurn(
			target: ConversationTarget,
			turnId?: string,
			changed = false,
			completedDelivery?: string
		) {
			const state = await read(target);
			if (
				state &&
				(changed ||
					state.pendingCheckRun ||
					(state.pendingTurn && state.pendingTurn.id === completedDelivery))
			)
				return run(target, turnId, completedDelivery);
		},
		async start() {
			await mutate((store) => {
				for (const s of Object.values(store.conversations)) {
					if (s.running) s.notes.push({ kind: 'checksRestarted' });
					s.running = false;
				}
			});
			unsubscribe = deps.followUps.onFire((event) => {
				void events
					.enqueue(JSON.stringify(event.followUp.target), () => fired(event))
					.catch((error) =>
						deps.onError(error, {
							stage: 'fire',
							followUpId: event.followUp.id,
							target: event.followUp.target,
						})
					);
			});
			for (const entry of await deps.followUps.list())
				if (entry.state === 'fired' && entry.fire) {
					try {
						await fired({ followUp: entry, ...entry.fire, externalStatus: entry.externalStatus });
					} catch (error) {
						deps.onError(error, { stage: 'replay', followUpId: entry.id, target: entry.target });
					}
				}
			await deps.followUps.start();
		},
		dispose() {
			unsubscribe?.();
			deps.followUps.stop();
			for (const controller of controllers.values()) controller.abort();
		},
	};
}
