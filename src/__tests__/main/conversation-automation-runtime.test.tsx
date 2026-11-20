import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { registerConversationAutomation } from '../../main/conversation-automation-runtime';
import { createConversationAutomationApi } from '../../main/preload/conversationAutomation';
import { useConversationAutomation } from '../../renderer/hooks/agent/useConversationAutomation';
import { useSessionStore } from '../../renderer/stores/sessionStore';
import { useConversationAutomationStore } from '../../renderer/stores/conversationAutomationStore';
import { createMockSession, createMockAITab } from '../helpers';
import { beginGitTurn, finishGitTurn } from '../../main/git-changes';
import { WindowRegistry } from '../../main/window-registry';
import { WindowProvider } from '../../renderer/contexts/WindowContext';
import { logger } from '../../main/utils/logger';
import type { IpcBootstrapDependencies } from '../../main/ipc/bootstrap/types';
import type {
	AutomationAction,
	ConversationAutomationState,
} from '../../shared/conversationAutomation';

const ipc = vi.hoisted(() => ({
	handlers: new Map<string, (...args: any[]) => any>(),
	sender: {} as object,
	renderer: undefined as EventEmitter | undefined,
}));
vi.mock('electron', () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: any[]) => any) =>
			ipc.handlers.set(channel, handler),
	},
	ipcRenderer: {
		invoke: (channel: string, ...args: unknown[]) =>
			ipc.handlers.get(channel)!({ sender: ipc.sender }, ...args),
		on: (channel: string, listener: (...args: any[]) => void) =>
			ipc.renderer!.on(channel, listener),
		removeListener: (channel: string, listener: (...args: any[]) => void) =>
			ipc.renderer!.removeListener(channel, listener),
	},
}));
vi.mock('../../main/process-manager', () => ({ ProcessManager: class {} }));
vi.mock('../../main/utils/sentry', () => ({ captureException: vi.fn() }));
vi.mock('../../renderer/utils/sentry', () => ({ captureException: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
	<WindowProvider>{children}</WindowProvider>
);

describe('conversation automation production wiring', () => {
	let root: string;
	let project: string;
	let app: EventEmitter;
	let pm: EventEmitter;
	let send: ReturnType<typeof vi.fn>;
	let windows: WindowRegistry;
	const target = { kind: 'conversation' as const, sessionId: 'agent', tabId: 'exact' };
	const invoke = (action: AutomationAction, caller = false) =>
		ipc.handlers.get('conversationAutomation:execute')!(
			{},
			{
				...action,
				target,
				...(caller ? { caller: { agentId: target.sessionId, tabId: target.tabId } } : {}),
			}
		) as Promise<ConversationAutomationState>;
	const ready = () => ipc.handlers.get('conversationAutomation:ready')!({ sender: ipc.sender });
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-runtime-'));
		root = await fs.realpath(root);
		project = path.join(root, 'project');
		await fs.mkdir(project);
		execFileSync('git', ['init', '-b', 'main'], { cwd: project });
		vi.useFakeTimers({
			toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
		});
		ipc.handlers.clear();
		ipc.renderer = new EventEmitter();
		app = new EventEmitter();
		pm = new EventEmitter();
		send = vi.fn((channel, payload) => ipc.renderer!.emit(channel, {}, payload));
		const webContents = { send, isDestroyed: () => false };
		ipc.sender = webContents;
		windows = new WindowRegistry();
		// Primary conversations are implicitly owned, with no explicit sessionIds claim.
		windows.create({
			windowId: 'owner',
			isMain: true,
			browserWindow: { webContents, isDestroyed: () => false } as never,
		});
		window.history.replaceState({}, '', '/');
		vi.mocked(window.maestro.windows.getState).mockResolvedValue({
			id: 'owner',
			sessionIds: [],
			activeSessionId: target.sessionId,
		} as never);
		vi.mocked(window.maestro.windows.list).mockImplementation(async () =>
			windows.getAll().map(({ id, sessionIds, isMain }) => ({
				id,
				sessionIds,
				isMain,
				activeSessionId: target.sessionId,
			}))
		);
		const session = createMockSession({
			id: target.sessionId,
			cwd: project,
			projectRoot: project,
			activeTabId: 'other',
			state: 'busy',
			aiTabs: [createMockAITab({ id: 'exact', state: 'busy' }), createMockAITab({ id: 'other' })],
		});
		const sessions = [session];
		useSessionStore.setState({ sessions, sessionsLoaded: true });
		useConversationAutomationStore.getState().replace([]);
		const deps = {
			app: Object.assign(app, { getPath: () => path.join(root, 'data') }),
			getProcessManager: () => pm,
			sessionsStore: { get: () => sessions },
			settingsStore: { get: (_key: string, fallback: unknown) => fallback },
			windowRegistry: windows,
			safeSend: (channel: string) => ipc.renderer!.emit(channel, {}),
		} as unknown as IpcBootstrapDependencies;
		registerConversationAutomation(deps);
		window.maestro.conversationAutomation = createConversationAutomationApi();
		window.maestro.sessions.setMany = vi.fn(async () => true);
		// Exercise the canonical renderer logger's IPC forwarding into the main logger.
		window.maestro.logger.log = vi.fn(async (level, message, context, data) => {
			logger[level](message, context, data);
		});
		await invoke({ action: 'status' });
	});
	afterEach(async () => {
		cleanup();
		app.emit('will-quit');
		vi.useRealTimers();
		await fs.rm(root, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it.each(['primary', 'secondary'])(
		'delivers a caller-registered timer to the exact %s owner',
		async (owner) => {
			await ready();
			let recipient = send;
			if (owner === 'secondary') {
				recipient = vi.fn();
				const webContents = { send: recipient, isDestroyed: () => false };
				windows.create({
					windowId: 'secondary',
					sessionIds: [target.sessionId],
					browserWindow: { webContents, isDestroyed: () => false } as never,
				});
				await ipc.handlers.get('conversationAutomation:ready')!({ sender: webContents });
			}
			const state = await invoke(
				{
					action: 'follow-add',
					reason: 'Inspect CI',
					condition: { kind: 'time', at: Date.now() + 20_000 },
				},
				true
			);
			await vi.advanceTimersByTimeAsync(20_000);
			await vi.waitFor(() =>
				expect(recipient).toHaveBeenCalledWith(
					'conversationAutomation:turn',
					expect.objectContaining({ id: `follow:${state.followUps[0].id}`, target })
				)
			);
			if (owner === 'secondary') expect(send).not.toHaveBeenCalled();
			expect(
				JSON.parse(
					await fs.readFile(
						path.join(root, 'data/conversation-automation/conversation-turns.json'),
						'utf8'
					)
				)[0]
			).toMatchObject({ target, state: 'queued' });
		}
	);

	it('mounts the renderer listener, signals ready, persists the exact queue item and acknowledges it', async () => {
		renderHook(() => useConversationAutomation(), { wrapper });
		const state = await invoke(
			{
				action: 'follow-add',
				reason: 'Original reason',
				condition: { kind: 'time', at: Date.now() + 20_000 },
			},
			true
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(20_000);
		});
		await vi.waitFor(() =>
			expect(useSessionStore.getState().sessions[0].executionQueue).toHaveLength(1)
		);
		const item = useSessionStore.getState().sessions[0].executionQueue[0];
		expect(item).toMatchObject({
			id: `follow:${state.followUps[0].id}`,
			tabId: 'exact',
			exactTarget: true,
		});
		expect(useSessionStore.getState().sessions[0].activeTabId).toBe('other');
		await vi.waitFor(async () =>
			expect((await invoke({ action: 'status' })).deliveries[0].state).toBe('accepted')
		);
		pm.emit('spawn', { sessionId: 'agent-ai-exact', prompt: item.text });
		await vi.waitFor(async () =>
			expect((await invoke({ action: 'status' })).deliveries[0].state).toBe('delivered')
		);
	});

	it('logs a delivery write failure with the follow-up id and exact target before any turn exists', async () => {
		const errors = vi.spyOn(logger, 'error');
		await ready();
		await fs.mkdir(path.join(root, 'data/conversation-automation/conversation-turns.json'));
		const state = await invoke(
			{
				action: 'follow-add',
				reason: 'Test a write error',
				condition: { kind: 'time', at: Date.now() + 20_000 },
			},
			true
		);
		await vi.advanceTimersByTimeAsync(20_000);
		await vi.waitFor(() =>
			expect(errors).toHaveBeenCalledWith(
				// Replacing a directory is EISDIR on POSIX and EPERM on Windows.
				expect.stringMatching(/EISDIR|EPERM/),
				'ConversationAutomation',
				expect.objectContaining({ stage: 'fire', followUpId: state.followUps[0].id, target })
			)
		);
		expect(send).not.toHaveBeenCalled();
		expect((await invoke({ action: 'status' })).deliveries).toEqual([]);
	});

	it('logs a window send rejection and retries durable intent without duplicating a turn', async () => {
		const errors = vi.spyOn(logger, 'error');
		await ready();
		send.mockImplementationOnce(() => {
			throw new Error('WebContents send failed');
		});
		const state = await invoke(
			{
				action: 'follow-add',
				reason: 'Test a send error',
				condition: { kind: 'time', at: Date.now() + 20_000 },
			},
			true
		);
		await vi.advanceTimersByTimeAsync(20_000);
		await vi.waitFor(() =>
			expect(errors).toHaveBeenCalledWith(
				'Could not send conversation turn',
				'ConversationAutomation',
				expect.objectContaining({
					stage: 'send',
					followUpId: state.followUps[0].id,
					target,
					windowId: 'owner',
				})
			)
		);
		renderHook(() => useConversationAutomation(), { wrapper });
		await vi.waitFor(async () =>
			expect((await invoke({ action: 'status' })).deliveries[0].state).toBe('accepted')
		);
		expect(useSessionStore.getState().sessions[0].executionQueue).toHaveLength(1);
	});

	it('logs renderer persistence rejection, leaves intent queued, and acknowledges only after retry', async () => {
		const errors = vi.spyOn(logger, 'error');
		renderHook(() => useConversationAutomation(), { wrapper });
		vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(false);
		const state = await invoke(
			{
				action: 'follow-add',
				reason: 'Test a renderer error',
				condition: { kind: 'time', at: Date.now() + 20_000 },
			},
			true
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(20_000);
		});
		await vi.waitFor(() =>
			expect(errors).toHaveBeenCalledWith(
				'Conversation automation renderer operation failed',
				'ConversationAutomation',
				expect.objectContaining({
					stage: 'receive',
					followUpId: state.followUps[0].id,
					target,
					windowId: 'owner',
					error: expect.stringContaining('Could not persist'),
				})
			)
		);
		expect((await invoke({ action: 'status' })).deliveries[0].state).toBe('queued');
		vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(true);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		await vi.waitFor(async () =>
			expect((await invoke({ action: 'status' })).deliveries[0].state).toBe('accepted')
		);
		expect(useSessionStore.getState().sessions[0].executionQueue).toHaveLength(1);
	});

	it('runs the native F4 sequence with real checks, Git fingerprints and progress rules', async () => {
		renderHook(() => useConversationAutomation(), { wrapper });
		// `exit 1` fails under both sh and cmd; cmd has no `false`, which would be not-run.
		await invoke({ action: 'checks-set', commands: ['exit 1'] });
		await invoke({ action: 'authorize', choice: 'project' });
		const initial = await invoke({ action: 'fix', mode: 'auto' });
		// The native failure's empty transcript and gather decision describe this
		// initial state, before any attempt, when the first fix turn cannot dispatch.
		expect(initial.decision?.kind).toBe('gather');
		expect(initial.attempts).toEqual([]);
		expect(initial.pendingTurn?.diagnosis).toBe(false);
		for (const [index, contents] of ['first', 'second', 'first'].entries()) {
			await vi.waitFor(() =>
				expect(useSessionStore.getState().sessions[0].executionQueue).toHaveLength(index + 1)
			);
			const item = useSessionStore.getState().sessions[0].executionQueue[index];
			await beginGitTurn('agent-ai-exact', project);
			pm.emit('spawn', { sessionId: 'agent-ai-exact', prompt: item.text });
			await fs.writeFile(path.join(project, 'fix.txt'), contents);
			await invoke(
				{
					action: 'plan',
					proposal: {
						basis: `Hypothesis ${index}`,
						difference: `Experiment ${index}`,
						expectation: 'Failure changes',
						candidates: [],
					},
				},
				true
			);
			await finishGitTurn('agent-ai-exact');
			await vi.waitFor(async () =>
				expect((await invoke({ action: 'status' })).attempts).toHaveLength(index + 1)
			);
		}
		await vi.waitFor(async () =>
			expect((await invoke({ action: 'status' })).pendingTurn?.diagnosis).toBe(true)
		);
		const state = await invoke({ action: 'status' });
		expect(state.progress.attempts.map((attempt) => attempt.verdict)).toEqual([
			'first',
			'none',
			'dup',
		]);
		expect(state.progress.attempts.map((attempt) => attempt.knownAfter)).toEqual([0, 0, 0]);
		expect(state.attempts[2].fingerprint).toBe(state.attempts[0].fingerprint);
		expect(new Set(state.attempts.map((attempt) => JSON.stringify(attempt.failures))).size).toBe(1);
		expect(state.decision?.kind).toBe('diagnose');
		expect(state.pendingTurn?.diagnosis).toBe(true);
		expect(state.deliveries).toHaveLength(4);
		expect(state.deliveries.at(-1)?.prompt).toContain('Diagnose why the last three attempts');
	});
});
