import { randomUUID } from 'crypto';
import type { SeatModel, SeatRole, MemberFaultKind, TurnKind } from '../../shared/team/types';
import { teamTurnPermission } from '../../shared/team/policy';
import type { AgentError, AgentSshRemoteConfig, UsageStats } from '../../shared/types';
import { DURATION_MS } from '../../shared/duration';
import { recordTurnUsage, drainTurnUsage, type TurnUsage } from '../../shared/turnUsageLedger';
import { tokenExhaustionResetAt, classifyRetryableError } from '../../shared/retryClassification';
import type { SpawnHandlerDependencies } from '../ipc/handlers/process/handle-spawn';
import type { ProcessConfig } from '../process-manager/types';
import { AGENT_LIVENESS_EVENTS } from '../utils/agent-liveness';
import { createIdleWatchdog } from '../utils/idle-watchdog';
import { beginSleepAwareSpan, sleepAwareElapsedMs } from '../utils/sleep-tracker';
import { getErrorPatterns, matchErrorPattern } from '../parsers/error-patterns';
import { killProcessTreeNow } from '../utils/processTree';
import { powerManager } from '../power-manager';
import { normalizeWorktreePath } from '../../shared/worktreePaths';
import { applyAgentConfigOverrides } from '../utils/agent-args';
import {
	appendToGroupChatBuffer,
	getGroupChatBufferedOutput,
	clearGroupChatBuffer,
	isGroupChatBufferTruncated,
} from '../group-chat/output-buffer';

export interface SeatTurnRequest extends SeatModel {
	teamId: string;
	seat: SeatRole;
	turn: TurnKind;
	dispatchId?: string;
	permissionMode: 'readonly' | 'full';
	cwd: string;
	nativeSessionId?: string;
	prompt: string;
	sshRemote?: AgentSshRemoteConfig;
	customPath?: string;
	customArgs?: string;
	customEnv?: Record<string, string>;
	signal?: AbortSignal;
	/** Persist native identity as soon as it exists, including before a forced quit. */
	onNativeSessionId?: (id: string) => void;
}

export interface SeatTurnResult {
	processId: string;
	dispatchId: string;
	text: string;
	truncated: boolean;
	nativeSessionId?: string;
	usage: TurnUsage | null;
	exitCode: number | null;
	durationMs: number;
	lastActivityAt: number;
	livenessEvents: number;
	timedOut?: 'idle' | 'maximum';
	canceled: boolean;
	failure?: { kind: MemberFaultKind; detail: string; resetsAt?: number };
}

const activeDispatches = new Set<string>();

