import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { searchNativeHistoryFiles } from '../../../main/storage/native-history-search-reader';
import { embedSystemPromptInPrompt } from '../../../shared/embeddedSystemPrompt';
import { createConversationArchive } from '../../../main/storage/conversation-archive';
import type { ArchivedConversation } from '../../../shared/conversationArchive';

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
	vi.restoreAllMocks();
	await fs.rm(root, { recursive: true, force: true });
});

it.each(['claude-code', 'codex'] as const)(
	'%s content hits use the same identity as Maestro archives, including shared transcript pools',
	async (provider) => {
		const id = '00000000-0000-0000-0000-000000000001';
		const file = await seed(provider, id, 'amber lighthouse');
		const accountDir = accounts.find((account) => account.provider === provider)!.accountDir;
		const subdir = provider === 'codex' ? 'sessions' : 'projects';
		await fs.mkdir(path.join(accountDir, subdir), { recursive: true });
		if (provider === 'codex') {
			await fs.rename(file, path.join(accountDir, subdir, path.basename(file)));
		}
		const alias = path.join(root, 'shared-account');
		await fs.mkdir(alias);
		await fs.symlink(path.join(accountDir, subdir), path.join(alias, subdir), 'junction');
		let records: ArchivedConversation[] = [];
		const archive = createConversationArchive({
			read: () => records,
			write: (next) => {
				records = next;
			},
			owners: () => [],
			accountDir: () => undefined,
			lifecycle: async () => ({}),
			deleteNative: vi.fn(),
		});
		await archive.change(
			{ provider, nativeSessionId: id, accountDir: alias, projectPath: root },
			'archive'
		);
		const result = await searchNativeHistoryFiles({ query: 'amber lighthouse', accounts });
		expect(result.truncated).toBe(false);
		expect(result.hits).toHaveLength(1);
		expect(result.hits[0].conversation.key).toBe((await archive.list())[0].key);
	}
);

it('bounds title index bytes and reports incomplete metadata without dropping a body hit', async () => {
	const id = '00000000-0000-0000-0000-000000000001';
	await seed('codex', id, 'amber lighthouse');
	const indexPath = path.join(accounts[1].accountDir, 'session_index.jsonl');
	await fs.writeFile(indexPath, JSON.stringify({ id, thread_name: 'x'.repeat(5000) }));
	const result = await searchNativeHistoryFiles({
		query: 'amber lighthouse',
		accounts,
		limits: { maxBytes: 3000 },
	});
	expect(result).toMatchObject({ truncated: true, limited: true });
	expect(result.hits).toHaveLength(1);
	expect(result.hits[0].conversation.title).toBe('Unrelated title');
});

it('reads each account title index once and keeps equal native IDs in separate accounts', async () => {
	const id = '00000000-0000-0000-0000-000000000001';
	const first = await seed('codex', id, 'amber lighthouse');
	await seed('codex', '00000000-0000-0000-0000-000000000002', 'amber lighthouse');
	const secondPool = path.join(root, 'second-codex');
	const secondFile = path.join(secondPool, 'sessions', path.basename(first));
	await fs.mkdir(path.dirname(secondFile), { recursive: true });
	await fs.copyFile(first, secondFile);
	accounts.push({ provider: 'codex', accountDir: secondPool });
	const indexes = [accounts[1].accountDir, secondPool].map((pool) =>
		path.join(pool, 'session_index.jsonl')
	);
	await Promise.all(
		indexes.map((file, index) =>
			fs.writeFile(file, JSON.stringify({ id, thread_name: `Account ${index}` }))
		)
	);
	const opened = vi.spyOn(fs, 'open');
	const result = await searchNativeHistoryFiles({ query: 'amber lighthouse', accounts });
	expect(result.truncated).toBe(false);
	expect(result.hits).toHaveLength(3);
	expect(
		result.hits
			.filter((hit) => hit.conversation.nativeSessionId === id)
			.map((hit) => hit.conversation.title)
			.sort()
	).toEqual(['Account 0', 'Account 1']);
	for (const file of indexes)
		expect(opened.mock.calls.filter(([name]) => name === file)).toHaveLength(1);
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

it('searches the displayed Codex user request without the Maestro envelope', async () => {
	const file = await seed('codex', '00000000-0000-0000-0000-000000000001', 'Done');
	const rows = (await fs.readFile(file, 'utf8'))
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	delete rows[1].payload.id;
	rows[1].payload.content[0].text = embedSystemPromptInPrompt(
		'# Maestro System Context',
		'amber lighthouse'
	);
	await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n'));
	const result = await searchNativeHistoryFiles({ query: 'amber lighthouse', accounts });
	expect(result.hits).toHaveLength(1);
	expect(result.hits[0].message.text).toBe('amber lighthouse');
	expect(result.hits[0].matchPreview).toBe('amber lighthouse');
	expect(result.hits[0].conversation.title).toBe('amber lighthouse');
	expect(
		(await searchNativeHistoryFiles({ query: 'Maestro System Context', accounts })).hits
	).toEqual([]);
});

it.each([false, true])(
	'finds legacy Codex metadata and environment cwd (compressed: %s)',
	async (compressed) => {
		const id = '00000000-0000-0000-0000-000000000001';
		const file = await seed('codex', id, 'unused', compressed);
		const content = [
			{ id, timestamp: '2026-11-06T10:00:00Z' },
			{
				type: 'message',
				role: 'user',
				content: [
					{
						type: 'input_text',
						text: '<environment_context><cwd>/legacy/project</cwd></environment_context>',
					},
				],
			},
			{
				type: 'message',
				role: 'user',
				content: [{ type: 'input_text', text: 'amber lighthouse' }],
			},
		]
			.map((row) => JSON.stringify(row))
			.join('\n');
		await fs.writeFile(file, compressed ? zstdCompressSync(content) : content);
		const result = await searchNativeHistoryFiles({
			query: 'amber lighthouse',
			accounts,
			projectPath: '/legacy/project',
		});
		expect(result.truncated).toBe(false);
		expect(result.hits).toHaveLength(1);
		expect(result.hits[0].conversation).toMatchObject({
			nativeSessionId: id,
			projectPath: '/legacy/project',
			title: 'amber lighthouse',
		});
		expect(
			(await searchNativeHistoryFiles({ query: 'environment_context', accounts })).hits
		).toEqual([]);
	}
);

it.each([false, true])(
	'uses native titles or the real user request outside loaded projects (indexed: %s)',
	async (indexed) => {
		const id = '00000000-0000-0000-0000-000000000001';
		const file = await seed('codex', id, 'amber lighthouse', false, '/unloaded/project');
		const rows = (await fs.readFile(file, 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		rows.splice(1, 0, {
			type: 'response_item',
			payload: {
				type: 'message',
				role: 'user',
				content: [{ type: 'input_text', text: '# AGENTS.md instructions\nInjected context' }],
			},
		});
		await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n'));
		if (indexed) {
			await fs.writeFile(
				path.join(accounts[1].accountDir, 'session_index.jsonl'),
				[
					JSON.stringify({ id, thread_name: 'Previous name' }),
					JSON.stringify({ id, thread_name: 'Named native conversation' }),
					'{"id":',
				].join('\n')
			);
		}
		const result = await searchNativeHistoryFiles({ query: 'amber lighthouse', accounts });
		expect(result.hits).toHaveLength(1);
		expect(result.hits[0].conversation.title).toBe(
			indexed ? 'Named native conversation' : 'Unrelated title'
		);
	}
);
