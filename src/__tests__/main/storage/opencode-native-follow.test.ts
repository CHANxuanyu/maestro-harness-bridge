// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OpenCodeOutputParser } from '../../../main/parsers/opencode-output-parser';

// OpenCode 1.19.4, anomalyco/opencode@148842ef7cb1bc34192b3fff57d0f9721ab9c801:
// packages/core/src/session/{sql,projector}.ts, database/schema.sql.ts,
// packages/schema/src/v1/session.ts and packages/opencode/src/session/processor.ts.
const probe = vi.hoisted(() => ({ home: '', bytes: 0, options: [] as unknown[] }));
vi.mock('os', async (original) => {
	const actual = await original<typeof import('os')>();
	return { ...actual, default: { ...actual, homedir: () => probe.home } };
});
vi.mock('better-sqlite3', async () => {
	const { nodeSqliteBetterSqlite3Mock } = await import('../../helpers/nodeSqlite');
	const Base = nodeSqliteBetterSqlite3Mock().default;
	return {
		default: class extends Base {
			constructor(file: string, options: unknown) {
				super(file);
				probe.options.push(options);
			}
			prepare(sql: string) {
				const statement = super.prepare(sql);
				return new Proxy(statement, {
					get(target, key) {
						const value = Reflect.get(target, key);
						if (key === 'all' || key === 'get')
							return (...args: unknown[]) => {
								const result = value.apply(target, args);
								for (const row of Array.isArray(result) ? result : [result])
									if (typeof row?.data === 'string') probe.bytes += Buffer.byteLength(row.data);
								return result;
							};
						return typeof value === 'function' ? value.bind(target) : value;
					},
				});
			}
		},
	};
});
vi.mock('../../../main/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));

let root: string;
let file: string;
let db: DatabaseSync;
type Storage = import('../../../main/storage/opencode-session-storage').OpenCodeSessionStorage;
let storage: Storage;
const session = 'ses_native_follow';

function message(id: string, at: number, content: string, model = 'native-model') {
	db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(
		id,
		session,
		at,
		at,
		JSON.stringify({
			role: 'assistant',
			modelID: model,
			providerID: 'native-provider',
			time: { created: at },
		})
	);
	part(`${id}-text`, id, at, { type: 'text', text: content });
}
function part(id: string, messageID: string, at: number, data: unknown) {
	db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)').run(
		id,
		messageID,
		session,
		at,
		at,
		JSON.stringify(data)
	);
}
function tool(callID: string, status: 'completed' | 'error', interrupted = false) {
	return {
		type: 'tool',
		callID,
		tool: 'bash',
		state: {
			status,
			input: { command: `printf ${callID}`, description: callID },
			...(status === 'error'
				? { error: interrupted ? 'Tool execution aborted' : `${callID} failed` }
				: { output: `${callID} output`, title: callID }),
			metadata: interrupted ? { interrupted: true } : {},
			time: { start: 2000, end: 2010 },
		},
	};
}

beforeEach(async () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-opencode-native-'));
	probe.home = root;
	vi.stubEnv('XDG_DATA_HOME', path.join(root, 'data'));
	file = path.join(root, 'data', 'opencode', 'opencode.db');
	fs.mkdirSync(path.dirname(file), { recursive: true });
	db = new DatabaseSync(file);
	db.exec(`
		CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_updated INTEGER);
		CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
		CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
	`);
	db.prepare('INSERT INTO session VALUES (?, ?, ?)').run(session, root, 1000);
	vi.resetModules();
	const { OpenCodeSessionStorage } = await import('../../../main/storage/opencode-session-storage');
	storage = new OpenCodeSessionStorage();
	probe.bytes = 0;
	probe.options = [];
});
afterEach(() => {
	db.close();
	vi.unstubAllEnvs();
	fs.rmSync(root, { recursive: true, force: true });
});

