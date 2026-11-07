import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { beforeAll, afterAll, expect, it } from 'vitest';
import type { runNativeHistorySearch } from '../../../main/storage/native-history-search';
let root: string;
let run: typeof runNativeHistorySearch;
beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-search-worker-'));
	await build({
		entryPoints: [
			'src/main/storage/native-history-search.ts',
			'src/main/storage/native-history-search-worker.ts',
		],
		outdir: root,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
	});
	run = createRequire(import.meta.url)(
		path.join(root, 'native-history-search.js')
	).runNativeHistorySearch;
});
afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true });
});
it('terminates cancelled work, bounds concurrency and releases its slot', async () => {
	const abort = new AbortController();
	const first = run({ query: 'needle', accounts: [] }, abort.signal);
	const second = run({ query: 'needle', accounts: [] });
	expect(await run({ query: 'needle', accounts: [] })).toMatchObject({ unavailable: true });
	abort.abort();
	expect(await first).toMatchObject({ cancelled: true, hits: [] });
	expect(await second).toEqual({ hits: [], truncated: false });
	expect(await run({ query: 'needle', accounts: [] })).toEqual({ hits: [], truncated: false });
});
it('does not start an already cancelled request', async () => {
	const abort = new AbortController();
	abort.abort();
	expect(await run({ query: 'needle', accounts: [] }, abort.signal)).toMatchObject({
		cancelled: true,
	});
});
