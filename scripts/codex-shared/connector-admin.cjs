#!/usr/bin/env node
'use strict';
// Explicit, idle-only rollback of the connector-owned service; never delete writer locks.
const { execFileSync } = require('node:child_process');
const { RpcClient } = require('./rpc.cjs');
const { readDescriptor, NATIVE } = require('./runtime.cjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function inspectThread(client, threadId) {
	const state = await client.request('thread/read', { threadId, includeTurns: false });
	let queued;
	try {
		queued = (await client.request('thread/queue/list', { threadId })).data.length;
	} catch (error) {
		// Native ephemeral threads cannot queue input. Any other inspection failure
		// still aborts rollback; an idle status alone is not sufficient.
		if (
			state.thread.ephemeral === true &&
			error.rpc?.code === -32600 &&
			error.message === 'ephemeral thread does not support queued submissions: ' + threadId
		)
			queued = 0;
		else throw error;
	}
	const terminals = await client.request('thread/backgroundTerminals/list', { threadId, limit: 1 });
	return {
		threadId,
		status: state.thread.status,
		queued,
		backgroundTerminal: terminals.data.length > 0,
	};
}
async function main() {
	if (process.argv[2] !== 'stop-idle') throw new Error('Usage: connector-admin.cjs stop-idle');
	const processes = execFileSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' }).split('\n');
	if (processes.some((line) => line.startsWith('/Applications/ChatGPT.app/Contents/MacOS/ChatGPT')))
		throw new Error('请先正常退出桌面 Codex，再运行回退。此工具不会关闭桌面应用。');
	let descriptor;
	try {
		descriptor = readDescriptor();
	} catch (error) {
		if (error.code === 'ENOENT') {
			console.log('没有已登记的共享服务。');
			return;
		}
		throw error;
	}
	let command;
	try {
		command = execFileSync('/bin/ps', ['-p', String(descriptor.pid), '-o', 'command='], {
			encoding: 'utf8',
		}).trim();
	} catch (error) {
		if (error.status === 1) {
			console.log('登记的共享服务已退出。');
			return;
		}
		throw error;
	}
	if (
		!command.startsWith(NATIVE + ' ') ||
		!command.includes('--listen unix://' + descriptor.socket)
	)
		throw new Error('共享服务进程身份不匹配；未发送终止信号。');
	const client = new RpcClient(descriptor.socket, 'maestro_shared_rollback');
	try {
		await client.initialize();
		let cursor;
		const busy = [];
		do {
			const list = await client.request('thread/loaded/list', { cursor, limit: 100 });
			cursor = list.nextCursor;
			for (const threadId of list.data) {
				const state = await inspectThread(client, threadId);
				if (state.status.type !== 'idle' || state.queued || state.backgroundTerminal)
					busy.push(state);
			}
		} while (cursor);
		if (busy.length)
			throw new Error('仍有进行中的任务、队列或后台终端，未停止共享服务：' + JSON.stringify(busy));
	} finally {
		client.close();
	}
	process.kill(descriptor.pid, 'SIGTERM');
	for (let i = 0; i < 50; i++) {
		await delay(100);
		try {
			process.kill(descriptor.pid, 0);
		} catch (error) {
			if (error.code === 'ESRCH') {
				console.log('共享服务已正常停止；会话和历史均保留。');
				return;
			}
			throw error;
		}
	}
	throw new Error('已请求共享服务正常停止，但尚未确认退出。未强制终止；请保留此信息。');
}
module.exports = { inspectThread };
if (require.main === module)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
