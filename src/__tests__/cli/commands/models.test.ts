import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modelsCommand } from '../../../cli/commands/models';
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

describe('models CLI parity', () => {
	it('reads the desktop catalog with account and host context and emits full JSON', async () => {
		const catalog = { provider: 'codex', models: [], stale: true, source: { kind: 'fallback' } };
		sendCommand.mockResolvedValue({ ok: true, result: catalog });
		await modelsCommand('codex', { accountDir: '~/account', sshRemote: 'host', json: true });
		expect(sendCommand).toHaveBeenCalledWith(
			{
				type: 'bridge.invoke',
				channel: 'agents:getModelCatalog',
				args: [
					{
						provider: 'codex',
						sessionId: undefined,
						sshRemoteId: 'host',
						account: { customEnvVars: { CODEX_HOME: '~/account' } },
					},
				],
			},
			'bridge.response'
		);
		expect(console.log).toHaveBeenCalledWith(JSON.stringify(catalog));
	});
	it('prints visible models, follow-default provenance and quota in text mode', async () => {
		sendCommand.mockResolvedValue({
			ok: true,
			result: {
				provider: 'codex',
				effortLabel: 'Reasoning',
				source: { kind: 'codex-cache' },
				followDefault: { modelId: 'astra', source: 'config' },
				models: [
					{
						id: 'astra',
						displayName: 'Astra',
						description: 'Fixture description',
						efforts: [{ id: 'high' }],
						defaultEffort: 'high',
						hidden: false,
					},
					{ id: 'hidden', hidden: true },
				],
				quota: { windows: [{ id: 'weekly', remainingPercent: 80 }] },
			},
		});
		await modelsCommand('codex', { agent: 'stored-agent' });
		expect(sendCommand.mock.calls[0][0].args[0].sessionId).toBe('stored-agent');
		expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Fixture description'));
		expect(console.log).toHaveBeenCalledWith('weekly: 80% remaining');
		expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('hidden'));
	});
	it.each(['invalid-provider', 'conflicting-account', 'server-error'])(
		'reports %s as failure',
		async (failure) => {
			vi.spyOn(process, 'exit').mockImplementation(() => {
				throw new Error('exit');
			});
			sendCommand.mockResolvedValue({ ok: false, error: 'Catalog unavailable' });
			await expect(
				modelsCommand(failure === 'invalid-provider' ? 'other' : 'codex', {
					json: true,
					...(failure === 'conflicting-account' ? { agent: 'a', accountDir: '/b' } : {}),
				})
			).rejects.toThrow('exit');
			if (failure !== 'server-error') expect(withMaestroClient).not.toHaveBeenCalled();
			expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"success":false'));
		}
	);
});
