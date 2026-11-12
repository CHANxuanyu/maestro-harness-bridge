import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { registerSessionCrudCallbacks } from '../../../../main/web-server/callbacks/sessionCrudCallbacks';
import { registerSessionCallbacks } from '../../../../main/web-server/callbacks/sessionCallbacks';
vi.mock('electron', async () => {
	const { EventEmitter } = await import('node:events');
	return { ipcMain: new EventEmitter() };
});
vi.mock('../../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../../main/utils/safe-send', () => ({
	isWebContentsAvailable: (win: unknown) => !!win,
}));
vi.mock('../../../../shared/cli-activity', () => ({ getSessionIdsBusyWithCli: () => new Set() }));
vi.mock('../../../../main/cross-agent/cross-agent-router', () => ({
	getCrossAgentTargetState: () => undefined,
}));
vi.mock('../../../../main/utils/agent-busy', () => ({ isAiTabProcessActive: () => false }));
vi.mock('../../../../main/storage/session-image-store', () => ({
	isImageRef: () => false,
	resolveToDataUrlSync: (value: string) => value,
}));
const ipc = ipcMain as unknown as EventEmitter;
beforeEach(() => {
	vi.clearAllMocks();
	ipc.removeAllListeners();
});
afterEach(() => {
	ipc.removeAllListeners();
	vi.useRealTimers();
});

it.each([
	'open-hit',
	'sidebar-search',
	'tasks',
	'project-settings',
	'new-split',
	'force-send',
	'refresh',
])('routes %s to the owning window and preserves its acknowledged result', async (action) => {
	const setters: Record<string, (...args: unknown[]) => unknown> = {};
	const server = new Proxy(
		{},
		{
			get: (_, key: string) => (callback: (...args: unknown[]) => unknown) => {
				setters[key] = callback;
			},
		}
	);
	const main = { webContents: { send: vi.fn() } };
	const owner = { webContents: { send: vi.fn() } };
	registerSessionCrudCallbacks(
		server as never,
		{ getMainWindow: () => main, getWindowForSession: () => owner } as never
	);
	const request = { newShellCommand: { action } };
	const pending = setters.setUpdateSessionConfigCallback('owner', request) as Promise<unknown>;
	expect(owner.webContents.send).toHaveBeenCalledWith(
		'remote:updateSessionConfig',
		'owner',
		request,
		expect.any(String)
	);
	expect(main.webContents.send).not.toHaveBeenCalled();
	const channel = owner.webContents.send.mock.calls[0][3];
	let settled = false;
	void pending.then(() => {
		settled = true;
	});
	ipc.emit(channel, { sender: main.webContents }, { success: true, data: { tabId: 'forged' } });
	await Promise.resolve();
	expect(settled).toBe(false);
	ipc.emit(channel, { sender: owner.webContents }, { success: true, data: { tabId: 'actual' } });
	await expect(pending).resolves.toEqual({ success: true, data: { tabId: 'actual' } });
	expect(ipc.listenerCount(channel)).toBe(0);
});

it('switches then immediately lists after the live owner has flushed its new selection', async () => {
	let saved = [
		{
			id: 'owner',
			name: 'Owner',
			toolType: 'codex',
			activeTabId: 'before',
			aiTabs: [{ id: 'before' }, { id: 'after' }],
		},
	];
	const setters: Record<string, () => unknown> = {};
	const server = new Proxy(
		{},
		{
			get: (_, key: string) => (callback: () => unknown) => {
				setters[key] = callback;
			},
		}
	);
	const owner = {
		webContents: {
			send: vi.fn((_channel, _id, _request, response) => {
				saved = saved.map((session) => ({ ...session, activeTabId: 'after' }));
				ipc.emit(
					response,
					{ sender: owner.webContents },
					{ success: true, data: { activeSessionId: 'owner', activeTabId: 'after' } }
				);
			}),
		},
	};
	registerSessionCallbacks(
		server as never,
		{
			sessionsStore: { get: () => saved },
			groupsStore: { get: () => [] },
			settingsStore: { get: () => true },
			getProcessManager: () => null,
			getMainWindow: () => owner,
			getWindowForSession: () => owner,
		} as never
	);
	const tabs = await setters.setListDesktopSessionsCallback();
	expect(tabs).toEqual([
		expect.objectContaining({ tabId: 'before', active: false, current: false }),
		expect.objectContaining({ tabId: 'after', active: true, current: true }),
	]);
	expect(owner.webContents.send).toHaveBeenCalledTimes(1);
});

it('returns a timeout failure rather than stale inventory', async () => {
	vi.useFakeTimers();
	const setters: Record<string, () => unknown> = {};
	const server = new Proxy(
		{},
		{
			get: (_, key: string) => (callback: () => unknown) => {
				setters[key] = callback;
			},
		}
	);
	const owner = { webContents: { send: vi.fn() } };
	registerSessionCallbacks(
		server as never,
		{
			sessionsStore: { get: () => [] },
			groupsStore: { get: () => [] },
			settingsStore: { get: () => true },
			getProcessManager: () => null,
			getMainWindow: () => owner,
		} as never
	);
	const pending = setters.setListDesktopSessionsCallback();
	const assertion = expect(pending).rejects.toThrow('Desktop did not confirm its live inventory');
	await vi.advanceTimersByTimeAsync(5000);
	await assertion;
	expect(ipc.eventNames()).toEqual([]);
});

it('finds an unsaved queue item in a secondary window and dispatches it only there', async () => {
	const setters: Record<string, (...args: unknown[]) => unknown> = {};
	const server = new Proxy(
		{},
		{
			get: (_, key: string) => (callback: (...args: unknown[]) => unknown) => {
				setters[key] = callback;
			},
		}
	);
	const main = {
		webContents: {
			send: vi.fn((_channel, _id, _patch, response) => {
				ipc.emit(
					response,
					{ sender: main.webContents },
					{ success: true, data: { sessionIds: [] } }
				);
			}),
		},
	};
	const secondary = {
		webContents: {
			send: vi.fn((_channel, id, patch, response) => {
				if (patch.newShellCommand.action === 'locate-queue')
					ipc.emit(
						response,
						{ sender: secondary.webContents },
						{ success: true, data: { sessionIds: ['unsaved-owner'] } }
					);
				else
					ipc.emit(
						response,
						{ sender: secondary.webContents },
						{ success: true, data: { agentId: id, itemId: 'queued' } }
					);
			}),
		},
	};
	registerSessionCrudCallbacks(
		server as never,
		{ getMainWindow: () => main, getAppWindows: () => [main, secondary] } as never
	);
	await expect(
		setters.setUpdateSessionConfigCallback('active', {
			newShellCommand: { action: 'force-send', itemId: 'queued' },
		})
	).resolves.toEqual({ success: true, data: { agentId: 'unsaved-owner', itemId: 'queued' } });
	expect(main.webContents.send).toHaveBeenCalledTimes(1);
	expect(secondary.webContents.send).toHaveBeenCalledTimes(2);
	expect(secondary.webContents.send.mock.calls[1][1]).toBe('unsaved-owner');
	expect(secondary.webContents.send.mock.calls[1][2].newShellCommand.action).toBe('force-send');
});
