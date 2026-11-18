import { describe, expect, it, vi } from 'vitest';
import { ipcMain, ipcRenderer } from 'electron';
import { registerTeamHandlers } from '../../../main/ipc/handlers/team';
import { createTeamApi } from '../../../main/preload/team';
import type { TeamScheduler } from '../../../main/team/scheduler';

vi.mock('electron', () => ({
	ipcMain: { handle: vi.fn() },
	ipcRenderer: { invoke: vi.fn(async () => undefined), on: vi.fn(), removeListener: vi.fn() },
}));
vi.mock('../../../main/utils/ipcHandler', () => ({
	withIpcErrorLogging:
		(_options: unknown, fn: (...args: unknown[]) => unknown) =>
		(_event: unknown, ...args: unknown[]) =>
			fn(...args),
}));

describe('team IPC/preload contract', () => {
	it('registers every API action and works with an absent Electron sender', async () => {
		const names = [
			'create',
			'list',
			'get',
			'status',
			'answer',
			'baselineEdit',
			'baselineDiff',
			'baselineReturn',
			'log',
			'say',
			'pause',
			'resume',
			'stop',
			'accept',
			'extend',
			'seatSet',
			'seatSub',
			'action',
			'requestChanges',
			'export',
			'seatTranscript',
		] as const;
		const service = Object.fromEntries(
			names.map((name) => [name, vi.fn(async (...args: unknown[]) => args)])
		);
		registerTeamHandlers(service as unknown as TeamScheduler);
		for (const name of names) {
			const registration = vi
				.mocked(ipcMain.handle)
				.mock.calls.find(([channel]) => channel === `team:${name}`)!;
			await registration[1](undefined as never, 'team', 'card', 'option', 'note');
			expect(service[name]).toHaveBeenCalledOnce();
		}
	});
	it('normalizes a missing JSON recipient before invoking the owner-message service', async () => {
		vi.mocked(ipcMain.handle).mockClear();
		const say = vi.fn(async () => ({ status: 'queued', messageId: 'message', to: 'pm' }));
		registerTeamHandlers({ say } as unknown as TeamScheduler);
		const [, handle] = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === 'team:say')!;
		const args = JSON.parse(JSON.stringify(['team', 'Queued question for PM', undefined]));
		expect(await handle(undefined as never, ...args)).toEqual({
			status: 'queued',
			messageId: 'message',
			to: 'pm',
		});
		expect(say).toHaveBeenCalledWith('team', 'Queued question for PM', 'pm');
	});
	it('invokes fixed argument order and unsubscribes exactly its own changed listener', async () => {
		const api = createTeamApi();
		await api.answer('team', 'card', 'option', 'note');
		expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(
			'team:answer',
			'team',
			'card',
			'option',
			'note'
		);
		await api.say('team', 'message', 'dev');
		expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('team:say', 'team', 'message', 'dev');
		const listener = vi.fn();
		const unsubscribe = api.onChanged(listener);
		const [, callback] = vi.mocked(ipcRenderer.on).mock.calls.at(-1)!;
		const payload = { teamId: 'team', event: { id: 'event', seq: 1 } };
		callback(undefined as never, payload);
		expect(listener).toHaveBeenCalledWith(payload);
		unsubscribe();
		expect(ipcRenderer.removeListener).toHaveBeenCalledWith('team:changed', callback);
	});
});
