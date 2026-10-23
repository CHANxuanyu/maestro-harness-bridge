import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
vi.mock('../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));
vi.mock('../../../main/utils/remote-fs', () => ({
	readFileRemote: vi.fn(),
	readDirRemote: vi.fn(),
	statRemote: vi.fn(),
}));
import { CodexSessionStorage } from '../../../main/storage/codex-session-storage';
import type { SshRemoteConfig } from '../../../shared/types';

const id = '11111111-2222-4333-8444-555555555555';
let root: string;
let storage: CodexSessionStorage;
async function transcript(account: string, text = 'initial') {
	const dir = path.join(root, account, 'sessions', '2026', '10', '23');
	await fs.mkdir(dir, { recursive: true });
	const file = path.join(dir, `rollout-2026-10-23T00-00-00-${id}.jsonl`);
	await fs.writeFile(file, text);
	return file;
}
const revision = (account = 'a') =>
	storage.getTranscriptRevision('/project', id, { configDir: path.join(root, account) });
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-revision-'));
	storage = new CodexSessionStorage();
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(root, { recursive: true, force: true });
});

describe('Codex read-only transcript revision', () => {
	it('reads no contents and probes only the same file after discovery', async () => {
		await transcript('a');
		const contents = vi.spyOn(fs, 'readFile');
		const first = await revision();
		const listing = vi.spyOn(fs, 'readdir');
		const stat = vi.spyOn(fs, 'stat');
		expect(await revision()).toBe(first);
		expect(first).toBeTypeOf('string');
		expect(contents).not.toHaveBeenCalled();
		expect(listing).not.toHaveBeenCalled();
		expect(stat).toHaveBeenCalledTimes(1);
	});
	it('detects append, truncation and inode replacement even with a restored timestamp', async () => {
		const file = await transcript('a');
		const original = await fs.stat(file);
		const first = await revision();
		await fs.appendFile(file, ' appended');
		const appended = await revision();
		expect(appended).not.toBe(first);
		await fs.truncate(file, 2);
		expect(await revision()).not.toBe(appended);
		const beforeReplacement = await revision();
		await fs.writeFile(file + '.replacement', 'aa');
		await fs.utimes(file + '.replacement', original.atime, original.mtime);
		await fs.rename(file + '.replacement', file);
		expect(await revision()).not.toBe(beforeReplacement);
	});
	it('keeps the same native ID isolated by exact account', async () => {
		await transcript('a', 'one');
		await transcript('b', 'another account');
		const a = await revision('a');
		const b = await revision('b');
		expect(a).not.toBe(b);
		expect(await revision('a')).toBe(a);
		expect(await revision('missing')).toBeNull();
	});
	it('does no local discovery for a remote request', async () => {
		const listing = vi.spyOn(fs, 'readdir');
		expect(
			await storage.getTranscriptRevision('/project', id, {}, { id: 'remote' } as SshRemoteConfig)
		).toBeNull();
		expect(listing).not.toHaveBeenCalled();
	});
	it('does not create or restore a missing transcript and retries a miss after the cooldown', async () => {
		const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
		expect(await revision()).toBeNull();
		await transcript('a');
		expect(await revision()).toBeNull();
		now.mockReturnValue(110_001);
		expect(await revision()).toBeTypeOf('string');
	});
	it('rediscovers a deleted path rather than retaining a false successful revision', async () => {
		const file = await transcript('a');
		expect(await revision()).not.toBeNull();
		await fs.unlink(file);
		expect(await revision()).toBeNull();
		await transcript('a', 'restored externally');
		expect(await revision()).toBeTypeOf('string');
	});
	it('matches filenames before reading unrelated history during an actual refresh', async () => {
		const file = await transcript('a', JSON.stringify({ type: 'session_meta', payload: { id } }));
		await fs.writeFile(path.join(path.dirname(file), 'aaa-legacy.jsonl'), 'unrelated');
		const contents = vi.spyOn(fs, 'readFile');
		await storage.readSessionMessages('/project', id, { configDir: path.join(root, 'a') });
		expect(contents.mock.calls.map((call) => call[0])).toEqual([file]);
	});
});

