// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GrokSessionStorage } from '../../../main/storage/grok-session-storage';
import { GrokOutputParser } from '../../../main/parsers/grok-output-parser';

vi.mock('../../../main/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../main/utils/sentry', () => ({ captureException: vi.fn() }));

// xai-org/grok-build@2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8 (1.0.45):
// sampling-types/src/conversation.rs; shell/src/session/storage/{mod,jsonl/mod}.rs;
// shell/src/extensions/notification.rs; pager/src/headless/reducer/acp.rs;
// agent-client-protocol-schema 0.11.4 (the official Cargo.lock resolution).
const id = '019f0000-aaaa-7000-8000-000000000001';
let root: string;
let project: string;
let transcript: string;
let updates: string;
let storage: GrokSessionStorage;
const row = (value: unknown) => `${JSON.stringify(value)}\n`;
const assistant = (text: string, calls?: unknown[]) => ({
	type: 'assistant',
	content: text,
	tool_calls: calls,
	model_id: 'grok-native-model',
	reasoning_effort: 'high',
});
const call = (id: string) => ({
	id,
	name: 'run_terminal_command',
	arguments: JSON.stringify({ command: id }),
});
const content = (text: string) => [{ type: 'content', content: { type: 'text', text } }];
const update = (toolCallId: string, status: string, output: string) => ({
	timestamp: 1792886400,
	method: 'session/update',
	params: {
		sessionId: id,
		update: { sessionUpdate: 'tool_call_update', toolCallId, status, content: content(output) },
	},
});
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'maestro-grok-native-'));
	project = path.join(root, 'project');
	vi.stubEnv('GROK_HOME', path.join(root, 'grok'));
	const dir = path.join(root, 'grok', 'sessions', encodeURIComponent(project), id);
	await fs.mkdir(dir, { recursive: true });
	transcript = path.join(dir, 'chat_history.jsonl');
	updates = path.join(dir, 'updates.jsonl');
	await fs.writeFile(
		transcript,
		row({ type: 'user', content: [{ type: 'text', text: 'Native test' }] })
	);
	storage = new GrokSessionStorage();
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await fs.rm(root, { recursive: true, force: true });
});

