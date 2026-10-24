import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SshRemoteConfig } from '../../../shared/types';

vi.mock('electron-store', () => ({
	default: class {
		get = vi.fn();
		set = vi.fn();
	},
}));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
vi.mock('../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));
vi.mock('../../../main/agents/provider-account-dirs', () => ({
	getProviderAccountDirs: vi.fn(async () => []),
}));
vi.mock('../../../main/utils/remote-fs', () => ({
	readFileRemote: vi.fn(),
	listDirWithStatsRemote: vi.fn(),
}));
vi.mock('../../../main/utils/statsCache', () => ({
	encodeClaudeProjectPath: (project: string) => project.replace(/[^a-zA-Z0-9]/g, '-'),
}));

import { ClaudeSessionStorage } from '../../../main/storage/claude-session-storage';

const id = '11111111-2222-4333-8444-555555555555';
const project = '/synthetic/project';
let root: string;
let storage: ClaudeSessionStorage;
const row = (uuid: string, type: string, content: unknown, model?: string) =>
	JSON.stringify({
		type,
		uuid,
		timestamp: '2026-10-24T00:00:00Z',
		message: { role: type, content, model },
	}) + '\n';
const message = (uuid: string, content: string, model?: string) =>
	row(uuid, 'assistant', content, model);
async function transcript(account: string, content: string) {
	const dir = path.join(root, account, 'projects', '-synthetic-project');
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(dir, `${id}.jsonl`);
	await fs.writeFile(file, content);
	return file;
}
const revision = (account = 'a') =>
	storage.getTranscriptRevision(project, id, { configDir: path.join(root, account) });
const read = (account = 'a', offset = 0, limit = 200) =>
	storage.readSessionMessages(project, id, {
		configDir: path.join(root, account),
		readOnly: true,
		offset,
		limit,
	});
const cold = (account = 'a') =>
	new ClaudeSessionStorage().readSessionMessages(project, id, {
		configDir: path.join(root, account),
		limit: 200,
	});

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-revision-'));
	storage = new ClaudeSessionStorage();
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(root, { recursive: true, force: true });
});

describe('Claude read-only transcript revision', () => {
	it('uses only stat and detects append, same-size edits and replacement', async () => {
		const file = await transcript('a', message('one', 'first'));
		const contents = vi.spyOn(fs, 'readFile');
		const listing = vi.spyOn(fs, 'readdir');
		const first = await revision();
		expect(first).toBeTypeOf('string');
		expect(await revision()).toBe(first);
		await fs.appendFile(file, message('two', 'second'));
		const appended = await revision();
		expect(appended).not.toBe(first);
		const stat = await fs.stat(file);
		await fs.writeFile(file, message('one', 'other') + message('two', 'second'));
		await fs.utimes(file, stat.atime, new Date(stat.mtimeMs + 1000));
		const edited = await revision();
		expect(edited).not.toBe(appended);
		await fs.writeFile(file + '.new', message('new', 'new'));
		await fs.utimes(file + '.new', stat.atime, stat.mtime);
		await fs.rename(file + '.new', file);
		expect(await revision()).not.toBe(edited);
		expect(contents).not.toHaveBeenCalled();
		expect(listing).not.toHaveBeenCalled();
	});
	it('keeps accounts separate and never discovers a local file for SSH', async () => {
		const a = await transcript('a', message('one', 'account A'));
		await transcript('b', message('one', 'account B'));
		expect(await revision('a')).not.toBe(await revision('b'));
		expect(await revision('missing')).toBeNull();
		await fs.unlink(a);
		expect(await revision('a')).toBeNull();
		await transcript('a', message('one', 'restored externally'));
		expect(await revision('a')).toBeTypeOf('string');
		const stat = vi.spyOn(fs, 'stat');
		expect(
			await storage.getTranscriptRevision(project, id, {}, { id: 'remote' } as SshRemoteConfig)
		).toBeNull();
		expect(stat).not.toHaveBeenCalled();
	});
});

