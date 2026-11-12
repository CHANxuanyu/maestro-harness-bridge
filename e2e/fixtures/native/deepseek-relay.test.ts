import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { createDeepSeekRelay } from './deepseek-relay.cjs';

it('forwards original bytes once and records image/effort/status without keys or prompt text', async () => {
	// Exercise the real HTTP handler with in-memory Node streams. No listening
	// sockets or credentials are needed, including inside the macOS sandbox.
	let handler: (request: any, response: any) => Promise<void>;
	const server = Object.assign(new EventEmitter(), {
		listen() {
			queueMicrotask(() => server.emit('listening'));
		},
		address: () => ({ port: 12345 }),
		closeAllConnections: vi.fn(),
		close: (callback: () => void) => callback(),
	});
	vi.spyOn(http, 'createServer').mockImplementation(((callback: typeof handler) => {
		handler = callback;
		return server;
	}) as any);
	let received = '';
	const request = vi.spyOn(http, 'request').mockImplementation(((
		_url: unknown,
		_options: unknown,
		callback: (response: any) => void
	) => {
		const writer = new Writable({
			write(chunk, _encoding, done) {
				received += chunk;
				done();
			},
		});
		Object.assign(writer, { setTimeout: vi.fn() });
		writer.on('finish', () => {
			const response = Object.assign(new PassThrough(), { statusCode: 400, headers: {} });
			callback(response);
			response.end('native rejection');
		});
		return writer;
	}) as any);
	const relay = await createDeepSeekRelay('http://127.0.0.1:23456');
	const body = JSON.stringify({
		model: 'test-model',
		thinking: { type: 'enabled', budget_tokens: 1024 },
		output_config: { effort: 'high' },
		messages: [
			{
				content: [
					{ type: 'text', text: 'private prompt' },
					{ type: 'image', source: { data: 'private-image' } },
				],
			},
		],
	});
	const incoming = Object.assign(Readable.from([Buffer.from(body)]), {
		url: '/v1/messages',
		method: 'POST',
		headers: { 'x-api-key': 'private-key' },
	});
	const outgoing = Object.assign(new PassThrough(), { headersSent: false, writeHead: vi.fn() });
	let response = '';
	outgoing.on('data', (chunk) => {
		response += chunk;
	});
	try {
		const finished = once(outgoing, 'finish');
		await handler!(incoming, outgoing);
		await finished;
		expect(response).toBe('native rejection');
		expect(outgoing.writeHead).toHaveBeenCalledWith(400, {});
		expect(received).toBe(body);
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0][1]).toMatchObject({ headers: { 'x-api-key': 'private-key' } });
		expect(relay.requests).toEqual([
			{
				path: '/v1/messages',
				model: 'test-model',
				thinking: { type: 'enabled', budget_tokens: 1024 },
				effort: 'high',
				images: 1,
				status: 400,
			},
		]);
		expect(JSON.stringify(relay.requests)).not.toContain('private');
	} finally {
		await relay.close();
		vi.restoreAllMocks();
	}
});
