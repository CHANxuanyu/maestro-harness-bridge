'use strict';

// Official @github/copilot@1.0.63, gitHead c440c72e8caca344fe4a4223cceb59dcd241cb48:
// index.js event schemas/session emission; app.js WM/n0e workspace metadata,
// Adr JSON stdout filtering, _dr terminal result, Session.abort+shutdown.
// Actual assistant.usage/effort is ephemeral and is not written to events.jsonl.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const model = 'copilot-native-model';

function createCopilotTurn({ configDir, cwd, id, prompt, emit = () => {} }) {
	const resumed = Boolean(id);
	id ||= randomUUID();
	const dir = path.join(configDir, 'session-state', id);
	const file = path.join(dir, 'events.jsonl');
	if (resumed && !fs.existsSync(file)) throw new Error('Session not found');
	fs.mkdirSync(dir, { recursive: true });
	const started = new Date().toISOString();
	let parentId = resumed
		? fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse).at(-1).id
		: null;
	const record = (type, data) => {
		const row = { type, data, id: randomUUID(), timestamp: new Date().toISOString(), parentId };
		fs.appendFileSync(file, JSON.stringify(row) + '\n');
		parentId = row.id;
		if (type !== 'session.shutdown') emit(row);
		return row;
	};
	if (!resumed) {
		fs.writeFileSync(
			path.join(dir, 'workspace.yaml'),
			`id: ${id}\ncwd: ${JSON.stringify(cwd)}\ncreated_at: ${started}\nupdated_at: ${started}\n`
		);
		record('session.start', {
			sessionId: id,
			version: 1,
			producer: 'copilot-agent',
			copilotVersion: '1.0.63',
			startTime: started,
			selectedModel: model,
			context: { cwd },
		});
	} else
		record('session.resume', {
			resumeTime: started,
			eventCount: fs.readFileSync(file, 'utf8').trim().split('\n').length,
			selectedModel: model,
		});
	record('user.message', { content: prompt });
	const result = (exitCode) => {
		record('session.shutdown', {
			shutdownType: 'routine',
			totalApiDurationMs: 1,
			sessionStartTime: Date.parse(started),
			codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: [] },
			modelMetrics: {},
			currentModel: model,
		});
		emit({
			type: 'result',
			timestamp: new Date().toISOString(),
			sessionId: id,
			exitCode,
			usage: {
				premiumRequests: 0,
				totalApiDurationMs: 1,
				sessionDurationMs: Date.now() - Date.parse(started),
				codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: 0 },
			},
		});
	};

	return {
		id,
		file,
		startTool(tool) {
			record('assistant.message', {
				messageId: randomUUID(),
				model,
				content: '',
				toolRequests: [{ toolCallId: tool.id, name: 'bash', arguments: { command: tool.command } }],
			});
			record('tool.execution_start', {
				toolCallId: tool.id,
				toolName: 'bash',
				arguments: { command: tool.command },
				model,
			});
		},
		finishTool(tool) {
			record('tool.execution_complete', {
				toolCallId: tool.id,
				success: tool.status !== 'failed',
				model,
				...(tool.status === 'failed'
					? { error: { message: tool.output, code: 'failure' } }
					: { result: { content: tool.output } }),
			});
		},
		finish(answer) {
			record('assistant.message', { messageId: randomUUID(), model, content: answer });
			result(0);
		},
		stop() {
			record('abort', { reason: 'user_initiated' });
			result(130);
		},
	};
}
module.exports = { createCopilotTurn };
