import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTurnDispatcher, type SeatTurnRequest } from '../../../main/team/turn-dispatcher';
import type { SpawnHandlerDependencies } from '../../../main/ipc/handlers/process/handle-spawn';
import type { ProcessManager } from '../../../main/process-manager';
import { AGENT_LIVENESS_EVENTS } from '../../../main/utils/agent-liveness';
import { getTurnUsageLedgerSize } from '../../../shared/turnUsageLedger';
import { TEAM_TURN_PROMPTS } from '../../../shared/team/prompts';
import { teamTurnPermission } from '../../../shared/team/policy';
import { SEAT_ROLES, type TurnKind } from '../../../shared/team/types';

vi.mock('../../../main/ipc/handlers/process/handle-spawn', () => ({ handleProcessSpawn: vi.fn() }));
vi.mock('../../../main/power-manager', () => ({ powerManager: { removeBlockReason: vi.fn() } }));
import { handleProcessSpawn } from '../../../main/ipc/handlers/process/handle-spawn';

describe('team turn dispatcher', () => {
	let pm: EventEmitter & {
		get: ReturnType<typeof vi.fn>;
		kill: ReturnType<typeof vi.fn>;
		spawn: ReturnType<typeof vi.fn>;
	};
	let deps: SpawnHandlerDependencies;
	let request: SeatTurnRequest;
	const started = async () => {
		await vi.waitFor(() => expect(handleProcessSpawn).toHaveBeenCalled());
	};
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		pm = Object.assign(new EventEmitter(), {
			get: vi.fn(),
			kill: vi.fn(() => true),
			spawn: vi.fn(() => ({ pid: 42, success: true })),
		});
		deps = {
			getProcessManager: () => pm as unknown as ProcessManager,
			getAgentDetector: () => ({
				getAgent: vi.fn(async () => ({ id: 'codex', command: 'codex', args: [] })),
			}),
			getMainWindow: vi.fn(),
			agentConfigsStore: { get: () => ({}) },
			settingsStore: { get: vi.fn() },
			sessionsStore: { get: () => [] },
		} as unknown as SpawnHandlerDependencies;
		request = {
			teamId: 'team1',
			seat: 'dev',
			turn: 'work',
			dispatchId: 'turn1',
			tool: 'codex',
			permissionMode: 'full',
			cwd: '/fixture',
			prompt: 'Do work',
		};
		vi.mocked(handleProcessSpawn).mockImplementation(async (config, dependencies) =>
			dependencies.getProcessManager()!.spawn(config)
		);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it.each(
		SEAT_ROLES.flatMap((seat) =>
			([...Object.keys(TEAM_TURN_PROMPTS), 'report_repair'] as TurnKind[]).map((turn) => ({
				seat,
				turn,
			}))
		)
	)('enforces permissions for $seat $turn through native spawn', async ({ seat, turn }) => {
		const permissionMode = teamTurnPermission(seat, turn);
		const writing =
			(seat === 'dev' && ['work', 'fix'].includes(turn)) ||
			(seat === 'qa' && ['qa_prep', 'reverify'].includes(turn));
		expect(permissionMode).toBe(writing ? 'full' : 'readonly');
		const dispatcher = createTurnDispatcher(deps);
		await expect(
			dispatcher.dispatch({
				...request,
				seat,
				turn,
				permissionMode: writing ? 'readonly' : 'full',
			})
		).rejects.toThrow('turn policy');
		const pending = dispatcher.dispatch({ ...request, seat, turn, permissionMode });
		await started();
		expect(handleProcessSpawn).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: request.cwd, permissionMode }),
			expect.anything()
		);
		pm.emit('exit', `team-team1-${seat}-turn1`, 0);
		expect((await pending).failure).toBeUndefined();
	});

	it.each(SEAT_ROLES)(
		'refuses providers that cannot enforce a read-only %s discussion',
		async (seat) => {
			deps.getAgentDetector = () =>
				({
					getAgent: async () => ({ id: 'codex', readOnlyCliEnforced: false }),
				}) as never;
			const result = await createTurnDispatcher(deps).dispatch({
				...request,
				seat,
				turn: 'position',
				permissionMode: 'readonly',
			});
			expect(result.failure).toMatchObject({ kind: 'turn-failed' });
			expect(handleProcessSpawn).not.toHaveBeenCalled();
		}
	);

	it('classifies the real PM five-hour refusal and resolves its local reset clock', async () => {
		const turn = createTurnDispatcher(deps).dispatch({
			...request,
			tool: 'claude-code',
			seat: 'pm',
			turn: 'review',
			permissionMode: 'readonly',
		});
		await started();
		pm.emit('agent-error', 'team-team1-pm-turn1', {
			type: 'rate_limited',
			message: "You've hit your limit. resets 11:10pm",
			recoverable: true,
		});
		pm.emit('exit', 'team-team1-pm-turn1', 1);
		const outcome = await turn;
		expect(outcome.failure).toMatchObject({
			kind: 'model-unavailable',
			detail: expect.stringContaining('resets 11:10pm'),
		});
		expect(outcome.failure?.resetsAt).toBeGreaterThan(Date.now());
	});

	it('uses the full event-free spawn preparation and collects only its own normalized usage and final text', async () => {
		const onNativeSessionId = vi.fn();
		const turn = createTurnDispatcher(deps).dispatch({
			...request,
			onNativeSessionId,
			model: 'model',
			effort: 'high',
			nativeSessionId: 'native-old',
			customPath: 'custom',
			customArgs: '--flag',
			customEnv: { CODEX_HOME: '/isolated' },
			sshRemote: { enabled: true, remoteId: 'remote' },
		});
		await started();
		const [config, dependencies] = vi.mocked(handleProcessSpawn).mock.calls[0];
		expect(config).toMatchObject({
			sessionId: 'team-team1-dev-turn1',
			agentSessionId: 'native-old',
			permissionMode: 'full',
			sessionCustomModel: 'model',
			sessionCustomEffort: 'high',
			sessionCustomPath: 'custom',
			sessionCustomArgs: '--flag',
			sessionCustomEnvVars: { CODEX_HOME: '/isolated' },
			sessionSshRemoteConfig: { enabled: true, remoteId: 'remote' },
			querySource: 'auto',
		});
		expect(dependencies.getMainWindow()).toBeNull();
		expect(dependencies.interactiveReplayController).toBeUndefined();
		pm.emit('data', 'other', 'wrong');
		pm.emit('usage', 'other', { inputTokens: 999 });
		pm.emit('data', config.sessionId, 'final answer');
		pm.emit('session-id', config.sessionId, 'native-new');
		expect(onNativeSessionId).toHaveBeenCalledWith('native-new');
		pm.emit('usage', config.sessionId, { inputTokens: 10, outputTokens: 3, totalCostUsd: 0.1 });
		pm.emit('usage', config.sessionId, { inputTokens: 5, outputTokens: 2, totalCostUsd: 0.2 });
		pm.emit('exit', config.sessionId, 0);
		expect(await turn).toMatchObject({
			text: 'final answer',
			nativeSessionId: 'native-new',
			exitCode: 0,
			usage: { inputTokens: 15, outputTokens: 5, events: 2 },
			livenessEvents: 3,
		});
		expect(pm.eventNames()).toEqual([]);
		expect(getTurnUsageLedgerSize()).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(AGENT_LIVENESS_EVENTS)(
		'counts %s as liveness, then kills a silent process before reporting timeout',
		async (event) => {
			const turn = createTurnDispatcher(deps).dispatch(request);
			await started();
			await vi.advanceTimersByTimeAsync(9 * 60_000);
			pm.emit(event, 'team-team1-dev-turn1', event === 'usage' ? {} : 'activity');
			await vi.advanceTimersByTimeAsync(9 * 60_000);
			expect(pm.kill).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(60_000);
			const result = await turn;
			expect(pm.kill).toHaveBeenCalledWith(result.processId, { sync: true });
			expect(result).toMatchObject({ timedOut: 'idle', failure: { kind: 'turn-failed' } });
			expect(pm.eventNames()).toEqual([]);
		}
	);

	it('enforces the absolute watchdog even with regular tool activity', async () => {
		const turn = createTurnDispatcher(deps).dispatch(request);
		await started();
		for (let i = 0; i < 6; i++) {
			await vi.advanceTimersByTimeAsync(5 * 60_000);
			pm.emit('tool-execution', 'team-team1-dev-turn1', {});
		}
		expect(await turn).toMatchObject({ timedOut: 'maximum', failure: { kind: 'turn-failed' } });
	});

	it.each([
		['auth_expired', 'login-expired'],
		['session_not_found', 'session-broken'],
		['token_exhaustion', 'session-broken'],
		['rate_limited', 'model-unavailable'],
		['agent_crashed', 'turn-failed'],
	])('classifies %s as %s without choosing a recovery', async (type, kind) => {
		const turn = createTurnDispatcher(deps).dispatch(request);
		await started();
		pm.emit('agent-error', 'team-team1-dev-turn1', {
			type,
			message: 'provider error',
			recoverable: true,
			limitResetAt: 99999,
		});
		pm.emit('exit', 'team-team1-dev-turn1', 1);
		expect(await turn).toMatchObject({ failure: { kind, resetsAt: 99999 } });
		expect(handleProcessSpawn).toHaveBeenCalledTimes(1);
	});

	it('refuses Ultra and inconsistent seat permissions before any spawn', async () => {
		const dispatcher = createTurnDispatcher(deps);
		await expect(dispatcher.dispatch({ ...request, effort: 'ULTRA' })).rejects.toThrow('Ultra');
		await expect(dispatcher.dispatch({ ...request, seat: 'pm' })).rejects.toThrow('turn policy');
		expect(handleProcessSpawn).not.toHaveBeenCalled();
	});

	it('rejects duplicate dispatch ids during preparation', async () => {
		const dispatcher = createTurnDispatcher(deps);
		const first = dispatcher.dispatch(request);
		await expect(dispatcher.dispatch(request)).rejects.toThrow('already running');
		await started();
		pm.emit('exit', 'team-team1-dev-turn1', 0);
		await first;
	});

	it('refuses native resume preparation that moves the seat out of its workspace', async () => {
		vi.mocked(handleProcessSpawn).mockImplementation(async (config, dependencies) =>
			dependencies.getProcessManager()!.spawn({ ...config, cwd: '/another-workspace' })
		);
		expect(await createTurnDispatcher(deps).dispatch(request)).toMatchObject({
			failure: { kind: 'session-broken' },
		});
		expect(pm.spawn).not.toHaveBeenCalled();
	});

	it('allows PM reads but refuses custom permission overrides and inherited Ultra', async () => {
		const detector = {
			getAgent: async () => ({
				id: 'codex',
				command: 'codex',
				args: [],
				readOnlyArgs: ['--sandbox', 'read-only'],
				fullAccessArgs: ['--dangerously-bypass-approvals-and-sandbox'],
			}),
		};
		deps.getAgentDetector = () => detector as never;
		const dispatcher = createTurnDispatcher(deps);
		const turn = dispatcher.dispatch({ ...request, seat: 'pm', permissionMode: 'readonly' });
		await started();
		pm.emit('exit', 'team-team1-pm-turn1', 0);
		expect((await turn).failure).toBeUndefined();
		const failed = await dispatcher.dispatch({
			...request,
			seat: 'pm',
			permissionMode: 'readonly',
			customArgs: '--sandbox danger-full-access',
		});
		expect(failed.failure?.detail).toContain('read-only policy');
		const bypass = await dispatcher.dispatch({
			...request,
			seat: 'pm',
			permissionMode: 'readonly',
			customArgs: '--dangerously-bypass-approvals-and-sandbox',
		});
		expect(bypass.failure?.detail).toContain('read-only policy');
		deps.agentConfigsStore = { get: () => ({ codex: { reasoningEffort: 'ultra' } }) } as never;
		await expect(dispatcher.dispatch(request)).rejects.toThrow('Ultra');
	});

	it('does not launch after cancellation during async spawn preparation', async () => {
		let resume!: () => void;
		vi.mocked(handleProcessSpawn).mockImplementation(async (config, dependencies) => {
			await new Promise<void>((done) => {
				resume = done;
			});
			return dependencies.getProcessManager()!.spawn(config);
		});
		const controller = new AbortController();
		const turn = createTurnDispatcher(deps).dispatch({ ...request, signal: controller.signal });
		await started();
		controller.abort();
		expect(await turn).toMatchObject({ canceled: true });
		resume();
		await Promise.resolve();
		await Promise.resolve();
		expect(pm.spawn).not.toHaveBeenCalled();
		expect(pm.eventNames()).toEqual([]);
	});

	it('returns start failures and cleans listeners even when a prepared spawn throws', async () => {
		vi.mocked(handleProcessSpawn).mockRejectedValue(new Error('Cannot resolve SSH remote'));
		const turn = createTurnDispatcher(deps).dispatch(request);
		expect(await turn).toMatchObject({
			exitCode: null,
			failure: { kind: 'turn-failed', detail: 'Cannot resolve SSH remote' },
		});
		expect(pm.eventNames()).toEqual([]);
	});
});