describe('Claude append-only refresh cursor', () => {
	it('pairs late parallel results across partial UTF-8 and keeps prior views immutable', async () => {
		const calls = [
			{ type: 'tool_use', id: 'ok', name: 'Read', input: { file_path: 'a.ts' } },
			{ type: 'tool_use', id: 'stop', name: 'Bash', input: { command: 'sleep 20' } },
			{ type: 'tool_use', id: 'fail', name: 'Grep', input: { pattern: 'text' } },
		];
		const initial =
			row('question', 'user', 'inspect') + row('parallel', 'assistant', calls, 'claude-first');
		const file = await transcript('a', initial);
		const before = await read();
		const result = Buffer.from(
			row('results', 'user', [
				{ type: 'tool_result', tool_use_id: 'fail', content: 'ordinary failure', is_error: true },
				{ type: 'tool_result', tool_use_id: 'ok', content: '成功中文' },
				{
					type: 'tool_result',
					tool_use_id: 'stop',
					content: 'Interrupted by user',
					is_error: true,
				},
			]).trimEnd()
		);
		const split = result.indexOf(Buffer.from('成功')) + 1;
		await fs.appendFile(file, result.subarray(0, split));
		expect(await read()).toEqual(before);
		await fs.appendFile(file, result.subarray(split));
		const visibleTail = await read();
		expect(visibleTail).toEqual(await cold());
		expect(visibleTail.messages[1]).toMatchObject({
			model: 'claude-first',
			toolUse: [
				{ ...calls[0], state: { status: 'completed', output: '成功中文' } },
				{ ...calls[1], state: { status: 'canceled', output: 'Interrupted by user' } },
				{ ...calls[2], state: { status: 'failed', output: 'ordinary failure' } },
			],
		});
		expect(before.messages[1].toolUse).toEqual(calls);
		await fs.appendFile(file, '\n' + message('answer', 'complete', 'claude-second'));
		const after = await read();
		expect(after).toEqual(await cold());
		expect(after.messages.map((entry) => entry.uuid)).toEqual(['question', 'parallel', 'answer']);
		expect(after.messages.at(-1)?.model).toBe('claude-second');
		expect((await read('a', 1, 1)).messages).toEqual([after.messages[1]]);
		storage = new ClaudeSessionStorage();
		expect(await read()).toEqual(after);
		expect(await fs.readFile(file, 'utf8')).toBe(
			initial + result.toString() + '\n' + message('answer', 'complete', 'claude-second')
		);
	});
	it('resets on truncation, atomic replacement and in-place regrowth', async () => {
		const file = await transcript('a', message('one', 'first') + message('two', 'second'));
		await read();
		await fs.writeFile(file, message('short', 'truncated'));
		expect(await read()).toEqual(await cold());
		await fs.writeFile(file + '.new', message('replacement', 'different model', 'claude-third'));
		await fs.rename(file + '.new', file);
		expect(await read()).toEqual(await cold());
		await fs.writeFile(
			file,
			message('regrown', 'changed beginning') + message('new-tail', 'longer end')
		);
		expect(await read()).toEqual(await cold());
	});
	it('reads only appended bytes after warming a large transcript and never writes it', async () => {
		const initial =
			message('one', 'first') +
			JSON.stringify({ type: 'ignored', data: 'x'.repeat(8 * 1024 * 1024) }) +
			'\n';
		const file = await transcript('a', initial);
		await read();
		const nativeOpen = fs.open.bind(fs);
		let requestedBytes = 0;
		vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
			expect(args[1]).toBe('r');
			const handle = await nativeOpen(...args);
			const nativeRead = handle.read.bind(handle);
			vi.spyOn(handle, 'read').mockImplementation(async (...readArgs: any[]) => {
				requestedBytes += typeof readArgs[2] === 'number' ? readArgs[2] : 0;
				return (nativeRead as any)(...readArgs);
			});
			return handle;
		});
		const tail = message('two', 'appended');
		await fs.appendFile(file, tail);
		const contents = vi.spyOn(fs, 'readFile');
		const write = vi.spyOn(fs, 'writeFile');
		const append = vi.spyOn(fs, 'appendFile');
		const rename = vi.spyOn(fs, 'rename');
		expect((await read()).messages.map((entry) => entry.content)).toEqual(['first', 'appended']);
		expect(contents).not.toHaveBeenCalled();
		expect(requestedBytes).toBeGreaterThan(0);
		expect(requestedBytes).toBeLessThan(2048);
		requestedBytes = 0;
		await read();
		expect(requestedBytes).toBe(0);
		expect(write).not.toHaveBeenCalled();
		expect(append).not.toHaveBeenCalled();
		expect(rename).not.toHaveBeenCalled();
		expect(await fs.readFile(file, 'utf8')).toBe(initial + tail);
	});
	it('keeps warm cursors isolated by account and does not restore missing files', async () => {
		const a = await transcript('a', message('one', 'A'));
		const b = await transcript('b', message('one', 'B'));
		expect((await read('a')).messages[0].content).toBe('A');
		expect((await read('b')).messages[0].content).toBe('B');
		await fs.appendFile(b, message('two', 'B continued'));
		expect((await read('a')).messages).toHaveLength(1);
		expect((await read('b')).messages).toHaveLength(2);
		await fs.unlink(a);
		await expect(read('a')).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(fs.stat(a)).rejects.toMatchObject({ code: 'ENOENT' });
		expect((await read('b')).messages).toHaveLength(2);
	});
});
