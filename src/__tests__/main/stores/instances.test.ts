import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Use vi.hoisted to create mock state that's accessible in both mock factory and tests
// This ensures proper scoping and avoids potential test interference
const { mockStoreConstructorCalls, mockStoreContents } = vi.hoisted(() => ({
	mockStoreConstructorCalls: [] as Array<Record<string, unknown>>,
	mockStoreContents: new Map<string, string>(),
}));

// Mock electron
vi.mock('electron', () => ({
	app: {
		getPath: vi.fn().mockReturnValue('/mock/user/data'),
	},
}));

// Mock electron-store with a class that tracks constructor calls
vi.mock('electron-store', async () => {
	const { default: path } = await import('path');
	return {
		default: class MockStore {
			options: Record<string, unknown>;
			path: string;
			_serialize = JSON.stringify;
			constructor(options: Record<string, unknown>) {
				this.options = options;
				this.path = path.resolve(String(options.cwd ?? '/mock/user/data'), `${options.name}.json`);
				mockStoreContents.set(
					this.path,
					JSON.stringify({
						...(options.defaults as object),
						...JSON.parse(mockStoreContents.get(this.path) ?? '{}'),
					})
				);
				mockStoreConstructorCalls.push(options);
			}
			get(key: string) {
				return JSON.parse(mockStoreContents.get(this.path) ?? '{}')[key];
			}
			set(key: string | Record<string, unknown>, value?: unknown) {
				this._write({
					...JSON.parse(mockStoreContents.get(this.path) ?? '{}'),
					...(typeof key === 'string' ? { [key]: value } : key),
				});
			}
			_write(value: unknown) {
				mockStoreContents.set(this.path, this._serialize(value));
			}
		},
	};
});

// Mock utils
vi.mock('../../../main/stores/utils', () => ({
	getCustomSyncPath: vi.fn(),
}));

import {
	initializeStores,
	isInitialized,
	getStoreInstances,
	getCachedPaths,
} from '../../../main/stores/instances';
import { getCustomSyncPath } from '../../../main/stores/utils';
import {
	consumeExternalStoreChange,
	resetInternalWriteTracking,
} from '../../../main/stores/write-tracker';

const mockedGetCustomSyncPath = vi.mocked(getCustomSyncPath);

