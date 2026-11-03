import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { zstdDecompressSync } from 'node:zlib';

/** The same bound applies to native bytes and decompressed transcript bytes. */
export const MAX_CODEX_ROLLOUT_BYTES = 100 * 1024 * 1024;

export function isCodexRollout(filename: string): boolean {
	return /^rollout-.*\.jsonl(?:\.zst)?$/i.test(filename);
}

/** Retain the legacy filename fallback used by existing history imports. */
export function codexRolloutSessionId(filename: string): string {
	const native = filename.match(
		/-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.jsonl(?:\.zst)?$/i
	);
	if (native) return native[1];
	const legacy = filename.match(/rollout-[\d_]+-([a-f0-9-]+)\.jsonl(?:\.zst)?$/i);
	return legacy?.[1] ?? filename.replace(/\.jsonl(?:\.zst)?$/i, '');
}

/** One UUID has one source. A writable plain rollout wins over its archive. */
export function preferPlainCodexRollouts<T>(
	files: readonly T[],
	filename: (file: T) => string
): T[] {
	const selected = new Map<string, T>();
	for (const file of files) {
		const name = filename(file);
		const id = codexRolloutSessionId(name);
		if (!selected.has(id) || !name.endsWith('.zst')) selected.set(id, file);
	}
	return [...selected.values()];
}

export function decodeCodexRollout(
	bytes: Buffer,
	filename: string,
	maxBytes = MAX_CODEX_ROLLOUT_BYTES
): string {
	if (bytes.length > maxBytes) throw new RangeError('Codex rollout exceeds the read size limit');
	if (!filename.endsWith('.zst')) return bytes.toString('utf8');
	if (typeof zstdDecompressSync !== 'function') {
		throw new Error('Reading compressed Codex history requires a Node runtime with zstd support');
	}
	return zstdDecompressSync(bytes, { maxOutputLength: maxBytes }).toString('utf8');
}

/** Read-only, bounded in memory. Never materializes a native archive on disk. */
export async function readCodexRollout(
	file: string,
	maxBytes = MAX_CODEX_ROLLOUT_BYTES
): Promise<string> {
	const handle = await fsp.open(file, 'r');
	try {
		const stat = await handle.stat();
		if (stat.size > maxBytes) throw new RangeError('Codex rollout exceeds the read size limit');
		const bytes = Buffer.alloc(stat.size);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
			if (!bytesRead) throw new Error('Codex rollout changed during read');
			offset += bytesRead;
		}
		return decodeCodexRollout(bytes, file, maxBytes);
	} finally {
		await handle.close();
	}
}

export function readCodexRolloutSync(file: string, maxBytes = MAX_CODEX_ROLLOUT_BYTES): string {
	const fd = fs.openSync(file, 'r');
	try {
		const stat = fs.fstatSync(fd);
		if (stat.size > maxBytes) throw new RangeError('Codex rollout exceeds the read size limit');
		const bytes = Buffer.alloc(stat.size);
		let offset = 0;
		while (offset < bytes.length) {
			const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
			if (!count) throw new Error('Codex rollout changed during read');
			offset += count;
		}
		return decodeCodexRollout(bytes, file, maxBytes);
	} finally {
		fs.closeSync(fd);
	}
}
