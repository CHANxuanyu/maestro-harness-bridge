import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { zstdCompressSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const isolation = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => isolation.root } }));
vi.mock('../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));
vi.mock('../../../main/utils/remote-fs', () => ({
	deleteRemote: vi.fn(),
	readFileRemote: vi.fn(),
	readBinaryFileRemoteAsBase64: vi.fn(),
	readDirRemote: vi.fn(),
	statRemote: vi.fn(),
}));
import { CodexSessionStorage } from '../../../main/storage/codex-session-storage';
import { transcriptMessagesToLogEntries } from '../../../renderer/utils/transcriptMessages';
import { searchNativeHistoryFiles } from '../../../main/storage/native-history-search-reader';
import { embedSystemPromptInPrompt } from '../../../shared/embeddedSystemPrompt';

const id = '11111111-2222-4333-8444-555555555555';
let account: string;
let file: string;
let content: string;
beforeEach(async () => {
	isolation.root = await fs.mkdtemp(path.join(os.tmpdir(), 'compressed-codex-'));
	account = path.join(isolation.root, 'account');
	const dir = path.join(account, 'sessions', '2026', '11', '03');
	await fs.mkdir(dir, { recursive: true });
	file = path.join(dir, `rollout-2026-11-03T00-00-00-${id}.jsonl`);
	content =
		[
			{ type: 'session_meta', payload: { id, cwd: isolation.root } },
			{
				type: 'response_item',
				payload: {
					type: 'message',
					role: 'user',
					content: [{ type: 'input_text', text: 'compressed question' }],
				},
			},
			{
				type: 'response_item',
				payload: {
					type: 'message',
					role: 'assistant',
					content: [{ type: 'output_text', text: 'compressed answer' }],
				},
			},
		]
			.map((row) => JSON.stringify(row))
			.join('\n') + '\n';
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(isolation.root, { recursive: true, force: true });
});
const read = (storage = new CodexSessionStorage(), readOnly = false) =>
	storage.readSessionMessages(isolation.root, id, { configDir: account, readOnly });

it.each(['older-answer', 'wrapped-user', 'folded-progress', 'legacy-title'])(
	'opens the archived search hit through the native reader: %s',
	async (scenario) => {
		const phrase = 'The amber lighthouse remembers this sentence';
		const rows = content
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		rows[1].payload.content[0].text =
			scenario === 'wrapped-user'
				? embedSystemPromptInPrompt('# Maestro System Context', phrase)
				: 'Archive conversation';
		rows[2].payload.content[0].text =
			scenario === 'wrapped-user' || scenario === 'folded-progress' ? 'Archive ready' : phrase;
		if (scenario === 'folded-progress') {
			rows.splice(
				2,
				0,
				...['Opening the archive', phrase].map((text) => ({
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'assistant',
						channel: 'commentary',
						content: [{ type: 'output_text', text }],
					},
				}))
			);
		}
		for (let index = 0; index < 310; index++) {
			for (const role of ['user', 'assistant'])
				rows.push({
					type: 'response_item',
					payload: {
						type: 'message',
						role,
						content: [
							{
								type: role === 'user' ? 'input_text' : 'output_text',
								text: `Later ${role} ${index}`,
							},
						],
					},
				});
		}
		const title = 'Named conversation from an unopened project';
		if (scenario === 'legacy-title') {
			rows[0] = { id };
			rows.splice(1, 0, {
				type: 'message',
				role: 'user',
				content: [
					{
						type: 'input_text',
						text: `<environment_context><cwd>${isolation.root}</cwd></environment_context>`,
					},
				],
			});
			await fs.writeFile(
				path.join(account, 'session_index.jsonl'),
				JSON.stringify({ id, thread_name: title })
			);
		}
		const archive = path.join(account, 'archived_sessions');
		await fs.mkdir(archive);
		const archivedFile = path.join(archive, path.basename(file) + '.zst');
		const bytes = zstdCompressSync(
			rows
				.map((row) =>
					JSON.stringify(
						scenario === 'legacy-title' && row.type === 'response_item' ? row.payload : row
					)
				)
				.join('\n') + '\n'
		);
		await fs.writeFile(archivedFile, bytes);
		// An account containing only archived history must also be readable.
		await fs.rm(path.join(account, 'sessions'), { recursive: true });
		const results = await searchNativeHistoryFiles({
			query: phrase,
			accounts: [{ provider: 'codex', accountDir: account }],
		});
		expect(results.hits).toHaveLength(1);
		const hit = results.hits[0];
		expect(hit.conversation.nativeSessionId).toBe(id);
		if (scenario === 'legacy-title') expect(hit.conversation.title).toBe(title);
		const storage = new CodexSessionStorage();
		const recent = await storage.readSessionMessages(hit.conversation.projectPath, id, {
			configDir: hit.conversation.accountDir,
			readOnly: true,
			limit: 500,
		});
		expect(recent.messages).toHaveLength(500);
		expect(recent.hasMore).toBe(true);
		expect(recent.messages.some((message) => message.content.includes(phrase))).toBe(false);
		const full = await storage.readSessionMessages(hit.conversation.projectPath, id, {
			configDir: hit.conversation.accountDir,
			readOnly: true,
			limit: 100000,
		});
		const visible = transcriptMessagesToLogEntries(full.messages);
		const matches = visible.filter((entry) => entry.text === hit.message.text);
		expect(matches).toHaveLength(1);
		expect(matches[0].text).toBe(phrase);
		expect(matches[0].source === 'user').toBe(scenario === 'wrapped-user');
		expect(
			await storage.getTranscriptRevision(isolation.root, id, { configDir: account })
		).toBeTypeOf('string');
		expect(await fs.readFile(archivedFile)).toEqual(bytes);
		expect(await fs.readdir(archive)).toEqual([path.basename(archivedFile)]);
		await expect(fs.stat(path.join(account, 'sessions'))).rejects.toThrow();
	}
);

