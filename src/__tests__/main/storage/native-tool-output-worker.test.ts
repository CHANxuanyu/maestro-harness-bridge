import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import type { readToolOutputFile } from '../../../main/storage/native-tool-output';

let root: string;
let read: typeof readToolOutputFile;
beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-output-worker-'));
	await build({
		entryPoints: [
			'src/main/storage/native-tool-output.ts',
			'src/main/storage/native-tool-output-worker.ts',
		],
		outdir: root,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		logLevel: 'silent',
	});
	read = createRequire(import.meta.url)(
		path.join(root, 'native-tool-output.js')
	).readToolOutputFile;
});
afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

it('uses real workers, caps concurrent reads, and frees a slot after completion', async () => {
	const file = path.join(root, 'rollout.jsonl');
	const output = 'z'.repeat(9000) + 'WORKER TAIL';
	await fs.writeFile(
		file,
		JSON.stringify({
			type: 'response_item',
			payload: { type: 'function_call_output', call_id: 'call-1', output },
		})
	);
	const first = read(file, 'codex', 'call-1');
	const second = read(file, 'codex', 'call-1');
	expect(await read(file, 'codex', 'call-1')).toEqual({ status: 'busy' });
	expect(await first).toMatchObject({ status: 'found', text: output });
	expect(await second).toMatchObject({ status: 'found', text: output });
	expect(await read(file, 'codex', 'absent')).toEqual({ status: 'not-found' });
});