const row = (type: string, payload: Record<string, unknown>) =>
	JSON.stringify({ type, timestamp: '2026-10-23T00:00:00Z', payload }) + '\n';
const message = (text: string) =>
	row('response_item', {
		type: 'message',
		role: 'assistant',
		content: [{ type: 'output_text', text }],
	});
const readIncrementally = (offset = 0, limit = 200) =>
	storage.readSessionMessages('/project', id, {
		configDir: path.join(root, 'a'),
		readOnly: true,
		offset,
		limit,
	});
const readCold = () =>
	new CodexSessionStorage().readSessionMessages('/project', id, {
		configDir: path.join(root, 'a'),
		limit: 200,
	});

describe('Codex append-only refresh cursor', () => {
	it('matches the cold converter across partial UTF-8 rows, tool completion and pagination', async () => {
		const file = await transcript(
			'a',
			message('first') +
				row('response_item', {
					type: 'function_call',
					name: 'shell',
					arguments: '{"command":"printf ok"}',
					call_id: 'tool-1',
				})
		);
		expect(await readIncrementally()).toEqual(await readCold());
		const result = Buffer.from(
			row('response_item', { type: 'function_call_output', call_id: 'tool-1', output: '成功 ok' })
		);
		const split = result.indexOf(Buffer.from('成功')) + 1;
		await fs.appendFile(file, result.subarray(0, split));
		const partial = await readIncrementally();
		expect(partial.messages).toHaveLength(2);
		expect((partial.messages[1].toolUse as any[])[0].state.status).toBe('running');
		await fs.appendFile(file, result.subarray(split));
		await fs.appendFile(file, message('after tool'));
		const complete = await readIncrementally();
		expect(complete).toEqual(await readCold());
		expect((complete.messages[1].toolUse as any[])[0].state.output).toBe('成功 ok');
		expect((await readIncrementally(1, 1)).messages).toEqual([complete.messages[1]]);
	});
	it('shows an unterminated valid final row once and commits it without duplicate IDs', async () => {
		const file = await transcript('a', message('one').trimEnd());
		expect(await readIncrementally()).toEqual(await readCold());
		await fs.appendFile(file, '\n' + message('two'));
		const result = await readIncrementally();
		expect(result).toEqual(await readCold());
		expect(result.messages.map((m) => m.content)).toEqual(['one', 'two']);
		expect(new Set(result.messages.map((m) => m.uuid)).size).toBe(2);
	});
	it('resets on truncation, atomic replacement and changed prefix after regrowth', async () => {
		const file = await transcript('a', message('first') + message('second'));
		await readIncrementally();
		await fs.writeFile(file, message('truncated'));
		expect(await readIncrementally()).toEqual(await readCold());
		await fs.writeFile(file + '.new', message('replacement') + message('new tail'));
		await fs.rename(file + '.new', file);
		expect(await readIncrementally()).toEqual(await readCold());
		await fs.writeFile(
			file,
			message('changed beginning') + message('new longer middle') + message('new end')
		);
		expect(await readIncrementally()).toEqual(await readCold());
	});
	it('reads only appended bytes plus bounded guards after a large warm read', async () => {
		const file = await transcript(
			'a',
			message('seed') + row('ignored_event', { data: 'x'.repeat(8 * 1024 * 1024) })
		);
		await readIncrementally();
		const nativeOpen = fs.open.bind(fs);
		let requestedBytes = 0;
		vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
			const handle = await nativeOpen(...args);
			const nativeRead = handle.read.bind(handle);
			vi.spyOn(handle, 'read').mockImplementation(async (...readArgs: any[]) => {
				requestedBytes += typeof readArgs[2] === 'number' ? readArgs[2] : 0;
				return (nativeRead as any)(...readArgs);
			});
			return handle;
		});
		await fs.appendFile(file, message('tail'));
		expect((await readIncrementally()).messages.map((m) => m.content)).toEqual(['seed', 'tail']);
		expect(requestedBytes).toBeLessThan(2048);
		requestedBytes = 0;
		await readIncrementally();
		expect(requestedBytes).toBe(0);
	});
});
