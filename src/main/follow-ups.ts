import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import path from 'path';
import { DURATION_MS } from '../shared/duration';
import { compactToolOutput, MAX_PERSISTED_TOOL_OUTPUT_CHARS } from '../shared/toolOutput';
import { SEAT_ROLES } from '../shared/team/types';
import type {
	FollowUp,
	FollowUpCondition,
	FollowUpExternalStatus,
	FollowUpFire,
	FollowUpRegistration,
} from '../shared/followUp';
import { atomicWriteJson, createKeyedWriteQueue } from './utils/atomic-json-store';
import { corruptStorePath } from './stores/corrupt-store-recovery';
import { execFileNoThrow } from './utils/execFile';
import { resolveGhPath } from './utils/cliDetection';
import { logger } from './utils/logger';

export const FOLLOW_UP_POLL_MS = 30 * DURATION_MS.second;
export const FOLLOW_UP_WAIT_MS = 20 * DURATION_MS.minute;

/** Only an app-owned process registry may attest that a command is observable. */
export interface FollowUpCommands {
	getStatus(processId: string): FollowUpExternalStatus | undefined;
	subscribe(listener: (processId: string, status: FollowUpExternalStatus) => void): () => void;
}

export interface FollowUpDependencies {
	userData: string;
	now?: () => number;
	commands?: FollowUpCommands;
	gh?: (args: string[], cwd: string) => Promise<{ status: string; conclusion: string | null }>;
	onError?: (error: unknown) => void;
}

function compactExternalStatus(status: FollowUpExternalStatus): FollowUpExternalStatus {
	return {
		...status,
		...(status.outputTail === undefined
			? {}
			: {
					outputTail: compactToolOutput(status.outputTail.slice(-MAX_PERSISTED_TOOL_OUTPUT_CHARS))
						.output as string,
				}),
	};
}

function validateRegistration(input: FollowUpRegistration): void {
	const target = input.target;
	const validTarget =
		target?.kind === 'conversation'
			? !!target.sessionId && !!target.tabId
			: target?.kind === 'team' && !!target.teamId && SEAT_ROLES.includes(target.seat);
	if (!validTarget || !input.reason?.trim() || !Number.isFinite(input.deadline))
		throw new Error('Follow-up requires an exact target, reason and absolute deadline');
	if (
		input.waitLimitMs !== undefined &&
		(!Number.isFinite(input.waitLimitMs) || input.waitLimitMs <= 0)
	)
		throw new Error('Invalid follow-up wait limit');
	const condition = input.condition;
	if (
		!condition ||
		!(
			(condition.kind === 'time' && Number.isFinite(condition.at)) ||
			(condition.kind === 'command' && !!condition.processId) ||
			(condition.kind === 'ci' && /^\d+$/.test(condition.runId) && !!condition.cwd)
		)
	)
		throw new Error('This wait cannot be observed; use a time condition');
}

