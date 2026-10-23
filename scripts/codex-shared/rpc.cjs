'use strict';
const net = require('node:net');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

class RpcClient extends EventEmitter {
	constructor(socket, name, onRequest) {
		super();
		this.name = name;
		this.pending = new Map();
		this.nextId = 0;
		this.ws = new WebSocket('ws://localhost/rpc', {
			createConnection: () => net.createConnection(socket),
		});
		this.opened = new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.ws.terminate();
				reject(new Error('Shared service connection timed out'));
			}, 10000);
			this.ws.once('open', () => {
				clearTimeout(timeout);
				resolve();
			});
			this.ws.once('error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});
		this.ws.on('error', () => {});
		this.ws.on('close', () => {
			for (const p of this.pending.values()) {
				clearTimeout(p.timer);
				p.reject(new Error('Shared service disconnected'));
			}
			this.pending.clear();
			this.emit('disconnected');
		});
		this.ws.on('message', async (raw) => {
			const message = JSON.parse(raw.toString());
			if (message.id != null && message.method) {
				if (onRequest === 'observe') {
					this.emit('serverRequest', message);
					return;
				}
				try {
					if (!onRequest) throw new Error('This client cannot handle ' + message.method);
					const result = await onRequest(message.method, message.params);
					this.ws.send(JSON.stringify({ id: message.id, result }));
				} catch (error) {
					this.ws.send(
						JSON.stringify({ id: message.id, error: { code: -32601, message: error.message } })
					);
				}
			} else if (message.id != null) {
				const p = this.pending.get(message.id);
				if (!p) return;
				this.pending.delete(message.id);
				clearTimeout(p.timer);
				if (message.error) {
					const error = new Error(message.error.message);
					error.rpc = message.error;
					p.reject(error);
				} else p.resolve(message.result);
			} else this.emit('notification', message);
		});
	}
	async initialize() {
		await this.opened;
		const result = await this.request('initialize', {
			clientInfo: { name: this.name, title: 'Maestro shared Codex client', version: '0.1' },
			capabilities: { experimentalApi: true },
		});
		this.ws.send(JSON.stringify({ method: 'initialized' }));
		return result;
	}
	request(method, params, timeout = 20000) {
		return new Promise((resolve, reject) => {
			const id = ++this.nextId;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(method + ' timed out'));
			}, timeout);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.ws.send(JSON.stringify({ id, method, params }));
			} catch (error) {
				this.pending.delete(id);
				clearTimeout(timer);
				reject(error);
			}
		});
	}
	close() {
		this.ws.close();
		const t = setTimeout(() => this.ws.terminate(), 500);
		t.unref();
	}
}
module.exports = { RpcClient };
