'use strict';
require('./protocol.test.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const readline = require('node:readline');
const { WebSocketServer } = require('ws');
const { parseExecArgs, translateItem, runSharedExec } = require('./shared-exec.cjs');
const { inspectThread } = require('./connector-admin.cjs');
const { canonicalStart } = require('./process-start-identity.cjs');
const { readDescriptor } = require('./runtime.cjs');
const threadId = '11111111-2222-4333-8444-555555555555';
const turnId = 'synthetic-owned-turn';

test('rejects new conversations, forks, unsupported flags and invalid sandbox combinations', () => {
	for (const args of [
		['exec', '--json', 'new prompt'],
		['exec', '--json', 'fork', threadId],
		['exec', '--json', 'resume', threadId, '--remote', 'remote-host'],
		['exec', '--json', 'resume', threadId, '--add-dir', '/tmp'],
		['exec', '--json', '-c', 'unsupported=true', 'resume', threadId],
	])
		assert.throws(() => parseExecArgs(args));
	const parsed = parseExecArgs([
		'exec',
		'--json',
		'--sandbox',
		'workspace-write',
		'--add-dir',
		'/tmp',
		'-c',
		'model_reasoning_effort="high"',
		'resume',
		threadId,
		'--',
		'synthetic prompt',
	]);
	assert.equal(parsed.threadId, threadId);
	assert.equal(parsed.settings.effort, 'high');
	assert.deepEqual(parsed.settings.sandboxPolicy.writableRoots, ['/tmp']);
});

test('preserves tool identity, input, output and public progress', () => {
	const item = {
		type: 'commandExecution',
		id: 'tool-1',
		command: 'printf MOCK_OK',
		aggregatedOutput: 'MOCK_OK',
		exitCode: 0,
		status: 'completed',
	};
	const event = translateItem(item, true)[0];
	assert.equal(event.item.id, item.id);
	assert.equal(event.item.command, item.command);
	assert.equal(event.item.aggregated_output, 'MOCK_OK');
	assert.equal(
		translateItem({ type: 'agentMessage', text: 'Progress', phase: 'commentary' }, true)[0].payload
			.phase,
		'commentary'
	);
});

test(
	'streams bounded cumulative command output before completion and cleans up at turn end',
	{ timeout: 5000 },
	async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-command-delta-'));
		const socket = path.join(root, 'rpc.sock');
		const server = http.createServer();
		const wss = new WebSocketServer({ server });
		const output = [];
		const times = [];
		let notify, deadline;
		const first = Array.from({ length: 100 }, (_, i) => `${i}:中文\n`).join('');
		const second = 'next\n'.repeat(100);
		const command = {
			type: 'commandExecution',
			id: 'stream-command',
			command: 'synthetic command',
			status: 'inProgress',
		};
		const parallel = { ...command, id: 'parallel-command', command: 'parallel command' };
		const delta = (itemId, text, extra = {}) =>
			notify('item/commandExecution/outputDelta', {
				threadId,
				turnId,
				itemId,
				delta: text,
				...extra,
			});
		wss.on('connection', (ws) =>
			ws.on('message', (raw) => {
				const message = JSON.parse(raw);
				if (message.id == null) return;
				const reply = (result) => ws.send(JSON.stringify({ id: message.id, result }));
				notify = (method, params) => ws.send(JSON.stringify({ method, params }));
				if (message.method === 'initialize') reply({ userAgent: 'synthetic' });
				else if (message.method === 'thread/resume')
					reply({ thread: { id: threadId, status: { type: 'idle' } }, model: 'synthetic' });
				else if (message.method === 'thread/queue/list') reply({ data: [] });
				else if (message.method === 'thread/unsubscribe') reply({});
				else if (message.method === 'turn/start') {
					reply({ turn: { id: turnId, status: 'inProgress' } });
					for (const item of [command, parallel])
						notify('item/started', { threadId, turnId, item });
					for (let i = 0; i < 100; i++) delta(command.id, `${i}:中文\n`);
					delta(parallel.id, 'parallel output');
					delta(command.id, 'FOREIGN_THREAD', { threadId: 'foreign' });
					delta(command.id, 'FOREIGN_TURN', { turnId: 'foreign' });
					delta('unknown-item', 'UNKNOWN_ITEM');
					// Without streaming the test still terminates and reports the missing updates.
					deadline = setTimeout(
						() => notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } }),
						1500
					);
				} else throw new Error('Unexpected request ' + message.method);
			})
		);
		await new Promise((resolve) => server.listen(socket, resolve));
		try {
			await runSharedExec(
				socket,
				['exec', '--json', 'resume', threadId, '--', 'synthetic prompt'],
				{
					output(event) {
						output.push(event);
						if (event.type !== 'item.updated' || event.item.id !== command.id) return;
						times.push(performance.now());
						if (times.length === 1) {
							for (let i = 0; i < 100; i++) delta(command.id, 'next\n');
						} else if (times.length === 2) {
							clearTimeout(deadline);
							delta(command.id, 'tail');
							notify('item/completed', {
								threadId,
								turnId,
								item: {
									...command,
									status: 'failed',
									exitCode: 1,
									aggregatedOutput: first + second + 'tail\nfinal',
								},
							});
							delta(command.id, 'LATE_ITEM');
							notify('item/completed', {
								threadId,
								turnId,
								item: {
									...parallel,
									status: 'completed',
									exitCode: 0,
									aggregatedOutput: 'parallel output',
								},
							});
							notify('item/started', { threadId, turnId, item: { ...command, id: 'unfinished' } });
							delta('unfinished', 'last pending output');
							notify('turn/completed', { threadId, turn: { id: turnId, status: 'interrupted' } });
							delta('unfinished', 'LATE_TURN');
						}
					},
				}
			);
			const updates = output.filter((event) => event.type === 'item.updated');
			const commandUpdates = updates.filter((event) => event.item.id === command.id);
			assert.deepEqual(
				commandUpdates.map((event) => event.item.aggregated_output),
				[first, first + second, first + second + 'tail']
			);
			assert.ok(
				times[1] - times[0] >= 180,
				'successive running updates are coalesced for about 200ms'
			);
			assert.equal(
				updates.length,
				5,
				'200 deltas produce three updates plus the two parallel calls'
			);
			for (const event of updates) {
				assert.equal(event.item.type, 'command_execution');
				assert.equal(event.item.status, 'in_progress');
				assert.equal(
					event.item.command,
					event.item.id === parallel.id ? parallel.command : command.command
				);
			}
			const completed = output.find(
				(event) => event.type === 'item.completed' && event.item.id === command.id
			);
			assert.equal(completed.item.aggregated_output, first + second + 'tail\nfinal');
			assert.equal(completed.item.status, 'failed');
			assert.equal(completed.item.exit_code, 1);
			assert.ok(output.indexOf(commandUpdates.at(-1)) < output.indexOf(completed));
			assert.equal(output.at(-2).item.aggregated_output, 'last pending output');
			assert.equal(output.at(-1).type, 'turn.completed');
			assert.doesNotMatch(JSON.stringify(output), /FOREIGN_|UNKNOWN_ITEM|LATE_/);
			assert.equal(
				output.filter((event) => event.type === 'item.started' && event.item.id === command.id)
					.length,
				1
			);
			const count = output.length;
			await new Promise((resolve) => setTimeout(resolve, 250));
			assert.equal(output.length, count, 'no timer emits after the turn has ended');
		} finally {
			clearTimeout(deadline);
			for (const ws of wss.clients) ws.terminate();
			await new Promise((resolve) => wss.close(resolve));
			await new Promise((resolve) => server.close(resolve));
			fs.rmSync(root, { recursive: true });
		}
	}
);

