'use strict';

// xai-org/grok-build@2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8, manifests 1.0.45:
// sampling-types/src/conversation.rs, shell/src/session/persistence.rs,
// shell/src/session/storage/{mod,jsonl/mod}.rs, extensions/notification.rs,
// pager/src/headless/reducer/acp.rs. ACP schema is locked at 0.11.4.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const model = 'grok-native-model';
const textContent = (text) => [{ type: 'content', content: { type: 'text', text } }];

function createGrokTurn({ configDir, cwd, id, prompt, persistUpdates = true, emit = () => {} }) {
	const resumed = Boolean(id);
	id ||= randomUUID();
	const dir = path.join(configDir, 'sessions', encodeURIComponent(cwd), id);
	const file = path.join(dir, 'chat_history.jsonl');
	if (resumed && !fs.existsSync(file)) throw new Error('Session not found');
	fs.mkdirSync(dir, { recursive: true });
	const append = (target, value) =>
		fs.appendFileSync(path.join(dir, target), `${JSON.stringify(value)}\n`);
	const summaryPath = path.join(dir, 'summary.json');
	const summary = fs.existsSync(summaryPath)
		? JSON.parse(fs.readFileSync(summaryPath))
		: {
				info: { id, cwd },
				session_summary: prompt,
				generated_title: prompt,
				created_at: new Date().toISOString(),
				num_messages: 0,
				current_model_id: model,
				chat_format_version: 1,
			};
	const saveSummary = () => {
		summary.updated_at = new Date().toISOString();
		fs.writeFileSync(summaryPath, JSON.stringify(summary));
	};
	const chat = (record) => {
		append('chat_history.jsonl', record);
		summary.num_messages++;
		saveSummary();
	};
	// The same pinned storage separates chat_history from ACP updates. Older
	// chat-only sessions cannot establish a tool's outcome from its text result.
	const notification = (method, update) => {
		if (!persistUpdates) return;
		append('updates.jsonl', {
			timestamp: Math.floor(Date.now() / 1000),
			method,
			params: { sessionId: id, update },
		});
	};
	const acp = (kind, fields) => {
		// toolName is a stdout field; ACP carries native identity in its metadata.
		const persisted = Object.fromEntries(
			Object.entries(fields).filter(([key, value]) => key !== 'toolName' && value !== null)
		);
		notification('session/update', { sessionUpdate: kind, ...persisted });
		emit({ type: kind, ...fields });
	};
	const requestId = randomUUID();
	chat({ type: 'user', content: [{ type: 'text', text: prompt }] });
	const finishTurn = (stopReason) => {
		notification('_x.ai/session/update', {
			sessionUpdate: 'turn_completed',
			prompt_id: requestId,
			stop_reason: stopReason,
		});
		emit({ type: 'end', stopReason, sessionId: id, requestId });
	};
	return {
		id,
		file,
		startTool(tool) {
			const input = { command: tool.command };
			chat({
				type: 'assistant',
				content: '',
				model_id: model,
				reasoning_effort: 'high',
				tool_calls: [
					{ id: tool.id, name: 'run_terminal_command', arguments: JSON.stringify(input) },
				],
			});
			acp('tool_call', {
				toolCallId: tool.id,
				title: tool.command,
				kind: 'execute',
				status: 'in_progress',
				toolName: 'run_terminal_command',
				rawInput: input,
				content: [],
				locations: [],
			});
		},
		finishTool(tool) {
			chat({ type: 'tool_result', tool_call_id: tool.id, content: tool.output });
			// ToolOutput::Bash, tools/src/types/output.rs. ACP reports completed
			// even for a nonzero exit, so the native exit_code must survive parsing.
			const output = [...Buffer.from(tool.output)];
			const rawOutput = {
				type: 'Bash',
				output,
				output_for_prompt: tool.output,
				exit_code: tool.status === 'failed' ? 1 : 0,
				command: tool.command,
				truncated: false,
				signal: null,
				timed_out: false,
				description: null,
				current_dir: cwd,
				output_file: '',
				total_bytes: output.length,
			};
			acp('tool_call_update', {
				toolCallId: tool.id,
				status: 'completed',
				content: textContent(tool.output),
				rawOutput,
				locations: null,
			});
		},
		finish(answer) {
			chat({ type: 'assistant', content: answer, model_id: model, reasoning_effort: 'high' });
			emit({ type: 'text', data: answer });
			finishTurn('end_turn');
		},
		stop() {
			finishTurn('cancelled');
		},
	};
}
module.exports = { createGrokTurn };
