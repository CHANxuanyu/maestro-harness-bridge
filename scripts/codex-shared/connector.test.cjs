'use strict';
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
const { parseExecArgs, translateItem } = require('./shared-exec.cjs');
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
	['failed start does not retry or fork', { failStart: true }],
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
		wss.on('connection', (ws) =>
			ws.on('message', (raw) => {
				const m = JSON.parse(raw);
				if (m.id == null) return;
				requests.push(m);
				const reply = (result) => ws.send(JSON.stringify({ id: m.id, result }));
				const notify = (method, params) => ws.send(JSON.stringify({ method, params }));
				if (m.method === 'initialize') reply({ userAgent: 'mock-native' });
				else if (m.method === 'thread/resume') {
					const finish = () =>
						reply({
							thread: { id: threadId, status: { type: options.busy ? 'active' : 'idle' } },
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
					reply({ turn: { id: turnId, status: 'inProgress' } });
					if (!options.stop) {
						notify('item/completed', {
							threadId: 'foreign',
							turnId,
							item: { type: 'agentMessage', text: 'FOREIGN_THREAD' },
						});
						notify('item/completed', {
							threadId,
							turnId: 'foreign',
							item: { type: 'agentMessage', text: 'FOREIGN_TURN' },
						});
						notify('item/completed', {
							threadId,
							turnId,
							item: { type: 'agentMessage', text: 'OWN_RESULT' },
						});
						notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
					}
				} else if (m.method === 'turn/interrupt') {
					assert.equal(m.params.threadId, threadId);
					assert.equal(m.params.turnId, turnId);
					reply({});
					notify('turn/completed', { threadId, turn: { id: turnId, status: 'interrupted' } });
				} else if (m.method === 'thread/unsubscribe') reply({});
				else throw new Error('Unexpected request ' + m.method);
			})
		);
		await new Promise((resolve) => server.listen(socket, resolve));
		try {
			const runner = `const {runSharedExec}=require(${JSON.stringify(path.join(__dirname, 'shared-exec.cjs'))});runSharedExec(process.argv[1],JSON.parse(process.argv[2])).then(r=>{if(r.interrupted)process.exitCode=130;}).catch(e=>{console.error(e.message);process.exitCode=1;});`;
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
				if (options.stop && event.type === 'turn.started') child.kill('SIGINT');
			});
			timer = setTimeout(() => child.kill('SIGKILL'), 8000);
			const [code] = await once(child, 'exit');
			assert.equal(
				code,
				options.busy || options.queued || options.failStart
					? 1
					: options.stop || options.earlyStop
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
			if (options.stop)
				assert.equal(requests.filter((r) => r.method === 'turn/interrupt').length, 1);
			assert.doesNotMatch(JSON.stringify(output), /FOREIGN_THREAD|FOREIGN_TURN/);
			if (!Object.keys(options).length) assert.match(JSON.stringify(output), /OWN_RESULT/);
		} finally {
			clearTimeout(timer);
			if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
			for (const ws of wss.clients) ws.terminate();
			await new Promise((resolve) => wss.close(resolve));
			await new Promise((resolve) => server.close(resolve));
			fs.rmSync(root, { recursive: true });
		}
	});
