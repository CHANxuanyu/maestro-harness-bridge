import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { readNativeToolOutput } from '../../../main/storage/native-tool-output-reader';
import { flattenToolResultContent } from '../../../main/parsers/claude-output-parser';
import { compactToolOutput } from '../../../shared/toolOutput';

let root: string;
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-output-'));
});
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

const claude = (content: unknown, id = 'call-1') => ({
	type: 'user',
	message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
});
const codex = (output: unknown, type = 'function_call_output', id = 'call-1') => ({
	type: 'response_item',
	payload: { type, call_id: id, output },
});
async function fixture(rows: unknown[], compressed = false) {
	const file = path.join(root, `rollout-synthetic.jsonl${compressed ? '.zst' : ''}`);
	const bytes = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
	await fs.writeFile(file, compressed ? zstdCompressSync(bytes) : bytes);
	return file;
}

describe('native tool output on demand', () => {
	it('retains the real Claude output length in the existing compact preview', () => {
		const text = 'x'.repeat(9000) + 'final error';
		expect(flattenToolResultContent(text)).toBe(compactToolOutput(text).output);
	});
	it('reads only the requested Claude tool result including text blocks', async () => {
		const output = 'a'.repeat(7000) + 'CLAUDE TAIL';
		const file = await fixture([
			claude('wrong', 'other'),
			claude([
				{ type: 'text', text: output },
				{ type: 'image', source: { data: 'ignored' } },
			]),
		]);
		const before = await fs.stat(file);
		expect(await readNativeToolOutput(file, 'claude-code', 'call-1')).toEqual({
			status: 'found',
			text: output,
			totalBytes: Buffer.byteLength(output),
			omittedBytes: 0,
		});
		expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs);
	});
	it.each(['function_call_output', 'custom_tool_call_output'])(
		'reads Codex %s without losing the tail',
		async (type) => {
			const output = 'b'.repeat(8000) + 'CODEX TAIL';
			expect(
				await readNativeToolOutput(
					await fixture([codex('wrong', type, 'other'), codex(output, type)]),
					'codex',
					'call-1'
				)
			).toMatchObject({ status: 'found', text: output, omittedBytes: 0 });
		}
	);
	it('reads zstd archives in memory without materializing files', async () => {
		const output = 'z'.repeat(9000) + 'ARCHIVE TAIL';
		const file = await fixture([codex(output)], true);
		expect(await readNativeToolOutput(file, 'codex', 'call-1')).toMatchObject({
			status: 'found',
			text: output,
		});
		expect(await fs.readdir(root)).toEqual([path.basename(file)]);
	});
	it('reports missing files, IDs and incomplete rows without fabricating output', async () => {
		const file = await fixture([claude('other', 'different')]);
		await fs.appendFile(file, '{"type":"user"');
		expect(await readNativeToolOutput(file, 'claude-code', 'call-1')).toEqual({
			status: 'not-found',
		});
		expect(await readNativeToolOutput(path.join(root, 'missing.jsonl'), 'codex', 'call-1')).toEqual(
			{ status: 'not-found' }
		);
	});
	it.each(['claude-code', 'codex'] as const)(
		'caps huge %s results by UTF-8 bytes, keeping the end',
		async (provider) => {
			const output = '中🙂'.repeat(400000) + 'LAST ERROR';
			const file = await fixture([provider === 'codex' ? codex(output) : claude(output)]);
			const result = await readNativeToolOutput(file, provider, 'call-1');
			expect(result.status).toBe('found');
			if (result.status !== 'found') throw new Error('missing output');
			expect(result.text.endsWith('LAST ERROR')).toBe(true);
			expect(result.text).not.toContain('\uFFFD');
			expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(2 * 1024 * 1024);
			expect(result.omittedBytes + Buffer.byteLength(result.text)).toBe(Buffer.byteLength(output));
		}
	);
	it('rejects native files beyond the read budget', async () => {
		const file = await fixture([]);
		await fs.truncate(file, 100 * 1024 * 1024 + 1);
		expect(await readNativeToolOutput(file, 'codex', 'call-1')).toEqual({ status: 'too-large' });
	});
});
