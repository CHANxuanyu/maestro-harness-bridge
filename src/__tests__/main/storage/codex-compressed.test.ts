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
