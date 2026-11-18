import { useEffect } from 'react';
import { useSessionStore, updateSessionWith } from '../../stores/sessionStore';
import { useWindowContextOptional } from '../../contexts/WindowContext';
import { useConversationAutomationStore } from '../../stores/conversationAutomationStore';
import { enqueuePromptForTab } from '../../services/queuedPrompt';
import { createKeyedWriteQueue } from '../../../shared/keyedWriteQueue';
import { captureException } from '../../utils/sentry';
import { logger } from '../../utils/logger';

const receipts = createKeyedWriteQueue();

export function useConversationAutomation(): void {
	const loaded = useSessionStore((state) => state.sessionsLoaded);
	const windowContext = useWindowContextOptional();
	useEffect(() => {
		const api = window.maestro?.conversationAutomation;
		if (!loaded || !api) return;
		let disposed = false;
		let refreshAgain = false;
		let refreshing = false;
		const report = (error: unknown, context: Record<string, unknown>) => {
			logger.error('Conversation automation renderer operation failed', 'ConversationAutomation', {
				...context,
				windowId: windowContext?.windowId,
				error: error instanceof Error ? error.stack : String(error),
			});
			captureException(error);
		};
		const refresh = async () => {
			refreshAgain = true;
			if (refreshing) return;
			refreshing = true;
			try {
				while (refreshAgain && !disposed) {
					refreshAgain = false;
					const states = await api.list();
					for (const state of states) {
						if (windowContext && !windowContext.ownsSession(state.target.sessionId, true)) continue;
						const canceled = new Set(
							state.deliveries
								.filter((entry) => entry.state === 'canceled')
								.map((entry) => entry.id)
						);
						if (canceled.size)
							updateSessionWith(state.target.sessionId, (session) =>
								session.executionQueue.some((item) => canceled.has(item.id))
									? {
											...session,
											executionQueue: session.executionQueue.filter(
												(item) => !canceled.has(item.id)
											),
										}
									: session
							);
					}
					if (!disposed) useConversationAutomationStore.getState().replace(states);
				}
			} finally {
				refreshing = false;
			}
		};
		const refreshSafely = () => {
			void refresh().catch((error) => report(error, { stage: 'refresh' }));
		};
		const offChanged = api.onChanged(refreshSafely);
		const offTurn = api.onTurn((delivery) => {
			const context = {
				stage: 'receive',
				deliveryId: delivery.id,
				followUpId: delivery.followUpId,
				target: delivery.target,
			};
			void receipts
				.enqueue(delivery.id, async () => {
					const { sessionId, tabId } = delivery.target;
					if (windowContext && !windowContext.ownsSession(sessionId, true)) {
						logger.warn(
							'Conversation turn reached a renderer that does not own it',
							'ConversationAutomation',
							{ ...context, windowId: windowContext.windowId }
						);
						return;
					}
					const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
					const tab = session?.aiTabs.find((tab) => tab.id === tabId);
					if (!session || !tab)
						return api.acknowledge(delivery.id, 'The target conversation no longer exists');
					if (
						!session.executionQueue?.some((item) => item.id === delivery.id) &&
						!tab.logs.some((log) => log.queuedItemId === delivery.id)
					) {
						const item = enqueuePromptForTab({
							sessionId,
							tabId,
							text: `[delivery:${delivery.id}]\n${delivery.prompt}`,
							id: delivery.id,
							exactTarget: true,
						});
						if (!item) {
							// A tab replacement lock is temporary; the durable intent stays queued.
							logger.debug(
								'Conversation turn is waiting for its exact tab',
								'ConversationAutomation',
								context
							);
							return;
						}
					}
					const current = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
					if (!current || (await window.maestro.sessions.setMany([current], [])) !== true)
						throw new Error('Could not persist conversation delivery');
					await api.acknowledge(delivery.id);
					logger.debug(
						'Persisted and acknowledged conversation turn',
						'ConversationAutomation',
						context
					);
				})
				.catch((error) => report(error, context));
		});
		// A closed target must be reported even when it was accepted while busy.
		const offSessions = useSessionStore.subscribe((state) => {
			for (const session of state.sessions) {
				if (windowContext && !windowContext.ownsSession(session.id, true)) continue;
				const missing =
					session.executionQueue?.filter(
						(item) => item.exactTarget && !session.aiTabs.some((tab) => tab.id === item.tabId)
					) ?? [];
				if (!missing.length) continue;
				updateSessionWith(session.id, (s) => ({
					...s,
					executionQueue: s.executionQueue.filter(
						(item) => !missing.some((gone) => gone.id === item.id)
					),
				}));
				for (const item of missing)
					void api
						.acknowledge(item.id, 'The target conversation closed before delivery')
						.catch((error) =>
							report(error, {
								stage: 'closed-target',
								deliveryId: item.id,
								target: { kind: 'conversation', sessionId: session.id, tabId: item.tabId },
							})
						);
			}
		});
		refreshSafely();
		void api.ready().catch((error) => report(error, { stage: 'ready' }));
		const timer = setInterval(() => {
			void api.ready().catch((error) => report(error, { stage: 'ready' }));
		}, 1000);
		return () => {
			disposed = true;
			offChanged();
			offTurn();
			offSessions();
			clearInterval(timer);
		};
	}, [loaded, windowContext]);
}
