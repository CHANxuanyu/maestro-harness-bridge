import { projectSettingsKey } from '../../../../../shared/projectSettings';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { StdoutHandler } from '../../../../../main/process-manager/handlers/StdoutHandler';
import { StderrHandler } from '../../../../../main/process-manager/handlers/StderrHandler';
import { ExitHandler } from '../../../../../main/process-manager/handlers/ExitHandler';
import { setupDataListener } from '../../../../../main/process-listeners/data-listener';
import { setupErrorListener } from '../../../../../main/process-listeners/error-listener';
import { setupExitListener } from '../../../../../main/process-listeners/exit-listener';
import * as gitChanges from '../../../../../main/git-changes';
import { DataBufferManager } from '../../../../../main/process-manager/handlers/DataBufferManager';
import type { ManagedProcess } from '../../../../../main/process-manager/types';
import { ClaudeOutputParser } from '../../../../../main/parsers/claude-output-parser';
import { CodexOutputParser } from '../../../../../main/parsers/codex-output-parser';
import { useAgentToolExecutionListener } from '../../../../../renderer/hooks/agent/internal/useAgentToolExecutionListener';
import { useAgentErrorListener } from '../../../../../renderer/hooks/agent/internal/useAgentErrorListener';
import { useAgentDataListener } from '../../../../../renderer/hooks/agent/internal/useAgentDataListener';
import { useBatchedSessionUpdates } from '../../../../../renderer/hooks/session/useBatchedSessionUpdates';
import { foldTurnActivity } from '../../../../../renderer/components/TerminalOutput/utils/foldTurnActivity';
import { useDebouncedPersistence } from '../../../../../renderer/hooks/utils/useDebouncedPersistence';
import { TurnDeliveryBar } from '../../../../../renderer/components/TerminalOutput/components/TurnDeliveryBar';
import { TurnActivityFold } from '../../../../../renderer/components/TerminalOutput/components/TurnActivityFold';
import { mockTheme } from '../../../../helpers/mockTheme';
import { readableTextOn } from '../../../../../shared/colorContrast';
import { useAgentExitListener } from '../../../../../renderer/hooks/agent/internal/useAgentExitListener';
import { useSessionStore } from '../../../../../renderer/stores/sessionStore';
import {
	useRetryStore,
	noteDispatch,
	cancelRetry,
} from '../../../../../renderer/stores/retryStore';
import { useSettingsStore } from '../../../../../renderer/stores/settingsStore';
import { useNotificationStore } from '../../../../../renderer/stores/notificationStore';
import { DEFAULT_BATCH_STATE } from '../../../../../renderer/hooks/batch/batchReducer';
import type { Session, BatchRunState } from '../../../../../renderer/types';
import type { TurnDelivery } from '../../../../../shared/gitChangeTurns';
import { createMockSession } from '../../../../helpers/mockSession';
import { createMockAITab } from '../../../../helpers/mockTab';

vi.mock('../../../../../main/ipc/handlers/groupChat', () => ({ groupChatEmitters: {} }));
vi.mock('../../../../../main/utils/sentry', () => ({ captureMessage: vi.fn() }));
vi.mock('../../../../../main/agents/capability-snapshot', () => ({
	capabilitySnapshots: { markAuthRequired: vi.fn() },
}));

let mockIsWebDesktop = false;
vi.mock('../../../../../renderer/utils/runtimeContext', () => ({
	isWebDesktop: () => mockIsWebDesktop,
}));

let handler:
	| ((
			sessionId: string,
			code: number,
			signal?: number,
			interrupted?: boolean,
			delivery?: TurnDelivery,
			deliveryToken?: string
	  ) => Promise<void>)
	| undefined;
const mockUnsubscribe = vi.fn();

const mockProcess = {
	onData: vi.fn().mockReturnValue(mockUnsubscribe),
	onToolExecution: vi.fn().mockReturnValue(mockUnsubscribe),
	onAgentError: vi.fn().mockReturnValue(mockUnsubscribe),
	onAuthExpired: vi.fn().mockReturnValue(mockUnsubscribe),
	onTurnDelivery: vi.fn().mockReturnValue(mockUnsubscribe),
	onExit: vi.fn((h: any) => {
		handler = h;
		return mockUnsubscribe;
	}),
	getActiveProcesses: vi.fn().mockResolvedValue([]),
};

function makeRef(): {
	current: Map<string, { toolName: string; toolState?: any }>;
} {
	return { current: new Map() };
}

function makeDeps() {
	return {
		getBatchStateRef: { current: null },
		processQueuedItemRef: { current: null },
		addHistoryEntryRef: { current: null },
		spawnBackgroundSynopsisRef: { current: null },
		rightPanelRef: { current: null },
		batchedUpdater: {
			appendLog: vi.fn(),
			markDelivered: vi.fn(),
			markUnread: vi.fn(),
			updateUsage: vi.fn(),
			updateContextUsage: vi.fn(),
			updateCycleBytes: vi.fn(),
			updateCycleTokens: vi.fn(),
			flushNow: vi.fn(),
		},
		activeHiddenToolRef: makeRef(),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	useSettingsStore.setState(useSettingsStore.getInitialState(), true);
	useNotificationStore.setState(useNotificationStore.getInitialState(), true);
	useNotificationStore.getState().setOsNotifications(false);
	useSettingsStore.setState({ newShell: false });
	handler = undefined;
	mockIsWebDesktop = false;
	useRetryStore.setState({ retries: {}, outages: {} } as any);
	useSessionStore.setState({
		sessions: [],
		groups: [],
		activeSessionId: '',
		initialLoadComplete: false,
		removedWorktreePaths: new Set(),
	});
	(window as any).maestro = {
		...((window as any).maestro || {}),
		process: mockProcess,
		stats: {
			recordQuery: vi.fn().mockResolvedValue(undefined),
			recordResilience: vi.fn().mockResolvedValue(undefined),
		},
		logger: { log: vi.fn() },
	};
});

afterEach(async () => {
	cancelRetry('sess-1', 'tab-1');
	// Exit side effects are intentionally deferred; settle them before resetting stores.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
});