it('lists, looks up, searches and renders compressed rollouts exactly like plain rollouts', async () => {
	await fs.writeFile(file, content);
	const plain = await read();
	await fs.unlink(file);
	await fs.writeFile(file + '.zst', zstdCompressSync(content));
	const storage = new CodexSessionStorage();
	expect(await read(storage)).toEqual(plain);
	expect(await read(storage, true)).toEqual(plain);
	expect(transcriptMessagesToLogEntries((await read(storage)).messages)).toEqual(
		transcriptMessagesToLogEntries(plain.messages)
	);
	expect(
		(await storage.listSessions(isolation.root, undefined, account)).map((s) => s.sessionId)
	).toEqual([id]);
	expect(
		(
			await storage.searchSessions(
				isolation.root,
				'compressed question',
				'user',
				undefined,
				account
			)
		).map((s) => s.sessionId)
	).toEqual([id]);
	expect(
		await storage.getTranscriptRevision(isolation.root, id, { configDir: account })
	).toBeTypeOf('string');
});

it('prefers the plain file for the same UUID even when the compressed name sorts first', async () => {
	await fs.writeFile(file, content);
	await fs.writeFile(
		file.replace('2026-11-03T00-00-00', '2020-01-01T00-00-00') + '.zst',
		zstdCompressSync(content.replaceAll('compressed', 'stale'))
	);
	expect((await read()).messages[0].content).toBe('compressed question');
	expect(
		await new CodexSessionStorage().listSessions(isolation.root, undefined, account)
	).toHaveLength(1);
});

it('follows immutable compressed revisions with a full reread when bytes change', async () => {
	const storage = new CodexSessionStorage();
	await fs.writeFile(file + '.zst', zstdCompressSync(content));
	const revision = await storage.getTranscriptRevision(isolation.root, id, { configDir: account });
	expect((await read(storage, true)).messages).toHaveLength(2);
	await fs.writeFile(
		file + '.zst',
		zstdCompressSync(content.replace('compressed answer', 'a changed external answer'))
	);
	expect(await storage.getTranscriptRevision(isolation.root, id, { configDir: account })).not.toBe(
		revision
	);
	expect((await read(storage, true)).messages[1].content).toBe('a changed external answer');
});

