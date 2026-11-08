import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { permissionCommand } from '../../../cli/commands/permission';
import { withMaestroClient } from '../../../cli/services/maestro-client';
vi.mock('../../../cli/services/maestro-client', () => ({ withMaestroClient: vi.fn() }));

const sendCommand = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(withMaestroClient).mockImplementation(async (callback) =>
		callback({ sendCommand } as never)
	);
	vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('permission CLI parity', () => {
	it('lists pending requests through the main relay', async () => {
		const requests = [{ requestId: 'a', toolName: 'Write', input: { content: 'review me' } }];
		sendCommand.mockResolvedValue({ ok: true, result: requests });
		await permissionCommand('list', undefined, { json: true });
		expect(sendCommand).toHaveBeenCalledWith(
			{ type: 'bridge.invoke', channel: 'permission:list', args: [] },
			'bridge.response'
		);
		expect(console.log).toHaveBeenCalledWith(JSON.stringify(requests));
	});
	it.each(['allow', 'deny'] as const)(
		'sends %s through the same handler as the dialog',
		async (action) => {
			sendCommand.mockResolvedValue({ ok: true, result: true });
			await permissionCommand(action, 'exact-id', { json: true });
			expect(sendCommand).toHaveBeenCalledWith(
				{
					type: 'bridge.invoke',
					channel: 'permission:respond',
					args: [
						'exact-id',
						action === 'allow'
							? { behavior: 'allow' }
							: { behavior: 'deny', message: 'Denied by user.' },
					],
				},
				'bridge.response'
			);
		}
	);
	it.each([
		['allow', undefined],
		['unknown', 'id'],
		['list', 'id'],
	])('rejects invalid command %s before connecting', async (action, id) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});
		await expect(permissionCommand(action, id, { json: true })).rejects.toThrow('exit');
		expect(withMaestroClient).not.toHaveBeenCalled();
	});
	it('reports an expired decision as failure', async () => {
		sendCommand.mockResolvedValue({ ok: true, result: false });
		const error = vi.mocked(console.log);
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});
		await expect(permissionCommand('allow', 'expired', { json: true })).rejects.toThrow('exit');
		expect(error).toHaveBeenCalledWith(
			JSON.stringify({ success: false, error: 'Permission request is no longer pending' })
		);
	});
});
