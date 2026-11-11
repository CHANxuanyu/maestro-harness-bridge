import path from 'node:path';
import { readSettingValue } from '../../../cli/services/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectSettings } from '../../../cli/commands/project-settings';
import { sendSimpleCommand } from '../../../cli/services/session-command';
import { maskEnvValue } from '../../../shared/agentEnvironment';

vi.mock('../../../cli/services/session-command', async (original) => ({
	...(await original<typeof import('../../../cli/services/session-command')>()),
	sendSimpleCommand: vi.fn(),
}));

vi.mock('../../../cli/services/storage', async (original) => ({
	...(await original<typeof import('../../../cli/services/storage')>()),
	readSettingValue: vi.fn(() => 'en'),
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
		vi.mocked(readSettingValue).mockReturnValue('en');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		vi.mocked(sendSimpleCommand).mockResolvedValue({ ok: true, result: snapshot });
	});
	afterEach(() => vi.restoreAllMocks());

	it.each([
		['config-b', 'config-b'],
		['off', null],
	])('sets auto handoff %s through the shared project service', async (autoHandoff, target) => {
		await projectSettings('set', {
			path: scope.projectPath,
			sshRemote: scope.sshRemoteId,
			autoHandoff,
			json: true,
		});
		expect(sendSimpleCommand).toHaveBeenCalledExactlyOnceWith(
			{
				type: 'bridge.invoke',
				channel: 'settings:projectSettings',
				args: [{ action: 'set', scope, patch: { autoHandoffTarget: target } }],
			},
			'bridge.response'
		);
	});

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
						scope: { projectPath: path.resolve('/tmp/project') },
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

	it('localizes new command errors using the saved UI language', async () => {
		vi.mocked(readSettingValue).mockReturnValue('zh-CN');
		await projectSettings('set', { path: '/tmp/project', json: true });
		expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0]).error).toBe(
			'请至少指定一项项目设置。'
		);
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

	it('translates a service error code with parameters at the CLI boundary', async () => {
		vi.mocked(readSettingValue).mockReturnValue('zh-CN');
		vi.mocked(sendSimpleCommand).mockResolvedValue({
			ok: true,
			result: {
				success: false,
				scope,
				settings: {},
				code: 'invalid-request',
				errorCode: 'invalidSetting',
				params: { field: 'defaultModel' },
			},
		});
		await projectSettings('set', { path: scope.projectPath, model: 'bad', json: true });
		expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0]).error).toBe(
			'项目设置无效：defaultModel'
		);
		expect(process.exit).toHaveBeenCalledWith(1);
	});
});

it('passes the model owner independently of the default conversation tool', async () => {
	vi.mocked(sendSimpleCommand).mockResolvedValue({
		ok: true,
		result: { success: true, settings: {} },
	});
	vi.spyOn(console, 'log').mockImplementation(() => {});
	await projectSettings('set', {
		path: '/tmp/project',
		model: 'opus',
		modelProvider: 'claude-code',
		json: true,
	});
	expect(sendSimpleCommand).toHaveBeenLastCalledWith(
		expect.objectContaining({
			args: [
				expect.objectContaining({ patch: { defaultModel: 'opus', modelProvider: 'claude-code' } }),
			],
		}),
		'bridge.response'
	);
	vi.restoreAllMocks();
});
