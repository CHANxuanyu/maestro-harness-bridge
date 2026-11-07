import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectSettings } from '../../../cli/commands/project-settings';
import { sendSimpleCommand } from '../../../cli/services/session-command';
import { maskEnvValue } from '../../../shared/agentEnvironment';

vi.mock('../../../cli/services/session-command', async (original) => ({
	...(await original<typeof import('../../../cli/services/session-command')>()),
	sendSimpleCommand: vi.fn(),
}));

describe('project settings CLI', () => {
	const scope = { projectPath: '~/work/project', sshRemoteId: 'synthetic-host' };
	const snapshot = {
		success: true,
		scope,
		settings: {
			defaultProvider: 'codex',
			envVars: { API_TOKEN: 'synthetic-secret-value', URL: 'https://example.invalid' },
		},
	};
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		vi.mocked(sendSimpleCommand).mockResolvedValue({ ok: true, result: snapshot });
	});
	afterEach(() => vi.restoreAllMocks());

	it('reads the same handler as the UI without expanding remote home paths and masks secrets', async () => {
		await projectSettings('show', {
			path: scope.projectPath,
			sshRemote: scope.sshRemoteId,
			json: true,
		});
		expect(sendSimpleCommand).toHaveBeenCalledExactlyOnceWith(
			{
				type: 'bridge.invoke',
				channel: 'settings:projectSettings',
				args: [{ action: 'show', scope }],
			},
			'bridge.response'
		);
		expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual({
			...snapshot,
			settings: {
				...snapshot.settings,
				envVars: {
					API_TOKEN: maskEnvValue(snapshot.settings.envVars.API_TOKEN),
					URL: 'https://example.invalid',
				},
			},
		});
	});

	it('allows an explicit secret reveal and never changes the backend response object', async () => {
		await projectSettings('show', {
			path: scope.projectPath,
			sshRemote: scope.sshRemoteId,
			showSecrets: true,
			json: true,
		});
		expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual(snapshot);
		expect(snapshot.settings.envVars.API_TOKEN).toBe('synthetic-secret-value');
	});

	it('sends defaults, environment replacement and the exact full access acknowledgement', async () => {
		await projectSettings('set', {
			path: scope.projectPath,
			sshRemote: scope.sshRemoteId,
			provider: 'codex',
			model: 'model',
			effort: 'high',
			permission: 'full',
			env: ['API_TOKEN=synthetic=value', 'EMPTY='],
			acknowledgeFullAccess: true,
			json: true,
		});
		expect(sendSimpleCommand).toHaveBeenCalledExactlyOnceWith(
			{
				type: 'bridge.invoke',
				channel: 'settings:projectSettings',
				args: [
					{
						action: 'set',
						scope,
						patch: {
							defaultProvider: 'codex',
							defaultModel: 'model',
							defaultReasoningEffort: 'high',
							defaultPermissionMode: 'full',
							envVars: { API_TOKEN: 'synthetic=value', EMPTY: '' },
						},
						acknowledgeFullAccess: true,
					},
				],
			},
			'bridge.response'
		);
	});

	it('clears defaults with the canonical inherit vocabulary', async () => {
		await projectSettings('set', {
			path: '/tmp/project',
			model: 'inherit',
			permission: 'default',
			clearEnv: true,
			json: true,
		});
		expect(sendSimpleCommand).toHaveBeenCalledExactlyOnceWith(
			{
				type: 'bridge.invoke',
				channel: 'settings:projectSettings',
				args: [
					{
						action: 'set',
						scope: { projectPath: '/tmp/project' },
						patch: { defaultModel: null, defaultPermissionMode: null, envVars: null },
					},
				],
			},
			'bridge.response'
		);
	});

	it.each([
		['unknown', { path: '/tmp/project' }],
		['show', {}],
		['show', { path: '/tmp/project', model: 'model' }],
		['set', { path: '/tmp/project' }],
		['set', { path: '/tmp/project', env: ['BROKEN'] }],
		['set', { path: '/tmp/project', env: ['KEY=value'], clearEnv: true }],
	] as const)('rejects invalid command %s %j before connecting', async (action, options) => {
		await projectSettings(action, options);
		expect(sendSimpleCommand).not.toHaveBeenCalled();
		expect(process.exit).toHaveBeenCalledWith(1);
	});

	it('retains structured failure and returns a failing exit status', async () => {
		const failure = {
			success: false,
			scope,
			settings: {},
			code: 'full-access-confirmation-required',
			error: 'Full access explanation',
		};
		vi.mocked(sendSimpleCommand).mockResolvedValue({ ok: true, result: failure });
		await projectSettings('set', { path: scope.projectPath, permission: 'full', json: true });
		expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual(failure);
		expect(process.exit).toHaveBeenCalledWith(1);
	});
});
