'use strict';

// Reuses the synthetic JSON-RPC server shapes in
// scripts/codex-shared/connector.test.cjs. Notifications and turn_context are
// pinned to codex-cli 0.163.0-alpha.11.1; no simulated renderer or connector.
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createTurn } = require('./protocol.cjs');

async function startAppServer({ socket, configDir, cwd, id, scenes }) {
	const server = http.createServer();
	const wss = new WebSocketServer({ server });
	const state = { status: 'idle', queue: [], requests: [], turns: [] };
	let sceneIndex = 0;
	const notify = (method, params) => {
		for (const client of wss.clients) client.send(JSON.stringify({ method, params }));
	};
	wss.on('connection', (ws) =>
		ws.on('message', async (raw) => {
			const message = JSON.parse(raw);
			if (message.id == null) return;
			state.requests.push(message);
			const reply = (result) => ws.send(JSON.stringify({ id: message.id, result }));
			if (message.method === 'initialize') reply({ userAgent: 'native-e2e' });
			else if (message.method === 'thread/resume')
				reply({ thread: { id, status: { type: state.status } }, model: 'gpt-5.3-codex' });
			else if (message.method === 'thread/read')
				reply({ thread: { id, status: { type: state.status }, turns: state.turns } });
			else if (message.method === 'thread/queue/list') reply({ data: state.queue });
			else if (message.method === 'thread/unsubscribe') reply({});
			else if (message.method === 'turn/start') {
				const scene = scenes[sceneIndex++];
				if (!scene) throw new Error('Unexpected shared turn');
				state.status = 'active';
				const turnId = randomUUID();
				const turn = { id: turnId, status: 'inProgress', items: [] };
				state.turns.push(turn);
				reply({ turn: { id: turnId, status: 'inProgress' } });
				const native = createTurn({
					provider: 'codex',
					configDir,
					cwd,
					id,
					prompt: message.params.input.map((item) => item.text).join('\n'),
				});
				if (scene.approval)
					ws.send(
						JSON.stringify({
							id: 'fixture-approval',
							method: 'item/commandExecution/requestApproval',
							params: { threadId: id, turnId, itemId: 'approval-command' },
						})
					);
				for (const tool of scene.tools || []) {
					native.startTool(tool);
					const item = {
						type: 'commandExecution',
						id: tool.id,
						command: tool.command,
						status: 'inProgress',
					};
					notify('item/started', { threadId: id, turnId, item });
					let previous = '';
					for (const output of tool.updates || []) {
						notify('item/commandExecution/outputDelta', {
							threadId: id,
							turnId,
							itemId: tool.id,
							delta: output.slice(previous.length),
						});
						previous = output;
						await delay(300);
					}
					native.finishTool(tool, tool.status);
					const complete = {
						...item,
						status: tool.status || 'completed',
						aggregatedOutput: tool.output,
						exitCode: tool.status === 'failed' ? 1 : 0,
					};
					turn.items.push(complete);
					notify('item/completed', { threadId: id, turnId, item: complete });
				}
				native.finish(scene.answer);
				const answer = {
					type: 'agentMessage',
					id: randomUUID(),
					text: scene.answer,
					phase: 'final_answer',
				};
				turn.items.push(answer);
				notify('item/completed', { threadId: id, turnId, item: answer });
				turn.status = 'completed';
				state.status = 'idle';
				notify('turn/completed', { threadId: id, turn });
			} else throw new Error(`Unexpected RPC: ${message.method}`);
		})
	);
	await new Promise((resolve) => server.listen(socket, resolve));
	return {
		state,
		async close() {
			for (const client of wss.clients) client.terminate();
			await new Promise((resolve) => wss.close(resolve));
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

module.exports = { startAppServer };