describe('stores/instances', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockStoreConstructorCalls.length = 0; // Clear tracked constructor calls
		mockStoreContents.clear();
		resetInternalWriteTracking();
		const readFileSync = fs.readFileSync;
		vi.spyOn(fs, 'readFileSync').mockImplementation(((file, ...args) => {
			const content = mockStoreContents.get(String(file));
			return content === undefined ? readFileSync(file, ...args) : Buffer.from(content);
		}) as typeof fs.readFileSync);
		mockedGetCustomSyncPath.mockReturnValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('initializeStores', () => {
		it.each([
			[{}, true, 'auto'],
			[{ newShell: false }, true, 'auto'],
			[{ newShell: false, newShellChoice: 'classic' }, false, 'classic'],
			[{ newShell: true, newShellChoice: 'new' }, true, 'new'],
		])('migrates before returning the settings store: %j', (stored, enabled, choice) => {
			mockStoreContents.set('/mock/user/data/maestro-settings.json', JSON.stringify(stored));
			initializeStores({ productionDataPath: '/mock/production/path' });
			expect(getStoreInstances().settingsStore!.get('newShell')).toBe(enabled);
			expect(getStoreInstances().settingsStore!.get('newShellChoice')).toBe(choice);
		});

		it('should initialize all stores', () => {
			const result = initializeStores({ productionDataPath: '/mock/production/path' });

			// Should create 9 stores (added agentCapabilitiesStore for snapshot persistence)
			expect(mockStoreConstructorCalls).toHaveLength(9);

			// Should return syncPath and bootstrapStore
			expect(result.syncPath).toBe('/mock/user/data');
			expect(result.bootstrapStore).toBeDefined();
		});

		it('should use custom sync path when available', () => {
			const customSyncPath = '/custom/sync/path';
			mockedGetCustomSyncPath.mockReturnValue(customSyncPath);

			const result = initializeStores({ productionDataPath: '/mock/production/path' });

			expect(result.syncPath).toBe(customSyncPath);
		});

		it('should create bootstrap store with userData path', () => {
			initializeStores({ productionDataPath: '/mock/production/path' });

			// First store created should be bootstrap
			expect(mockStoreConstructorCalls[0]).toEqual({
				name: 'maestro-bootstrap',
				cwd: '/mock/user/data',
				defaults: {},
				deserialize: expect.any(Function),
			});
		});

		it('configures stores with BOM-safe JSON deserialization', () => {
			initializeStores({ productionDataPath: '/mock/production/path' });

			for (const call of mockStoreConstructorCalls) {
				expect(call.deserialize).toEqual(expect.any(Function));
				expect((call.deserialize as (value: string) => unknown)('\uFEFF{"ok":true}')).toEqual({
					ok: true,
				});
			}
		});

		it('should create settings store with sync path', () => {
			initializeStores({ productionDataPath: '/mock/production/path' });

			// Second store created should be settings
			expect(mockStoreConstructorCalls[1]).toMatchObject({
				name: 'maestro-settings',
				cwd: '/mock/user/data',
			});
		});

		it('should create agent configs store with production path', () => {
			const productionPath = '/mock/production/path';
			initializeStores({ productionDataPath: productionPath });

			// Agent configs store should use production path
			const agentConfigsCall = mockStoreConstructorCalls.find(
				(call) => call.name === 'maestro-agent-configs'
			);
			expect(agentConfigsCall).toMatchObject({
				name: 'maestro-agent-configs',
				cwd: productionPath,
			});
		});

		it('should create window state store without cwd (local only)', () => {
			initializeStores({ productionDataPath: '/mock/production/path' });

			// Window state store should not have cwd
			const windowStateCall = mockStoreConstructorCalls.find(
				(call) => call.name === 'maestro-window-state'
			);
			expect(windowStateCall).toMatchObject({
				name: 'maestro-window-state',
				defaults: {
					width: 1400,
					height: 900,
					isMaximized: false,
					isFullScreen: false,
				},
			});
			// Window state should NOT have cwd
			expect(windowStateCall).not.toHaveProperty('cwd');
		});

		// Without this wiring the settings file watcher can't tell our own writes
		// from an external edit, and every settings:set bounces back to the
		// renderer as an "external change" that reloads over live typing.
		it('instruments both watched store instances with the correct file names', () => {
			initializeStores({ productionDataPath: '/mock/production/path' });
			const { settingsStore, agentConfigsStore } = getStoreInstances();

			settingsStore!.set('fontSize', 16);

			expect(consumeExternalStoreChange('maestro-settings.json', settingsStore!.path)).toBe(false);
			expect(
				consumeExternalStoreChange('maestro-agent-configs.json', agentConfigsStore!.path)
			).toBe(false);

			agentConfigsStore!.set('configs', {});

			expect(
				consumeExternalStoreChange('maestro-agent-configs.json', agentConfigsStore!.path)
			).toBe(false);
			mockStoreContents.set(settingsStore!.path, '{"fontSize":18}');
			expect(consumeExternalStoreChange('maestro-settings.json', settingsStore!.path)).toBe(true);
			expect(
				consumeExternalStoreChange('maestro-agent-configs.json', agentConfigsStore!.path)
			).toBe(false);
			expect(settingsStore!.path).toBe(path.resolve('/mock/user/data', 'maestro-settings.json'));
			expect(agentConfigsStore!.path).toBe(
				path.resolve('/mock/production/path', 'maestro-agent-configs.json')
			);
		});

		it('should log startup paths', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			initializeStores({ productionDataPath: '/mock/production/path' });

			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[STARTUP] userData path:'));
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[STARTUP] syncPath'));
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('[STARTUP] productionDataPath')
			);
		});
	});

	describe('isInitialized', () => {
		it('should return true after initialization', () => {
			initializeStores({ productionDataPath: '/mock/production/path' });

			expect(isInitialized()).toBe(true);
		});
	});

	describe('getStoreInstances', () => {
		it('should return all store instances after initialization', () => {
			initializeStores({ productionDataPath: '/mock/production/path' });

			const instances = getStoreInstances();

			expect(instances.bootstrapStore).toBeDefined();
			expect(instances.settingsStore).toBeDefined();
			expect(instances.sessionsStore).toBeDefined();
			expect(instances.groupsStore).toBeDefined();
			expect(instances.agentConfigsStore).toBeDefined();
			expect(instances.windowStateStore).toBeDefined();
			expect(instances.claudeSessionOriginsStore).toBeDefined();
			expect(instances.agentSessionOriginsStore).toBeDefined();
		});
	});

	describe('getCachedPaths', () => {
		it('should return cached paths after initialization', () => {
			initializeStores({ productionDataPath: '/mock/production/path' });

			const paths = getCachedPaths();

			expect(paths.syncPath).toBe('/mock/user/data');
			expect(paths.productionDataPath).toBe('/mock/production/path');
		});

		it('should return custom sync path when configured', () => {
			mockedGetCustomSyncPath.mockReturnValue('/custom/sync');

			initializeStores({ productionDataPath: '/mock/production/path' });

			const paths = getCachedPaths();

			expect(paths.syncPath).toBe('/custom/sync');
		});
	});
});
