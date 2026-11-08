'use strict';

// Synthetic Claude host for the existing permission-prompt-tool MCP contract.
// The configured bridge is real in Electron acceptance; this host never runs a model.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

function permissionServer(args) {
	const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
	const permissionMode = value('--permission-mode');
	if (
		value('--permission-prompt-tool') !== 'mcp__maestro_permissions__approve' ||
		!value('--mcp-config') ||
		args.some((arg) => arg.startsWith('--dangerously-skip-permissions')) ||
		(permissionMode && permissionMode !== 'default')
	)
		throw new Error('Approval fixture requires standard permission relay arguments');
	const config = JSON.parse(fs.readFileSync(value('--mcp-config'), 'utf8'));
	const server = config.mcpServers?.maestro_permissions;
	if (!server?.command || !Array.isArray(server.args))
		throw new Error('Approval fixture requires the configured Maestro MCP server');
	return server;
}

async function requestPermission(server, tool, configDir, signal) {
	if (signal.aborted) throw new Error('Synthetic approval stopped');
	const child = spawn(server.command, server.args, {
		env: { ...process.env, ...server.env },
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	fs.writeFileSync(path.join(configDir, 'fixture-permission-bridge-process'), String(child.pid));
	const lines = readline.createInterface({ input: child.stdout });
	let sequence = 0;
	const pending = new Map();
	const rejectPending = (error) => {
		for (const { reject } of pending.values()) reject(error);
		pending.clear();
	};
	child.stderr.on('data', (chunk) => process.stderr.write(chunk));
	child.stdin.on('error', rejectPending);
	child.once('error', rejectPending);
	lines.on('line', (line) => {
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			rejectPending(new Error('MCP bridge returned invalid JSON'));
			return;
		}
		const request = pending.get(message.id);
		if (!request) return;
		pending.delete(message.id);
		if (message.error) request.reject(new Error(message.error.message));
		else request.resolve(message.result);
	});
	const closed = new Promise((resolve) => {
		child.once('close', (code, exitSignal) => {
			rejectPending(new Error(`MCP bridge closed before replying: ${code ?? exitSignal}`));
			fs.appendFileSync(
				path.join(configDir, 'fixture-permission-bridge-exits.jsonl'),
				`${JSON.stringify({ pid: child.pid, code, signal: exitSignal })}\n`
			);
			resolve();
		});
	});
	const rpc = (method, params) =>
		new Promise((resolve, reject) => {
			const id = ++sequence;
			pending.set(id, { resolve, reject });
			child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
		});
	const abort = () => {
		rejectPending(new Error('Synthetic approval stopped'));
		child.kill('SIGTERM');
	};
	signal.addEventListener('abort', abort, { once: true });
	try {
		await rpc('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'synthetic-claude', version: '1' },
		});
		child.stdin.write(
			`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
		);
		const available = await rpc('tools/list', {});
		if (!available.tools?.some((entry) => entry.name === 'approve'))
			throw new Error('MCP bridge did not advertise approve');
		const result = await rpc('tools/call', {
			name: 'approve',
			arguments: { tool_name: tool.name || 'Bash', input: tool.input || { command: tool.command } },
		});
		const decision = JSON.parse(result.content.find((entry) => entry.type === 'text').text);
		if (!['allow', 'deny'].includes(decision.behavior))
			throw new Error('MCP bridge returned an invalid permission decision');
		fs.appendFileSync(
			path.join(configDir, 'fixture-permission-events.jsonl'),
			`${JSON.stringify({ toolId: tool.id, decision })}\n`
		);
		return decision;
	} finally {
		signal.removeEventListener('abort', abort);
		child.stdin.end();
		// Bound fixture teardown if a broken bridge ignores stdin EOF.
		const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
		try {
			await closed;
		} finally {
			clearTimeout(timer);
			lines.close();
		}
	}
}

module.exports = { permissionServer, requestPermission };
