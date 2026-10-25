'use strict';

// OpenCode 1.19.4, anomalyco/opencode@148842ef7cb1bc34192b3fff57d0f9721ab9c801:
// packages/core/src/session/{sql,projector}.ts supplies the SQLite projection;
// packages/schema/src/v1/session.ts supplies message/part fields;
// packages/opencode/src/cli/cmd/run.ts:668-788 supplies stdout envelopes;
// packages/opencode/src/session/processor.ts:591-610 supplies interrupted tools.
// JSON stdout emits only terminal tool states. A step is not a whole turn.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function readOpenCodeState(file) {
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		return {
			sessions: db
				.prepare('SELECT id, title, directory FROM session ORDER BY time_created, id')
				.all(),
			messages: db
				.prepare('SELECT id, session_id, data FROM message ORDER BY time_created, id')
				.all()
				.map((row) => ({ ...row, data: JSON.parse(row.data) })),
			parts: db
				.prepare('SELECT id, message_id, session_id, data FROM part ORDER BY time_created, id')
				.all()
				.map((row) => ({ ...row, data: JSON.parse(row.data) })),
		};
	} finally {
		db.close();
	}
}

function createOpenCodeTurn({ configDir, cwd, id, prompt, emit = () => {} }) {
	fs.mkdirSync(configDir, { recursive: true });
	const file = path.join(configDir, 'opencode.db');
	const db = new DatabaseSync(file);
	db.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS session (
			id TEXT PRIMARY KEY, project_id TEXT NOT NULL, directory TEXT NOT NULL,
			title TEXT NOT NULL, slug TEXT NOT NULL, version TEXT NOT NULL,
			time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
			summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER
		);
		CREATE TABLE IF NOT EXISTS message (
			id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
			time_updated INTEGER NOT NULL, data TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS part (
			id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
			time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
		);
	`);
	if (id && !db.prepare('SELECT 1 FROM session WHERE id = ?').get(id)) {
		db.close();
		throw new Error('Session not found');
	}
	const now = Date.now();
	if (!id) {
		id = `ses_${randomUUID().replaceAll('-', '')}`;
		db.prepare('INSERT OR IGNORE INTO project VALUES (?, ?)').run('global', '/');
		db.prepare(
			'INSERT INTO session (id, project_id, directory, title, slug, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
		).run(id, 'global', cwd, prompt, 'native-e2e', '1.19.4', now, now);
	}
	let sequence = 0;
	const nextId = (prefix) =>
		`${prefix}_${now.toString(16)}${(sequence++).toString(16).padStart(4, '0')}${randomUUID().replaceAll('-', '')}`;
	const message = (messageID, data) =>
		db
			.prepare(
				'INSERT INTO message VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, time_updated=excluded.time_updated'
			)
			.run(messageID, id, data.time.created, Date.now(), JSON.stringify(data));
	const part = (messageID, partID, data, event) => {
		db.prepare(
			'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, time_updated=excluded.time_updated'
		).run(partID, messageID, id, Date.now(), Date.now(), JSON.stringify(data));
		if (event)
			emit({
				type: event,
				timestamp: Date.now(),
				sessionID: id,
				part: { id: partID, sessionID: id, messageID, ...data },
			});
	};
	const userID = nextId('msg');
	message(userID, {
		role: 'user',
		time: { created: now },
		agent: 'build',
		model: { providerID: 'openai', modelID: 'gpt-4.1' },
	});
	part(userID, nextId('prt'), { type: 'text', text: prompt });
	let assistantID;
	let assistant;
	const beginStep = () => {
		assistantID = nextId('msg');
		assistant = {
			role: 'assistant',
			time: { created: Date.now() },
			parentID: userID,
			modelID: 'gpt-4.1',
			providerID: 'openai',
			mode: 'build',
			agent: 'build',
			path: { cwd, root: cwd },
			cost: 0,
			tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
		};
		message(assistantID, assistant);
		part(assistantID, nextId('prt'), { type: 'step-start' }, 'step_start');
	};
	const finishStep = (reason) => {
		part(
			assistantID,
			nextId('prt'),
			{ type: 'step-finish', reason, cost: 0, tokens: assistant.tokens },
			'step_finish'
		);
		assistant.finish = reason;
		assistant.time.completed = Date.now();
		message(assistantID, assistant);
	};
	beginStep();
	const calls = new Map();
	return {
		id,
		file,
		startTool(tool) {
			const partID = nextId('prt');
			const data = {
				type: 'tool',
				callID: tool.id,
				tool: 'bash',
				state: {
					status: 'running',
					input: { command: tool.command, description: tool.command },
					time: { start: Date.now() },
				},
			};
			calls.set(tool.id, { partID, data });
			part(assistantID, partID, data);
		},
		finishTool(tool, status = 'completed') {
			const { partID, data } = calls.get(tool.id);
			data.state = {
				...data.state,
				status: status === 'completed' ? 'completed' : 'error',
				...(status === 'completed'
					? { output: tool.output, title: tool.command, metadata: {} }
					: {
							error: status === 'canceled' ? 'Tool execution aborted' : tool.output,
							metadata: status === 'canceled' ? { interrupted: true } : {},
						}),
				time: { ...data.state.time, end: Date.now() },
			};
			part(assistantID, partID, data, 'tool_use');
		},
		finish(answer) {
			if (calls.size) {
				finishStep('tool-calls');
				beginStep();
			}
			part(
				assistantID,
				nextId('prt'),
				{ type: 'text', text: answer, time: { start: Date.now(), end: Date.now() } },
				'text'
			);
			finishStep('stop');
			db.prepare('UPDATE session SET time_updated=? WHERE id=?').run(Date.now(), id);
			db.close();
		},
		stop() {
			assistant.error = {
				name: 'MessageAbortedError',
				data: { message: 'The operation was aborted' },
			};
			assistant.time.completed = Date.now();
			message(assistantID, assistant);
			emit({ type: 'error', timestamp: Date.now(), sessionID: id, error: assistant.error });
			db.close();
		},
	};
}
module.exports = { createOpenCodeTurn, readOpenCodeState };
