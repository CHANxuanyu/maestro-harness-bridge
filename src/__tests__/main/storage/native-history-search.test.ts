import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { searchNativeHistoryFiles } from '../../../main/storage/native-history-search-reader';

let root: string;
let accounts: Array<{ provider: 'claude-code' | 'codex'; accountDir: string }>;
beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'native-search-')));
	accounts = [
		{ provider: 'claude-code', accountDir: path.join(root, 'claude') },
		{ provider: 'codex', accountDir: path.join(root, 'codex') },
	];
});
afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});
async function seed(
	provider: 'claude-code' | 'codex',
	id: string,
	text: string,
	compressed = false,
	cwd = '/project'
) {
	const account = accounts.find((a) => a.provider === provider)!;
	const file = path.join(
		account.accountDir,
		provider === 'codex' ? 'archived_sessions' : 'projects/encoded',
		provider === 'codex' ? `rollout-20261106-${id}.jsonl${compressed ? '.zst' : ''}` : `${id}.jsonl`
	);
	await fs.mkdir(path.dirname(file), { recursive: true });
	const rows =
		provider === 'codex'
			? [
					{ type: 'session_meta', payload: { id, cwd } },
					{
						type: 'response_item',
						timestamp: '2026-11-06T10:00:00Z',
						payload: {
							type: 'message',
							role: 'user',
							id: 'opening',
							content: [{ type: 'input_text', text: 'Unrelated title' }],
						},
					},
					{
						type: 'response_item',
						timestamp: '2026-11-06T10:01:00Z',
						payload: {
							type: 'message',
							role: 'assistant',
							id: 'hit',
							content: [{ type: 'output_text', text }],
						},
					},
				]
			: [
					{ type: 'user', cwd, uuid: 'opening', message: { content: 'Unrelated title' } },
					{
						type: 'assistant',
						cwd,
						uuid: 'hit',
						timestamp: '2026-11-06T10:01:00Z',
						message: { content: [{ type: 'text', text }] },
					},
				];
	const content = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
	await fs.writeFile(file, compressed ? zstdCompressSync(content) : content);
	return file;
}
it('finds Claude and compressed archived Codex body text with project, snippet and message identity, read only', async () => {
	const files = await Promise.all([
		seed('claude-code', 'one', 'before secret phrase after'),
		seed('codex', '00000000-0000-0000-0000-000000000001', 'before secret phrase after', true),
	]);
	const before = await Promise.all(files.map((f) => fs.readFile(f)));
	const result = await searchNativeHistoryFiles({ query: 'secret phrase', accounts });
	expect(result.hits).toHaveLength(2);
	for (const hit of result.hits) {
		expect(hit.conversation).toMatchObject({
			title: 'Unrelated title',
			projectPath: '/project',
			accountDir: expect.stringContaining(root),
		});
		expect(hit.matchPreview).toContain('secret phrase');
		expect(hit.message).toMatchObject({ uuid: 'hit', role: 'assistant' });
	}
	expect(await Promise.all(files.map((f) => fs.readFile(f)))).toEqual(before);
	expect(
		await searchNativeHistoryFiles({ query: 'secret phrase', accounts, projectPath: '/other' })
	).toMatchObject({ hits: [] });
});
it('returns at most 50 conversations and tells the caller there are more', async () => {
	for (let i = 0; i < 51; i++) await seed('claude-code', `c${i}`, 'needle');
	const result = await searchNativeHistoryFiles({ query: 'needle', accounts });
	expect(result.hits).toHaveLength(50);
	expect(result.truncated).toBe(true);
});
it('bounds source and expanded bytes, file enumeration and elapsed time', async () => {
	await seed('codex', '00000000-0000-0000-0000-000000000001', 'needle' + 'z'.repeat(10000), true);
	for (const limits of [{ maxBytes: 100 }, { maxBytes: 2000 }, { maxFiles: 0 }, { maxMs: 0 }]) {
		const result = await searchNativeHistoryFiles({ query: 'needle', accounts, limits });
		expect(result.hits).toEqual([]);
		expect(result.truncated).toBe(true);
	}
});
it('does not duplicate an archived rollout when its plain source exists', async () => {
	const id = '00000000-0000-0000-0000-000000000001';
	await seed('codex', id, 'needle', true);
	await seed('codex', id, 'needle');
	expect((await searchNativeHistoryFiles({ query: 'needle', accounts })).hits).toHaveLength(1);
});