/** Execute one native turn. Scheduling, retries and report validation belong to the caller. */
export function createTurnDispatcher(deps: SpawnHandlerDependencies) {
	return {
		async dispatch(input: SeatTurnRequest): Promise<SeatTurnResult> {
			if (!input.prompt.trim()) throw new Error('A seat turn requires a prompt');
			const configuredEffort =
				input.effort || deps.agentConfigsStore.get('configs', {})[input.tool]?.reasoningEffort;
			if (input.tool === 'codex' && configuredEffort?.trim().toLowerCase() === 'ultra')
				throw new Error('Codex Ultra is not allowed for team seats');
			if (input.tool === 'terminal') throw new Error('A team seat requires a provider');
			if (input.permissionMode !== teamTurnPermission(input.seat, input.turn))
				throw new Error(
					`Permission mode conflicts with the ${input.seat} ${input.turn} turn policy`
				);
			const pm = deps.getProcessManager();
			if (!pm) throw new Error('Process manager unavailable');
			const dispatchId = input.dispatchId ?? randomUUID();
			const processId = `team-${input.teamId}-${input.seat}-${dispatchId}`;
			if (activeDispatches.has(processId) || pm.get(processId))
				throw new Error('Dispatch is already running');
			activeDispatches.add(processId);
			const span = beginSleepAwareSpan();
			let lastActivityAt = Date.now();
			let livenessEvents = 0;
			let nativeSessionId = input.nativeSessionId;
			let agentError: AgentError | undefined;
			let timedOut: SeatTurnResult['timedOut'];
			let canceled = false;
			let settled = false;
			let resolve!: (result: SeatTurnResult) => void;
			const result = new Promise<SeatTurnResult>((done) => {
				resolve = done;
			});
			const classify = (error: AgentError): NonNullable<SeatTurnResult['failure']> => {
				let kind: MemberFaultKind = 'turn-failed';
				if (error.type === 'auth_expired') kind = 'login-expired';
				else if (error.type === 'session_not_found' || error.type === 'token_exhaustion')
					kind = 'session-broken';
				else if (
					error.type === 'rate_limited' ||
					classifyRetryableError(error) === 'token-exhaustion'
				)
					kind = 'model-unavailable';
				const resetsAt = error.limitResetAt ?? tokenExhaustionResetAt(error, Date.now());
				if (resetsAt && classifyRetryableError(error) === 'availability')
					kind = 'model-unavailable';
				return { kind, detail: error.message, ...(resetsAt ? { resetsAt } : {}) };
			};
			const finish = (exitCode: number | null, detail?: string) => {
				if (settled) return;
				settled = true;
				activeDispatches.delete(processId);
				powerManager.removeBlockReason(`session:${processId}`);
				watchdog.disarm();
				for (const event of AGENT_LIVENESS_EVENTS) pm.off(event, onLife);
				pm.off('data', onData);
				pm.off('usage', onUsage);
				pm.off('session-id', onSession);
				pm.off('agent-error', onError);
				pm.off('exit', onExit);
				input.signal?.removeEventListener('abort', onAbort);
				const text = getGroupChatBufferedOutput(processId) ?? '';
				const truncated = isGroupChatBufferTruncated(processId);
				clearGroupChatBuffer(processId);
				resolve({
					processId,
					dispatchId,
					text,
					truncated,
					nativeSessionId,
					usage: drainTurnUsage(processId),
					exitCode,
					durationMs: sleepAwareElapsedMs(span),
					lastActivityAt,
					livenessEvents,
					timedOut,
					canceled,
					failure: agentError
						? classify(agentError)
						: detail || exitCode !== 0
							? { kind: 'turn-failed', detail: detail ?? `Provider exited with code ${exitCode}` }
							: undefined,
				});
			};
			const terminate = (detail: string) => {
				// ProcessManager owns remote signalling and provider-specific teardown.
				// Kill before publishing the failure, even if kill emits exit synchronously.
				const process = pm.get(processId);
				if (process?.childProcess?.pid && !process.sshRemoteId)
					killProcessTreeNow(process.childProcess.pid, { sessionId: processId });
				pm.kill(processId, { sync: true });
				finish(null, detail);
			};
			const watchdog = createIdleWatchdog({
				idleMs: 10 * DURATION_MS.minute,
				maxMs: 30 * DURATION_MS.minute,
				onIdle: () => {
					timedOut = 'idle';
					terminate('Provider was silent for 10 minutes');
				},
				onMax: () => {
					timedOut = 'maximum';
					terminate('Provider exceeded 30 minutes');
				},
			});
			const onLife = (id: string) => {
				if (id !== processId) return;
				lastActivityAt = Date.now();
				livenessEvents++;
				watchdog.touch();
			};
			const onData = (id: string, text: string) => {
				if (id === processId) appendToGroupChatBuffer(id, text);
			};
			const onUsage = (id: string, usage: UsageStats) => {
				if (id === processId) recordTurnUsage(id, usage);
			};
			const onSession = (id: string, nativeId: string) => {
				if (id === processId) {
					nativeSessionId = nativeId;
					input.onNativeSessionId?.(nativeId);
				}
			};
			const onError = (id: string, error: AgentError) => {
				if (id === processId) agentError = error;
			};
			const onExit = (id: string, code: number, signal?: number, interrupted?: boolean) => {
				if (id !== processId) return;
				canceled ||= !!interrupted && !timedOut;
				finish(
					code,
					timedOut
						? `Provider timed out (${timedOut})`
						: canceled
							? 'Provider canceled'
							: signal
								? `Provider terminated by signal ${signal}`
								: undefined
				);
			};
			const onAbort = () => {
				canceled = true;
				terminate('Provider canceled');
			};
			for (const event of AGENT_LIVENESS_EVENTS) pm.on(event, onLife);
			pm.on('data', onData);
			pm.on('usage', onUsage);
			pm.on('session-id', onSession);
			pm.on('agent-error', onError);
			pm.on('exit', onExit);
			input.signal?.addEventListener('abort', onAbort, { once: true });
			if (input.signal?.aborted) onAbort();
			// Preparation is asynchronous. Guard the final spawn as well, so a
			// timeout or cancellation during discovery cannot launch an orphan later.
			const guarded = new Proxy(pm, {
				get(target, property, receiver) {
					if (property === 'spawn')
						return (config: ProcessConfig) => {
							if (settled) throw new Error('Dispatch ended during spawn preparation');
							if (
								!input.sshRemote?.enabled &&
								normalizeWorktreePath(config.cwd) !== normalizeWorktreePath(input.cwd)
							) {
								agentError = {
									type: 'session_not_found',
									message: 'Native session belongs to a different seat workspace',
									agentId: input.tool,
									recoverable: false,
									timestamp: Date.now(),
								};
								throw new Error(agentError.message);
							}
							return target.spawn(config);
						};
					return Reflect.get(target, property, receiver);
				},
			});
			void (async () => {
				if (settled) return;
				const agent = await deps.getAgentDetector()?.getAgent(input.tool);
				if (!agent) throw new Error(`Unknown provider: ${input.tool}`);
				if (input.permissionMode === 'readonly') {
					if (agent.readOnlyCliEnforced === false)
						throw new Error('This provider cannot enforce the turn read-only policy');
					const overrides = {
						agentConfigValues: deps.agentConfigsStore.get('configs', {})[input.tool] ?? {},
						sessionCustomArgs: input.customArgs,
						sessionCustomModel: input.model,
						sessionCustomEffort: input.effort,
					};
					const configured = applyAgentConfigOverrides(agent, [], overrides).args;
					const pinned = applyAgentConfigOverrides(agent, [], {
						...overrides,
						readOnlyMode: true,
					}).args;
					const writeFlags = new Set(
						(agent.fullAccessArgs ?? agent.yoloModeArgs ?? []).filter((arg) => arg.startsWith('-'))
					);
					if (
						configured.length !== pinned.length ||
						configured.some((arg) => writeFlags.has(arg.split('=')[0]))
					)
						throw new Error('Provider configuration conflicts with the turn read-only policy');
				}
				const { handleProcessSpawn } = await import('../ipc/handlers/process/handle-spawn');
				if (settled) return;
				const spawned = await handleProcessSpawn(
					{
						sessionId: processId,
						toolType: input.tool,
						command: agent.path ?? agent.command,
						args: agent.args,
						cwd: input.cwd,
						prompt: input.prompt,
						agentSessionId: input.nativeSessionId,
						permissionMode: input.permissionMode,
						sessionCustomModel: input.model,
						sessionCustomEffort: input.effort,
						sessionCustomPath: input.customPath,
						sessionCustomArgs: input.customArgs,
						sessionCustomEnvVars: input.customEnv,
						sessionSshRemoteConfig: input.sshRemote,
						querySource: 'auto',
						maestroPMaxWaitSeconds: (10 * DURATION_MS.minute) / DURATION_MS.second,
					},
					{
						...deps,
						getProcessManager: () => guarded,
						getMainWindow: () => null,
						getPermissionWindow: () => null,
						safeSend: undefined,
						interactiveReplayController: undefined,
					}
				);
				if (!spawned.success) finish(null, 'Provider could not start');
				if (settled) powerManager.removeBlockReason(`session:${processId}`);
			})().catch((error: unknown) => {
				const detail = error instanceof Error ? error.message : String(error);
				const matched = matchErrorPattern(getErrorPatterns(input.tool), detail);
				if (matched) agentError = { ...matched, agentId: input.tool, timestamp: Date.now() };
				if (pm.get(processId)) terminate(detail);
				else finish(null, detail);
			});
			return result;
		},
	};
}
