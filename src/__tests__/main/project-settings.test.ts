import { createMockSession } from '../helpers/mockSession';
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
		changed.mockReset();
	});
	const service = () =>
		createProjectSettingsService({ settingsStore: store as never, onChanged: changed });
	const scope = { projectPath: '/tmp/project-settings-fixture' };

	it.each(['sessions', 'flush', 'settings'])(
		'rolls back every store when %s fails after mutation',
		async (step) => {
			values = {
				newShell: true,
				projectSettings: { [projectSettingsKey(scope)]: { defaultProvider: 'claude-code' } },
			};
			let sessions = [
				createMockSession({
					id: 'owner',
					cwd: scope.projectPath,
					projectRoot: scope.projectPath,
					customPath: '/fixture/old',
				}),
			];
			const beforeSettings = structuredClone(values);
			const beforeSessions = structuredClone(sessions);
			let failed = false;
			const fail = (at: string) => {
				if (at === step && !failed) {
					failed = true;
					throw new Error('injected write failure');
				}
			};
			const api = createProjectSettingsService({
				settingsStore: {
					...store,
					set: (key: string, value: unknown) => {
						store.set(key, value);
						fail('settings');
					},
				} as never,
				sessionsStore: {
					get: () => sessions,
					set: (_key: string, value: typeof sessions) => {
						sessions = structuredClone(value);
						fail('sessions');
					},
				},
				flushSessionWrites: async () => {
					fail('flush');
				},
				onChanged: changed,
			});
			expect(
				await api.command({
					action: 'set',
					scope,
					patch: { defaultProvider: 'codex' },
					toolPatches: { owner: { customPath: '/fixture/new' } },
				})
			).toMatchObject({ success: false, code: 'persistence-failed' });
			expect(failed).toBe(true);
			expect(values).toEqual(beforeSettings);
			expect(sessions).toEqual(beforeSessions);
			expect(changed).not.toHaveBeenCalled();
		}
	);

	it('still rolls back if the shell setting changes while the disk write is pending', async () => {
		values.newShell = true;
		const owner = createMockSession({
			id: 'owner',
			cwd: scope.projectPath,
			projectRoot: scope.projectPath,
		});
		let sessions = [owner];
		const flush = vi
			.fn()
			.mockImplementationOnce(async () => {
				values.newShell = false;
				throw new Error('pending write failed');
			})
			.mockResolvedValue(undefined);
		const api = createProjectSettingsService({
			settingsStore: store as never,
			sessionsStore: {
				get: () => sessions,
				set: (_key, updated) => {
					sessions = updated as typeof sessions;
				},
			},
			flushSessionWrites: flush,
			onChanged: changed,
		});
		expect(
			await api.command({
				action: 'set',
				scope,
				patch: { defaultProvider: 'codex' },
				toolPatches: { owner: { customArgs: '--new' } },
			})
		).toMatchObject({ success: false, errorCode: 'saveFailed' });
		expect(sessions).toEqual([owner]);
		expect(values).toEqual({ newShell: false });
		expect(changed).not.toHaveBeenCalled();
	});

	it('does not report a save failure after a committed transaction when a listener fails', async () => {
		values.newShell = true;
		changed.mockImplementation(() => {
			throw new Error('listener disconnected');
		});
		expect(
			await service().command({ action: 'set', scope, patch: { defaultProvider: 'codex' } })
		).toMatchObject({ success: true });
		expect((await service().command({ action: 'show', scope })).settings.defaultProvider).toBe(
			'codex'
		);
	});

	it('restores an absent defaults key when its first write fails after mutation', async () => {
		values.newShell = true;
		const api = createProjectSettingsService({
			settingsStore: {
				...store,
				set: (key: string, value: unknown) => {
					store.set(key, value);
					throw new Error('write failed');
				},
				delete: (key: string) => {
					delete values[key];
				},
			} as never,
			onChanged: changed,
		});
		expect(
			await api.command({ action: 'set', scope, patch: { defaultProvider: 'codex' } })
		).toMatchObject({ success: false, errorCode: 'saveFailed' });
		expect(values).toEqual({ newShell: true });
		expect(changed).not.toHaveBeenCalled();
	});

	it('validates every tool before saving project defaults or any tool', async () => {
		values.newShell = true;
		const set = vi.fn();
		const api = createProjectSettingsService({
			settingsStore: { ...store, set } as never,
			sessionsStore: {
				get: () => [
					createMockSession({
						id: 'owner',
						cwd: scope.projectPath,
						projectRoot: scope.projectPath,
					}),
				],
				set,
			},
			flushSessionWrites: async () => {},
		});
		expect(
			await api.command({
				action: 'set',
				scope,
				patch: { defaultProvider: 'codex' },
				toolPatches: {
					owner: { customPath: '/fixture/new' },
					missing: { customArgs: '--changed' },
				},
			})
		).toMatchObject({ success: false });
		expect(set).not.toHaveBeenCalled();
	});

	it('commits all tool patches once and preserves live conversations and untouched tools', async () => {
		values.newShell = true;
		const owner = createMockSession({
			id: 'owner',
			cwd: scope.projectPath,
			projectRoot: scope.projectPath,
		});
		const sibling = createMockSession({ ...owner, id: 'sibling', customPath: '/fixture/old' });
		const untouched = createMockSession({ ...owner, id: 'untouched' });
		let sessions = [owner, sibling, untouched];
		const write = vi.fn((_key, updated) => {
			sessions = updated;
		});
		const flush = vi.fn().mockResolvedValue(undefined);
		const api = createProjectSettingsService({
			settingsStore: store as never,
			sessionsStore: { get: () => sessions, set: write },
			flushSessionWrites: flush,
			onChanged: changed,
		});
		expect(
			await api.command({
				action: 'set',
				scope,
				patch: { defaultProvider: 'codex' },
				toolPatches: { owner: { customArgs: '--new' }, sibling: { customPath: null } },
			})
		).toMatchObject({ success: true });
		expect(write).toHaveBeenCalledTimes(1);
		expect(flush).toHaveBeenCalledTimes(1);
		expect(sessions[0]).toEqual({ ...owner, customArgs: '--new' });
		expect(sessions[1]).toEqual({ ...sibling, customPath: undefined });
		expect(sessions[2]).toBe(untouched);
		expect(changed).toHaveBeenCalledExactlyOnceWith({
			owner: { customArgs: '--new' },
			sibling: { customPath: undefined },
		});
	});

	it.each([
		{ newShell: false, patch: { customArgs: '--new' }, errorCode: 'newShellRequired' },
		{ newShell: true, patch: { aiTabs: [] }, errorCode: 'invalidPatch' },
		{ newShell: true, patch: { maestroPMode: 'unsupported' }, errorCode: 'invalidSetting' },
		{ newShell: true, patch: { contextWindowSource: 'unsupported' }, errorCode: 'invalidSetting' },
		{
			newShell: true,
			patch: { customEnvVars: { 'BAD-KEY': 'bad' } },
			errorCode: 'invalidEnvironment',
		},
		{
			newShell: true,
			patch: { sessionSshRemoteConfig: { enabled: true, remoteId: 'host' } },
			errorCode: 'toolRunning',
		},
	])('rejects invalid tool changes before writing: %j', async ({ newShell, patch, errorCode }) => {
		values.newShell = newShell;
		const owner = createMockSession({
			id: 'owner',
			cwd: scope.projectPath,
			projectRoot: scope.projectPath,
		});
		const write = vi.fn();
		const api = createProjectSettingsService({
			settingsStore: { ...store, set: write } as never,
			sessionsStore: { get: () => [owner], set: write },
			flushSessionWrites: async () => {},
			isSessionRunning: () => true,
		});
		expect(
			await api.command({
				action: 'set',
				scope,
				patch: { defaultProvider: 'codex' },
				toolPatches: { owner: patch },
			})
		).toMatchObject({ success: false, errorCode });
		expect(write).not.toHaveBeenCalled();
	});

	it('reports a failed rollback explicitly and still restores the other store', async () => {
		values.newShell = true;
		const owner = createMockSession({
			id: 'owner',
			cwd: scope.projectPath,
			projectRoot: scope.projectPath,
		});
		let sessions = [owner];
		const api = createProjectSettingsService({
			settingsStore: {
				...store,
				set: () => {
					throw new Error('disk unavailable');
				},
			} as never,
			sessionsStore: {
				get: () => sessions,
				set: (_key, value) => {
					sessions = value as typeof sessions;
				},
			},
			flushSessionWrites: async () => {},
		});
		expect(
			await api.command({
				action: 'set',
				scope,
				patch: {},
				toolPatches: { owner: { customArgs: '--new' } },
			})
		).toMatchObject({ success: false, errorCode: 'rollbackFailed' });
		expect(sessions).toEqual([owner]);
	});

	it('keeps auto handoff off by default and isolates its target by project and host', async () => {
		const api = service();
		expect(
			(await api.command({ action: 'show', scope })).settings.autoHandoffTarget
		).toBeUndefined();
		for (const sshRemoteId of [undefined, 'host-a', 'host-b']) {
			const location = { ...scope, sshRemoteId };
			expect(
				await api.command({
					action: 'set',
					scope: location,
					patch: { autoHandoffTarget: sshRemoteId ?? 'local-target' },
				})
			).toMatchObject({ success: true });
		}
		for (const sshRemoteId of [undefined, 'host-a', 'host-b']) {
			expect(
				(await api.command({ action: 'show', scope: { ...scope, sshRemoteId } })).settings
					.autoHandoffTarget
			).toBe(sshRemoteId ?? 'local-target');
		}
		expect(
			(await api.command({ action: 'show', scope: { projectPath: '/tmp/other' } })).settings
				.autoHandoffTarget
		).toBeUndefined();
		expect(
			await api.command({ action: 'set', scope, patch: { autoHandoffTarget: null } })
		).toMatchObject({ success: true, settings: {} });
	});

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

	it('matches local Windows case variants while preserving POSIX and SSH case', async () => {
		expect(projectSettingsKey({ projectPath: 'C:\\Work\\Repo\\' })).toBe(
			projectSettingsKey({ projectPath: 'c:/work/repo' })
		);
		expect(projectSettingsKey({ projectPath: '\\\\Server\\Share\\Repo' })).toBe(
			projectSettingsKey({ projectPath: '//server/share/repo' })
		);
		for (const sshRemoteId of [undefined, 'remote']) {
			expect(projectSettingsKey({ projectPath: '/Work/Repo', sshRemoteId })).not.toBe(
				projectSettingsKey({ projectPath: '/work/repo', sshRemoteId })
			);
		}
		expect(projectSettingsKey({ projectPath: 'C:/Work/Repo', sshRemoteId: 'remote' })).not.toBe(
			projectSettingsKey({ projectPath: 'c:/work/repo', sshRemoteId: 'remote' })
		);
	});

	it('reads and updates saved mixed-case Windows keys without losing settings or host isolation', async () => {
		values.projectSettings = {
			'[null,"C:/Work/Repo"]': {
				defaultPermissionMode: 'readonly',
				fullAccessAcknowledged: true,
				envVars: { TOKEN: 'synthetic-only' },
			},
			'["remote","C:/Work/Repo"]': { defaultPermissionMode: 'standard' },
		};
		const api = service();
		const target = { projectPath: 'c:/work/repo/' };
		expect((await api.command({ action: 'show', scope: target })).settings).toEqual({
			defaultPermissionMode: 'readonly',
			fullAccessAcknowledged: true,
			envVars: { TOKEN: 'synthetic-only' },
		});
		await api.command({ action: 'set', scope: target, patch: { defaultProvider: 'codex' } });
		expect(
			(await api.command({ action: 'show', scope: { projectPath: 'C:/WORK/REPO' } })).settings
		).toEqual({
			defaultProvider: 'codex',
			defaultPermissionMode: 'readonly',
			fullAccessAcknowledged: true,
			envVars: { TOKEN: 'synthetic-only' },
		});
		expect(Object.keys(values.projectSettings as object)).toHaveLength(2);
		expect(
			(
				await api.command({
					action: 'show',
					scope: { projectPath: 'C:/Work/Repo', sshRemoteId: 'remote' },
				})
			).settings.defaultPermissionMode
		).toBe('standard');
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
			'toolMissing',
			'toolRunning',
			'newShellRequired',
			'rollbackFailed',
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