it('deletes only the selected conversation in either form, including a duplicate archive', async () => {
	await fs.writeFile(file, content);
	await fs.writeFile(file + '.zst', zstdCompressSync(content));
	const other = file.replace(id, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee') + '.zst';
	await fs.writeFile(other, zstdCompressSync('other conversation'));
	const storage = new CodexSessionStorage();
	expect(await storage.deleteSession(id, account)).toEqual({ success: true });
	await expect(fs.stat(file)).rejects.toThrow();
	await expect(fs.stat(file + '.zst')).rejects.toThrow();
	expect(await fs.readFile(other)).toEqual(zstdCompressSync('other conversation'));
});

it('transfers remote compressed bytes for local decoding and reports transfer failures clearly', async () => {
	const remote = await import('../../../main/utils/remote-fs');
	const { readDirRemote, statRemote, readBinaryFileRemoteAsBase64, readFileRemote } =
		vi.mocked(remote);
	const config = { id: 'host', enabled: true } as import('../../../shared/types').SshRemoteConfig;
	readDirRemote.mockImplementation(async (dir) => ({
		success: true,
		data: dir.endsWith('/sessions')
			? [{ name: '2026', isDirectory: true, isSymlink: false }]
			: dir.endsWith('/2026')
				? [{ name: '11', isDirectory: true, isSymlink: false }]
				: dir.endsWith('/11')
					? [{ name: '03', isDirectory: true, isSymlink: false }]
					: [{ name: path.basename(file) + '.zst', isDirectory: false, isSymlink: false }],
	}));
	statRemote.mockImplementation(async (file) =>
		file.endsWith('.zst')
			? { success: true, data: { size: 200, mtime: 123, isDirectory: false } }
			: { success: false, error: 'File not found' }
	);
	readBinaryFileRemoteAsBase64.mockResolvedValue({
		success: true,
		data: zstdCompressSync(content).toString('base64'),
	});
	const storage = new CodexSessionStorage();
	expect(
		(
			await storage.readSessionMessages(
				isolation.root,
				id,
				{ configDir: '/remote/account' },
				config
			)
		).messages
	).toHaveLength(2);
	expect(readFileRemote).not.toHaveBeenCalled();
	const firstRevision = await storage.getTranscriptRevision(
		isolation.root,
		id,
		{ configDir: '/remote/account' },
		config
	);
	const discoveries = readDirRemote.mock.calls.length;
	expect(
		await storage.getTranscriptRevision(
			isolation.root,
			id,
			{ configDir: '/remote/account' },
			config
		)
	).toBe(firstRevision);
	expect(readDirRemote).toHaveBeenCalledTimes(discoveries);
	const { deleteRemote } = vi.mocked(remote);
	deleteRemote.mockResolvedValue({ success: true });
	expect(await storage.deleteSession(id, '/remote/account', config)).toEqual({ success: true });
	expect(deleteRemote).toHaveBeenCalledWith(
		`/remote/account/sessions/2026/11/03/${path.basename(file)}.zst`,
		config,
		false
	);
	readBinaryFileRemoteAsBase64.mockResolvedValue({ success: false, error: 'base64 unavailable' });
	await expect(
		storage.readSessionMessages(isolation.root, id, { configDir: '/remote/account' }, config)
	).rejects.toThrow(
		'Cannot transfer compressed Codex conversation for local zstd decompression: base64 unavailable'
	);
});

it('refuses partial native history rewrites and keeps every source byte', async () => {
	await fs.writeFile(file, content);
	const storage = new CodexSessionStorage();
	vi.spyOn(
		storage as unknown as { findSessionFile: (id: string) => Promise<string> },
		'findSessionFile'
	).mockResolvedValue(file);
	expect(
		await storage.deleteMessagePair(isolation.root, id, 'codex-msg-0', 'compressed question')
	).toEqual({
		success: false,
		error: 'Native Codex history is read-only. Delete the whole conversation instead.',
	});
	expect(await fs.readFile(file, 'utf8')).toBe(content);
});

it('switches a cached archive revision to a newly writable plain sibling', async () => {
	await fs.writeFile(file + '.zst', zstdCompressSync(content));
	const storage = new CodexSessionStorage();
	const first = await storage.getTranscriptRevision(isolation.root, id, { configDir: account });
	await fs.writeFile(file, content.replace('compressed answer', 'new writable answer'));
	expect(await storage.getTranscriptRevision(isolation.root, id, { configDir: account })).not.toBe(
		first
	);
	expect((await read(storage, true)).messages[1].content).toBe('new writable answer');
});
