'use strict';
const http = require('node:http');
const https = require('node:https');
const { once } = require('node:events');

// Transparent loopback observation: forward bytes and headers unchanged except
// Host. Persist only the allowlisted request shape and status, never auth,
// prompts, image bytes, response bodies or arbitrary provider diagnostics.
async function createDeepSeekRelay(upstream = 'https://api.deepseek.com/anthropic') {
	const requests = [];
	const pending = new Set();
	const server = http.createServer(async (incoming, outgoing) => {
		const chunks = [];
		let size = 0;
		for await (const chunk of incoming) {
			size += chunk.length;
			if (size > 2 * 1024 * 1024) {
				outgoing.writeHead(413).end();
				return;
			}
			chunks.push(chunk);
		}
		const bytes = Buffer.concat(chunks);
		let body;
		try {
			body = JSON.parse(bytes.toString('utf8'));
		} catch {
			outgoing.writeHead(400).end();
			return;
		}
		const pathname = new URL(incoming.url, 'http://127.0.0.1').pathname;
		const record = {
			path: pathname,
			model: body.model,
			thinking: body.thinking
				? {
						type: body.thinking.type,
						...(typeof body.thinking.budget_tokens === 'number'
							? { budget_tokens: body.thinking.budget_tokens }
							: {}),
					}
				: null,
			effort: body.output_config?.effort ?? body.reasoning_effort ?? null,
			images: (body.messages ?? [])
				.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
				.filter((part) => part.type === 'image').length,
			status: null,
		};
		requests.push(record);
		const target = new URL(upstream.replace(/\/$/, '') + incoming.url);
		const request = (target.protocol === 'https:' ? https : http).request(
			target,
			{
				method: incoming.method,
				headers: { ...incoming.headers, host: target.host },
			},
			(response) => {
				record.status = response.statusCode;
				outgoing.writeHead(response.statusCode, response.headers);
				response.pipe(outgoing);
			}
		);
		pending.add(request);
		request.on('close', () => pending.delete(request));
		request.setTimeout(120_000, () => request.destroy(new Error('Relay upstream timeout')));
		request.on('error', () => {
			record.status = 502;
			if (!outgoing.headersSent) outgoing.writeHead(502);
			outgoing.end();
		});
		outgoing.on('close', () => {
			if (!outgoing.writableFinished) request.destroy();
		});
		request.end(bytes);
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		requests,
		async close() {
			for (const request of pending) request.destroy();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}
module.exports = { createDeepSeekRelay };
