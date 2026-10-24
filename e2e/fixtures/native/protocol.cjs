'use strict';

// Wire shapes come from src/main/parsers/{claude,codex}-output-parser.ts,
// src/main/storage/{claude,codex}-session-storage.ts and their tests.
// Claude's interrupt text was verified with the official 2.1.310 package.
// Codex exec events and rollout turn_context use the pinned protocol:
// https://github.com/openai/codex/tree/rust-v0.163.0-alpha.11.1/codex-rs
// Scenario controls are fixture inputs only, never fields in native events.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const interrupted =
	"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const models = { claude: 'claude-sonnet-4-6', codex: 'gpt-5.3-codex' };

function transcriptPath(provider, configDir, cwd, id) {
	return provider === 'claude'
		? path.join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`)
		: path.join(
				configDir,
				'sessions',
				'2026',
				'10',
				'24',
				`rollout-2026-10-24T00-00-00-${id}.jsonl`
			);
}

function createTurn({
	provider,
	configDir,
	cwd,
	id = randomUUID(),
	prompt,
	persist = true,
	emit = () => {},
}) {
	const file = transcriptPath(provider, configDir, cwd, id);
	const timestamp = () => new Date().toISOString();
	const append = (record) => {
		if (!persist) return;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
	};
	const claudeMessage = (role, content) => {
		const record = {
			type: role,
			uuid: randomUUID(),
			sessionId: id,
			cwd,
			timestamp: timestamp(),
			message: { role, content, ...(role === 'assistant' ? { model: models.claude } : {}) },
		};
		append(record);
		emit({ type: role, session_id: id, message: record.message });
	};
	const rollout = (type, payload) => append({ timestamp: timestamp(), type, payload });
	if (provider === 'claude') {
		emit({ type: 'system', subtype: 'init', session_id: id, slash_commands: [] });
		claudeMessage('user', prompt);
	} else {
		if (!fs.existsSync(file))
			rollout('session_meta', {
				id,
				cwd,
				timestamp: timestamp(),
				cli_version: '0.163.0-alpha.11.1',
				source: 'cli',
			});
		rollout('turn_context', { cwd, model: models.codex, effort: 'high' });
		rollout('response_item', {
			type: 'message',
			role: 'user',
			content: [{ type: 'input_text', text: prompt }],
		});
		emit({ type: 'thread.started', thread_id: id });
		emit({ type: 'turn.started' });
	}
	return {
		id,
		file,
		startTool(tool) {
			if (provider === 'claude')
				claudeMessage('assistant', [
					{ type: 'tool_use', id: tool.id, name: 'Bash', input: { command: tool.command } },
				]);
			else {
				rollout('response_item', {
					type: 'function_call',
					call_id: tool.id,
					name: 'exec_command',
					arguments: JSON.stringify({ cmd: tool.command }),
				});
				emit({
					type: 'item.started',
					item: {
						id: tool.id,
						type: 'command_execution',
						command: tool.command,
						aggregated_output: '',
						status: 'in_progress',
					},
				});
			}
		},
		updateTool(tool, output) {
			if (provider === 'codex')
				emit({
					type: 'item.updated',
					item: {
						id: tool.id,
						type: 'command_execution',
						command: tool.command,
						aggregated_output: output,
						status: 'in_progress',
					},
				});
		},
		finishTool(tool, status = 'completed') {
			const output =
				status === 'canceled'
					? provider === 'claude'
						? interrupted
						: 'aborted by user'
					: tool.output;
			if (provider === 'claude')
				claudeMessage('user', [
					{
						type: 'tool_result',
						tool_use_id: tool.id,
						content: output,
						is_error: status !== 'completed',
					},
				]);
			else {
				// ExecCommandToolOutput::response_header in the pinned core/src/tools/context.rs.
				rollout('response_item', {
					type: 'function_call_output',
					call_id: tool.id,
					output:
						status === 'canceled'
							? output
							: `Wall time: 0.0100 seconds\nProcess exited with code ${status === 'failed' ? 1 : 0}\nOutput:\n${output}`,
				});
				// The pinned exec/src/exec_events.rs has no canceled command status.
				// SIGINT ends this stream; Maestro settles its still-running call.
				if (status === 'canceled') return;
				emit({
					type: 'item.completed',
					item: {
						id: tool.id,
						type: 'command_execution',
						command: tool.command,
						aggregated_output: output,
						status,
						exit_code: status === 'failed' ? 1 : 0,
					},
				});
			}
		},
		finish(text) {
			if (provider === 'claude') {
				claudeMessage('assistant', [{ type: 'text', text }]);
				emit({
					type: 'result',
					subtype: 'success',
					session_id: id,
					result: text,
					usage: { input_tokens: 10, output_tokens: 5 },
					total_cost_usd: 0.0001,
				});
			} else {
				rollout('response_item', {
					type: 'message',
					role: 'assistant',
					phase: 'final_answer',
					content: [{ type: 'output_text', text }],
				});
				emit({ type: 'item.completed', item: { id: randomUUID(), type: 'agent_message', text } });
				emit({
					type: 'turn.completed',
					usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
				});
			}
		},
	};
}

module.exports = { createTurn, transcriptPath, models, interrupted };
