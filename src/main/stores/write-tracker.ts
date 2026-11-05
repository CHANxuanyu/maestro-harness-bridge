/**
 * Distinguish app writes from external edits by content, without a time window
 * that could hide a CLI write. Only hashes are retained, never settings values.
 */
import { createHash } from 'crypto';
import fs from 'fs';

interface WriteState {
	hash: string | undefined;
	externalChange: boolean;
}

const writes = new Map<string, WriteState>();

function contentHash(content: string | Buffer): string {
	return createHash('sha256').update(content).digest('hex');
}

function fileHash(filePath: string): string | undefined {
	try {
		return contentHash(fs.readFileSync(filePath));
	} catch {
		// Missing or unreadable content cannot prove that an event is our own.
		return undefined;
	}
}

/** Acknowledge changed content when the watcher queues its reload notification. */
export function consumeExternalStoreChange(fileName: string, filePath: string): boolean {
	const state = writes.get(fileName);
	const hash = fileHash(filePath);
	if (!state) return true;
	if (!state.externalChange && hash !== undefined && hash === state.hash) return false;
	state.hash = hash;
	state.externalChange = false;
	return true;
}

/** Test-only: forget every recorded write. */
export function resetInternalWriteTracking(): void {
	writes.clear();
}

/**
 * Instrument conf's synchronous write and serializer on this instance. All
 * mutators (including assigning store.store) use these two hooks. Capture the
 * actual serialized bytes, rather than reading after a write, when another
 * process may already have replaced them. Commit the hash only on success.
 *
 * Before each write, latch any disk content we did not write or acknowledge.
 * electron-store re-reads external values before mutating, so its next write
 * can carry them forward before fs.watch fires. That pending external change
 * must survive even when the final file matches our latest serialized hash.
 */
export function trackStoreWrites<T>(store: T, fileName: string): T {
	const target = store as unknown as {
		path: string;
		_serialize: (value: unknown) => string;
		_write: (value: unknown) => unknown;
	};
	const state: WriteState = { hash: fileHash(target.path), externalChange: false };
	writes.set(fileName, state);
	const serialize = target._serialize;
	const write = target._write;
	let serializedHash: string | undefined;

	Object.defineProperty(store, '_serialize', {
		value: (value: unknown) => {
			const content = serialize.call(store, value);
			serializedHash = contentHash(content);
			return content;
		},
		writable: true,
		configurable: true,
	});
	Object.defineProperty(store, '_write', {
		value: (value: unknown) => {
			if (fileHash(target.path) !== state.hash) state.externalChange = true;
			const result = write.call(store, value);
			state.hash = serializedHash;
			return result;
		},
		writable: true,
		configurable: true,
	});
	return store;
}
