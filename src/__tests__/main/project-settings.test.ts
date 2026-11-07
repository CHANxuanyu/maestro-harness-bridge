import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectSettingsService } from '../../main/project-settings';
import { projectSettingsKey } from '../../shared/projectSettings';
import { getTranslator, hasTranslation } from '../../renderer/i18n/translate';

describe('project settings persistence', () => {
	let values: Record<string, unknown>;
	const changed = vi.fn();
	const store = {
		get: (key: string, fallback?: unknown) => values[key] ?? fallback,
		set: (key: string, value: unknown) => {
			values[key] = structuredClone(value);
		},
	};
	beforeEach(() => {
		values = {};
		changed.mockClear();
	});
	const service = () =>
		createProjectSettingsService({ settingsStore: store as never, onChanged: changed });
	const scope = { projectPath: '/tmp/project-settings-fixture' };

	it('saves defaults only in Maestro and isolates the same path on distinct hosts', async () => {
		const api = service();
		for (const sshRemoteId of [undefined, 'host-a', 'host-b']) {
			const target = { ...scope, ...(sshRemoteId ? { sshRemoteId } : {}) };
			expect(
				await api.command({
					action: 'set',
					scope: target,
					patch: {
						modelProvider: 'claude-code',
						defaultModel: sshRemoteId ?? 'local',
						envVars: { API_TOKEN: 'synthetic-only' },
					},
				})
			).toMatchObject({ success: true });
		}
		expect(Object.keys(values)).toEqual(['projectSettings']);
		for (const sshRemoteId of [undefined, 'host-a', 'host-b']) {
			const result = await api.command({
				action: 'show',
				scope: { ...scope, ...(sshRemoteId ? { sshRemoteId } : {}) },
			});
			expect(result.settings.defaultModel).toBe(sshRemoteId ?? 'local');
		}
		expect(changed).toHaveBeenCalledTimes(3);
	});

	it('normalizes trailing separators without resolving SSH paths on the local machine', async () => {
		expect(projectSettingsKey({ projectPath: '~/work//project/', sshRemoteId: 'ssh' })).toBe(
			projectSettingsKey({ projectPath: '~/work/project', sshRemoteId: 'ssh' })
		);
		expect(projectSettingsKey({ projectPath: '/tmp/a\\b', sshRemoteId: 'ssh' })).not.toBe(
			projectSettingsKey({ projectPath: '/tmp/a/b', sshRemoteId: 'ssh' })
		);
	});

	it('requires the full access explanation once per project and remembers it when resetting defaults', async () => {
		const api = service();
		const request = { action: 'set', scope, patch: { defaultPermissionMode: 'full' } };
		expect(await api.command(request)).toMatchObject({
			success: false,
			code: 'full-access-confirmation-required',
		});
		expect(values).toEqual({});
		expect(await api.command({ ...request, acknowledgeFullAccess: true })).toMatchObject({
			success: true,
			settings: { fullAccessAcknowledged: true },
		});
		await api.command({ action: 'set', scope, patch: { defaultPermissionMode: null } });
		expect(await api.command(request)).toMatchObject({ success: true });
		expect(
			await api.command({ ...request, scope: { ...scope, sshRemoteId: 'other' } })
		).toMatchObject({ success: false, code: 'full-access-confirmation-required' });
	});

	it('merges independent settings, clears individual defaults and preserves empty environment values', async () => {
		const api = service();
		await api.command({
			action: 'set',
			scope,
			patch: {
				defaultProvider: 'codex',
				defaultModel: 'model-a',
				envVars: { EMPTY: '', API_TOKEN: 'synthetic-only' },
			},
		});
		const result = await api.command({
			action: 'set',
			scope,
			patch: { defaultModel: null, defaultReasoningEffort: 'high' },
		});
		expect(result.settings).toEqual({
			defaultProvider: 'codex',
			modelProvider: 'codex',
			defaultReasoningEffort: 'high',
			envVars: { EMPTY: '', API_TOKEN: 'synthetic-only' },
		});
	});

	it.each([
		{ patch: { defaultProvider: 'terminal' } },
		{ patch: { defaultPermissionMode: 'anything' } },
		{ patch: { fullAccessAcknowledged: true } },
		{ patch: { envVars: { 'BAD=KEY': 'value' } } },
		{ patch: { envVars: { KEY: 42 } } },
		{ scope: { projectPath: '/tmp/project\u0000other' }, patch: {} },
		{ scope: { projectPath: '/tmp/project', sshRemoteId: '' }, patch: {} },
	])('rejects invalid input without modifying existing settings: %j', async (invalid) => {
		const api = service();
		await api.command({
			action: 'set',
			scope,
			patch: { modelProvider: 'claude-code', defaultModel: 'kept' },
		});
		const before = structuredClone(values);
		expect(await api.command({ action: 'set', scope, ...invalid })).toMatchObject({
			success: false,
			code: 'invalid-request',
		});
		expect(values).toEqual(before);
	});

	it('clears the previous tool model and effort on a tool change unless replacements are explicit', async () => {
		const api = service();
		await api.command({
			action: 'set',
			scope,
			patch: {
				defaultProvider: 'claude-code',
				defaultModel: 'opus',
				defaultReasoningEffort: 'high',
			},
		});
		expect(
			(await api.command({ action: 'set', scope, patch: { defaultProvider: 'codex' } })).settings
		).toEqual({ defaultProvider: 'codex' });
		expect(
			(
				await api.command({
					action: 'set',
					scope,
					patch: {
						defaultModel: 'custom-model',
						defaultReasoningEffort: 'medium',
						defaultProvider: 'claude-code',
					},
				})
			).settings
		).toEqual({
			defaultProvider: 'claude-code',
			modelProvider: 'claude-code',
			defaultModel: 'custom-model',
			defaultReasoningEffort: 'medium',
		});
		expect(
			(await api.command({ action: 'set', scope, patch: { defaultProvider: null } })).settings
		).toEqual({});
	});

	it('records the owner of a model without changing the inherited default tool', async () => {
		const api = service();
		expect(
			await api.command({
				action: 'set',
				scope,
				patch: {
					defaultModel: 'opus',
					defaultReasoningEffort: 'high',
					modelProvider: 'claude-code',
				},
			})
		).toMatchObject({
			success: true,
			settings: { modelProvider: 'claude-code', defaultModel: 'opus' },
		});
		expect((await api.command({ action: 'show', scope })).settings.defaultProvider).toBeUndefined();
	});

	it('requires an explicit model owner when neither a saved nor default tool is available', async () => {
		expect(
			await service().command({ action: 'set', scope, patch: { defaultModel: 'opus' } })
		).toMatchObject({ success: false, errorCode: 'modelProviderRequired' });
		expect(values).toEqual({});
	});

	it('returns translatable error codes without loading renderer translations in main', async () => {
		values.uiLanguage = 'zh-CN';
		const result = await service().command({
			action: 'set',
			scope,
			patch: { defaultPermissionMode: 'full' },
		});
		expect(result).toMatchObject({ errorCode: 'fullAccessRequired' });
		expect(result.error).toBeUndefined();
		const cases = [
			[{}, 'scopeRequired'],
			[{ action: 'set', scope }, 'invalidPatch'],
			[{ action: 'set', scope, patch: { unknown: 'value' } }, 'unknownSetting'],
			[{ action: 'set', scope, patch: { envVars: [] } }, 'invalidEnvironment'],
			[{ action: 'set', scope, patch: { defaultModel: '' } }, 'invalidSetting'],
			[{ action: 'set', scope, patch: { defaultProvider: 'terminal' } }, 'unknownProvider'],
			[{ action: 'set', scope, patch: { defaultPermissionMode: 'bad' } }, 'invalidPermission'],
		] as const;
		for (const [input, errorCode] of cases) {
			expect(await service().command(input)).toMatchObject({ errorCode });
		}
		for (const errorCode of [
			...cases.map((entry) => entry[1]),
			'fullAccessRequired',
			'saveFailed',
			'requestFailed',
			'modelProviderRequired',
		] as const) {
			const key = `workflows.projectSettings.errors.${errorCode}` as const;
			for (const locale of ['en', 'zh-CN'] as const) {
				expect(hasTranslation(locale, key)).toBe(true);
				expect(getTranslator(locale)(key, { field: 'defaultModel' })).not.toContain('{field}');
			}
		}
	});

	it('reports persistence failure without announcing a change', async () => {
		const api = createProjectSettingsService({
			settingsStore: {
				...store,
				set: () => {
					throw new Error('disk full');
				},
			} as never,
			onChanged: changed,
		});
		expect(
			await api.command({
				action: 'set',
				scope,
				patch: { modelProvider: 'claude-code', defaultModel: 'model' },
			})
		).toMatchObject({ success: false, code: 'persistence-failed' });
		expect(changed).not.toHaveBeenCalled();
	});
});
