'use strict';

// can1357/oh-my-pi v18.12.6 @45c35e40c46166dc726ccc52f5d27f40f2449f99:
// ai/src/types.ts; agent/src/agent-loop.ts; coding-agent/src/session/
// {session-entries,session-paths,session-manager,agent-session}.ts;
// modes/print-mode.ts printableEvent. No scenario controls enter native rows.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const content = (text) => [{ type: 'text', text }];
const model = 'omp-native-model';
const usage = {
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function createOmpTurn({ configDir, cwd, id, prompt, emit = () => {} }) {
	const sessions = path.join(configDir, 'sessions');
	fs.mkdirSync(sessions, { recursive: true });
	const resumed = Boolean(id);
	id ||= randomUUID();
	let file = resumed
		? fs
				.readdirSync(sessions, { recursive: true })
				.map((name) => path.join(sessions, String(name)))
				.find((name) => name.endsWith(`_${id}.jsonl`))
		: undefined;
	if (resumed && !file) throw new Error('Session not found');
	if (!file) {
		const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(cwd));
		if (relative.startsWith('..') || path.isAbsolute(relative))
			throw new Error('Fixture project must be under the temporary root');
		const bucket = `-tmp-${relative.replace(/[/\\:]/g, '-')}`;
		file = path.join(
			sessions,
			bucket,
			`${new Date().toISOString().replace(/[:.]/g, '-')}_${id}.jsonl`
		);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(
			file,
			JSON.stringify({
				type: 'session',
				version: 3,
				id,
				cwd,
				timestamp: new Date().toISOString(),
			}) + '\n'
		);
	}
	const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
	const header = rows[0];
	let parentId = rows.at(-1).type === 'session' ? null : rows.at(-1).id;
	const append = (fields) => {
		const row = { ...fields, id: randomUUID(), parentId, timestamp: new Date().toISOString() };
		fs.appendFileSync(file, JSON.stringify(row) + '\n');
		parentId = row.id;
		return row;
	};
	const message = (message) => {
		append({ type: 'message', message });
		emit({ type: 'message_end', message });
	};
	const assistant = (text, calls = [], stopReason = calls.length ? 'toolUse' : 'stop') => ({
		role: 'assistant',
		content: [...content(text), ...calls],
		api: 'anthropic-messages',
		provider: 'anthropic',
		model,
		usage,
		stopReason,
		timestamp: Date.now(),
	});
	const active = new Map();
	emit(header);
	emit({ type: 'agent_start' });
	message({ role: 'user', content: content(prompt), timestamp: Date.now() });
	append({ type: 'thinking_level_change', thinkingLevel: 'high', configured: 'high' });
	const finishTool = (tool, canceled = false) => {
		const result = {
			content: content(canceled ? 'Tool execution was aborted.' : tool.output),
			details: canceled
				? { __synthetic: true, source: 'assistant_stop_aborted', executed: false }
				: {},
		};
		const isError = canceled || tool.status === 'failed';
		emit({ type: 'tool_execution_end', toolCallId: tool.id, toolName: 'bash', result, isError });
		message({
			role: 'toolResult',
			toolCallId: tool.id,
			toolName: 'bash',
			...result,
			isError,
			timestamp: Date.now(),
		});
		active.delete(tool.id);
	};
	return {
		id,
		file,
		startTool(tool) {
			const args = { command: tool.command };
			message(assistant('', [{ type: 'toolCall', id: tool.id, name: 'bash', arguments: args }]));
			active.set(tool.id, tool);
			emit({ type: 'tool_execution_start', toolCallId: tool.id, toolName: 'bash', args });
		},
		finishTool,
		finish(answer) {
			const final = assistant(answer);
			emit({
				type: 'message_update',
				assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: answer },
			});
			message(final);
			emit({ type: 'agent_end', messages: [final], isTerminal: true, yielded: true });
		},
		stop() {
			for (const tool of active.values()) finishTool(tool, true);
			const final = assistant('', [], 'aborted');
			message(final);
			emit({ type: 'agent_end', messages: [final], isTerminal: true, yielded: true });
		},
	};
}
module.exports = { createOmpTurn };