test('preserves structured cancellation and tool failures in the exec transport', () => {
	for (const status of ['interrupted', 'canceled', 'cancelled', 'failed']) {
		const event = translateItem(
			{ type: 'fileChange', id: 'patch-status', status, changes: [] },
			true
		)[0];
		assert.equal(event.payload.call_id, 'patch-status');
		assert.equal(event.payload.status, status);
	}
	for (const item of [
		{ type: 'dynamicToolCall', success: false, contentItems: [] },
		{ type: 'mcpToolCall', result: { isError: true, content: [] } },
		{ type: 'mcpToolCall', error: { message: 'Synthetic tool failure' } },
	]) {
		assert.equal(
			translateItem({ id: 'failed-tool', status: 'completed', ...item }, true)[0].payload.is_error,
			true
		);
	}
	assert.equal(
		translateItem(
			{ type: 'dynamicToolCall', id: 'ok', status: 'completed', success: true, contentItems: [] },
			true
		)[0].payload.is_error,
		false
	);
});

test('process creation identity is locale independent and fails closed', () => {
	assert.equal(
		canonicalStart('五 10月/23 00:57:03 2026'),
		canonicalStart('Fri Oct 23 00:57:03 2026')
	);
	assert.notEqual(
		canonicalStart('Fri Oct 23 00:57:04 2026'),
		canonicalStart('Fri Oct 23 00:57:03 2026')
	);
	for (const bad of ['', 'garbage', '2026-10-23', '五 99月/23 00:57:03 2026'])
		assert.throws(() => canonicalStart(bad));
});

