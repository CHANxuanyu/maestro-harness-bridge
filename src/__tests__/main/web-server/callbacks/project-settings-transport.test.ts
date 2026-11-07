import { expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { registerBrowserTabCallbacks } from '../../../../main/web-server/callbacks/browserTabCallbacks';
import type { NewAITabWithPromptCallback } from '../../../../main/web-server/types';

vi.mock('electron', () => ({ ipcMain: { once: vi.fn(), removeListener: vi.fn() } }));
vi.mock('../../../../main/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../../main/utils/safe-send', () => ({ isWebContentsAvailable: () => true }));

it('routes prompt creation to the owner and preserves the new project runner identity in the reply', async () => {
	let create: NewAITabWithPromptCallback;
	const server = new Proxy(
		{},
		{
			get: (_, key) =>
				key === 'setNewAITabWithPromptCallback'
					? (callback: NewAITabWithPromptCallback) => {
							create = callback;
						}
					: () => {},
		}
	);
	const primary = { webContents: { send: vi.fn() } };
	const owner = { webContents: { send: vi.fn() } };
	registerBrowserTabCallbacks(
		server as never,
		{
			getMainWindow: () => primary,
			getWindowForSession: () => owner,
			settingsStore: { get: () => true },
		} as never
	);
	const timer = vi.spyOn(globalThis, 'setTimeout');
	const pending = create!('source-owner', 'Synthetic prompt', true);
	const listener = vi.mocked(ipcMain.once).mock.calls.at(-1)![1];
	listener({} as never, {
		success: true,
		sessionId: 'project-owner',
		tabId: 'project-tab',
		queued: true,
	});
	expect(await pending).toEqual({
		success: true,
		sessionId: 'project-owner',
		tabId: 'project-tab',
		queued: true,
	});
	expect(timer).toHaveBeenCalledWith(expect.any(Function), 60_000);
	timer.mockRestore();
	expect(primary.webContents.send).not.toHaveBeenCalled();
	expect(owner.webContents.send).toHaveBeenCalledWith(
		'remote:newAITabWithPrompt',
		'source-owner',
		'Synthetic prompt',
		expect.any(String),
		true
	);
});
