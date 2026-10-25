// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CopilotSessionStorage } from '../../../main/storage/copilot-session-storage';
import { CopilotOutputParser } from '../../../main/parsers/copilot-output-parser';

vi.mock('../../../main/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));

// Official @github/copilot@1.0.63, gitHead c440c72e8caca344fe4a4223cceb59dcd241cb48:
// index.js event schemas; app.js Adr/_dr stdout and WM/n0e workspace metadata.
// assistant.usage is ephemeral and excluded by Adr; it cannot supply history effort.
const id = '11111111-2222-4333-8444-555555555555';
const timestamp = '2026-10-25T00:00:00.000Z';
const event = (type: string, data: unknown, suffix = type) => ({
	type,
	data,
	id: suffix,
	timestamp,
	parentId: null,
});
const row = (value: unknown) => JSON.stringify(value) + '\n';
let root: string, project: string, file: string, workspace: string;
let storage: CopilotSessionStorage;
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'maestro-copilot-native-'));
	project = path.join(root, 'project');
	vi.stubEnv('COPILOT_HOME', root);
	const dir = path.join(root, 'session-state', id);
	await fs.mkdir(dir, { recursive: true });
	workspace = path.join(dir, 'workspace.yaml');
	await fs.writeFile(
		workspace,
		`id: ${id}\ncwd: ${JSON.stringify(project)}\ncreated_at: ${timestamp}\nupdated_at: ${timestamp}\n`
	);
	file = path.join(dir, 'events.jsonl');
	await fs.writeFile(
		file,
		row(
			event('session.start', {
				sessionId: id,
				version: 1,
				producer: 'copilot-agent',
				copilotVersion: '1.0.63',
				startTime: timestamp,
				selectedModel: 'configured-only',
				reasoningEffort: 'high',
				context: { cwd: project },
			})
		) + row(event('user.message', { content: 'Native acceptance' }))
	);
	storage = new CopilotSessionStorage();
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await fs.rm(root, { recursive: true, force: true });
});

it('reads and probes only the selected account directory even when another account has the same ID', async () => {
	const selected = path.join(root, 'selected');
	const dir = path.join(selected, 'session-state', id);
	await fs.mkdir(dir, { recursive: true });
	await fs.copyFile(workspace, path.join(dir, 'workspace.yaml'));
	await fs.writeFile(
		path.join(dir, 'events.jsonl'),
		row(event('user.message', { content: 'Selected account' }))
	);
	const options = { configDir: selected, readOnly: true };
	expect((await storage.readSessionMessages(project, id, options)).messages[0].content).toBe(
		'Selected account'
	);
	expect(await storage.getTranscriptRevision(project, id, options)).toContain(
		path.join(selected, 'session-state')
	);
	await fs.rm(dir, { recursive: true });
	expect((await storage.readSessionMessages(project, id, options)).messages).toEqual([]);
	expect(await storage.getTranscriptRevision(project, id, options)).toBeNull();
});

it('pairs reversed completions by native ID and matches live input, result, failure and model', async () => {
	const requests = ['first', 'second'].map((toolCallId) => ({
		toolCallId,
		name: 'bash',
		arguments: { command: toolCallId },
	}));
	const parser = new CopilotOutputParser();
	const live = new Map<string, unknown>();
	const rows = [
		event('assistant.message', {
			messageId: 'assistant-1',
			model: 'actual-model',
			content: '',
			toolRequests: requests,
		}),
	];
	for (const request of requests) {
		const start = event('tool.execution_start', { ...request, toolName: request.name });
		live.set(request.toolCallId, parser.parseJsonObject(start)?.toolState);
		rows.push(start);
	}
	for (const toolCallId of ['second', 'first']) {
		const end = event('tool.execution_complete', {
			toolCallId,
			success: toolCallId === 'first',
			...(toolCallId === 'first'
				? { result: { content: 'first result' } }
				: { error: { message: 'second failure', code: 'failure' } }),
		});
		live.set(toolCallId, {
			...(live.get(toolCallId) as object),
			...parser.parseJsonObject(end)?.toolState,
		});
		rows.push(end);
	}
	await fs.appendFile(file, rows.map(row).join(''));
	const before = await fs.readFile(file);
	const result = await storage.readSessionMessages(project, id, { readOnly: true });
	const message = result.messages.at(-1)!;
	const calls = message.toolUse as Array<{ id: string; state: unknown }>;
	expect(calls).toHaveLength(2);
	for (const call of calls) expect(call.state).toEqual(live.get(call.id));
	expect(message.model).toBe('actual-model');
	expect(message.effort).toBeUndefined();
	expect(await fs.readFile(file)).toEqual(before);
});

it('native abort cancels only unfinished calls without rewriting earlier success or failure', async () => {
	const tools = ['done', 'failed', 'pending'].map((toolCallId) => ({
		toolCallId,
		name: 'bash',
		arguments: { command: toolCallId },
	}));
	await fs.appendFile(
		file,
		[
			event('assistant.message', { messageId: 'tools', content: '', toolRequests: tools }),
			event('tool.execution_complete', {
				toolCallId: 'done',
				success: true,
				result: { content: 'done' },
			}),
			event('tool.execution_complete', {
				toolCallId: 'failed',
				success: false,
				error: { message: 'cancelled is just prose', code: 'failure' },
			}),
			event('abort', { reason: 'user_initiated' }),
			event('user.message', { content: 'Next turn' }, 'next-user'),
			event(
				'assistant.message',
				{
					messageId: 'next',
					content: '',
					toolRequests: [{ toolCallId: 'next', name: 'bash', arguments: { command: 'next' } }],
				},
				'next-assistant'
			),
		]
			.map(row)
			.join('')
	);
	const messages = (await storage.readSessionMessages(project, id)).messages;
	const states = messages
		.flatMap((message) => (message.toolUse ?? []) as Array<{ state: { status: string } }>)
		.map((call) => call.state.status);
	expect(states).toEqual(['completed', 'failed', 'canceled', 'running']);
});

