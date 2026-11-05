/** Tests for content-based suppression of internal store writes. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Conf from 'conf';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	consumeExternalStoreChange,
	resetInternalWriteTracking,
	trackStoreWrites,
} from '../../../main/stores/write-tracker';

describe('main/stores/write-tracker', () => {
	let root: string;
	let store: Conf<Record<string, unknown>>;
	const filename = 'maestro-settings.json';

	beforeEach(() => {
		vi.useFakeTimers();
		resetInternalWriteTracking();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-write-tracker-'));
		store = new Conf({ cwd: root, configName: 'maestro-settings', defaults: { value: 'initial' } });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('does not suppress an untracked file', () => {
		expect(consumeExternalStoreChange(filename, store.path)).toBe(true);
	});

	it('recognizes the initial content without an app mutation', () => {
		trackStoreWrites(store, filename);

		expect(consumeExternalStoreChange(filename, store.path)).toBe(false);
	});

	it('recognizes our written content regardless of elapsed time', () => {
		trackStoreWrites(store, filename);
		const result = store.set('value', 'app');
		vi.advanceTimersByTime(10000);

		expect(result).toBeUndefined();
		expect(store.get('value')).toBe('app');
		expect(consumeExternalStoreChange(filename, store.path)).toBe(false);
	});

	it.each(['delete', 'clear', 'reset'] as const)(
		'tracks %s, including nested mutators',
		(method) => {
			trackStoreWrites(store, filename);
			store.set('value', 'app');

			store[method]('value');

			expect(store.get('value')).toBe(method === 'delete' ? undefined : 'initial');
			expect(consumeExternalStoreChange(filename, store.path)).toBe(false);
		}
	);

	it('tracks full-document assignment too', () => {
		trackStoreWrites(store, filename);
		store.store = { replaced: true };

		expect(store.store).toEqual({ replaced: true });
		expect(consumeExternalStoreChange(filename, store.path)).toBe(false);
	});

	it('does not acknowledge external content during a read', () => {
		trackStoreWrites(store, filename);
		fs.writeFileSync(store.path, '{"value":"external"}');

		expect(store.get('value')).toBe('external');
		expect(consumeExternalStoreChange(filename, store.path)).toBe(true);
		expect(consumeExternalStoreChange(filename, store.path)).toBe(false);
	});

	it('keeps files independent', () => {
		trackStoreWrites(store, filename);
		const configs = trackStoreWrites(
			new Conf({ cwd: root, configName: 'maestro-agent-configs', defaults: {} }),
			'maestro-agent-configs.json'
		);
		store.set('value', 'app');
		configs.set('configs', {});
		fs.writeFileSync(store.path, '{"value":"external"}');

		expect(consumeExternalStoreChange('maestro-agent-configs.json', configs.path)).toBe(false);
		expect(consumeExternalStoreChange(filename, store.path)).toBe(true);
	});

	it('preserves an external edit when an internal mutation throws', () => {
		const target = store as unknown as { _write(value: unknown): void };
		vi.spyOn(target, '_write').mockImplementation(() => {
			throw new Error('ENOSPC');
		});
		trackStoreWrites(store, filename);
		fs.writeFileSync(store.path, '{"value":"external"}');

		expect(() => store.set('value', 'app')).toThrow('ENOSPC');
		expect(store.get('value')).toBe('external');
		expect(consumeExternalStoreChange(filename, store.path)).toBe(true);
	});

	it('does not acknowledge serialized bytes from a failed write', () => {
		const target = store as unknown as {
			_serialize(value: unknown): string;
			_write(value: unknown): void;
		};
		vi.spyOn(target, '_write').mockImplementation((value) => {
			target._serialize(value);
			throw new Error('ENOSPC');
		});
		trackStoreWrites(store, filename);

		expect(() => store.set('value', 'app')).toThrow('ENOSPC');
		expect(store.get('value')).toBe('initial');
		expect(consumeExternalStoreChange(filename, store.path)).toBe(false);
	});

	it('captures the actual serializer output rather than a later external replacement', () => {
		store = new Conf({ cwd: root, configName: 'maestro-settings', serialize: JSON.stringify });
		const target = store as unknown as { _write(value: unknown): void };
		const write = target._write;
		vi.spyOn(target, '_write').mockImplementation((value) => {
			write.call(store, value);
			fs.writeFileSync(store.path, '{"value":"external"}');
		});
		trackStoreWrites(store, filename);

		store.set('value', 'app');

		expect(consumeExternalStoreChange(filename, store.path)).toBe(true);
	});
});
