import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { GrokOutputParser } from '../../../src/main/parsers/grok-output-parser';
import { GrokSessionStorage } from '../../../src/main/storage/grok-session-storage';
vi.mock('../../../src/main/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../src/main/utils/sentry', () => ({ captureException: vi.fn() }));
const require = createRequire(import.meta.url);
const { createGrokTurn } = require('./grok-protocol.cjs');
const roots: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
it('the pinned Grok fixture produces matching stdout and native history outcomes', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-grok-fixture-'));
	roots.push(root);
	vi.stubEnv('GROK_HOME', root);
	const parser = new GrokOutputParser();
	const live = new Map<string, Record<string, unknown>>();
	const turn = createGrokTurn({
		configDir: root,
		cwd: root,
		prompt: 'Synthetic fixture acceptance',
		emit: (row: unknown) => {
			const event = parser.parseJsonObject(row);
			if (event?.toolCallId)
				live.set(event.toolCallId, {
					...live.get(event.toolCallId),
					...(event.toolState as Record<string, unknown>),
				});
		},
	});
	const tools = [
		{ id: 'fixture-one', command: 'printf one', output: 'one' },
		{ id: 'fixture-two', command: 'exit 1', output: 'two', status: 'failed' },
	];
	for (const tool of tools) turn.startTool(tool);
	for (const tool of [...tools].reverse()) turn.finishTool(tool);
	turn.finish('Fixture answer');
	const before = fs.readFileSync(turn.file);
	const result = await new GrokSessionStorage().readSessionMessages(root, turn.id, {
		readOnly: true,
	});
	const calls = result.messages.flatMap(
		(message) => (message.toolUse ?? []) as Array<{ id: string; state: Record<string, unknown> }>
	);
	expect(calls.map((call) => call.id)).toEqual(tools.map((tool) => tool.id));
	for (const call of calls) expect(call.state).toEqual(live.get(call.id));
	expect(calls.map((call) => call.state.status)).toEqual(['completed', 'failed']);
	expect(result.messages.at(-1)).toMatchObject({
		content: 'Fixture answer',
		model: 'grok-native-model',
		effort: 'high',
	});
	expect(fs.readFileSync(turn.file)).toEqual(before);
});

it('chat-only history has no recorded tool outcome and reads without writing updates', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-grok-chat-only-'));
	roots.push(root);
	vi.stubEnv('GROK_HOME', root);
	const turn = createGrokTurn({
		configDir: root,
		cwd: root,
		prompt: 'Chat-only fixture',
		persistUpdates: false,
	});
	const tool = { id: 'chat-only-tool', command: 'printf result', output: 'result' };
	turn.startTool(tool);
	turn.finishTool(tool);
	turn.finish('Chat-only answer');
	const before = fs.readFileSync(turn.file);
	const updates = path.join(path.dirname(turn.file), 'updates.jsonl');
	expect(fs.existsSync(updates)).toBe(false);
	const result = await new GrokSessionStorage().readSessionMessages(root, turn.id, {
		readOnly: true,
	});
	expect(result.messages.flatMap((message) => message.toolUse ?? [])).toMatchObject([
		{ id: tool.id, state: { status: 'unknown', output: tool.output } },
	]);
	expect(fs.readFileSync(turn.file)).toEqual(before);
	expect(fs.existsSync(updates)).toBe(false);
});