it('a native abort settles every pending live tool without changing completed calls or ending the next turn', () => {
	// @github/copilot 1.0.63 index.js abort schema and AgentSession abort emission.
	const parser = new CopilotOutputParser();
	parser.parseJsonObject(
		event('assistant.message', {
			messageId: 'tools',
			content: '',
			toolRequests: ['done', 'pending-one', 'pending-two'].map((toolCallId) => ({
				toolCallId,
				name: 'bash',
				arguments: { command: toolCallId },
			})),
		})
	);
	expect(
		parser.parseJsonObject(
			event('tool.execution_complete', {
				toolCallId: 'done',
				success: true,
				result: { content: 'Done' },
			})
		)
	).toMatchObject({ toolCallId: 'done', toolState: { status: 'completed' } });
	const aborted = parser.parseJsonObject(event('abort', { reason: 'remote_command' }));
	expect(aborted).toMatchObject({
		type: 'tool_use',
		toolCallId: 'pending-one',
		toolName: 'bash',
		toolState: { status: 'canceled' },
		toolResultBlocks: [
			{ toolCallId: 'pending-two', toolName: 'bash', toolState: { status: 'canceled' } },
		],
	});
	expect(parser.parseJsonObject(event('abort', { reason: 'user_initiated' }))).toEqual({
		type: 'system',
		raw: expect.any(Object),
	});
	expect(
		parser.parseJsonObject(
			event('tool.execution_start', {
				toolCallId: 'next-turn',
				toolName: 'bash',
				arguments: { command: 'next' },
			})
		)
	).toMatchObject({ type: 'tool_use', toolCallId: 'next-turn', toolState: { status: 'running' } });
});

it('only the CLI terminal result ends parsing, while later tool/text events are dropped', () => {
	const parser = new CopilotOutputParser();
	// @github/copilot 1.0.63 app.js qYr schema and Adr stdout emitter.
	const nativeError = event('session.error', { errorType: 'query', message: 'Native failure' });
	expect(parser.detectErrorFromParsed(nativeError)).not.toBeNull();
	expect(
		parser.parseJsonObject(event('assistant.message', { messageId: 'one', content: 'One answer' }))
	).not.toBeNull();
	expect(
		parser.parseJsonObject(
			event('tool.execution_start', {
				toolCallId: 'later',
				toolName: 'bash',
				arguments: { command: 'later' },
			})
		)
	).toMatchObject({ type: 'tool_use' });
	parser.parseJsonObject({
		type: 'result',
		sessionId: id,
		timestamp,
		exitCode: 0,
		usage: { sessionDurationMs: 1 },
	});
	expect(parser.detectErrorFromParsed(nativeError)).toBeNull();
	expect(parser.detectErrorFromLine(JSON.stringify(nativeError))).toBeNull();
	expect(
		parser.parseJsonObject(
			event('tool.execution_start', { toolCallId: 'late', toolName: 'bash', arguments: {} })
		)
	).toBeNull();
	expect(
		parser.parseJsonObject(event('assistant.message_delta', { deltaContent: 'late' }))
	).toBeNull();
});

it('reads only appended bytes, keeps partial tails and pagination equal to a full read, and notices replacements', async () => {
	await fs.appendFile(
		file,
		row(
			event('assistant.message', {
				messageId: 'large',
				content: 'x'.repeat(180000),
				model: 'model',
			})
		)
	);
	await storage.readSessionMessages(project, id, { readOnly: true });
	const revision = await storage.getTranscriptRevision(project, id);
	expect(revision).toBeTruthy();
	const readFile = vi.spyOn(fs, 'readFile');
	const next = row(
		event('assistant.message', { messageId: 'next', content: '新答复', model: 'new-model' }, 'next')
	);
	await fs.appendFile(file, Buffer.from(next).subarray(0, -4));
	const partial = await storage.readSessionMessages(project, id, { readOnly: true });
	expect(partial.messages.at(-1)?.content).toHaveLength(180000);
	await fs.appendFile(file, Buffer.from(next).subarray(-4));
	const incremental = await storage.readSessionMessages(project, id, { readOnly: true, limit: 1 });
	expect(readFile.mock.calls.filter(([name]) => name === file)).toHaveLength(0);
	expect(incremental).toEqual(
		await new CopilotSessionStorage().readSessionMessages(project, id, { limit: 1 })
	);
	expect(incremental.messages[0].content).toBe('新答复');
	expect(await storage.getTranscriptRevision(project, id)).not.toBe(revision);
	await fs.writeFile(file + '.next', row(event('user.message', { content: 'replacement' })));
	await fs.rename(file + '.next', file);
	expect(
		(await storage.readSessionMessages(project, id, { readOnly: true })).messages[0].content
	).toBe('replacement');
	await fs.writeFile(workspace, `id: ${id}\ncwd: /another/project\n`);
	expect(await storage.getTranscriptRevision(project, id)).toBeNull();
	expect((await storage.readSessionMessages(project, id, { readOnly: true })).messages).toEqual([]);
});