describe('OpenCode native resume contract', () => {
	it('does not mistake a step finish for the end of the CLI invocation', () => {
		// Official prompt.ts:1103-1115 continues after stop when tools still need a reply.
		const parser = new OpenCodeOutputParser();
		parser.parseJsonObject({ type: 'step_finish', part: { reason: 'stop' } });
		expect(parser.parseJsonObject({ type: 'step_start', sessionID: session })?.sessionId).toBe(
			session
		);
		expect(parser.parseJsonObject({ type: 'text', part: { text: 'Next step answer' } })?.text).toBe(
			'Next step answer'
		);
	});
	it('preserves native call IDs, inputs, failures and the per-message model in live and history reads', async () => {
		message('msg-a', 1000, 'Native answer');
		const parts = [tool('call-a', 'completed'), tool('call-b', 'error')];
		for (const [i, data] of parts.entries()) part(`part-${i}`, 'msg-a', 2000 + i, data);
		const history = await storage.readSessionMessages(root, session);
		const calls = history.messages[0].toolUse as Array<{ id: string; state: unknown }>;
		const live = parts.map((part) =>
			new OpenCodeOutputParser().parseJsonObject({ type: 'tool_use', sessionID: session, part })
		);
		expect({
			model: history.messages[0].model,
			historyIds: calls.map((call) => call.id),
			liveIds: live.map((event) => event?.toolCallId),
			failed: live[1]?.toolState,
		}).toMatchObject({
			model: 'native-model',
			historyIds: ['call-a', 'call-b'],
			liveIds: ['call-a', 'call-b'],
			failed: { status: 'failed', output: 'call-b failed', input: parts[1].state.input },
		});
		expect(history.messages[0].effort).toBeUndefined();
		for (const [index, data] of parts.entries()) {
			const live = new OpenCodeOutputParser().parseJsonObject({
				type: 'tool_use',
				sessionID: session,
				part: data,
			});
			expect(live?.toolCallId).toBe(data.callID);
			expect(live?.toolState).toEqual(calls[index].state);
			expect(live?.toolState).toMatchObject({
				input: data.state.input,
				status: index === 0 ? 'completed' : 'failed',
				output: index === 0 ? 'call-a output' : 'call-b failed',
			});
		}
	});

	it('uses the native interrupted marker for cancellation without treating ordinary errors as canceled', async () => {
		message('msg-a', 1000, '');
		const stopped = tool('call-stop', 'error', true);
		part('part-stop', 'msg-a', 2000, stopped);
		const live = new OpenCodeOutputParser().parseJsonObject({ type: 'tool_use', part: stopped });
		expect(live?.toolState).toMatchObject({ status: 'canceled', output: 'Tool execution aborted' });
		const history = await storage.readSessionMessages(root, session, { readOnly: true });
		expect(history.messages[0].toolUse).toMatchObject([
			{ id: 'call-stop', state: live?.toolState },
		]);
	});

	it('loads appended and updated rows incrementally, including same-millisecond updates and deletions', async () => {
		message('msg-large', 1000, 'old body '.repeat(20_000));
		message('msg-current', 2000, 'Current answer');
		part('part-current', 'msg-current', 2000, tool('call-current', 'completed'));
		const before = await storage.readSessionMessages(root, session, { readOnly: true, limit: 100 });
		expect(before.total).toBe(2);
		const revision = await storage.getTranscriptRevision?.(root, session);
		expect(revision).toEqual(expect.any(String));
		// Native updates use Date.now(), so two changes can share the same millisecond.
		db.prepare('UPDATE part SET data = ? WHERE id = ?').run(
			JSON.stringify(tool('call-current', 'error')),
			'part-current'
		);
		message('msg-new', 3000, 'Appended answer', 'second-model');
		probe.bytes = 0;
		const incremental = await storage.readSessionMessages(root, session, {
			readOnly: true,
			limit: 100,
		});
		expect(probe.bytes).toBeLessThan(5000);
		expect(incremental).toEqual(await storage.readSessionMessages(root, session, { limit: 100 }));
		expect(incremental.messages[1].toolUse).toMatchObject([{ state: { status: 'failed' } }]);
		expect(await storage.getTranscriptRevision?.(root, session)).not.toBe(revision);
		db.prepare('DELETE FROM part WHERE id = ?').run('part-current');
		db.prepare('DELETE FROM part WHERE message_id = ?').run('msg-large');
		db.prepare('DELETE FROM message WHERE id = ?').run('msg-large');
		expect(await storage.readSessionMessages(root, session, { readOnly: true })).toEqual(
			await storage.readSessionMessages(root, session)
		);
		expect(probe.options.every((options) => (options as { readonly: boolean }).readonly)).toBe(
			true
		);
	});

	it('sees WAL commits and keeps the native database bytes unchanged while reading and paging', async () => {
		db.exec('PRAGMA journal_mode = WAL');
		message('msg-a', 1000, 'One');
		await storage.readSessionMessages(root, session, { readOnly: true });
		const revision = await storage.getTranscriptRevision?.(root, session);
		message('msg-b', 2000, 'Two');
		const files = [file, `${file}-wal`];
		const before = files.map((p) => fs.readFileSync(p));
		expect(await storage.getTranscriptRevision?.(root, session)).not.toBe(revision);
		const page = await storage.readSessionMessages(root, session, {
			readOnly: true,
			offset: 1,
			limit: 1,
		});
		expect(page.messages.map((msg) => msg.content)).toEqual(['One']);
		expect(page.total).toBe(2);
		expect(files.map((p) => fs.readFileSync(p))).toEqual(before);
		expect(await storage.getTranscriptRevision?.(root, 'ses_missing')).toBeNull();
	});

	it('discards the parsed cursor when a database is replaced with the same row IDs and timestamps', async () => {
		message('msg-a', 1000, 'Old content');
		await storage.readSessionMessages(root, session, { readOnly: true });
		const revision = await storage.getTranscriptRevision(root, session);
		db.close();
		fs.copyFileSync(file, `${file}.replacement`);
		fs.renameSync(`${file}.replacement`, file);
		db = new DatabaseSync(file);
		db.prepare('UPDATE part SET data = ?').run(
			JSON.stringify({ type: 'text', text: 'New content' })
		);
		expect(await storage.getTranscriptRevision(root, session)).not.toBe(revision);
		const incremental = await storage.readSessionMessages(root, session, { readOnly: true });
		expect(incremental).toEqual(await storage.readSessionMessages(root, session));
		expect(incremental.messages[0].content).toBe('New content');
	});
});
