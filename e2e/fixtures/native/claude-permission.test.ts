import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createNativeTempDir } from './temp-root.cjs';

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
	for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL');
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function startFixture(options: { relay?: boolean; bypass?: boolean } = {}) {
	const root = createNativeTempDir('claude-approval-');
	roots.push(root);
	const configDir = path.join(root, 'account');
	const project = path.join(root, 'project');
	fs.mkdirSync(configDir);
	fs.mkdirSync(project);
	const script = path.join(root, 'scenario.json');
	fs.writeFileSync(
		script,
		JSON.stringify({
			scene: {
				approval: true,
				answer: 'APPROVAL_ALLOWED',
				toolDelay: 0,
				writes: { 'approved.txt': 'only after approval\n' },
				tools: [
					{
						id: 'write-approved',
						name: 'Write',
						input: {
							file_path: path.join(project, 'approved.txt'),
							content: 'only after approval\n',
						},
						output: 'approved.txt written',
					},
				],
			},
		})
	);
	const requested = path.join(root, 'requested.json');
	const decision = path.join(root, 'decision.json');
	const mockBridge = path.join(root, 'bridge.cjs');
	fs.writeFileSync(
		mockBridge,
		`const fs = require('node:fs');
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin });
let timer;
lines.on('line', (line) => {
	const msg = JSON.parse(line);
	const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
	if (msg.method === 'initialize') reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } });
	if (msg.method === 'tools/list') reply({ tools: [{ name: 'approve', inputSchema: { type: 'object' } }] });
	if (msg.method === 'tools/call') {
		fs.writeFileSync(process.env.FIXTURE_REQUEST, JSON.stringify(msg.params));
		timer = setInterval(() => {
			if (!fs.existsSync(process.env.FIXTURE_DECISION)) return;
			clearInterval(timer);
			reply({ content: [{ type: 'text', text: fs.readFileSync(process.env.FIXTURE_DECISION, 'utf8') }] });
		}, 10);
	}
});
lines.on('close', () => { clearInterval(timer); process.exit(0); });
`
	);
	const mcpConfig = path.join(root, 'mcp.json');
	fs.writeFileSync(
		mcpConfig,
		JSON.stringify({
			mcpServers: {
				maestro_permissions: {
					command: process.execPath,
					args: [mockBridge],
					env: { FIXTURE_REQUEST: requested, FIXTURE_DECISION: decision },
				},
			},
		})
	);
	const child = spawn(
		process.execPath,
		[
			path.resolve('e2e/fixtures/native/claude'),
			'--print',
			'--output-format',
			'stream-json',
			...(options.bypass ? ['--dangerously-skip-permissions'] : []),
			...(options.relay === false
				? []
				: [
						'--permission-prompt-tool',
						'mcp__maestro_permissions__approve',
						'--mcp-config',
						mcpConfig,
					]),
			'--',
			'Write the synthetic approval marker',
		],
		{
			cwd: project,
			env: {
				PATH: process.env.PATH,
				HOME: root,
				USERPROFILE: root,
				CLAUDE_CONFIG_DIR: configDir,
				MAESTRO_NATIVE_SCRIPT: script,
			},
		}
	);
	children.push(child);
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (chunk) => (stdout += chunk));
	child.stderr.on('data', (chunk) => (stderr += chunk));
	const exited = new Promise<number | null>((resolve, reject) => {
		child.once('close', resolve);
		child.once('error', reject);
	});
	return {
		child,
		exited,
		root,
		configDir,
		requested,
		decision,
		marker: path.join(project, 'approved.txt'),
		stdout: () => stdout,
		stderr: () => stderr,
	};
}

describe('synthetic Claude standard permission contract', () => {
	it.each([{ relay: false }, { bypass: true }])(
		'refuses an approval scene that cannot prove standard relay arguments: %j',
		async (options) => {
			const fixture = startFixture(options);
			expect(await fixture.exited).toBe(1);
			expect(fixture.stderr()).toContain(
				'Approval fixture requires standard permission relay arguments'
			);
			expect(fs.existsSync(fixture.marker)).toBe(false);
		}
	);

	it('waits for the MCP decision before writing once and emits the unchanged tool input', async () => {
		const fixture = startFixture();
		await expect.poll(() => fs.existsSync(fixture.requested)).toBe(true);
		expect(fs.existsSync(fixture.marker)).toBe(false);
		expect(fixture.child.exitCode).toBe(null);
		expect(JSON.parse(fs.readFileSync(fixture.requested, 'utf8'))).toEqual({
			name: 'approve',
			arguments: {
				tool_name: 'Write',
				input: { file_path: fixture.marker, content: 'only after approval\n' },
			},
		});
		fs.writeFileSync(fixture.decision, JSON.stringify({ behavior: 'allow' }));
		expect(await fixture.exited).toBe(0);
		expect(fs.readFileSync(fixture.marker, 'utf8')).toBe('only after approval\n');
		expect(
			fs
				.readFileSync(path.join(fixture.configDir, 'fixture-permission-events.jsonl'), 'utf8')
				.trim()
				.split('\n')
		).toHaveLength(1);
		expect(fixture.stdout()).toContain('APPROVAL_ALLOWED');
		expect(fixture.stderr()).toBe('');
	});

	it('returns a denied tool result and finishes without the side effect', async () => {
		const fixture = startFixture();
		await expect.poll(() => fs.existsSync(fixture.requested)).toBe(true);
		fs.writeFileSync(
			fixture.decision,
			JSON.stringify({ behavior: 'deny', message: 'No test write' })
		);
		expect(await fixture.exited).toBe(0);
		expect(fs.existsSync(fixture.marker)).toBe(false);
		expect(fixture.stdout()).toContain('Permission denied: No test write');
		expect(fixture.stdout()).not.toContain('APPROVAL_ALLOWED');
		expect(fixture.stdout()).toContain('"is_error":true');
	});

	it('stops while waiting and closes the MCP child without writing', async () => {
		const fixture = startFixture();
		await expect.poll(() => fs.existsSync(fixture.requested)).toBe(true);
		fixture.child.kill('SIGINT');
		expect(await fixture.exited).toBe(130);
		expect(fs.existsSync(fixture.marker)).toBe(false);
		expect(fixture.stdout()).not.toContain('APPROVAL_ALLOWED');
		expect(fixture.stdout()).toContain('"is_error":true');
	});
});
