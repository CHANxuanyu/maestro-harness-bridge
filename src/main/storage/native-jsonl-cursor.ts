import fs from 'fs/promises';

// The same byte cursor and prefix/boundary checks used by Claude/Codex storage.
// Providers keep their own small view maps; this helper owns no global cache.
export interface NativeJsonlCursor<T> {
	dev: number;
	ino: number;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
	offset: number;
	head: Buffer;
	boundary: Buffer;
	rows: T[];
	visible: T[];
}

export function parseNativeJsonl<T>(content: string): T[] {
	const rows: T[] = [];
	for (const line of content.split('\n')) {
		if (!line.trim()) continue;
		try {
			rows.push(JSON.parse(line) as T);
		} catch {
			/* Native writers can leave a partial tail. */
		}
	}
	return rows;
}

export async function nativeFileRevision(file: string): Promise<string | null> {
	try {
		const stat = await fs.stat(file);
		return `${file}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

export async function readNativeJsonl<T>(
	filePath: string,
	prior?: NativeJsonlCursor<T>
): Promise<{ rows: T[]; cursor?: NativeJsonlCursor<T> }> {
	const file = await fs.open(filePath, 'r');
	try {
		const stat = await file.stat();
		if (
			prior &&
			(prior.dev !== stat.dev ||
				prior.ino !== stat.ino ||
				stat.size < prior.size ||
				(stat.size === prior.size &&
					(stat.mtimeMs !== prior.mtimeMs || stat.ctimeMs !== prior.ctimeMs)))
		)
			prior = undefined;
		if (prior && stat.size === prior.size) return { rows: prior.visible, cursor: prior };
		if (prior) {
			const head = Buffer.alloc(prior.head.length);
			const boundary = Buffer.alloc(prior.boundary.length);
			await file.read(head, 0, head.length, 0);
			await file.read(boundary, 0, boundary.length, prior.offset - boundary.length);
			if (!head.equals(prior.head) || !boundary.equals(prior.boundary)) prior = undefined;
		}
		const start = prior?.offset ?? 0;
		const bytes = Buffer.alloc(stat.size - start);
		let read = 0;
		while (read < bytes.length) {
			const { bytesRead } = await file.read(bytes, read, bytes.length - read, start + read);
			if (!bytesRead)
				throw new Error('Native transcript changed during read; refresh again when idle');
			read += bytesRead;
		}
		const complete = bytes.lastIndexOf(10) + 1;
		const rows = (prior?.rows ?? []).concat(
			parseNativeJsonl<T>(bytes.subarray(0, complete).toString('utf8'))
		);
		// A complete row without newline is visible but remains uncommitted. A split
		// UTF-8/JSON tail is re-read intact when the provider finishes appending it.
		const visible =
			complete < bytes.length
				? rows.concat(parseNativeJsonl<T>(bytes.subarray(complete).toString('utf8')))
				: rows;
		if (stat.size > 32 * 1024 * 1024) return { rows: visible };
		const offset = start + complete;
		const head = Buffer.alloc(Math.min(256, offset));
		const boundary = Buffer.alloc(Math.min(256, offset));
		await file.read(head, 0, head.length, 0);
		await file.read(boundary, 0, boundary.length, offset - boundary.length);
		return {
			rows: visible,
			cursor: {
				dev: stat.dev,
				ino: stat.ino,
				size: stat.size,
				mtimeMs: stat.mtimeMs,
				ctimeMs: stat.ctimeMs,
				offset,
				head,
				boundary,
				rows,
				visible,
			},
		};
	} finally {
		await file.close();
	}
}
