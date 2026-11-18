import * as fs from 'fs/promises';
import path from 'path';
import type { ConversationDelivery, ConversationTarget } from '../shared/conversationAutomation';
import type { FollowUpFire } from '../shared/followUp';
import { atomicWriteJson, createKeyedWriteQueue } from './utils/atomic-json-store';
import type { WindowRegistry } from './window-registry';
import { logger } from './utils/logger';

export function followUpPrompt(event: FollowUpFire): string {
	const { followUp, externalStatus } = event;
	return [
		`[follow-up:${followUp.id}] ${followUp.reason}`,
		`Event: ${event.kind}; condition: ${followUp.condition.kind}.`,
		...(event.late ? ['Late follow-up: the scheduled time passed while the app was closed.'] : []),
		`Application observation: ${JSON.stringify(externalStatus)}`,
		event.kind === 'expired'
			? 'The total time limit is reached. Report the current state, remaining work and recommendation. Stop; do not change files or register another follow-up.'
			: event.kind === 'wait-timeout'
				? 'A single wait ended, not the total budget. A queued/running external event is normal waiting, not a failed attempt. The app will check again every 10 minutes. Work on independent tasks within the existing authorization.'
				: 'Continue this exact conversation using the observed result. Stay within the existing authorization and total time limit.',
	].join('\n');
}

/** Durable intent, delivered only to the registered owner after its renderer is ready. */
export function createConversationTurns(deps: {
	userData: string;
	windows: Pick<WindowRegistry, 'getWindowForSession' | 'getPrimary' | 'get'>;
	exists: (target: ConversationTarget) => boolean;
	changed?: () => void;
}) {
	const file = path.join(deps.userData, 'conversation-turns.json');
	const writes = createKeyedWriteQueue();
	const ready = new Set<string>();
	// Primary owns unassigned sessions, as in WindowContext and the windows IPC handlers.
	// An explicitly assigned owner must never be replaced by another window.
	const ownerId = (target: ConversationTarget) =>
		deps.windows.getWindowForSession(target.sessionId) ?? deps.windows.getPrimary()?.id;
	let records: ConversationDelivery[] | undefined;
	const load = async () => {
		if (!records) {
			try {
				const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
				if (!Array.isArray(parsed)) throw new Error('Invalid conversation delivery store');
				records = parsed as ConversationDelivery[];
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				records = [];
			}
		}
		return records;
	};
	const save = async (next: ConversationDelivery[]) => {
		try {
			await fs.mkdir(deps.userData, { recursive: true });
			await atomicWriteJson(file, next);
		} catch (error) {
			logger.error('Could not persist conversation turns', 'ConversationAutomation', {
				stage: 'persist',
				deliveries: next.map(({ id, followUpId, target, state }) => ({
					deliveryId: id,
					followUpId,
					target,
					state,
				})),
				error: error instanceof Error ? error.stack : String(error),
			});
			throw error;
		}
		records = next;
		deps.changed?.();
	};
	const pump = () =>
		writes.enqueue(file, async () => {
			const current = await load();
			let changed = false;
			const next = current.map((entry): ConversationDelivery => {
				if (entry.state !== 'queued' && entry.state !== 'accepted') return entry;
				if (!deps.exists(entry.target)) {
					changed = true;
					logger.warn(
						'Conversation turn is undeliverable: target no longer exists',
						'ConversationAutomation',
						{
							stage: 'pump',
							deliveryId: entry.id,
							followUpId: entry.followUpId,
							target: entry.target,
						}
					);
					return {
						...entry,
						state: 'undeliverable',
						error: 'The target conversation no longer exists',
					};
				}
				if (entry.state === 'accepted') return entry;
				const windowId = ownerId(entry.target);
				if (!windowId || !ready.has(windowId)) return entry;
				const owner = deps.windows.get(windowId)?.browserWindow;
				if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed()) return entry;
				try {
					owner.webContents.send('conversationAutomation:turn', entry);
					logger.debug('Sent conversation turn to its owner', 'ConversationAutomation', {
						stage: 'send',
						deliveryId: entry.id,
						followUpId: entry.followUpId,
						target: entry.target,
						windowId,
					});
				} catch (error) {
					// Keep durable intent queued. The owner's next ready signal retries it.
					logger.error('Could not send conversation turn', 'ConversationAutomation', {
						stage: 'send',
						deliveryId: entry.id,
						followUpId: entry.followUpId,
						target: entry.target,
						windowId,
						error: error instanceof Error ? error.stack : String(error),
					});
				}
				return entry;
			});
			if (changed) await save(next);
		});
	return {
		async enqueue(entry: Omit<ConversationDelivery, 'state'>) {
			await writes.enqueue(file, async () => {
				const current = await load();
				if (!current.some((item) => item.id === entry.id)) {
					await save([...current, { ...entry, state: 'queued' }]);
					const windowId = deps.exists(entry.target) ? ownerId(entry.target) : undefined;
					logger.info('Queued conversation turn', 'ConversationAutomation', {
						stage: 'enqueue',
						deliveryId: entry.id,
						followUpId: entry.followUpId,
						target: entry.target,
						windowId,
						ready: !!windowId && ready.has(windowId),
					});
				}
			});
			await pump();
		},
		async ready(windowId: string) {
			if (!ready.has(windowId))
				logger.info('Conversation renderer ready', 'ConversationAutomation', {
					stage: 'ready',
					windowId,
				});
			ready.add(windowId);
			await pump();
		},
		async acknowledge(id: string, windowId: string, error?: string) {
			await writes.enqueue(file, async () => {
				const current = await load();
				const entry = current.find((item) => item.id === id);
				if (!entry) {
					logger.warn('Unknown conversation delivery receipt', 'ConversationAutomation', {
						stage: 'ack',
						deliveryId: id,
						windowId,
					});
					return;
				}
				if (ownerId(entry.target) !== windowId) {
					logger.warn(
						'Conversation delivery receipt from a different owner',
						'ConversationAutomation',
						{
							stage: 'ack',
							deliveryId: id,
							followUpId: entry.followUpId,
							target: entry.target,
							windowId,
							ownerId: ownerId(entry.target),
						}
					);
					return;
				}
				if (entry.state === 'canceled' || entry.state === 'delivered') return;
				await save(
					current.map((item) =>
						item.id === id ? { ...item, state: error ? 'undeliverable' : 'accepted', error } : item
					)
				);
				logger[error ? 'warn' : 'info']('Conversation turn receipt', 'ConversationAutomation', {
					stage: 'ack',
					deliveryId: id,
					followUpId: entry.followUpId,
					target: entry.target,
					windowId,
					error,
				});
			});
		},
		async delivered(id: string) {
			await writes.enqueue(file, async () => {
				const current = await load();
				const entry = current.find((item) => item.id === id);
				if (!entry || !['queued', 'accepted'].includes(entry.state)) return;
				await save(
					current.map((item) => (item.id === id ? { ...item, state: 'delivered' } : item))
				);
				logger.info('Conversation turn started', 'ConversationAutomation', {
					stage: 'delivered',
					deliveryId: id,
					followUpId: entry.followUpId,
					target: entry.target,
				});
			});
		},
		async cancel(target: ConversationTarget) {
			await writes.enqueue(file, async () =>
				save(
					(await load()).map((item) =>
						item.target.sessionId === target.sessionId &&
						item.target.tabId === target.tabId &&
						['queued', 'accepted'].includes(item.state)
							? { ...item, state: 'canceled' }
							: item
					)
				)
			);
		},
		list: () => writes.enqueue(file, async () => structuredClone(await load())),
		pump,
	};
}
