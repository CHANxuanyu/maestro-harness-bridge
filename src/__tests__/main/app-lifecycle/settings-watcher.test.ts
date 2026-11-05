/**
 * Tests for the settings file watcher factory.
 *
 * The behaviour that matters most here is self-write suppression: the app
 * writes maestro-settings.json on every settings change (one write per
 * keystroke for text settings like the Conductor Profile), and each of those
 * writes trips the same fs.watch the CLI does. Echoing them back to the
 * renderer as "external change" makes it reload settings asynchronously and
 * clobber whatever is being typed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FSWatcher, WatchEventType } from 'fs';
import type { BrowserWindow } from 'electron';
import { trackStoreWrites } from '../../../main/stores/write-tracker';

type WatchCallback = (eventType: WatchEventType, filename: string | null) => void;

// Every fs.watch registration, in order (settings dir + agent-configs dir).
let watcherCallbacks: WatchCallback[] = [];
const mockClose = vi.fn();

const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWatch = vi.fn((...args: unknown[]) => {
	watcherCallbacks.push(args[1] as WatchCallback);
	return {
		close: mockClose,
		on: vi.fn(),
	} as unknown as FSWatcher;
});

vi.mock('fs', () => ({
	default: {
		existsSync: (...args: unknown[]) => mockExistsSync(...args),
		readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
		mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
		watch: (...args: unknown[]) => mockWatch(...args),
	},
	readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
	existsSync: (...args: unknown[]) => mockExistsSync(...args),
	mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
	watch: (...args: unknown[]) => mockWatch(...args),
}));

vi.mock('../../../main/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('app-lifecycle/settings-watcher', () => {
	let send: ReturnType<typeof vi.fn>;
	// rc broadcasts the reload to EVERY open window rather than just the main
	// one, so the watcher takes an enumerator instead of a getMainWindow.
	let getBroadcastWindows: () => BrowserWindow[];
	let store: { _serialize(value: unknown): string; _write(value: unknown): void };

	function writeInternally() {
		store._write({ conductorProfile: 'app value' });
	}

	/** Fire a change event for `filename` on every registered watcher. */
	function emitChange(filename: string) {
		for (const cb of watcherCallbacks) {
			cb('change', filename);
		}
	}

	async function startWatcher() {
		const { createSettingsWatcher } = await import('../../../main/app-lifecycle/settings-watcher');
		const watcher = createSettingsWatcher({
			getBroadcastWindows,
			getSettingsPath: () => '/test/sync',
			getAgentConfigsPath: () => '/test/sync',
		});
		watcher.start();
		return watcher;
	}

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		watcherCallbacks = [];
		send = vi.fn();
		const win = {
			isDestroyed: () => false,
			webContents: { send, isDestroyed: () => false },
		} as unknown as BrowserWindow;
		getBroadcastWindows = () => [win];
		mockExistsSync.mockReturnValue(true);

		const { resetInternalWriteTracking } = await import('../../../main/stores/write-tracker');
		resetInternalWriteTracking();
		mockReadFileSync.mockReturnValue(Buffer.from('{}'));
		store = trackStoreWrites(
			{
				path: '/test/sync/maestro-settings.json',
				_serialize: JSON.stringify,
				_write(value: unknown) {
					mockReadFileSync.mockReturnValue(Buffer.from(this._serialize(value)));
				},
			},
			'maestro-settings.json'
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('notifies the renderer for an external settings change', async () => {
		await startWatcher();

		mockReadFileSync.mockReturnValue(Buffer.from('{"external":true}'));
		emitChange('maestro-settings.json');
		vi.advanceTimersByTime(400);

		expect(send).toHaveBeenCalledWith('settings:externalChange');
	});

	it('ignores unrelated files in the watched directory', async () => {
		await startWatcher();

		emitChange('maestro-sessions.json');
		vi.advanceTimersByTime(400);

		expect(send).not.toHaveBeenCalled();
	});

	it("does not notify the renderer for the app's own settings write", async () => {
		await startWatcher();

		writeInternally();
		emitChange('maestro-settings.json');
		vi.advanceTimersByTime(400);

		expect(send).not.toHaveBeenCalled();
	});

	it('suppresses a burst of self-writes (typing in a text setting)', async () => {
		await startWatcher();

		for (let i = 0; i < 20; i++) {
			writeInternally();
			emitChange('maestro-settings.json');
			vi.advanceTimersByTime(120); // ~8 keystrokes/sec
		}
		vi.advanceTimersByTime(400);

		expect(send).not.toHaveBeenCalled();
	});

	it('notifies for new external content after an earlier internal write', async () => {
		await startWatcher();

		writeInternally();
		vi.advanceTimersByTime(501);
		mockReadFileSync.mockReturnValue(Buffer.from('{"conductorProfile":"external value"}'));

		emitChange('maestro-settings.json');
		vi.advanceTimersByTime(400);

		expect(send).toHaveBeenCalledWith('settings:externalChange');
	});

	it('tracks each watched file independently', async () => {
		await startWatcher();

		// A settings write must not mask an external agent-config change.
		writeInternally();
		emitChange('maestro-agent-configs.json');
		vi.advanceTimersByTime(400);

		expect(send).toHaveBeenCalledWith('settings:externalChange');
	});

	it('stops watching on stop()', async () => {
		const watcher = await startWatcher();

		watcher.stop();

		expect(mockClose).toHaveBeenCalled();
	});
});
