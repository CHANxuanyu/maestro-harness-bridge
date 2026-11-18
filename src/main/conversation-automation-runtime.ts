import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import path from 'path';
import { ipcMain } from 'electron';
import type { IpcBootstrapDependencies } from './ipc/bootstrap/types';
import { createConversationAutomation } from './conversation-automation';
import { createConversationTurns } from './conversation-turns';
import { createFollowUpStore } from './follow-ups';
import { createCheckRunner } from './check-runner';
import { createSshRemoteStoreAdapter, getSshRemoteConfig } from './utils/ssh-remote-resolver';
import { getGitChanges, getGitChangeDiff, onGitTurnFinished } from './git-changes';
import type { AutomationRequest, ConversationTarget } from '../shared/conversationAutomation';
import type { FollowUpExternalStatus } from '../shared/followUp';
import { MAX_PERSISTED_TOOL_OUTPUT_CHARS } from '../shared/toolOutput';
import { withIpcErrorLogging } from './utils/ipcHandler';
import { logger } from './utils/logger';
import type { StoredSession } from './stores/types';
import type { ProcessConfig } from './process-manager/types';
import { execGitReadOnly } from './utils/remote-git';

/** Both shells and the CLI reach this single main-owned runtime. */
export function registerConversationAutomation(deps: IpcBootstrapDependencies): void {
	const userData = path.join(deps.app.getPath('userData'), 'conversation-automation');
	const changed = () => deps.safeSend('conversationAutomation:changed');
	const onError = (error: unknown, context?: Record<string, unknown>) =>
		logger.error(
			error instanceof Error ? (error.stack ?? error.message) : String(error),
			'ConversationAutomation',
			context
		);
	const sessions = () => deps.sessionsStore.get('sessions', []) as StoredSession[];
	const find = (target: ConversationTarget) => {
		const session = sessions().find((s) => s.id === target.sessionId);
		const tab = session?.aiTabs?.find(
			(tab: { id: string; logs?: { id: string; source: string }[] }) => tab.id === target.tabId
		);
		return session && tab ? { session, tab } : undefined;
	};
	const executionCwds = new Map<string, string>();
	const resolve = async (target: ConversationTarget) => {
		const found = find(target);
		if (!found) throw new Error('The target conversation no longer exists');
		const { session } = found;
		const remoteId = session.sessionSshRemoteConfig?.enabled
			? session.sessionSshRemoteConfig.remoteId
			: undefined;
		if (session.sessionSshRemoteConfig?.enabled && !remoteId)
			throw new Error('SSH remote cannot be resolved');
		const cwd =
			executionCwds.get(`${target.sessionId}-ai-${target.tabId}`) ??
			(session.sessionSshRemoteConfig?.enabled
				? session.sessionSshRemoteConfig.workingDirOverride || session.remoteCwd || session.cwd
				: session.cwd);
		return {
			cwd: remoteId ? cwd : await fs.realpath(cwd),
			project: remoteId
				? session.projectRoot || cwd
				: await fs.realpath(session.projectRoot || cwd),
			host: remoteId ? { kind: 'ssh' as const, remoteId } : { kind: 'local' as const },
		};
	};
	const turns = createConversationTurns({
		userData,
		windows: deps.windowRegistry,
		exists: (target) => !!find(target),
		changed,
	});
	const statuses = new Map<string, FollowUpExternalStatus>();
	const commandListeners = new Set<(id: string, status: FollowUpExternalStatus) => void>();
	const pm = deps.getProcessManager();
	const activeDeliveries = new Map<string, string>();
	const spawned = (config: ProcessConfig) => {
		const marker = config.prompt?.match(/\[delivery:([^\]]+)\]/)?.[1];
		if (marker) {
			activeDeliveries.set(config.sessionId, marker);
			void turns.delivered(marker).catch((error) =>
				onError(error, {
					stage: 'delivered',
					deliveryId: marker,
					processId: config.sessionId,
				})
			);
		} else activeDeliveries.delete(config.sessionId);
	};
	pm?.on('spawn', spawned);
	const commandStart = (id: string) => {
		statuses.set(id, { state: 'running', observedAt: Date.now() });
		if (statuses.size > 500) {
			const oldest = [...statuses].find(([, value]) => value.state === 'completed');
			if (oldest) statuses.delete(oldest[0]);
		}
	};
	const output = (id: string, text: string) => {
		const previous = statuses.get(id);
		if (previous)
			statuses.set(id, {
				...previous,
				outputTail: ((previous.outputTail ?? '') + text).slice(-MAX_PERSISTED_TOOL_OUTPUT_CHARS),
			});
	};
	const exit = (id: string, code: number) => {
		const previous = statuses.get(id);
		if (!previous) return;
		const status: FollowUpExternalStatus = {
			...previous,
			state: 'completed',
			exitCode: code,
			observedAt: Date.now(),
		};
		statuses.set(id, status);
		for (const listener of commandListeners) listener(id, status);
	};
	pm?.on('command-start', commandStart);
	pm?.on('data', output);
	pm?.on('stderr', output);
	pm?.on('command-exit', exit);
	const followUps = createFollowUpStore({
		userData,
		onError,
		commands: {
			getStatus: (id) => statuses.get(id),
			subscribe: (listener) => {
				commandListeners.add(listener);
				return () => {
					commandListeners.delete(listener);
				};
			},
		},
	});
	const automation = createConversationAutomation({
		userData,
		resolve,
		turns,
		followUps,
		changed,
		onError,
		cancelAutomatic: (target) => {
			const id = `${target.sessionId}-ai-${target.tabId}`;
			if (activeDeliveries.has(id)) pm?.kill(id);
		},
		checks: createCheckRunner({ sshStore: createSshRemoteStoreAdapter(deps.settingsStore) }),
		snapshot: async (target) => {
			const scope = await resolve(target);
			const found = find(target)!;
			const remote =
				scope.host.kind === 'ssh'
					? (getSshRemoteConfig(createSshRemoteStoreAdapter(deps.settingsStore), {
							sessionSshConfig: found.session.sessionSshRemoteConfig,
						}).config ?? undefined)
					: undefined;
			if (scope.host.kind === 'ssh' && !remote) throw new Error('SSH remote cannot be resolved');
			const changes = await getGitChanges(
				scope.cwd,
				remote,
				scope.host.kind === 'ssh' ? scope.cwd : undefined
			);
			if (changes.timedOut || changes.truncated || changes.notARepo)
				throw new Error('Workspace evidence is unavailable');
			const head = await execGitReadOnly(
				['rev-parse', '--verify', 'HEAD'],
				scope.cwd,
				remote,
				scope.host.kind === 'ssh' ? scope.cwd : undefined
			);
			const revision = head.exitCode === 0 ? head.stdout.trim() : 'unborn';
			const hash = createHash('sha256').update(revision);
			for (const file of [...changes.files].sort((a, b) => a.path.localeCompare(b.path))) {
				const diff = await getGitChangeDiff(
					scope.cwd,
					file.path,
					remote,
					scope.host.kind === 'ssh' ? scope.cwd : undefined
				);
				if (diff.timedOut || diff.tooLarge || diff.binary)
					throw new Error('Workspace diff cannot be fingerprinted completely');
				hash.update(JSON.stringify([file.path, file.status, diff.diff]));
			}
			const fingerprint = hash.digest('hex');
			return { revision, fingerprint };
		},
	});
	const offFinished = onGitTurnFinished(
		(processId, delivery, scope) => {
			executionCwds.set(processId, scope.cwd);
			for (const session of sessions()) {
				const tab = session.aiTabs?.find(
					(tab: { id: string; logs?: { id: string; source: string }[] }) =>
						`${session.id}-ai-${tab.id}` === processId
				);
				if (!tab) continue;
				const target = { kind: 'conversation' as const, sessionId: session.id, tabId: tab.id };
				void automation
					.afterTurn(target, delivery.checkRunId, scope.changed, activeDeliveries.get(processId))
					.catch((error) =>
						onError(error, {
							stage: 'after-turn',
							target,
							deliveryId: activeDeliveries.get(processId),
						})
					);
				break;
			}
		},
		(processId) => automation.tracksTurn(processId)
	);
	const ownerWindow = (event: Electron.IpcMainInvokeEvent) =>
		deps.windowRegistry
			.getAppWindows()
			.find((entry) => entry.browserWindow.webContents === event.sender)?.id;
	ipcMain.handle(
		'conversationAutomation:execute',
		withIpcErrorLogging(
			{ context: 'ConversationAutomation', operation: 'execute' },
			async (request: AutomationRequest) => {
				try {
					return await automation.execute(request);
				} catch (error) {
					onError(error, {
						stage: 'execute',
						action: request.action,
						target: request.target,
						caller: request.caller,
					});
					throw error;
				}
			}
		)
	);
	ipcMain.handle(
		'conversationAutomation:list',
		withIpcErrorLogging({ context: 'ConversationAutomation', operation: 'list' }, () =>
			automation.list()
		)
	);
	ipcMain.handle('conversationAutomation:ready', async (event) => {
		const id = ownerWindow(event);
		if (!id) {
			logger.warn('Conversation ready signal has no registered window', 'ConversationAutomation', {
				stage: 'ready',
				webContentsId: event.sender.id,
			});
			return;
		}
		try {
			await turns.ready(id);
		} catch (error) {
			onError(error, { stage: 'ready', windowId: id });
			throw error;
		}
	});
	ipcMain.handle('conversationAutomation:ack', async (event, id: string, error?: string) => {
		const windowId = ownerWindow(event);
		if (!windowId) {
			logger.warn('Conversation receipt has no registered window', 'ConversationAutomation', {
				stage: 'ack',
				deliveryId: id,
				webContentsId: event.sender.id,
			});
			return;
		}
		try {
			await turns.acknowledge(id, windowId, error);
		} catch (failure) {
			onError(failure, { stage: 'ack', deliveryId: id, windowId });
			throw failure;
		}
	});
	void automation.start().catch((error) => onError(error, { stage: 'start' }));
	deps.app.once('will-quit', () => {
		automation.dispose();
		offFinished();
		pm?.off('spawn', spawned);
		pm?.off('command-start', commandStart);
		pm?.off('data', output);
		pm?.off('stderr', output);
		pm?.off('command-exit', exit);
	});
}