export function createFollowUpStore(deps: FollowUpDependencies) {
	const now = deps.now ?? Date.now;
	const file = path.join(deps.userData, 'follow-ups.json');
	const writes = createKeyedWriteQueue();
	const listeners = new Set<(event: FollowUpFire) => void>();
	const report = deps.onError ?? ((error: unknown) => logger.error(String(error), 'FollowUps'));
	const gh =
		deps.gh ??
		(async (args: string[], cwd: string) => {
			const result = await execFileNoThrow(await resolveGhPath(), args, cwd, {
				timeout: 10 * DURATION_MS.second,
			});
			if (result.exitCode !== 0)
				throw new Error(result.stderr || 'Cannot observe GitHub Actions; use a time condition');
			return JSON.parse(result.stdout) as { status: string; conclusion: string | null };
		});
	let records: FollowUp[] | undefined;
	let running = false;
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let unsubscribe: (() => void) | undefined;
	const restored = new Set<string>();
	const polling = new Set<string>();
	const nextPoll = new Map<string, number>();
	const commandStatus = (processId: string): FollowUpExternalStatus => {
		try {
			return (
				deps.commands?.getStatus(processId) ?? {
					state: 'unavailable',
					observedAt: now(),
					error: 'The app can no longer observe this process',
				}
			);
		} catch (error) {
			return { state: 'unavailable', observedAt: now(), error: String(error) };
		}
	};

	const ciStatus = async (
		condition: Extract<FollowUpCondition, { kind: 'ci' }>
	): Promise<FollowUpExternalStatus> => {
		const result = await gh(
			['run', 'view', condition.runId, '--json', 'status,conclusion'],
			condition.cwd
		);
		if (
			!result ||
			!['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(
				result.status
			)
		)
			throw new Error('GitHub Actions returned an unobservable status; use a time condition');
		return {
			state: result.status === 'completed' ? 'completed' : 'running',
			observedAt: now(),
			...result,
		};
	};
	const load = async () => {
		if (records) return records;
		let bytes: Buffer;
		try {
			bytes = await fs.readFile(file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			return (records = []);
		}
		try {
			const parsed: unknown = JSON.parse(bytes.toString('utf8'));
			if (!Array.isArray(parsed)) throw new SyntaxError('Invalid follow-up store');
			const ids = new Set<string>();
			for (const entry of parsed as FollowUp[]) {
				try {
					validateRegistration(entry);
				} catch {
					throw new SyntaxError('Invalid saved follow-up');
				}
				if (
					!entry.id ||
					ids.has(entry.id) ||
					!Number.isFinite(entry.createdAt) ||
					!['pending', 'fired', 'canceled'].includes(entry.state) ||
					!entry.externalStatus ||
					!Number.isFinite(entry.waitLimitMs) ||
					entry.waitLimitMs <= 0 ||
					(entry.state === 'fired' && !entry.fire)
				)
					throw new SyntaxError('Invalid saved follow-up');
				ids.add(entry.id);
				if (entry.state === 'pending') restored.add(entry.id);
			}
			return (records = parsed as FollowUp[]);
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
			const sidecar = `${corruptStorePath(file)}.${randomUUID()}`;
			await fs.rename(file, sidecar);
			report(new Error(`Preserved unreadable follow-ups at ${sidecar}: ${error.message}`));
			return (records = []);
		}
	};
	const save = async (next: FollowUp[]) => {
		await fs.mkdir(deps.userData, { recursive: true });
		await atomicWriteJson(file, next);
		records = next;
	};
	const due = (entry: FollowUp): { kind: FollowUpFire['kind']; at: number } | undefined => {
		const time = now();
		if (entry.deadline <= time) return { kind: 'expired', at: entry.deadline };
		if (entry.condition.kind === 'time' && entry.condition.at <= time)
			return { kind: 'ready', at: entry.condition.at };
		if (entry.externalStatus.state === 'completed')
			return { kind: 'ready', at: entry.externalStatus.observedAt };
		if (entry.createdAt + entry.waitLimitMs <= time) {
			// At the single-wait boundary, take one fresh CI observation. Polling
			// is bounded by the gh runner and never delays the absolute deadline.
			if (
				entry.condition.kind === 'ci' &&
				polling.has(entry.id) &&
				entry.externalStatus.observedAt < entry.createdAt + entry.waitLimitMs
			)
				return;
			return { kind: 'wait-timeout', at: entry.createdAt + entry.waitLimitMs };
		}
		if (entry.externalStatus.state === 'unavailable')
			return { kind: 'ready', at: entry.externalStatus.observedAt };
	};
	const fireDue = async () => {
		const current = await load();
		const events: FollowUpFire[] = [];
		const next = current.map((entry) => {
			const trigger = entry.state === 'pending' ? due(entry) : undefined;
			if (!trigger) return entry;
			const fire = {
				kind: trigger.kind,
				at: now(),
				late: restored.has(entry.id) && trigger.at < now(),
			};
			const fired: FollowUp = { ...entry, state: 'fired', fire };
			events.push({ ...fire, followUp: fired, externalStatus: entry.externalStatus });
			return fired;
		});
		if (!events.length) return;
		// Persist first. A crash between this write and delivery leaves a fired
		// record for reconciliation, never a second automatic firing.
		await save(next);
		if (!running) return;
		for (const event of events)
			for (const listener of listeners) {
				try {
					listener(structuredClone(event));
				} catch (error) {
					report(error);
				}
			}
	};
	const updateStatus = (id: string, status: FollowUpExternalStatus, epoch: number) =>
		writes.enqueue(file, async () => {
			if (!running || generation !== epoch) return;
			const current = await load();
			if (!current.some((entry) => entry.id === id && entry.state === 'pending')) return;
			const bounded = compactExternalStatus(status);
			await save(
				current.map((entry) => (entry.id === id ? { ...entry, externalStatus: bounded } : entry))
			);
			await fireDue();
		});
	const schedule = (retryAfter = 0) => {
		if (timer) clearTimeout(timer);
		if (!running) return;
		let at = Infinity;
		for (const entry of records ?? []) {
			if (entry.state !== 'pending') continue;
			const waitAt = entry.createdAt + entry.waitLimitMs;
			at = Math.min(
				at,
				entry.deadline,
				polling.has(entry.id) && waitAt <= now() ? Infinity : waitAt,
				entry.condition.kind === 'time' ? entry.condition.at : (nextPoll.get(entry.id) ?? now())
			);
		}
		if (Number.isFinite(at))
			timer = setTimeout(
				() => {
					void tick().catch((error) => {
						report(error);
						schedule(FOLLOW_UP_POLL_MS);
					});
				},
				Math.min(Math.max(at - now(), retryAfter, 1), 2 ** 31 - 1)
			);
	};
	const pollCi = (entry: FollowUp, epoch: number) => {
		if (entry.condition.kind !== 'ci' || polling.has(entry.id)) return;
		polling.add(entry.id);
		nextPoll.set(entry.id, now() + FOLLOW_UP_POLL_MS);
		void ciStatus(entry.condition)
			.catch(
				(error: unknown): FollowUpExternalStatus => ({
					state: 'unavailable',
					observedAt: now(),
					error: String(error),
				})
			)
			.then((status) => updateStatus(entry.id, status, epoch))
			.catch(report)
			.finally(() => {
				polling.delete(entry.id);
				schedule();
			});
	};
	const tick = async () => {
		const epoch = generation;
		await writes.enqueue(file, async () => {
			if (!running || epoch !== generation) return;
			const current = await load();
			let updated = false;
			const next = current.map((entry): FollowUp => {
				if (entry.state !== 'pending') return entry;
				if (entry.condition.kind === 'command') {
					updated = true;
					const status = commandStatus(entry.condition.processId);
					return {
						...entry,
						externalStatus: compactExternalStatus(status),
					};
				}
				if (
					entry.condition.kind === 'ci' &&
					entry.deadline > now() &&
					entry.createdAt + entry.waitLimitMs <= now() &&
					entry.externalStatus.observedAt < entry.createdAt + entry.waitLimitMs &&
					!['completed', 'unavailable'].includes(entry.externalStatus.state)
				)
					pollCi(entry, epoch);
				return entry;
			});
			if (updated) await save(next);
			await fireDue();
		});
		if (!running || epoch !== generation) return;
		for (const entry of records ?? []) {
			if (
				entry.state !== 'pending' ||
				entry.condition.kind === 'time' ||
				(nextPoll.get(entry.id) ?? 0) > now()
			)
				continue;
			nextPoll.set(entry.id, now() + FOLLOW_UP_POLL_MS);
			if (polling.has(entry.id)) continue;
			if (entry.condition.kind === 'ci') pollCi(entry, epoch);
		}
		schedule();
	};

	return {
		async register(input: FollowUpRegistration): Promise<FollowUp> {
			const snapshot = structuredClone(input);
			validateRegistration(snapshot);
			const condition = snapshot.condition;
			let status: FollowUpExternalStatus = { state: 'waiting', observedAt: now() };
			if (condition.kind === 'ci') status = await ciStatus(condition);
			if (condition.kind === 'command') {
				const observed = commandStatus(condition.processId);
				if (observed.state === 'unavailable')
					throw new Error('The app cannot observe this process; use a time condition');
				status = observed;
			}
			status = compactExternalStatus(status);
			const entry: FollowUp = {
				...snapshot,
				id: snapshot.id ?? randomUUID(),
				createdAt: now(),
				waitLimitMs: snapshot.waitLimitMs ?? FOLLOW_UP_WAIT_MS,
				state: 'pending',
				externalStatus: status,
			};
			await writes.enqueue(file, async () => {
				const current = await load();
				if (current.some((item) => item.id === entry.id))
					throw new Error('Follow-up id already exists');
				await save([...current, entry]);
			});
			nextPoll.set(entry.id, now() + FOLLOW_UP_POLL_MS);
			if (running) await tick();
			return structuredClone(entry);
		},
		async cancel(id: string): Promise<boolean> {
			const canceled = await writes.enqueue(file, async () => {
				const current = await load();
				if (!current.some((entry) => entry.id === id && entry.state === 'pending')) return false;
				await save(
					current.map((entry) => (entry.id === id ? { ...entry, state: 'canceled' } : entry))
				);
				return true;
			});
			schedule();
			return canceled;
		},
		list(): Promise<FollowUp[]> {
			return writes.enqueue(file, async () => structuredClone(await load()));
		},
		onFire(listener: (event: FollowUpFire) => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		async start(): Promise<void> {
			if (running) return;
			running = true;
			const epoch = ++generation;
			unsubscribe = deps.commands?.subscribe((processId, status) => {
				for (const entry of records ?? [])
					if (entry.condition.kind === 'command' && entry.condition.processId === processId) {
						void updateStatus(entry.id, status, epoch)
							.then(() => schedule())
							.catch(report);
					}
			});
			await tick();
		},
		stop(): void {
			running = false;
			generation++;
			if (timer) clearTimeout(timer);
			unsubscribe?.();
			unsubscribe = undefined;
		},
	};
}
