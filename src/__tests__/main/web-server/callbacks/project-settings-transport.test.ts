import { expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { registerBrowserTabCallbacks } from '../../../../main/web-server/callbacks/browserTabCallbacks';
import type { NewAITabWithPromptCallback } from '../../../../main/web-server/types';

vi.mock('electron', () => ({ ipcMain: { on: vi.fn(), once: vi.fn(), removeListener: vi.fn() } }));
vi.mock('../../../../main/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../../main/utils/safe-send', () => ({ isWebContentsAvailable: () => true }));

it.each([true, false])(
	'routes prompt creation to the owner without changing classic behavior, newShell=%s',
	async (newShell) => {
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
				settingsStore: { get: () => newShell },
			} as never
		);
		const timer = vi.spyOn(globalThis, 'setTimeout');
		const pending = create!(
			'source-owner',
			'Synthetic prompt',
			true,
			...(newShell ? [] : [{ fromSessionId: 'parent', fromTabId: 'parent-tab' }])
		);
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
		expect(timer).toHaveBeenCalledWith(expect.any(Function), newShell ? 60_000 : 5000);
		timer.mockRestore();
		expect(primary.webContents.send).not.toHaveBeenCalled();
		expect(owner.webContents.send).toHaveBeenCalledWith(
			'remote:newAITabWithPrompt',
			'source-owner',
			'Synthetic prompt',
			expect.any(String),
			true
		);
	}
);

it.each([true, false])(
	'reads live provenance and requires the owner saved receipt=%s',
	async (provenanceSaved) => {
		vi.clearAllMocks();
		let create!: NewAITabWithPromptCallback;
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
		const parent = { webContents: { send: vi.fn() } };
		const target = { webContents: { send: vi.fn() } };
		registerBrowserTabCallbacks(
			server as never,
			{
				getMainWindow: () => parent,
				getWindowForSession: (id: string) => (id === 'parent' ? parent : target),
				settingsStore: { get: () => true },
			} as never
		);
		const pending = create('target', 'Build', true, {
			fromSessionId: 'parent',
			fromTabId: 'parent-tab',
		});
		expect(parent.webContents.send).toHaveBeenCalledWith(
			'context:readHandoffSource',
			expect.objectContaining({
				sourceAgentId: 'parent',
				sourceTabId: 'parent-tab',
				permissionOnly: true,
				delegation: true,
			}),
			expect.any(String)
		);
		expect(target.webContents.send).not.toHaveBeenCalled();
		const sourceListener = vi.mocked(ipcMain.on).mock.calls.at(-1)![1];
		sourceListener({ sender: parent.webContents } as never, {
			sourceAgentId: 'parent',
			sourceTabId: 'parent-tab',
			sourceProvider: 'codex',
			sourceTitle: 'Parent',
			sourceNativeSessionId: 'native-parent',
			sourcePermission: { permissionMode: 'readonly', readOnlyMode: true },
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(target.webContents.send).toHaveBeenCalledWith(
			'remote:newAITabWithPrompt',
			'target',
			'Build',
			expect.any(String),
			true,
			{
				origin: {
					kind: 'subtask',
					sourceSessionId: 'parent',
					sourceTabId: 'parent-tab',
					sourceProvider: 'codex',
					sourceTitle: 'Parent',
					sourceNativeSessionId: 'native-parent',
					createdAt: expect.any(Number),
				},
				permission: { permissionMode: 'readonly', readOnlyMode: true },
			}
		);
		const listener = vi.mocked(ipcMain.on).mock.calls.at(-1)![1];
		let settled = false;
		void pending.then(() => {
			settled = true;
		});
		listener({ sender: parent.webContents } as never, {
			success: true,
			tabId: 'wrong-child',
			provenanceSaved: true,
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		listener({ sender: target.webContents } as never, {
			success: true,
			tabId: 'child',
			provenanceSaved,
		});
		expect(await pending).toMatchObject({
			success: provenanceSaved,
			tabId: 'child',
			...(provenanceSaved ? { provenanceSaved: true } : { error: expect.any(String) }),
		});
	}
);