test('rollback accepts only the exact ephemeral queue error and preserves busy state', async () => {
	const error = Object.assign(
		new Error('ephemeral thread does not support queued submissions: synthetic'),
		{ rpc: { code: -32600 } }
	);
	const mock = (ephemeral, queueError, active = false) => ({
		request: async (method) => {
			if (method === 'thread/read')
				return { thread: { ephemeral, status: { type: active ? 'active' : 'idle' } } };
			if (method === 'thread/queue/list') {
				if (queueError) throw queueError;
				return { data: [] };
			}
			if (method === 'thread/backgroundTerminals/list') return { data: active ? [{}] : [] };
			throw new Error(method);
		},
	});
	assert.equal((await inspectThread(mock(true, error), 'synthetic')).queued, 0);
	await assert.rejects(inspectThread(mock(false, error), 'synthetic'));
	await assert.rejects(inspectThread(mock(true, new Error('transport error')), 'synthetic'));
	const busy = await inspectThread(mock(false, null, true), 'synthetic');
	assert.equal(busy.status.type, 'active');
	assert.equal(busy.backgroundTerminal, true);
});

test('descriptor rejects public permissions and a socket outside its private root', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-descriptor-'));
	try {
		fs.chmodSync(root, 0o700);
		const file = path.join(root, 'runtime.json');
		fs.writeFileSync(
			file,
			JSON.stringify({ socket: path.join(root, 'test.sock'), pid: process.pid }),
			{ mode: 0o600 }
		);
		assert.equal(readDescriptor(root).pid, process.pid);
		fs.chmodSync(file, 0o644);
		assert.throws(() => readDescriptor(root));
		fs.chmodSync(file, 0o600);
		fs.writeFileSync(file, JSON.stringify({ socket: '/outside/test.sock', pid: process.pid }));
		assert.throws(() => readDescriptor(root));
	} finally {
		fs.rmSync(root, { recursive: true });
	}
});