describe('useAgentExitListener', () => {
	it.each(['hanging', 'throwing'] as const)(
		'completes and drains a queued turn despite %s delivery capture, then settles Stop',
		async (mode) => {
			useSettingsStore.setState({ newShell: true });
			const capture = vi.spyOn(gitChanges, 'finishGitTurn').mockImplementation(() => {
				if (mode === 'throwing') throw new Error('capture failed');
				return new Promise(() => {});
			});
			try {
				const queued = {
					id: 'next',
					timestamp: 3,
					tabId: 'tab-1',
					type: 'message' as const,
					text: 'next question',
				};
				useSessionStore.setState({
					sessions: [
						createMockSession({
							id: 'sess-1',
							activeTabId: 'tab-1',
							state: 'busy',
							busySource: 'ai',
							executionQueue: [queued],
							aiTabs: [
								createMockAITab({
									id: 'tab-1',
									state: 'busy',
									logs: [
										{ id: 'user', source: 'user', timestamp: 1, text: 'first question' },
										{ id: 'answer', source: 'stdout', timestamp: 2, text: 'QUEUE_READY' },
									],
								}),
							],
						}),
					],
				});
				const dispatch = vi.fn().mockResolvedValue(undefined);
				const deps = { ...makeDeps(), processQueuedItemRef: { current: dispatch } };
				renderHook(() => useAgentExitListener(deps));
				const emitter = new EventEmitter();
				let completion: Promise<void> | undefined;
				setupExitListener(
					emitter as never,
					{
						powerManager: { removeBlockReason: vi.fn() },
						patterns: {},
						getWebServer: () => null,
						logger: { warn: vi.fn(), debug: vi.fn() },
						safeSend: (channel: string, ...args: Parameters<NonNullable<typeof handler>>) => {
							if (channel === 'process:exit') completion = handler!(...args);
						},
					} as unknown as Parameters<typeof setupExitListener>[1]
				);
				await act(async () => {
					emitter.emit('exit', 'sess-1-ai-tab-1', 0);
					await completion;
					await new Promise((resolve) => setTimeout(resolve, 0));
				});
				const session = useSessionStore.getState().sessions[0];
				expect(session.executionQueue).toEqual([]);
				expect(session.aiTabs[0].logs.map((entry) => entry.text)).toEqual([
					'first question',
					'QUEUE_READY',
					'next question',
				]);
				expect(session.aiTabs[0].logs[0].turnCompletion).toMatchObject({ status: 'completed' });
				expect(dispatch).toHaveBeenCalledExactlyOnceWith('sess-1', queued);
				await act(async () => {
					emitter.emit('exit', 'sess-1-ai-tab-1', 0, undefined, true);
					await completion;
				});
				const stopped = useSessionStore.getState().sessions[0];
				expect(stopped.aiTabs[0].state).toBe('idle');
				expect(stopped.aiTabs[0].logs.at(-1)?.turnCompletion).toMatchObject({ status: 'canceled' });
				expect(dispatch).toHaveBeenCalledTimes(1);
			} finally {
				capture.mockRestore();
			}
		}
	);

	it('attaches a fast delivery after the exit probe and never to the next queued turn', async () => {
		useSettingsStore.setState({ newShell: true });
		let release!: (value: []) => void;
		mockProcess.getActiveProcesses.mockReturnValueOnce(
			new Promise((resolve) => {
				release = resolve;
			})
		);
		useSessionStore.setState({
			sessions: [
				createMockSession({
					id: 'sess-1',
					activeTabId: 'tab-1',
					state: 'busy',
					busySource: 'ai',
					executionQueue: [
						{ id: 'next', timestamp: 3, tabId: 'tab-1', type: 'message', text: 'next question' },
					],
					aiTabs: [
						createMockAITab({
							id: 'tab-1',
							state: 'busy',
							logs: [
								{ id: 'user', source: 'user', timestamp: 1, text: 'first question' },
								{ id: 'answer', source: 'stdout', timestamp: 2, text: 'first answer' },
							],
						}),
					],
				}),
			],
		});
		const dispatch = vi.fn().mockResolvedValue(undefined);
		renderHook(() =>
			useAgentExitListener({ ...makeDeps(), processQueuedItemRef: { current: dispatch } })
		);
		const delivery = { files: 2, additions: 3, deletions: 1, paths: ['a', 'b'] };
		await act(async () => {
			const exiting = handler!('sess-1-ai-tab-1', 0, undefined, false, undefined, 'turn-token');
			const arriving = mockProcess.onTurnDelivery.mock.calls[0][0](
				'sess-1-ai-tab-1',
				'turn-token',
				delivery
			);
			release([]);
			await Promise.all([exiting, arriving]);
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		const logs = useSessionStore.getState().sessions[0].aiTabs[0].logs;
		expect(logs[0].turnCompletion?.delivery).toEqual(delivery);
		expect(logs.at(-1)?.turnCompletion).toBeUndefined();
		expect(dispatch).toHaveBeenCalledTimes(1);
	});

	it.each(['claude-code', 'codex'] as const)(
		'attaches late %s delivery only to its finished turn and restores the persisted bar',
		async (toolType) => {
			useSettingsStore.setState({ newShell: true, uiLanguage: 'en' });
			const queued = {
				id: 'next',
				timestamp: 3,
				tabId: 'tab-1',
				type: 'message' as const,
				text: 'next question',
			};
			useSessionStore.setState({
				sessionsReadOk: true,
				sessions: [
					createMockSession({
						id: 'sess-1',
						toolType,
						activeTabId: 'tab-1',
						state: 'busy',
						busySource: 'ai',
						executionQueue: [queued],
						aiTabs: [
							createMockAITab({
								id: 'tab-1',
								state: 'busy',
								logs: [
									{ id: 'user', source: 'user', timestamp: 1, text: 'write two files' },
									{ id: 'answer', source: 'stdout', timestamp: 2, text: 'DELIVERY_DONE' },
								],
							}),
							createMockAITab({
								id: 'other-tab',
								logs: [
									{
										id: 'other-user',
										source: 'user',
										timestamp: 1,
										text: 'another tab',
										turnCompletion: {
											status: 'completed',
											timestamp: 2,
											deliveryToken: 'turn-token',
										},
									},
								],
							}),
						],
					}),
				],
			});
			const saveAll = vi.fn().mockResolvedValue(true);
			const saveMany = vi.fn().mockResolvedValue(true);
			window.maestro.sessions = { ...window.maestro.sessions, setAll: saveAll, setMany: saveMany };
			const dispatch = vi.fn().mockResolvedValue(undefined);
			const deps = { ...makeDeps(), processQueuedItemRef: { current: dispatch } };
			const loaded = { current: true };
			const hook = renderHook(() => {
				useAgentExitListener(deps);
				return useDebouncedPersistence(loaded);
			});
			function Delivery() {
				const session = useSessionStore((state) => state.sessions[0]);
				const tab = session.aiTabs[0];
				const folded = foldTurnActivity(tab.logs, {
					newShell: true,
					keepLastTurnOpen: tab.state === 'busy',
				});
				return (
					<>
						{[...folded.deliveryByHostId].map(([id, footer]) => (
							<TurnDeliveryBar
								key={id}
								{...footer}
								sessionId={session.id}
								tabId={tab.id}
								textColor={mockTheme.colors.textMain}
							/>
						))}
					</>
				);
			}
			render(<Delivery />);
			await act(async () => {
				await handler!('sess-1-ai-tab-1', 0, undefined, false, undefined, 'turn-token');
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			expect(dispatch).toHaveBeenCalledExactlyOnceWith('sess-1', queued);
			await act(async () => {
				await handler!('sess-1-ai-tab-1', 0, undefined, false, undefined, 'next-token');
				await hook.result.current.flushNow();
			});
			const finished = useSessionStore.getState().sessions[0];
			expect(finished.aiTabs[0].state).toBe('idle');
			expect(finished.executionQueue).toEqual([]);
			expect(finished.aiTabs[0].logs[1].text).toBe('DELIVERY_DONE');
			expect(finished.aiTabs[0].logs.at(-1)?.turnCompletion?.deliveryToken).toBe('next-token');
			expect(screen.queryByTestId('turn-delivery')).not.toBeInTheDocument();
			expect(saveAll).toHaveBeenCalledTimes(1);
			const delivery = {
				files: 2,
				additions: 3,
				deletions: 0,
				paths: ['activity-a.txt', 'activity-b.txt'],
			};
			const arrive = mockProcess.onTurnDelivery.mock.calls[0][0];
			await act(async () => {
				await arrive('sess-1-ai-tab-1', 'unknown-token', delivery);
			});
			expect(useSessionStore.getState().sessions[0].aiTabs[0].logs).toEqual(
				finished.aiTabs[0].logs
			);
			await act(async () => {
				await arrive('sess-1-ai-tab-1', 'turn-token', delivery);
			});
			const session = useSessionStore.getState().sessions[0];
			expect(session.aiTabs[0].logs[0].turnCompletion?.delivery).toEqual(delivery);
			expect(session.aiTabs[0].logs.slice(1)).toEqual(finished.aiTabs[0].logs.slice(1));
			expect(session.aiTabs[1]).toBe(finished.aiTabs[1]);
			expect(screen.getAllByTestId('turn-delivery')).toHaveLength(1);
			expect(screen.getByTestId('turn-delivery')).toHaveAttribute('data-turn-id', 'user');
			expect(screen.getByTestId('turn-delivery')).toHaveTextContent('Changed 2 files · +3 -0');
			await act(async () => {
				await hook.result.current.flushNow();
			});
			expect(saveMany).toHaveBeenCalledTimes(1);
			const saved = JSON.parse(JSON.stringify(saveMany.mock.calls[0][0])) as Session[];
			expect(saved[0].aiTabs[0].logs[0].turnCompletion?.delivery).toEqual(delivery);
			hook.unmount();
			act(() => useSessionStore.setState({ sessions: saved }));
			expect(screen.getAllByTestId('turn-delivery')).toHaveLength(1);
			expect(screen.getByTestId('turn-delivery')).toHaveAttribute('data-turn-id', 'user');
			expect(screen.getByTestId('turn-delivery')).toHaveTextContent('Changed 2 files · +3 -0');
		}
	);

	it.each([
		{ provider: 'claude', reuseCall: true, retry: false },
		{ provider: 'codex', reuseCall: true, retry: false },
		{ provider: 'claude', reuseCall: false, retry: false },
		{ provider: 'codex', reuseCall: false, retry: false },
		{ provider: 'claude', reuseCall: true, retry: true },
		{ provider: 'codex', reuseCall: true, retry: true },
		{ provider: 'claude', reuseCall: false, retry: true },
		{ provider: 'codex', reuseCall: false, retry: true },
	])(
		'shows the fixture terminal error for $provider, reused call=$reuseCall, retry=$retry',
		async ({ provider, reuseCall, retry }) => {
			useSettingsStore.setState({ newShell: true, uiLanguage: 'en' });
			const toolType = provider === 'claude' ? 'claude-code' : 'codex';
			const reason = 'Activity fixture connection failed';
			const tab = createMockAITab({
				id: 'tab-1',
				state: 'busy',
				logs: [
					{ id: 'previous-user', timestamp: 1, source: 'user', text: 'Previous turn' },
					{
						id: 'tool-activity-4',
						timestamp: 2,
						source: 'tool',
						text: 'Bash',
						metadata: { toolState: { status: 'failed' } },
					},
					{ id: 'previous-answer', timestamp: 3, source: 'stdout', text: 'ACTIVITY_DONE' },
					{
						id: 'error-user',
						timestamp: 4,
						source: 'user',
						text: 'End this synthetic turn with an error',
					},
				],
			});
			useSessionStore.setState({
				sessions: [
					createMockSession({
						id: 'sess-1',
						toolType,
						state: 'busy',
						activeTabId: tab.id,
						aiTabs: [tab],
					}),
				],
			});
			// The native composer snapshots the dispatched prompt, enabling retry.
			// Without this the error listener takes its modal fallback instead.
			if (retry) {
				noteDispatch(
					'sess-1',
					{
						id: 'error-user',
						tabId: tab.id,
						type: 'message',
						text: tab.logs.at(-1)!.text,
						timestamp: 4,
					},
					{ conductorProfile: '', customAICommands: [], speckitCommands: [], openspecCommands: [] }
				);
			}
			const deps = makeDeps();
			renderHook(() => {
				const liveDeps = { ...deps, batchedUpdater: useBatchedSessionUpdates() };
				useAgentDataListener(liveDeps);
				useAgentToolExecutionListener();
				useAgentErrorListener({ ...liveDeps, pauseBatchOnErrorRef: { current: null } });
				useAgentExitListener(liveDeps);
			});
			const processId = 'sess-1-ai-tab-1';
			const emitter = new EventEmitter();
			const safeSend = vi.fn((channel: string, ...args: unknown[]) => {
				if (channel === 'process:data') mockProcess.onData.mock.calls[0][0](...args);
				if (channel === 'agent:error') mockProcess.onAgentError.mock.calls[0][0](...args);
				return true;
			});
			const { flushPendingData } = setupDataListener(
				emitter as never,
				{
					safeSend,
					getWebServer: () => null,
					outputBuffer: {},
					outputParser: {},
					debugLog: vi.fn(),
					patterns: {},
				} as unknown as Parameters<typeof setupDataListener>[1]
			);
			setupErrorListener(
				emitter as never,
				{ safeSend, logger: { info: vi.fn(), warn: vi.fn() } } as Parameters<
					typeof setupErrorListener
				>[1],
				flushPendingData
			);
			emitter.on('tool-execution', mockProcess.onToolExecution.mock.calls[0][0]);
			const proc = {
				sessionId: processId,
				toolType,
				cwd: '.',
				pid: 1,
				startTime: Date.now(),
				isStreamJsonMode: true,
				isBatchMode: true,
				isTerminal: false,
				jsonBuffer: '',
				stdoutBuffer: '',
				streamedText: '',
				resultEmitted: false,
				errorEmitted: false,
				outputParser: provider === 'claude' ? new ClaudeOutputParser() : new CodexOutputParser(),
			} as ManagedProcess;
			const processes = new Map([[processId, proc]]);
			const bufferManager = new DataBufferManager(processes, emitter);
			const stdout = new StdoutHandler({ processes, emitter, bufferManager });
			const stderr = new StderrHandler({ processes, emitter });
			const exit = new ExitHandler({ processes, emitter, bufferManager, stdoutHandler: stdout });
			let rendererExit: Promise<void> | undefined;
			emitter.on('exit', (...args: Parameters<NonNullable<typeof handler>>) => {
				rendererExit = handler!(...args);
			});
			const { createTurn } = createRequire(import.meta.url)(
				'../../../../../../e2e/fixtures/native/protocol.cjs'
			);
			await act(async () => {
				const turn = createTurn({
					provider,
					configDir: '.',
					cwd: '.',
					persist: false,
					prompt: tab.logs.at(-1)!.text,
					emit: (event: Record<string, unknown>) =>
						stdout.handleData(processId, `${JSON.stringify(event)}\n`),
				});
				// native-activity-bar uses the first turn's activity-4 again in its
				// error scene. Also cover a provider assigning a fresh native call id.
				const tool = {
					id: reuseCall ? 'activity-4' : 'error-tool',
					command: 'printf step-4',
					output: 'Exit code: 1\nExpected regression failure',
				};
				turn.startTool(tool);
				turn.finishTool(tool, 'failed');
				turn.fail(reason);
				// cli.cjs writes the same reason to stderr and exits 1, without Stop.
				stderr.handleData(processId, `${reason}\n`);
				await exit.handleExit(processId, 1);
				await rendererExit;
				const forwardedError = safeSend.mock.calls.find(
					([channel]) => channel === 'agent:error'
				)?.[2];
				expect(forwardedError).toMatchObject({
					type: 'network_error',
					sessionId: processId,
					raw:
						provider === 'codex' ? { errorLine: reason } : { stderr: `${reason}\n`, exitCode: 1 },
				});
			});
			const finished = useSessionStore.getState().sessions[0].aiTabs[0];
			expect(finished.state).toBe('idle');
			expect
				.soft(finished.logs.find((log) => log.id === 'error-user')?.turnCompletion)
				.toMatchObject({ status: 'error', reason });
			expect(finished.logs.filter((log) => log.source === 'tool')).toHaveLength(reuseCall ? 1 : 2);
			const folded = foldTurnActivity(finished.logs, { newShell: true, keepLastTurnOpen: false });
			const [hostId, activity] = [...folded.activityByHostId].at(-1)!;
			expect(activity).toMatchObject({ turnId: 'error-user', status: 'error', reason });
			expect(activity.failingStepId).toBe(reuseCall ? undefined : 'tool-error-tool');
			// Preserve the actionable error or retry card even if no tool belongs to
			// this turn. Never borrow the previous turn's failed step for its summary.
			const errorCard = finished.logs.find((log) =>
				retry ? !!log.retryOutageId : log.source === 'error'
			);
			expect(!!useRetryStore.getState().retries['sess-1:tab-1']).toBe(retry);
			expect(errorCard).toBeDefined();
			expect(folded.logs).toContain(errorCard);
			const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
			render(
				<TurnActivityFold
					hostId={hostId}
					index={0}
					activity={activity}
					open
					newShell
					onToggle={vi.fn()}
					theme={mockTheme}
					secondaryTextColor={mockTheme.colors.textDim}
				>
					{activity.entries.map((entry) => (
						<div key={entry.id} data-log-id={entry.id}>
							{entry.text}
						</div>
					))}
				</TurnActivityFold>
			);
			expect(
				screen.getByTestId('activity-collapsed').querySelector('[data-tool-status="error"]')
			).toHaveTextContent(reason);
			const expectedSummary = reuseCall ? `Failed: ${reason}` : `· 1 step · ${reason}`;
			if (!reuseCall)
				expect(screen.getByTestId('activity-collapsed').textContent).toMatch(/^Worked for /);
			expect(screen.getByTestId('activity-collapsed')).toHaveTextContent(expectedSummary);
			expect(screen.getByText(reuseCall ? `Failed: ${reason}` : reason)).toHaveStyle({
				color: readableTextOn(mockTheme.colors.error, [mockTheme.colors.bgMain]),
			});
			if (!reuseCall) {
				expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
				expect((scroll.mock.instances.at(-1) as HTMLElement).dataset.logId).toBe('tool-error-tool');
			}
			scroll.mockRestore();
		}
	);

	it.each([
		{
			name: 'earlier turn',
			errorTime: 1,
			errorSession: 'sess-1-ai-tab-1',
			code: 1,
			newShell: true,
			stopped: false,
			status: 'error',
			reason: 'exit code 1',
		},
		{
			name: 'another process',
			errorTime: 20,
			errorSession: 'sess-1-ai-tab-2',
			code: 1,
			newShell: true,
			stopped: false,
			status: 'error',
			reason: 'exit code 1',
		},
		{
			name: 'provider failure with exit 0',
			errorTime: 20,
			errorSession: 'sess-1-ai-tab-1',
			code: 0,
			newShell: true,
			stopped: false,
			status: 'error',
			reason: 'Provider disconnected',
		},
		{
			name: 'explicit stop',
			errorTime: 20,
			errorSession: 'sess-1-ai-tab-1',
			code: 1,
			newShell: true,
			stopped: true,
			status: 'canceled',
			reason: undefined,
		},
		{
			name: 'classic shell',
			errorTime: 20,
			errorSession: 'sess-1-ai-tab-1',
			code: 1,
			newShell: false,
			stopped: false,
			status: undefined,
			reason: undefined,
		},
	])(
		'scopes the retained provider error: $name',
		async ({ errorTime, errorSession, code, newShell, stopped, status, reason }) => {
			useSettingsStore.setState({ newShell, uiLanguage: 'en' });
			const tab = createMockAITab({
				id: 'tab-1',
				state: 'busy',
				logs: [{ id: 'user', timestamp: 10, source: 'user', text: 'Try this turn' }],
				agentError: {
					type: 'network_error',
					message: 'Connection failed',
					timestamp: errorTime,
					sessionId: errorSession,
					agentId: 'codex',
					recoverable: true,
					raw: { errorLine: 'Provider disconnected' },
				},
			});
			useSessionStore.setState({
				sessions: [
					createMockSession({ id: 'sess-1', activeTabId: tab.id, aiTabs: [tab], state: 'busy' }),
				],
			});
			renderHook(() => useAgentExitListener(makeDeps()));
			await act(async () => {
				await handler!('sess-1-ai-tab-1', code, undefined, stopped);
			});
			const completion = useSessionStore.getState().sessions[0].aiTabs[0].logs[0].turnCompletion;
			if (newShell) expect(completion).toMatchObject({ status, reason });
			else expect(completion).toBeUndefined();
		}
	);

	it.each([false, true])(
		'keeps other conversations and queues intact after a scoped Stop, own queue %s',
		async (ownQueue) => {
			useSettingsStore.setState({ newShell: true });
			const background = createMockAITab({
				id: 'right',
				state: 'busy',
				inputValue: 'draft',
				logs: [{ id: 'partial', timestamp: 1, source: 'ai', text: 'partial output' }],
			});
			const otherItem = {
				id: 'other',
				timestamp: 1,
				tabId: 'right',
				type: 'message' as const,
				text: 'other queued',
				readOnlyMode: true,
			};
			const ownItem = { ...otherItem, id: 'own', tabId: 'left', text: 'own queued' };
			const session = createMockSession({
				id: 'sess-1',
				state: 'busy',
				busySource: 'ai',
				aiTabs: [createMockAITab({ id: 'left', state: 'busy' }), background],
				activeTabId: 'right',
				executionQueue: ownQueue ? [otherItem, ownItem] : [otherItem],
			});
			useSessionStore.setState({ sessions: [session] });
			const processQueuedItem = vi.fn().mockResolvedValue(undefined);
			const deps = { ...makeDeps(), processQueuedItemRef: { current: processQueuedItem } };
			renderHook(() => useAgentExitListener(deps));
			await act(async () => {
				await handler!('sess-1-ai-left', 130, undefined, true);
			});
			expect(useSessionStore.getState().sessions[0].aiTabs[1]).toEqual(background);
			expect(useSessionStore.getState().sessions[0].executionQueue).toEqual([otherItem]);
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			if (ownQueue) expect(processQueuedItem).toHaveBeenCalledExactlyOnceWith('sess-1', ownItem);
			else expect(processQueuedItem).not.toHaveBeenCalled();
		}
	);

	it('skips terminal-tab format session ids', async () => {
		renderHook(() => useAgentExitListener(makeDeps()));
		await handler!('sess-1-terminal-tab-1', 0);
		expect(mockProcess.getActiveProcesses).not.toHaveBeenCalled();
	});

	it('skips batch session ids', async () => {
		renderHook(() => useAgentExitListener(makeDeps()));
		await handler!('sess-1-batch-tab-1', 0);
		expect(mockProcess.getActiveProcesses).not.toHaveBeenCalled();
	});

	it('transitions an exiting AI tab to idle', async () => {
		const tab = createMockAITab({
			id: 'tab-1',
			state: 'busy',
			thinkingStartTime: 0,
		});
		const session = createMockSession({
			id: 'sess-1',
			aiTabs: [tab],
			activeTabId: 'tab-1',
			state: 'busy',
		});
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentExitListener(makeDeps()));
		await act(async () => {
			await handler!('sess-1-ai-tab-1', 0);
		});

		const updated = useSessionStore.getState().sessions[0];
		expect(updated.aiTabs[0].state).toBe('idle');
		expect(updated.state).toBe('idle');
	});

	// 2026-10-12: a `--print` turn emits its whole reply on the final result, an
	// instant before exit, so the reply was still in the batch buffer when the
	// exit reducer appended the next queued message's card. The transcript then
	// read "next question, previous answer" and the running turn looked finished.
	it('lands the finished reply before the next queued message card', async () => {
		const tab = createMockAITab({
			id: 'tab-1',
			state: 'busy',
			thinkingStartTime: 0,
			logs: [{ id: 'u1', timestamp: 1, source: 'user', text: 'first question' }],
		});
		const session = createMockSession({
			id: 'sess-1',
			aiTabs: [tab],
			activeTabId: 'tab-1',
			state: 'busy',
			busySource: 'ai',
			executionQueue: [
				{ id: 'q-next', timestamp: 2, tabId: 'tab-1', type: 'message', text: 'second question' },
			] as any,
		});
		useSessionStore.setState({ sessions: [session] } as any);

		const deps = makeDeps();
		deps.processQueuedItemRef.current = vi.fn().mockResolvedValue(undefined) as any;
		// The buffered reply only reaches the store when the batch is flushed.
		let buffered = true;
		deps.batchedUpdater.flushNow.mockImplementation(() => {
			if (!buffered) return;
			buffered = false;
			useSessionStore.getState().setSessions((prev) =>
				prev.map((s) => ({
					...s,
					aiTabs: s.aiTabs.map((t) => ({
						...t,
						logs: [
							...t.logs,
							{ id: 'a1', timestamp: 3, source: 'stdout' as const, text: 'first answer' },
						],
					})),
				}))
			);
		});

		renderHook(() => useAgentExitListener(deps));
		await act(async () => {
			await handler!('sess-1-ai-tab-1', 0);
			await new Promise((r) => setTimeout(r, 0));
		});

		const logs = useSessionStore.getState().sessions[0].aiTabs[0].logs;
		expect(logs.map((l) => l.text)).toEqual(['first question', 'first answer', 'second question']);
		expect(logs[2].queuedItemId).toBe('q-next');
	});

	describe('on a web-desktop client', () => {
		// Every process:* event is fanned out to every connected browser, so a
		// web-desktop client must render the exit (tab idle) but never run the
		// one-shot effects the desktop renderer owns: stats row, queue dequeue,
		// synopsis (and with it the History entry), spoken notification.
		beforeEach(() => {
			mockIsWebDesktop = true;
		});

		it('flips the tab idle but records no stats row', async () => {
			const tab = createMockAITab({ id: 'tab-1', state: 'busy', thinkingStartTime: 0 });
			const session = createMockSession({
				id: 'sess-1',
				aiTabs: [tab],
				activeTabId: 'tab-1',
				state: 'busy',
				busySource: 'ai',
				thinkingStartTime: 1000,
			});
			useSessionStore.setState({ sessions: [session] } as any);

			renderHook(() => useAgentExitListener(makeDeps()));
			await act(async () => {
				await handler!('sess-1-ai-tab-1', 0);
				await new Promise((r) => setTimeout(r, 0));
			});

			const updated = useSessionStore.getState().sessions[0];
			expect(updated.aiTabs[0].state).toBe('idle');
			expect(updated.state).toBe('idle');
			expect((window as any).maestro.stats.recordQuery).not.toHaveBeenCalled();
		});

		it('leaves the execution queue intact and dispatches nothing', async () => {
			const tabA = createMockAITab({ id: 'tab-A', state: 'busy', thinkingStartTime: 0 });
			const tabB = createMockAITab({ id: 'tab-B', state: 'idle' });
			const itemB = {
				id: 'item-B',
				timestamp: 1,
				tabId: 'tab-B',
				type: 'message' as const,
				text: 'BRAVO',
				readOnlyMode: true,
			};
			const session = createMockSession({
				id: 'sess-1',
				aiTabs: [tabA, tabB],
				activeTabId: 'tab-A',
				state: 'busy',
				busySource: 'ai',
				executionQueue: [itemB] as any,
			});
			useSessionStore.setState({ sessions: [session] } as any);

			const processQueuedItem = vi.fn().mockResolvedValue(undefined);
			const deps = makeDeps();
			deps.processQueuedItemRef.current = processQueuedItem as any;

			renderHook(() => useAgentExitListener(deps));
			await act(async () => {
				await handler!('sess-1-ai-tab-A', 0);
				await new Promise((r) => setTimeout(r, 0));
			});

			const updated = useSessionStore.getState().sessions[0];
			expect(updated.aiTabs.find((t) => t.id === 'tab-A')?.state).toBe('idle');
			expect(updated.aiTabs.find((t) => t.id === 'tab-B')?.state).toBe('idle');
			expect(updated.executionQueue.map((i) => i.id)).toEqual(['item-B']);
			expect(updated.state).toBe('idle');
			expect(processQueuedItem).not.toHaveBeenCalled();
		});

		it('never spawns the exit synopsis', async () => {
			const tab = createMockAITab({
				id: 'tab-1',
				state: 'busy',
				thinkingStartTime: 0,
				agentSessionId: 'asid-1',
				logs: [
					{ id: 'l-user', timestamp: 1, source: 'user', text: 'do work' },
					{ id: 'l-tool', timestamp: 2, source: 'tool', text: 'Edit(file.ts)' },
					{ id: 'l-out', timestamp: 3, source: 'stdout', text: 'done' },
				] as any,
			});
			const session = createMockSession({
				id: 'sess-1',
				aiTabs: [tab],
				activeTabId: 'tab-1',
				state: 'busy',
				busySource: 'ai',
			});
			useSessionStore.setState({ sessions: [session] } as any);

			const spawn = vi.fn();
			const addHistory = vi.fn();
			const deps = makeDeps();
			deps.spawnBackgroundSynopsisRef.current = spawn as any;
			deps.addHistoryEntryRef.current = addHistory as any;

			renderHook(() => useAgentExitListener(deps));
			await act(async () => {
				await handler!('sess-1-ai-tab-1', 0);
				await new Promise((r) => setTimeout(r, 0));
			});

			expect(spawn).not.toHaveBeenCalled();
			expect(addHistory).not.toHaveBeenCalled();
		});
	});

	it('appends a system log on terminal exit', async () => {
		const session = createMockSession({ id: 'sess-1', shellLogs: [] });
		useSessionStore.setState({ sessions: [session] } as any);

		renderHook(() => useAgentExitListener(makeDeps()));
		await act(async () => {
			await handler!('sess-1-terminal', 1);
		});

		const updated = useSessionStore.getState().sessions[0];
		const log = updated.shellLogs[updated.shellLogs.length - 1];
		expect(log?.text).toContain('exited with code 1');
	});

	it('retires a finished orphan and dispatches the next queued item for ANOTHER tab exactly once', async () => {
		// Regression: A is a closed/orphaned tab whose turn just finished. B is a
		// second closed/orphaned tab with a queued read-only message; C is an open
		// tab with a queued read-only message. When A exits, the retire branch must
		// dequeue B's item (in lockstep with the post-reducer spawn) and mark B busy
		// - NOT leave it in the queue. Leaving it queued caused B to run twice (once
		// from queuedItemToProcess at A's exit, again when that run exited) and never
		// surface as busy in the UI.
		const orphanA = createMockAITab({ id: 'tab-A', state: 'busy', thinkingStartTime: 0 });
		const orphanB = createMockAITab({ id: 'tab-B', state: 'idle', agentSessionId: 'asid-B' });
		const tabC = createMockAITab({ id: 'tab-C', state: 'idle' });
		const itemB = {
			id: 'item-B',
			timestamp: 1,
			tabId: 'tab-B',
			type: 'message' as const,
			text: 'BRAVO',
			readOnlyMode: true,
		};
		const itemC = {
			id: 'item-C',
			timestamp: 2,
			tabId: 'tab-C',
			type: 'message' as const,
			text: 'CHARLIE',
			readOnlyMode: true,
		};
		const session = createMockSession({
			id: 'sess-1',
			aiTabs: [tabC],
			orphanedThinkingTabs: [orphanA, orphanB],
			activeTabId: 'tab-C',
			state: 'busy',
			busySource: 'ai',
			executionQueue: [itemB, itemC] as any,
		});
		useSessionStore.setState({ sessions: [session] } as any);

		const processQueuedItem = vi.fn().mockResolvedValue(undefined);
		const deps = makeDeps();
		deps.processQueuedItemRef.current = processQueuedItem as any;

		renderHook(() => useAgentExitListener(deps));
		await act(async () => {
			await handler!('sess-1-ai-tab-A', 0);
			// queued-item dispatch is fired on a setTimeout(0) after the reducer
			await new Promise((r) => setTimeout(r, 0));
		});

		const updated = useSessionStore.getState().sessions[0];
		// A retired; B promoted to busy and dequeued; C still queued.
		expect(updated.orphanedThinkingTabs?.map((t) => t.id)).toEqual(['tab-B']);
		expect(updated.orphanedThinkingTabs?.[0].state).toBe('busy');
		expect(updated.executionQueue.map((i) => i.id)).toEqual(['item-C']);
		expect(updated.state).toBe('busy');
		// Spawned exactly once, with B's item.
		expect(processQueuedItem).toHaveBeenCalledTimes(1);
		expect(processQueuedItem.mock.calls[0][1].id).toBe('item-B');
	});

	it('retires a finished orphan with no queued work and goes idle', async () => {
		const orphanA = createMockAITab({ id: 'tab-A', state: 'busy', thinkingStartTime: 0 });
		const session = createMockSession({
			id: 'sess-1',
			aiTabs: [createMockAITab({ id: 'tab-C', state: 'idle' })],
			orphanedThinkingTabs: [orphanA],
			activeTabId: 'tab-C',
			state: 'busy',
			busySource: 'ai',
			executionQueue: [],
		});
		useSessionStore.setState({ sessions: [session] } as any);

		const processQueuedItem = vi.fn().mockResolvedValue(undefined);
		const deps = makeDeps();
		deps.processQueuedItemRef.current = processQueuedItem as any;

		renderHook(() => useAgentExitListener(deps));
		await act(async () => {
			await handler!('sess-1-ai-tab-A', 0);
			await new Promise((r) => setTimeout(r, 0));
		});

		const updated = useSessionStore.getState().sessions[0];
		expect(updated.orphanedThinkingTabs).toBeUndefined();
		expect(updated.state).toBe('idle');
		expect(processQueuedItem).not.toHaveBeenCalled();
	});

	// Desktop document/spec-mode Auto Run synopsizes each task from this exit path,
	// which sets up the synopsis and dispatches it via runExitSynopsis (reaching
	// spawnBackgroundSynopsisRef), so the run-scoped model override must reach the
	// synopsis spawn config here for parity with the CLI batch processor.
	function setupSynopsisRun(opts: { sessionCustomModel?: string; runModelOverride?: string }) {
		const tab = createMockAITab({
			id: 'tab-1',
			state: 'busy',
			thinkingStartTime: 0,
			agentSessionId: 'asid-1',
			// Auto Run tabs opt into the exit-path synopsis via saveToHistory.
			saveToHistory: true,
			// Thinking on -> tool logs are recorded, so the activity gate trusts the
			// tool log below as evidence of meaningful work.
			showThinking: 'on',
			logs: [
				{ id: 'l-user', timestamp: 1, source: 'user', text: 'do the task' },
				{ id: 'l-tool', timestamp: 2, source: 'tool', text: 'Edit(file.ts)' },
			],
		} as any);
		const session = createMockSession({
			id: 'sess-1',
			aiTabs: [tab],
			activeTabId: 'tab-1',
			state: 'busy',
			customModel: opts.sessionCustomModel,
		});
		useSessionStore.setState({ sessions: [session] } as any);

		const spawn = vi.fn().mockResolvedValue({ success: false });
		const deps = makeDeps();
		deps.spawnBackgroundSynopsisRef.current = spawn as any;
		// runExitSynopsis bails before spawning unless a history-entry sink exists.
		deps.addHistoryEntryRef.current = vi.fn() as any;
		// The active run exposes its per-run model override via getBatchStateRef.
		const batchState: BatchRunState = {
			...DEFAULT_BATCH_STATE,
			isRunning: true,
			runModelOverride: opts.runModelOverride,
		};
		deps.getBatchStateRef.current = (() => batchState) as any;
		return { deps, spawn };
	}

	it.each(['codex', 'claude-code'] as const)(
		'does not request a synopsis after stopping %s without a final answer',
		async (toolType) => {
			const { deps, spawn } = setupSynopsisRun({});
			useSessionStore
				.getState()
				.setSessions((sessions) => sessions.map((session) => ({ ...session, toolType })));
			spawn.mockResolvedValue({
				success: false,
				error: 'No final answer is available for this turn',
			});
			renderHook(() => useAgentExitListener(deps));
			await act(async () => {
				await handler!('sess-1-ai-tab-1', 0, undefined, true);
			});
			expect(spawn).not.toHaveBeenCalled();
			expect(
				useNotificationStore.getState().toasts.some((toast) => toast.title === 'Synopsis failed')
			).toBe(false);
			expect(useSessionStore.getState().sessions[0].aiTabs[0].state).toBe('idle');
		}
	);

	it('drops a pending debounced synopsis when the next turn is stopped', async () => {
		const { deps, spawn } = setupSynopsisRun({});
		useSettingsStore.setState({ synopsisDebounceSeconds: 60 });
		const hook = renderHook(() => useAgentExitListener(deps));
		await act(async () => {
			await handler!('sess-1-ai-tab-1', 0);
		});
		expect(spawn).not.toHaveBeenCalled();
		await act(async () => {
			await handler!('sess-1-ai-tab-1', 0, undefined, true);
		});
		// Teardown flushes any pending timer immediately. It must find none.
		hook.unmount();
		expect(spawn).not.toHaveBeenCalled();
	});

	describe.each([false, true])('deliberate Stop notifications with newShell=%s', (newShell) => {
		it.each([
			{ viewing: true, code: 0 },
			{ viewing: true, code: 130 },
			{ viewing: false, code: 0 },
			{ viewing: false, code: 130 },
		])(
			'suppresses every completion channel with viewing=$viewing and code=$code',
			async ({ viewing, code }) => {
				useSettingsStore.setState({ newShell });
				const tab = createMockAITab({
					id: 'stopped',
					state: 'busy',
					thinkingStartTime: Date.now() - 100,
					logs: [
						{ id: 'u1', timestamp: 1, source: 'user', text: 'Previous question' },
						{ id: 'a1', timestamp: 2, source: 'stdout', text: 'Previous answer already finished.' },
						{ id: 'u2', timestamp: 3, source: 'user', text: 'Current interrupted question' },
					],
				});
				useSessionStore.setState({
					sessions: [
						createMockSession({
							id: 'sess-1',
							aiTabs: [tab, createMockAITab({ id: 'other', state: 'busy' })],
							activeTabId: viewing ? 'stopped' : 'other',
							state: 'busy',
						}),
					],
					activeSessionId: 'sess-1',
				});
				const show = vi.fn().mockResolvedValue(undefined);
				const speak = vi.fn().mockResolvedValue(undefined);
				window.maestro.notification.show = show;
				window.maestro.notification.speak = speak;
				useNotificationStore.getState().setOsNotifications(true);
				useNotificationStore.getState().setAudioFeedback(true, 'say');
				renderHook(() => useAgentExitListener(makeDeps()));
				await act(async () => {
					await handler!('sess-1-ai-stopped', code, undefined, true);
					await new Promise((resolve) => setTimeout(resolve, 0));
				});
				expect(useNotificationStore.getState().history).toHaveLength(0);
				expect(useNotificationStore.getState().toasts).toHaveLength(0);
				expect(show).not.toHaveBeenCalled();
				expect(speak).not.toHaveBeenCalled();
				expect(window.maestro.stats.recordQuery).toHaveBeenCalledTimes(1);

				// Stopping one conversation must not silence another conversation's completion.
				await act(async () => {
					await handler!('sess-1-ai-other', 0);
					await new Promise((resolve) => setTimeout(resolve, 0));
				});
				expect(useNotificationStore.getState().history).toEqual([
					expect.objectContaining({ sessionId: 'sess-1', tabId: 'other', type: 'success' }),
				]);
				expect(useNotificationStore.getState().toasts).toHaveLength(viewing ? 1 : 0);
				expect(show).toHaveBeenCalledTimes(viewing ? 1 : 0);
				expect(speak).toHaveBeenCalledTimes(1);
			}
		);
	});

	it('spawns the exit-path synopsis under the run model override, not the session model', async () => {
		const { deps, spawn } = setupSynopsisRun({
			sessionCustomModel: 'session-sonnet',
			runModelOverride: 'run-opus',
		});

		renderHook(() => useAgentExitListener(deps));
		await act(async () => {
			await handler!('sess-1-ai-tab-1', 0);
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(spawn).toHaveBeenCalledTimes(1);
		// 6th arg is the synopsis sessionConfig.
		const sessionConfig = spawn.mock.calls[0][5];
		expect(sessionConfig.customModel).toBe('run-opus');
	});

	it('falls back to the session model when the run has no model override', async () => {
		const { deps, spawn } = setupSynopsisRun({
			sessionCustomModel: 'session-sonnet',
			runModelOverride: undefined,
		});

		renderHook(() => useAgentExitListener(deps));
		await act(async () => {
			await handler!('sess-1-ai-tab-1', 0);
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(spawn).toHaveBeenCalledTimes(1);
		const sessionConfig = spawn.mock.calls[0][5];
		expect(sessionConfig.customModel).toBe('session-sonnet');
	});

	// Agent Resilience: the exiting turn failed and a resend is counting down.
	// The reducer must leave the queue alone. Draining it would fail every item
	// against the same provider, and the dispatch would supersede the pending
	// retry (noteDispatch), silently discarding the prompt that is waiting.
	it('holds the execution queue while a retry is counting down', async () => {
		const tab = createMockAITab({ id: 'tab-1', state: 'busy', thinkingStartTime: 0 });
		const queued = {
			id: 'item-1',
			timestamp: 1,
			tabId: 'tab-1',
			type: 'message' as const,
			text: 'QUEUED',
			readOnlyMode: true,
		};
		const session = createMockSession({
			id: 'sess-1',
			aiTabs: [tab],
			activeTabId: 'tab-1',
			state: 'busy',
			busySource: 'ai',
			executionQueue: [queued] as any,
		});
		useSessionStore.setState({ sessions: [session] } as any);
		useRetryStore.setState({
			retries: {
				'sess-1:tab-1': {
					sessionId: 'sess-1',
					tabId: 'tab-1',
					key: 'sess-1:tab-1',
					outageId: 'outage-1',
					strategy: { kind: 'fixed', delayMs: 60_000, maxAttempts: 5 },
					mode: 'auto',
					status: 'scheduled',
					attempt: 0,
					startedAt: 0,
					nextRetryAt: 60_000,
					lastMessage: 'overloaded',
				},
			},
		} as any);

		const processQueuedItem = vi.fn().mockResolvedValue(undefined);
		const deps = makeDeps();
		deps.processQueuedItemRef.current = processQueuedItem as any;

		renderHook(() => useAgentExitListener(deps));
		await act(async () => {
			await handler!('sess-1-ai-tab-1', 1);
			await new Promise((r) => setTimeout(r, 0));
		});

		const updated = useSessionStore.getState().sessions[0];
		expect(updated.executionQueue.map((i) => i.id)).toEqual(['item-1']);
		expect(updated.aiTabs[0].state).toBe('idle');
		expect(processQueuedItem).not.toHaveBeenCalled();
	});

	// A failed attempt is not a completed turn. Each attempt of an outage used to
	// raise a green "success" toast quoting whatever the dying turn printed last,
	// so the user was told the work was done three times while it had not run.
	it.each([
		['raises no completion toast while a retry is counting down', true, 0],
		['raises the completion toast once no retry is pending', false, 1],
	])('%s', async (_name, retryPending, expectedToasts) => {
		const tab = createMockAITab({
			id: 'tab-1',
			state: 'busy',
			thinkingStartTime: 0,
			logs: [
				{ id: 'u', timestamp: 1, source: 'user', text: 'do the thing' },
				{ id: 'a', timestamp: 2, source: 'stdout', text: 'Halfway there before it died.' },
			],
		});
		const session = createMockSession({
			id: 'sess-1',
			aiTabs: [tab],
			activeTabId: 'tab-1',
			state: 'busy',
			busySource: 'ai',
			executionQueue: [],
		});
		useSessionStore.setState({ sessions: [session] } as any);
		useNotificationStore.setState({ toasts: [] } as any);
		if (retryPending) {
			useRetryStore.setState({
				retries: {
					'sess-1:tab-1': {
						sessionId: 'sess-1',
						tabId: 'tab-1',
						key: 'sess-1:tab-1',
						outageId: 'outage-1',
						mode: 'resend',
						status: 'scheduled',
						attempt: 0,
						startedAt: 0,
						nextRetryAt: 60_000,
						lastMessage: 'Your workspace is out of credits.',
					},
				},
			} as any);
		}

		renderHook(() => useAgentExitListener(makeDeps()));
		await act(async () => {
			await handler!('sess-1-ai-tab-1', 1);
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(useNotificationStore.getState().toasts).toHaveLength(expectedToasts);
		expect(useNotificationStore.getState().history).toHaveLength(expectedToasts);
	});

	it('drains the queue normally once the retry has settled', async () => {
		// Same shape as above with no retry entry: proves the hold is the retry's
		// doing, not the exit code or the read-only flag.
		const tab = createMockAITab({ id: 'tab-1', state: 'busy', thinkingStartTime: 0 });
		const queued = {
			id: 'item-1',
			timestamp: 1,
			tabId: 'tab-1',
			type: 'message' as const,
			text: 'QUEUED',
			readOnlyMode: true,
		};
		const session = createMockSession({
			id: 'sess-1',
			aiTabs: [tab],
			activeTabId: 'tab-1',
			state: 'busy',
			busySource: 'ai',
			executionQueue: [queued] as any,
		});
		useSessionStore.setState({ sessions: [session] } as any);

		const processQueuedItem = vi.fn().mockResolvedValue(undefined);
		const deps = makeDeps();
		deps.processQueuedItemRef.current = processQueuedItem as any;

		renderHook(() => useAgentExitListener(deps));
		await act(async () => {
			await handler!('sess-1-ai-tab-1', 1);
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(useSessionStore.getState().sessions[0].executionQueue).toEqual([]);
		expect(processQueuedItem).toHaveBeenCalledTimes(1);
	});

	it('deletes activeHiddenToolRef entry on AI exit', async () => {
		const tab = createMockAITab({ id: 'tab-1', state: 'busy' });
		const session = createMockSession({
			id: 'sess-1',
			aiTabs: [tab],
			activeTabId: 'tab-1',
		});
		useSessionStore.setState({ sessions: [session] } as any);

		const deps = makeDeps();
		deps.activeHiddenToolRef.current.set('sess-1:tab-1', { toolName: 'Read' });

		renderHook(() => useAgentExitListener(deps));
		await act(async () => {
			await handler!('sess-1-ai-tab-1', 0);
		});

		expect(deps.activeHiddenToolRef.current.has('sess-1:tab-1')).toBe(false);
	});
	it.each([true, false])(
		'records a final completion with viewing=%s while retaining popup/audio defaults',
		async (viewing) => {
			const tab = createMockAITab({
				id: 'tab-1',
				state: 'busy',
				thinkingStartTime: Date.now() - 100,
				logs: [],
			});
			useSessionStore.setState({
				sessions: [
					createMockSession({ id: 'sess-1', aiTabs: [tab], activeTabId: 'tab-1', state: 'busy' }),
				],
				activeSessionId: viewing ? 'sess-1' : '',
			});
			const speak = vi.fn().mockResolvedValue(undefined);
			window.maestro.notification.speak = speak;
			useNotificationStore.getState().setAudioFeedback(true, 'say');
			renderHook(() => useAgentExitListener(makeDeps()));
			await act(async () => {
				await handler!('sess-1-ai-tab-1', 0);
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			expect(useNotificationStore.getState().history).toHaveLength(1);
			expect(useNotificationStore.getState().toasts).toHaveLength(viewing ? 0 : 1);
			expect(speak).toHaveBeenCalledTimes(1);
		}
	);

	it.each([false, true])(
		'records intermediate queued replies only when opted in (%s)',
		async (enabled) => {
			useSettingsStore.setState({ notificationHistoryQueuedReplies: enabled });
			const tab = createMockAITab({
				id: 'tab-1',
				state: 'busy',
				thinkingStartTime: Date.now() - 100,
				logs: [],
			});
			const queued = {
				id: 'next',
				timestamp: 1,
				tabId: 'tab-1',
				type: 'message' as const,
				text: 'Next',
				readOnlyMode: true,
			};
			useSessionStore.setState({
				sessions: [
					createMockSession({
						id: 'sess-1',
						aiTabs: [tab],
						activeTabId: 'tab-1',
						state: 'busy',
						executionQueue: [queued],
					}),
				],
			});
			const dispatch = vi.fn().mockResolvedValue(undefined);
			const deps = makeDeps();
			deps.processQueuedItemRef.current = dispatch as never;
			renderHook(() => useAgentExitListener(deps));
			await act(async () => {
				await handler!('sess-1-ai-tab-1', 0);
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			expect(dispatch).toHaveBeenCalledTimes(1);
			expect(useNotificationStore.getState().history).toHaveLength(enabled ? 1 : 0);
			expect(useNotificationStore.getState().toasts).toHaveLength(0);
		}
	);
});

it('hands off one failed user turn once after exit and leaves a source link', async () => {
	const error = {
		type: 'rate_limited' as const,
		message: 'quota',
		timestamp: 2,
		agentId: 'claude-code',
		recoverable: true,
	};
	const tab = createMockAITab({
		id: 'tab-1',
		state: 'busy',
		agentError: error,
		logs: [{ id: 'turn-1', source: 'user', timestamp: 1, text: 'Failed request' }],
	});
	const source = createMockSession({
		id: 'sess-1',
		cwd: '/tmp/project',
		projectRoot: '/tmp/project',
		activeTabId: tab.id,
		aiTabs: [tab],
		state: 'error',
		agentError: error,
	});
	const target = createMockSession({
		id: 'target',
		toolType: 'codex',
		cwd: source.cwd,
		projectRoot: source.projectRoot,
	});
	useSessionStore.setState({ sessions: [source, target] });
	useSettingsStore.setState({
		newShell: true,
		projectSettings: {
			[projectSettingsKey({ projectPath: source.cwd })]: { autoHandoffTarget: target.id },
		},
	});
	const handoff = vi.fn().mockResolvedValue({
		success: true,
		state: 'queued',
		agentId: target.id,
		tabId: 'recipient',
		targetAccount: '/tmp/work-account',
	});
	window.maestro.context.handoff = handoff;
	vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(true);
	renderHook(() => useAgentExitListener(makeDeps()));
	await act(async () => {
		await handler!('sess-1-ai-tab-1', 1);
	});
	await act(async () => {
		await handler!('sess-1-ai-tab-1', 1);
	});
	expect(handoff).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({
			targetConfigId: 'target',
			automaticTurnId: 'turn-1',
			send: true,
			background: true,
		})
	);
	expect(useSessionStore.getState().sessions[0].aiTabs[0].logs).toContainEqual(
		expect.objectContaining({
			autoHandoff: { sessionId: 'target', tabId: 'recipient' },
			text: expect.stringContaining('/tmp/work-account'),
		})
	);
});
