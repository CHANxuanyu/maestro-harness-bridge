import fs from 'fs';
import os from 'os';
import path from 'path';
import Conf from 'conf';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createSettingsWatcher,
	type SettingsWatcher,
} from '../../../main/app-lifecycle/settings-watcher';
import { resetInternalWriteTracking, trackStoreWrites } from '../../../main/stores/write-tracker';

vi.mock('../../../main/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe.each(['maestro-settings.json', 'maestro-agent-configs.json'])(
	'settings watcher content: %s',
	(filename) => {
		let root: string;
		let store: Conf<Record<string, unknown>>;
		let watcher: SettingsWatcher;
		let callbacks: Array<(event: string, filename: string) => void>;
		let sends: ReturnType<typeof vi.fn>[];
		let onSettingsChangedExternally: ReturnType<typeof vi.fn>;

		function emitChange() {
			for (const callback of callbacks) callback('change', filename);
		}

		function writeExternally() {
			const data = JSON.parse(fs.readFileSync(store.path, 'utf8'));
			fs.writeFileSync(store.path, JSON.stringify({ ...data, external: 'CLI value' }, null, '\t'));
		}

		function expectNotifications(count: number) {
			for (const send of sends) {
				expect(send).toHaveBeenCalledTimes(count);
				if (count) expect(send).toHaveBeenCalledWith('settings:externalChange');
			}
			expect(onSettingsChangedExternally).toHaveBeenCalledTimes(
				filename === 'maestro-settings.json' ? count : 0
			);
		}

		beforeEach(() => {
			vi.useFakeTimers();
			resetInternalWriteTracking();
			root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-settings-watcher-'));
			store = trackStoreWrites(
				new Conf({ cwd: root, configName: path.basename(filename, '.json'), defaults: {} }),
				filename
			);
			callbacks = [];
			vi.spyOn(fs, 'watch').mockImplementation(((
				_dir: string,
				callback: (event: string, filename: string) => void
			) => {
				callbacks.push(callback);
				return { close: vi.fn(), on: vi.fn() };
			}) as typeof fs.watch);
			sends = [vi.fn(), vi.fn()];
			onSettingsChangedExternally = vi.fn();
			watcher = createSettingsWatcher({
				getBroadcastWindows: () =>
					sends.map(
						(send) =>
							({
								isDestroyed: () => false,
								webContents: { send, isDestroyed: () => false },
							}) as unknown as BrowserWindow
					),
				getSettingsPath: () => root,
				getAgentConfigsPath: () => root,
				onSettingsChangedExternally,
			});
			watcher.start();
		});

		afterEach(() => {
			watcher.stop();
			vi.restoreAllMocks();
			vi.useRealTimers();
			fs.rmSync(root, { recursive: true, force: true });
		});

		it('notifies for an external write 100 ms after an internal write', () => {
			store.set('internal', 'app value');
			emitChange();
			vi.advanceTimersByTime(100);
			writeExternally();
			emitChange();
			vi.advanceTimersByTime(400);

			expect(store.get('external')).toBe('CLI value');
			expectNotifications(1);
		});

		it('does not notify for an internal write alone, even if its event is delayed', () => {
			store.set('internal', 'app value');
			vi.advanceTimersByTime(1000);
			emitChange();
			vi.advanceTimersByTime(400);

			expectNotifications(0);
		});

		it('does not notify for rapid internal writes while typing', () => {
			for (let i = 0; i < 20; i++) {
				store.set('conductorProfile', 'x'.repeat(i));
				emitChange();
				vi.advanceTimersByTime(120);
			}
			vi.advanceTimersByTime(400);

			expectNotifications(0);
		});

		it.each([true, false])(
			'notifies once when an internal write carries an external value forward (early event: %s)',
			(earlyEvent) => {
				store.set('internal', 'first app value');
				emitChange();
				vi.advanceTimersByTime(100);
				writeExternally();
				if (earlyEvent) emitChange();
				vi.advanceTimersByTime(100);
				store.set('internal', 'next app value');
				emitChange();
				emitChange();
				vi.advanceTimersByTime(400);

				expect(store.get('external')).toBe('CLI value');
				expectNotifications(1);
				store.set('internal', 'later app value');
				emitChange();
				vi.advanceTimersByTime(1000);
				expectNotifications(1);
			}
		);
	}
);
