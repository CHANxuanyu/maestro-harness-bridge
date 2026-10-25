'use strict';

// Reuses the synthetic JSON-RPC server shapes in
// scripts/codex-shared/connector.test.cjs. Notifications and turn_context are
// pinned to codex-cli 0.163.0-alpha.11.1; no simulated renderer or connector.
const http = require('node:http');
const fs = require('node:fs');
const { WebSocketServer } = require('ws');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createTurn } = require('./protocol.cjs');

async function startAppServer({
	socket,
	configDir,
	cwd,
	id,
	scenes,
	acceptBlocker = false,
	userInput = false,
}) {
	const server = http.createServer();
	const wss = new WebSocketServer({ server });
	const state = { status: 'idle', queue: [], requests: [], turns: [] };
	let sceneIndex = 0;
	let interruptTurn;
	const notify = (method, params) => {
		for (const client of wss.clients) client.send(JSON.stringify({ method, params }));
	};
	wss.on('connection', (ws) =>
		ws.on('message', async (raw) => {
			const message = JSON.parse(raw);
			if (message.id == null || !message.method) return;
			state.requests.push(message);
			const reply = (result) => ws.send(JSON.stringify({ id: message.id, result }));
			if (message.method === 'initialize') reply({ userAgent: 'native-e2e' });
			else if (message.method === 'thread/resume')
				reply({ thread: { id, status: { type: state.status } }, model: 'gpt-5.3-codex' });
			else if (message.method === 'thread/read')
				reply({ thread: { id, status: { type: state.status }, turns: state.turns } });
			else if (message.method === 'thread/queue/list') reply({ data: state.queue });
			// Pinned official thread_queue.rs tests and v2 queue response schemas.
			else if (message.method === 'thread/queue/add') {
				const queuedSubmission = {
					id: randomUUID(),
					input: message.params.input,
					clientUserMessageId: message.params.clientUserMessageId,
				};
				state.queue.push(queuedSubmission);
				reply({ queuedSubmission });
			} else if (message.method === 'thread/queue/delete') {
				const index = state.queue.findIndex(
					(entry) => entry.id === message.params.queuedSubmissionId
				);
				if (index >= 0) state.queue.splice(index, 1);
				reply({ deleted: index >= 0 });
			} else if (message.method === 'turn/interrupt') {
				interruptTurn?.();
				reply({});
			} else if (message.method === 'thread/unsubscribe') reply({});
			else if (message.method === 'turn/start') {
				const prompt = message.params.input.map((item) => item.text).join('\n');
				const scene =
					acceptBlocker && prompt.startsWith('Hold this acceptance turn')
						? {
								answer: '',
								waitForStop: true,
								tools: [{ id: 'shared-busy', command: 'sleep 120', output: '' }],
							}
						: scenes[sceneIndex++];
				let interrupted = false;
				interruptTurn = () => {
					interrupted = true;
				};
				if (!scene) throw new Error('Unexpected shared turn');
				state.status = 'active';
				const turnId = randomUUID();
				const turn = { id: turnId, status: 'inProgress', items: [] };
				state.turns.push(turn);
				reply({ turn: { id: turnId, status: 'inProgress' } });
				notify('turn/started', { threadId: id, turn });
				const native = createTurn({
					provider: 'codex',
					configDir,
					cwd,
					id,
					prompt,
				});
				if (scene.approval) {
					// Pinned official ToolRequestUserInputParams/Question and
					// app-server/tests/suite/v2/request_user_input.rs fixtures.
					const params = { threadId: id, turnId, itemId: 'approval-command' };
					if (userInput)
						Object.assign(params, {
							isBlocking: false,
							autoResolutionMs: null,
							questions: [
								{
									id: 'confirm_path',
									header: 'Confirm',
									question: 'Proceed with the plan?',
									isOther: false,
									isSecret: false,
									options: [
										{ label: 'Yes (Recommended)', description: 'Continue the current plan.' },
										{ label: 'No', description: 'Stop and revisit the approach.' },
									],
								},
							],
						});
					for (const client of wss.clients)
						client.send(
							JSON.stringify({
								id: 'fixture-approval',
								method: userInput
									? 'item/tool/requestUserInput'
									: 'item/commandExecution/requestApproval',
								params,
							})
						);
				}
				for (const tool of scene.tools || []) {
					native.startTool(tool);
					const item = {
						type: 'commandExecution',
						id: tool.id,
						command: tool.command,
						status: 'inProgress',
					};
					notify('item/started', { threadId: id, turnId, item });
					if (scene.waitForStop) while (!interrupted) await delay(10);
					if (interrupted) {
						native.finishTool(tool, 'canceled');
						break;
					}
					let previous = '';
					for (const [index, output] of (tool.updates || []).entries()) {
						notify('item/commandExecution/outputDelta', {
							threadId: id,
							turnId,
							itemId: tool.id,
							delta: output.slice(previous.length),
						});
						previous = output;
						await delay(300);
						if (tool.gates?.[index])
							while (!fs.existsSync(tool.gates[index]) && !interrupted) await delay(10);
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
				if (interrupted) {
					turn.status = 'interrupted';
					state.status = 'idle';
					notify('turn/completed', { threadId: id, turn });
					return;
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
			interruptTurn?.();
			for (const client of wss.clients) client.terminate();
			await new Promise((resolve) => wss.close(resolve));
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

module.exports = { startAppServer };
