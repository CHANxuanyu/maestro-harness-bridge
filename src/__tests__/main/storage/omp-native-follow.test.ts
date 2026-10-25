// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OmpSessionStorage } from '../../../main/storage/omp-session-storage';
import { OmpOutputParser } from '../../../main/parsers/omp-output-parser';
vi.mock('../../../main/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));
// can1357/oh-my-pi v18.12.6 @45c35e40c46166dc726ccc52f5d27f40f2449f99:
// ai/src/types.ts; agent/src/agent-loop.ts; coding-agent/src/session/
// {session-entries,agent-session}.ts and modes/print-mode.ts.
const id = '00000000-0000-4000-8000-000000000018';
const time = '2026-10-25T00:00:00.000Z';
const content = (text: string) => [{ type: 'text', text }];
const call = (id: string) => ({ type: 'toolCall', id, name: 'bash', arguments: { command: id } });
const entry = (id: string, parentId: string | null, message: unknown) => ({
	type: 'message',
	id,
	parentId,
	timestamp: time,
	message,
});
const assistant = (text: string, calls: unknown[] = []) => ({
	role: 'assistant',
	content: [...content(text), ...calls],
	model: 'omp-native-model',
	stopReason: calls.length ? 'toolUse' : 'stop',
	timestamp: Date.parse(time),
});
const canceled = { __synthetic: true, source: 'assistant_stop_aborted', executed: false };
let root: string, project: string, file: string, storage: OmpSessionStorage;
const lines = (rows: unknown[]) => rows.map((row) => JSON.stringify(row) + '\n').join('');
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'maestro-omp-native-'));
	project = path.join(root, 'project');
	vi.spyOn(os, 'homedir').mockReturnValue(root);
	vi.stubEnv('PI_CODING_AGENT_DIR', '');
	file = path.join(root, '.omp', 'agent', 'sessions', 'project', '2026-10-25_' + id + '.jsonl');
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(
		file,
		lines([
			{ type: 'session', version: 3, id, cwd: project, timestamp: time },
			entry('u', null, {
				role: 'user',
				content: content('Native acceptance'),
				timestamp: Date.parse(time),
			}),
		])
	);
	storage = new OmpSessionStorage();
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await fs.rm(root, { recursive: true, force: true });
});
describe('Oh My Pi native alignment', () => {
	it('error detection preserves continuations and drops errors after terminal settlement', () => {
		const parser = new OmpOutputParser();
		const event = {
			type: 'agent_end',
			isTerminal: false,
			messages: [{ ...assistant(''), errorMessage: 'Native interruption' }],
		};
		expect(parser.detectErrorFromParsed(event)).toBeNull();
		parser.parseJsonObject(event);
		const terminal = { ...event, isTerminal: true };
		expect(parser.detectErrorFromParsed(terminal)).not.toBeNull();
		parser.parseJsonObject(terminal);
		expect(parser.detectErrorFromParsed(terminal)).toBeNull();
		expect(parser.detectErrorFromLine(JSON.stringify(terminal))).toBeNull();
	});
	it('pairs native toolCall/toolResult by ID with matching live input and outcomes', async () => {
		const outcomes = [
			{
				id: 'one',
				result: { content: content('one-output'), details: { exitCode: 0 } },
				isError: false,
			},
			{
				id: 'two',
				result: { content: content('two-output'), details: { exitCode: 1 } },
				isError: true,
			},
			{
				id: 'three',
				result: { content: content('Tool execution was aborted.'), details: canceled },
				isError: true,
			},
		];
		await fs.appendFile(
			file,
			lines([
				{
					type: 'thinking_level_change',
					id: 'thinking',
					parentId: 'u',
					timestamp: time,
					thinkingLevel: 'high',
					configured: 'auto',
				},
				entry(
					'a',
					'thinking',
					assistant(
						'',
						outcomes.map((x) => call(x.id))
					)
				),
				...[...outcomes].reverse().map((x, i, rows) =>
					entry('result-' + x.id, i ? 'result-' + rows[i - 1].id : 'a', {
						role: 'toolResult',
						toolCallId: x.id,
						toolName: 'bash',
						...x.result,
						isError: x.isError,
						timestamp: Date.parse(time),
					})
				),
				entry('final', 'result-one', assistant('Native final answer')),
			])
		);
		const messages = (await storage.readSessionMessages(project, id)).messages;
		expect(messages).toHaveLength(3);
		expect(messages[2]).toMatchObject({ model: 'omp-native-model', effort: 'high' });
		const parser = new OmpOutputParser();
		const live = outcomes.map((x) => {
			const start = parser.parseJsonObject({
				type: 'tool_execution_start',
				toolCallId: x.id,
				toolName: 'bash',
				args: { command: x.id },
			});
			const end = parser.parseJsonObject({
				type: 'tool_execution_end',
				toolCallId: x.id,
				toolName: 'bash',
				result: x.result,
				isError: x.isError,
			});
			return {
				id: end?.toolCallId,
				tool: end?.toolName,
				state: {
					...(start?.toolState as Record<string, unknown>),
					...(end?.toolState as Record<string, unknown>),
				},
			};
		});
		expect(live.map((x) => x.state.status)).toEqual(['completed', 'failed', 'canceled']);
		expect(messages[1].toolUse).toEqual(live);
	});
	it('keeps error prose as failure without a native cancellation marker', () => {
		const parser = new OmpOutputParser();
		expect(
			parser.parseJsonObject({
				type: 'tool_execution_end',
				toolCallId: 'x',
				toolName: 'bash',
				result: { content: content('aborted by an application error'), details: {} },
				isError: true,
			})?.toolState
		).toMatchObject({ status: 'failed' });
	});
	it('honors nonterminal maintenance before dropping events after a terminal agent_end', () => {
		const parser = new OmpOutputParser();
		const end = {
			type: 'agent_end',
			messages: [assistant('First pass')],
			isTerminal: false,
			yielded: false,
		};
		expect(parser.parseJsonObject(end)?.type).toBe('system');
		expect(
			parser.parseJsonObject({
				type: 'message_update',
				assistantMessageEvent: { type: 'text_delta', delta: 'Continuation' },
			})?.text
		).toBe('Continuation');
		expect(parser.parseJsonObject({ ...end, isTerminal: true, yielded: true })?.type).toBe(
			'result'
		);
		expect(
			parser.parseJsonObject({
				type: 'message_update',
				assistantMessageEvent: { type: 'text_delta', delta: 'late' },
			})
		).toBeNull();
		expect(
			parser.parseJsonObject({
				type: 'tool_execution_end',
				toolCallId: 'late',
				toolName: 'bash',
				result: { content: content('late') },
				isError: false,
			})
		).toBeNull();
	});
	it('uses the active branch and does not borrow a later or cleared effort setting', async () => {
		await fs.appendFile(
			file,
			lines([
				{
					type: 'thinking_level_change',
					id: 'high',
					parentId: 'u',
					timestamp: time,
					thinkingLevel: 'high',
				},
				entry('old', 'high', assistant('old branch')),
				{
					type: 'thinking_level_change',
					id: 'clear',
					parentId: 'u',
					timestamp: time,
					thinkingLevel: null,
				},
				entry('new', 'clear', assistant('selected branch')),
				{ ...entry('late', 'old', assistant('off-branch result')), activeLeafId: 'new' },
			])
		);
		const messages = (await storage.readSessionMessages(project, id)).messages;
		expect(messages.map((x) => x.content)).toEqual(['Native acceptance', 'selected branch']);
		expect(messages[1].effort).toBeUndefined();
		expect(messages[1].model).toBe('omp-native-model');
	});
	it('reads the explicit native agent directory without falling back to the default', async () => {
		const isolated = path.join(root, 'isolated-agent');
		await fs.mkdir(path.join(isolated, 'sessions', 'project'), { recursive: true });
		await fs.rename(file, path.join(isolated, 'sessions', 'project', path.basename(file)));
		vi.stubEnv('PI_CODING_AGENT_DIR', isolated);
		expect((await storage.readSessionMessages(project, id)).messages).toHaveLength(1);
	});
	it('does not reuse a cursor from another native agent directory', async () => {
		await storage.readSessionMessages(project, id, { readOnly: true });
		const isolated = path.join(root, 'another-agent');
		const otherFile = path.join(isolated, 'sessions', 'project', path.basename(file));
		await fs.mkdir(path.dirname(otherFile), { recursive: true });
		await fs.writeFile(
			otherFile,
			lines([
				{ type: 'session', id, cwd: project, timestamp: time },
				entry('other', null, assistant('Other native directory')),
			])
		);
		vi.stubEnv('PI_CODING_AGENT_DIR', isolated);
		expect(
			(await storage.readSessionMessages(project, id, { readOnly: true })).messages.map(
				(x) => x.content
			)
		).toEqual(['Other native directory']);
	});
	it('keeps read-only refresh incremental and equal to full reads after append and replacement', async () => {
		await fs.appendFile(file, lines([entry('big', 'u', assistant('x'.repeat(180000)))]));
		const read = (options = { readOnly: true }) =>
			storage.readSessionMessages(project, id, options);
		await read();
		const before = await storage.getTranscriptRevision(project, id);
		expect(before).toBeTruthy();
		const readFile = vi.spyOn(fs, 'readFile');
		const open = fs.open.bind(fs);
		let bytes = 0;
		vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
			const handle = await open(...args);
			const read = handle.read.bind(handle);
			handle.read = (async (...readArgs: Parameters<typeof read>) => {
				const result = await read(...readArgs);
				bytes += result.bytesRead;
				return result;
			}) as typeof handle.read;
			return handle;
		});
		await fs.appendFile(file, lines([entry('tail', 'big', assistant('tail answer'))]));
		const incremental = await read();
		expect(await storage.getTranscriptRevision(project, id)).not.toBe(before);
		expect(readFile).not.toHaveBeenCalled();
		expect(bytes).toBeLessThan(5000);
		expect(incremental).toEqual(await read({ readOnly: false }));
		const original = await fs.readFile(file);
		const replacement = file + '.replacement';
		await fs.writeFile(
			replacement,
			lines([
				{ type: 'session', id, cwd: project, timestamp: time },
				entry('new', null, assistant('replacement')),
			])
		);
		await fs.rename(replacement, file);
		expect((await read()).messages.map((x) => x.content)).toEqual(['replacement']);
		expect(original.length).toBeGreaterThan(180000);
	});
});
