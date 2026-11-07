import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { registerSessionCrudCallbacks } from '../../../../main/web-server/callbacks/sessionCrudCallbacks';

vi.mock('electron', () => ({ ipcMain: { once: vi.fn(), removeListener: vi.fn() } }));
vi.mock('../../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../../main/utils/safe-send', () => ({
	isWebContentsAvailable: vi.fn(() => true),
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('session config window routing', () => {
	it('moves the project in its owning window before acknowledging the cwd change', async () => {
		const setUpdateSessionCwdCallback = vi.fn();
		const server = new Proxy(
			{},
			{
				get: (_target, key) =>
					key === 'setUpdateSessionCwdCallback' ? setUpdateSessionCwdCallback : vi.fn(),
			}
		);
		const main = { webContents: { send: vi.fn() } };
		const owner = { webContents: { send: vi.fn() } };
		const getWindowForSession = vi.fn(() => owner);
		registerSessionCrudCallbacks(
			server as never,
			{
				getMainWindow: () => main,
				getWindowForSession,
			} as never
		);

		const pending = setUpdateSessionCwdCallback.mock.calls[0][0]('owner-b', '/projects/new');
		expect(owner.webContents.send).toHaveBeenCalledWith(
			'remote:updateSessionCwd',
			'owner-b',
			'/projects/new',
			expect.any(String)
		);
		expect(main.webContents.send).not.toHaveBeenCalled();
		expect(getWindowForSession).toHaveBeenCalledWith('owner-b');
		const channel = owner.webContents.send.mock.calls[0][3];
		const handler = vi.mocked(ipcMain.once).mock.calls.find(([name]) => name === channel)![1];
		handler({} as never, { success: true });
		await expect(pending).resolves.toEqual({ success: true });
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(['owner', 'missing', 'unavailable'])(
		'routes panel actions through the existing owner lookup with %s lookup',
		async (lookup) => {
			const setUpdateSessionConfigCallback = vi.fn();
			const server = new Proxy(
				{},
				{
					get: (_target, key) =>
						key === 'setUpdateSessionConfigCallback' ? setUpdateSessionConfigCallback : vi.fn(),
				}
			);
			const main = { webContents: { send: vi.fn() } };
			const secondary = { webContents: { send: vi.fn() } };
			const getWindowForSession =
				lookup === 'unavailable' ? undefined : vi.fn(() => (lookup === 'owner' ? secondary : null));
			registerSessionCrudCallbacks(
				server as never,
				{
					getMainWindow: () => main,
					getWindowForSession,
				} as never
			);
			const patch = {
				tabId: 'conversation',
				newShellPanelAction: 'terminal-close',
				newShellTerminalId: 'terminal',
			};
			const pending = setUpdateSessionConfigCallback.mock.calls[0][0]('agent', patch);
			const target = lookup === 'owner' ? secondary : main;
			expect(target.webContents.send).toHaveBeenCalledWith(
				'remote:updateSessionConfig',
				'agent',
				patch,
				expect.stringMatching(/^remote:updateSessionConfig:response:/)
			);
			if (getWindowForSession) expect(getWindowForSession).toHaveBeenCalledWith('agent');
			expect((lookup === 'owner' ? main : secondary).webContents.send).not.toHaveBeenCalled();
			const channel = target.webContents.send.mock.calls[0][3];
			const handler = vi.mocked(ipcMain.once).mock.calls.find(([name]) => name === channel)![1];
			handler({} as never, { success: true });
			await expect(pending).resolves.toEqual({ success: true });
			expect(vi.getTimerCount()).toBe(0);
		}
	);
});
