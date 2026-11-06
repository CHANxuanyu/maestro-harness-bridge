import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
	codexRolloutSessionId,
	isCodexRollout,
	readCodexRollout,
	readCodexRolloutSync,
} from '../../shared/codexRollout';
let root: string;
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'rollout-cap-'));
});
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});
it.each(['.jsonl', '.jsonl.zst'])('parses current and legacy filenames with %s', (suffix) => {
	const id = '11111111-2222-4333-8444-555555555555';
	for (const timestamp of ['2026-11-03T00-00-00', '20261103_000000_000']) {
		const name = `rollout-${timestamp}-${id}${suffix}`;
		expect(isCodexRollout(name)).toBe(true);
		expect(codexRolloutSessionId(name)).toBe(id);
	}
	expect(isCodexRollout('unrelated.jsonl.zst')).toBe(false);
	expect(codexRolloutSessionId('legacy.jsonl.zst')).toBe('legacy');
});
it.each(['.jsonl', '.jsonl.zst'])('caps both source and expanded bytes with %s', async (suffix) => {
	const file = path.join(root, `rollout-test${suffix}`);
	const text = 'x'.repeat(4096);
	await fs.writeFile(file, suffix.endsWith('.zst') ? zstdCompressSync(text) : text);
	await expect(readCodexRollout(file, 128)).rejects.toThrow();
	expect(() => readCodexRolloutSync(file, 128)).toThrow();
	expect(await readCodexRollout(file, 4096)).toBe(text);
	expect(readCodexRolloutSync(file, 4096)).toBe(text);
});

it.each(['.jsonl', '.jsonl.zst'])('reads only a bounded prefix with %s', async (suffix) => {
	const file = path.join(root, `rollout-prefix${suffix}`);
	const content = 'metadata\n' + 'x'.repeat(1024 * 1024);
	await fs.writeFile(file, suffix.endsWith('.zst') ? zstdCompressSync(content) : content);
	expect(await readCodexRollout(file, 16384, { prefixBytes: 128 })).toBe(content.slice(0, 128));
	await expect(readCodexRollout(file, 128, { prefixBytes: 129 })).rejects.toThrow(RangeError);
	await expect(readCodexRollout(file, 128, { prefixBytes: 0 })).rejects.toThrow(RangeError);
});