for (const [label, options] of [
	['active turn sends nothing', { busy: true }],
	['existing queue is preserved', { queued: true }],
	['stop before send starts no turn', { earlyStop: true }],
	['stop targets the acknowledged turn only', { stop: true }],
	[
		'same native session continues after Stop and successive client restarts',
		{ stop: true, resumeSequence: true },
	],
	['failed start does not retry or fork', { failStart: true }],
	['early output and approvals retain order and exclude other turns', { earlyEvents: true }],
	['completed turns ignore late output and confirmation requests', { lateEvents: true }],
	[
		'failed turns ignore late output and confirmation requests',
		{ lateEvents: true, failedTurn: true },
	],
	['foreign notifications do not leak into the current turn', {}],
])
	test(label, { timeout: 10000 }, async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-rpc-'));
		const socket = path.join(root, 'rpc.sock');
		const server = http.createServer();
		const wss = new WebSocketServer({ server });
		const requests = [],
			output = [];
		let child, timer;
		let attempt = 0;
		let nativeStatus = options.busy ? 'active' : 'idle';
		const shouldStop = () => options.stop && (!options.resumeSequence || attempt === 0);
		wss.on('connection', (ws) =>
			ws.on('message', (raw) => {
				const m = JSON.parse(raw);
				if (m.id == null) return;
				requests.push(m);
				const currentTurnId = options.resumeSequence ? `${turnId}-${attempt}` : turnId;
				const reply = (result) => ws.send(JSON.stringify({ id: m.id, result }));
				const notify = (method, params) => ws.send(JSON.stringify({ method, params }));
				if (m.method === 'initialize') reply({ userAgent: 'mock-native' });
				else if (m.method === 'thread/resume') {
					const finish = () =>
						reply({
							thread: { id: threadId, status: { type: nativeStatus } },
							model: 'test-model',
						});
					if (options.earlyStop) {
						child.kill('SIGINT');
						setTimeout(finish, 100);
					} else finish();
				} else if (m.method === 'thread/queue/list')
					reply({ data: options.queued ? [{ id: 'queued' }] : [] });
				else if (m.method === 'turn/start') {
					if (options.failStart) {
						ws.send(
							JSON.stringify({ id: m.id, error: { code: -32600, message: 'Synthetic failure' } })
						);
						return;
					}
					nativeStatus = 'active';
					if (options.earlyEvents) {
						notify('item/completed', {
							threadId,
							turnId: currentTurnId,
							item: { type: 'agentMessage', text: 'EARLY_PROGRESS', phase: 'commentary' },
						});
						for (const [requestId, requestedThread, requestedTurn] of [
							['own-approval', threadId, currentTurnId],
							['foreign-turn-approval', threadId, 'foreign'],
							['foreign-thread-approval', 'foreign', currentTurnId],
						])
							ws.send(
								JSON.stringify({
									id: requestId,
									method: 'item/commandExecution/requestApproval',
									params: { threadId: requestedThread, turnId: requestedTurn },
								})
							);
					}
					reply({ turn: { id: currentTurnId, status: 'inProgress' } });
					if (options.resumeSequence) {
						for (const toolId of ['first-tool', 'second-tool']) {
							const item = { type: 'commandExecution', id: toolId, command: `printf ${toolId}` };
							notify('item/started', { threadId, turnId: currentTurnId, item });
							notify('item/completed', {
								threadId,
								turnId: currentTurnId,
								item: {
									...item,
									status: 'completed',
									exitCode: 0,
									aggregatedOutput: `${attempt}:${toolId}`,
								},
							});
						}
					}
					if (!shouldStop()) {
						notify('item/completed', {
							threadId: 'foreign',
							turnId: currentTurnId,
							item: { type: 'agentMessage', text: 'FOREIGN_THREAD' },
						});
						notify('item/completed', {
							threadId,
							turnId: 'foreign',
							item: { type: 'agentMessage', text: 'FOREIGN_TURN' },
						});
						notify('item/completed', {
							threadId,
							turnId: currentTurnId,
							item: { type: 'agentMessage', text: 'OWN_RESULT' },
						});
						nativeStatus = 'idle';
						const completedTurn = {
							id: currentTurnId,
							status: options.failedTurn ? 'failed' : 'completed',
						};
						notify('turn/completed', { threadId, turn: completedTurn });
						if (options.lateEvents) {
							notify('item/completed', {
								threadId,
								turnId,
								item: { type: 'agentMessage', text: 'LATE_RESULT' },
							});
							notify('error', {
								threadId,
								turnId: currentTurnId,
								error: { message: 'LATE_ERROR' },
							});
							notify('turn/completed', { threadId, turn: completedTurn });
							ws.send(
								JSON.stringify({
									id: 'late-confirmation',
									method: 'item/commandExecution/requestApproval',
									params: { threadId, turnId },
								})
							);
						}
					}
				} else if (m.method === 'turn/interrupt') {
					assert.equal(m.params.threadId, threadId);
					assert.equal(m.params.turnId, currentTurnId);
					reply({});
					nativeStatus = 'idle';
					notify('turn/completed', {
						threadId,
						turn: { id: currentTurnId, status: 'interrupted' },
					});
				} else if (m.method === 'thread/unsubscribe') reply({});
				else throw new Error('Unexpected request ' + m.method);
			})
		);
		await new Promise((resolve) => server.listen(socket, resolve));
		try {
			const runner = `const {runSharedExec}=require(${JSON.stringify(path.join(__dirname, 'shared-exec.cjs'))});runSharedExec(process.argv[1],JSON.parse(process.argv[2])).then(r=>{if(r.interrupted)process.exitCode=130;}).catch(e=>{console.error(e.message);process.exitCode=1;});`;
			for (attempt = 0; attempt < (options.resumeSequence ? 3 : 1); attempt++) {
				requests.length = 0;
				output.length = 0;

				child = spawn(
					process.execPath,
					[
						'-e',
						runner,
						socket,
						JSON.stringify([
							'exec',
							'--json',
							'--sandbox',
							'read-only',
							'resume',
							threadId,
							'--',
							'mock prompt',
						]),
					],
					{ stdio: ['ignore', 'pipe', 'pipe'] }
				);
				let stderr = '';
				child.stderr.on('data', (b) => (stderr += b));
				readline.createInterface({ input: child.stdout }).on('line', (line) => {
					const event = JSON.parse(line);
					output.push(event);
					if (shouldStop() && event.type === 'turn.started') child.kill('SIGINT');
				});
				timer = setTimeout(() => child.kill('SIGKILL'), 8000);
				const [code] = await once(child, 'exit');
				clearTimeout(timer);
				assert.equal(
					code,
					options.busy || options.queued || options.failStart || options.failedTurn
						? 1
						: shouldStop() || options.earlyStop
							? 130
							: 0,
					stderr
				);
				const starts = requests.filter((r) => r.method === 'turn/start');
				assert.equal(starts.length, options.busy || options.queued || options.earlyStop ? 0 : 1);
				if (starts.length) assert.equal(starts[0].params.sandboxPolicy.type, 'readOnly');
				assert.equal(
					requests.some((r) =>
						['thread/start', 'thread/fork', 'thread/queue/add', 'thread/settings/update'].includes(
							r.method
						)
					),
					false
				);
				if (shouldStop())
					assert.equal(requests.filter((r) => r.method === 'turn/interrupt').length, 1);
				assert.doesNotMatch(JSON.stringify(output), /FOREIGN_THREAD|FOREIGN_TURN/);
				if (options.lateEvents) {
					assert.doesNotMatch(
						JSON.stringify(output),
						/LATE_RESULT|LATE_ERROR|waiting for a client confirmation/
					);
					assert.equal(
						output.filter(
							(event) => event.type === 'turn.completed' || event.type === 'turn.failed'
						).length,
						1
					);
				}
				if (!Object.keys(options).length) assert.match(JSON.stringify(output), /OWN_RESULT/);
				if (options.earlyEvents) {
					const messages = output
						.filter((event) => event.type === 'event_msg')
						.map((event) => event.payload.message);
					assert.equal(messages[0], 'EARLY_PROGRESS');
					assert.match(messages[1], /waiting for a client confirmation/);
					assert.equal(messages[2], 'OWN_RESULT');
					assert.equal(messages.length, 3);
				}
				if (options.resumeSequence) {
					assert.equal(nativeStatus, 'idle');
					assert.equal(
						requests.find((request) => request.method === 'thread/resume').params.threadId,
						threadId
					);
					assert.equal(starts[0].params.threadId, threadId);
					assert.deepEqual(
						output
							.filter((event) => event.type === 'item.completed')
							.map((event) => event.item.aggregated_output),
						[`${attempt}:first-tool`, `${attempt}:second-tool`]
					);
					assert.equal(output.filter((event) => event.type === 'turn.completed').length, 1);
				}
			}
		} finally {
			clearTimeout(timer);
			if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
			for (const ws of wss.clients) ws.terminate();
			await new Promise((resolve) => wss.close(resolve));
			await new Promise((resolve) => server.close(resolve));
			fs.rmSync(root, { recursive: true });
		}
	});