describe('Grok native history and live outcomes', () => {
	it('treats a native Bash nonzero exit as failure even when ACP says completed', async () => {
		// tools/src/types/output.rs and shell/src/session/acp_conversion.rs:
		// ACP completion does not inspect Bash.exit_code.
		const rawOutput = {
			type: 'Bash',
			output: [101],
			output_for_prompt: 'e',
			exit_code: 1,
			command: 'exit 1',
			truncated: false,
			signal: null,
			timed_out: false,
			description: null,
			current_dir: project,
			output_file: '',
			total_bytes: 1,
		};
		const parser = new GrokOutputParser();
		parser.parseJsonObject({
			type: 'tool_call',
			toolCallId: 'bash',
			toolName: 'run_terminal_command',
			rawInput: { command: 'exit 1' },
		});
		const live = parser.parseJsonObject({
			type: 'tool_call_update',
			toolCallId: 'bash',
			status: 'completed',
			rawOutput,
			content: content('e'),
		});
		expect(live?.toolState).toMatchObject({ status: 'failed', exitCode: 1, output: rawOutput });
		await fs.appendFile(
			transcript,
			row(assistant('', [{ ...call('bash'), arguments: JSON.stringify({ command: 'exit 1' }) }]))
		);
		const event = update('bash', 'completed', 'e');
		await fs.writeFile(
			updates,
			row({ ...event, params: { ...event.params, update: { ...event.params.update, rawOutput } } })
		);
		expect((await storage.readSessionMessages(project, id)).messages[1].toolUse).toMatchObject([
			{ id: 'bash', state: { status: 'failed', exitCode: 1, output: rawOutput } },
		]);
	});
	it('pairs call IDs with durable outcomes and uses the same native input/output as stdout', async () => {
		await fs.appendFile(transcript, row(assistant('', [call('call-a'), call('call-b')])));
		await fs.appendFile(
			transcript,
			row({ type: 'tool_result', tool_call_id: 'call-b', content: 'second result' })
		);
		await fs.appendFile(
			transcript,
			row({ type: 'tool_result', tool_call_id: 'call-a', content: 'first result' })
		);
		await fs.writeFile(
			updates,
			row(update('call-b', 'failed', 'second result')) +
				row(update('call-a', 'completed', 'first result'))
		);
		const parser = new GrokOutputParser();
		const live = ['call-a', 'call-b'].map((toolCallId, index) => {
			const start = parser.parseJsonObject({
				type: 'tool_call',
				toolCallId,
				toolName: 'run_terminal_command',
				rawInput: { command: toolCallId },
				status: 'in_progress',
			});
			const end = parser.parseJsonObject({
				type: 'tool_call_update',
				toolCallId,
				status: index ? 'failed' : 'completed',
				content: content(index ? 'second result' : 'first result'),
			});
			return { id: end?.toolCallId, state: { ...start?.toolState, ...end?.toolState } };
		});
		const result = await storage.readSessionMessages(project, id);
		expect(result.messages[1]).toMatchObject({ model: 'grok-native-model', effort: 'high' });
		const tools = result.messages[1].toolUse as Array<{ id: string; state: unknown }>;
		expect(tools.map(({ id, state }) => ({ id, state }))).toEqual(live);
		expect(live).toEqual([
			{
				id: 'call-a',
				state: { input: { command: 'call-a' }, status: 'completed', output: 'first result' },
			},
			{
				id: 'call-b',
				state: { input: { command: 'call-b' }, status: 'failed', output: 'second result' },
			},
		]);
	});
	it.each(['end_turn', 'cancelled'])(
		'drops late text and tool events after %s while preserving native identity',
		(stopReason) => {
			const parser = new GrokOutputParser();
			expect(
				parser.parseJsonObject({
					type: 'end',
					stopReason,
					sessionId: id,
					requestId: 'request-native',
				})?.sessionId
			).toBe(id);
			expect(parser.parseJsonObject({ type: 'text', data: 'late text' })).toBeNull();
			expect(
				parser.parseJsonObject({
					type: 'tool_call',
					toolCallId: 'late',
					toolName: 'run_terminal_command',
					rawInput: {},
				})
			).toBeNull();
		}
	);
	it('does not infer success or failure from result prose when durable status is absent', async () => {
		await fs.appendFile(
			transcript,
			row(assistant('', [call('call-a')])) +
				row({
					type: 'tool_result',
					tool_call_id: 'call-a',
					content: 'error, interrupted, exit code 1 are ordinary words here',
				})
		);
		const result = await storage.readSessionMessages(project, id);
		expect(result.messages[1].toolUse).toMatchObject([
			{
				id: 'call-a',
				state: {
					status: 'unknown',
					output: 'error, interrupted, exit code 1 are ordinary words here',
				},
			},
		]);
	});
	it('settles only pending tools when a durable native turn reports user cancellation', async () => {
		await fs.appendFile(transcript, row(assistant('', [call('done'), call('pending')])));
		const starts = ['done', 'pending']
			.map((toolCallId) =>
				row({
					timestamp: 1792886400,
					method: 'session/update',
					params: {
						sessionId: id,
						update: {
							sessionUpdate: 'tool_call',
							toolCallId,
							title: toolCallId,
							status: 'in_progress',
							rawInput: { command: toolCallId },
						},
					},
				})
			)
			.join('');
		await fs.writeFile(
			updates,
			starts +
				row(update('done', 'completed', 'already completed')) +
				row({
					timestamp: 1792886400,
					method: '_x.ai/session/update',
					params: {
						sessionId: id,
						update: {
							sessionUpdate: 'turn_completed',
							prompt_id: 'request-native',
							stop_reason: 'cancelled',
						},
					},
				})
		);
		const result = await storage.readSessionMessages(project, id);
		expect(result.messages[1].toolUse).toMatchObject([
			{ id: 'done', state: { status: 'completed', output: 'already completed' } },
			{ id: 'pending', state: { status: 'canceled' } },
		]);
	});
	it('reads only appended bytes, detects updates-only changes and stays identical to full paging', async () => {
		await fs.appendFile(transcript, row(assistant('x'.repeat(180000), [call('call-a')])));
		await fs.writeFile(updates, row(update('call-a', 'in_progress', 'working')));
		await storage.readSessionMessages(project, id, { readOnly: true });
		const revision = await storage.getTranscriptRevision(project, id);
		let bytes = 0;
		const originalRead = fs.readFile.bind(fs);
		vi.spyOn(fs, 'readFile').mockImplementation((async (
			...args: Parameters<typeof fs.readFile>
		) => {
			const result = await originalRead(...args);
			bytes += Buffer.byteLength(result);
			return result;
		}) as typeof fs.readFile);
		const originalOpen = fs.open.bind(fs);
		vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
			const file = await originalOpen(...args);
			return new Proxy(file, {
				get(target, key) {
					if (key === 'read')
						return async (...values: unknown[]) => {
							const result = await (
								target.read as (...args: unknown[]) => Promise<{ bytesRead: number }>
							).apply(target, values);
							bytes += result.bytesRead;
							return result;
						};
					const value = Reflect.get(target, key);
					return typeof value === 'function' ? value.bind(target) : value;
				},
			});
		});
		await fs.appendFile(updates, row(update('call-a', 'failed', 'native failure')));
		expect(await storage.getTranscriptRevision(project, id)).not.toBe(revision);
		await fs.appendFile(transcript, row(assistant('Next native answer')));
		const before = await originalRead(transcript);
		const updateBytes = await originalRead(updates);
		const incremental = await storage.readSessionMessages(project, id, { readOnly: true });
		expect(bytes).toBeLessThan(5000);
		expect(incremental).toEqual(await storage.readSessionMessages(project, id));
		expect(
			await storage.readSessionMessages(project, id, { readOnly: true, offset: 1, limit: 1 })
		).toEqual(await storage.readSessionMessages(project, id, { offset: 1, limit: 1 }));
		expect(await originalRead(transcript)).toEqual(before);
		expect(await originalRead(updates)).toEqual(updateBytes);
	});
	it('re-reads a partial tail and a replaced native transcript without carrying old messages', async () => {
		await fs.appendFile(transcript, row(assistant('first')));
		await storage.readSessionMessages(project, id, { readOnly: true });
		const next = row(assistant('第二条'));
		const bytes = Buffer.from(next);
		const cut = bytes.indexOf(Buffer.from('二')) + 1;
		await fs.appendFile(transcript, bytes.subarray(0, cut));
		expect(await storage.readSessionMessages(project, id, { readOnly: true })).toEqual(
			await storage.readSessionMessages(project, id)
		);
		await fs.appendFile(transcript, bytes.subarray(cut));
		expect(await storage.readSessionMessages(project, id, { readOnly: true })).toEqual(
			await storage.readSessionMessages(project, id)
		);
		await fs.writeFile(transcript + '.new', row(assistant('replacement')));
		await fs.rename(transcript + '.new', transcript);
		expect(await storage.readSessionMessages(project, id, { readOnly: true })).toEqual(
			await storage.readSessionMessages(project, id)
		);
		expect(
			(await storage.readSessionMessages(project, id, { readOnly: true })).messages.map(
				(message) => message.content
			)
		).toEqual(['replacement']);
	});
});
