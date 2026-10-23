'use strict';
const net = require('node:net');
const readline = require('node:readline');
const WebSocket = require('ws');
// The bundled native `app-server proxy` copies raw socket bytes; it does not
// perform the WebSocket upgrade required by this CLI's --listen unix://.
// This adapter changes only framing. JSON-RPC messages and IDs pass unchanged.
async function proxyStdio(socket) {
	const ws = new WebSocket('ws://localhost/rpc', {
		createConnection: () => net.createConnection(socket),
	});
	await new Promise((resolve, reject) => {
		ws.once('open', resolve);
		ws.once('error', reject);
	});
	const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
	let ended = false;
	const close = () => {
		ended = true;
		input.close();
		process.stdin.pause();
		ws.close();
		const timer = setTimeout(() => ws.terminate(), 500);
		timer.unref();
	};
	process.once('SIGINT', close);
	process.once('SIGTERM', close);
	ws.on('message', (data) => {
		if (!process.stdout.write(data.toString() + '\n')) ws.pause();
	});
	const drain = () => ws.resume();
	process.stdout.on('drain', drain);
	const stopped = new Promise((resolve, reject) => {
		ws.once('error', reject);
		ws.once('close', () => {
			input.close();
			process.stdin.pause();
			resolve();
		});
	});
	const forward = (async () => {
		for await (const line of input) {
			if (ended) break;
			await new Promise((resolve, reject) =>
				ws.send(line, (error) => (error ? reject(error) : resolve()))
			);
		}
		if (!ended) close();
	})();
	try {
		await Promise.race([forward, stopped]);
	} finally {
		close();
		process.off('SIGINT', close);
		process.off('SIGTERM', close);
		process.stdout.off('drain', drain);
	}
}
module.exports = { proxyStdio };
