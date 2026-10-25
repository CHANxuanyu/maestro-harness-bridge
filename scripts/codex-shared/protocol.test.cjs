'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function launcher(
	version,
	args,
	differences = [
		{ field: 'v2/TurnStartParams.input', expected: { type: 'array' }, actual: { type: 'string' } },
	]
) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-version-test-'));
	try {
		for (const name of fs.readdirSync(__dirname).filter((name) => /\.(py|json|cjs)$/.test(name)))
			fs.copyFileSync(path.join(__dirname, name), path.join(root, name));
		fs.writeFileSync(
			path.join(root, 'MANIFEST.json'),
			JSON.stringify({
				state: 'READY_FOR_OPT_IN',
				nativeVersion: 'codex-cli 0.163.0-alpha.11.1',
				nativeVersions: ['codex-cli 0.163.0-alpha.11.1'],
				files: {},
			})
		);
		// Mock OS calls only in the test process, never through product flags.
		return spawnSync(
			process.platform === 'win32' ? 'python' : 'python3',
			[
				'-c',
				`
import json, os, runpy, subprocess, sys
sys.argv = [${JSON.stringify(path.join(root, 'codex-shared.py'))}] + json.loads(${JSON.stringify(JSON.stringify(args))})
def check_output(command, **kwargs):
    if command[-1] == '--version': return ${JSON.stringify(version)}
    return ${JSON.stringify(JSON.stringify({ differences }))}
subprocess.check_output = check_output
subprocess.run = lambda *args, **kwargs: None
def execve(*args): raise SystemExit(82)
os.execve = execve
runpy.run_path(sys.argv[0], run_name='__main__')
`,
			],
			{ encoding: 'utf8', env: { ...process.env, MAESTRO_SHARED_STATE: path.join(root, 'state') } }
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

test('unknown native check identifies the changed protocol field and still refuses', () => {
	const result = launcher('codex-cli 9.99.0', ['--connector-check']);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /v2\/TurnStartParams.input/);
});

test('exec cannot attach through an unadmitted native version', () => {
	const result = launcher('codex-cli 9.99.0', [
		'exec',
		'--json',
		'resume',
		'11111111-2222-4333-8444-555555555555',
		'hello',
	]);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /shared startup refused/);
});

test('the admitted native check retains its signature preflight and success result', () => {
	const result = launcher('codex-cli 0.163.0-alpha.11.1', ['--connector-check']);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(JSON.parse(result.stdout).nativeSignatureVerified, true);
});

const surface = require('./protocol-surface.json');
const baseline = require('./protocol-baseline.json');
const catalog = require('./versions.json');
const { compare } = require('./protocol-check.cjs');
const { parseExecArgs, translateItem } = require('./shared-exec.cjs');

test('every candidate is refused by daily startup, including a matching protocol', () => {
	for (const entry of catalog.filter((entry) => entry.state === 'candidate')) {
		const result = launcher(entry.version, ['--connector-check'], []);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /candidate native version; shared startup refused/);
		assert.match(result.stderr, /Mac shared acceptance and explicit admission/);
	}
});

test('every reviewed synthetic protocol preserves tool output and refuses active/queued turns', async () => {
	const { startAppServer } = require('../../e2e/fixtures/native/app-server.cjs');
	const { runSharedExec } = require('./shared-exec.cjs');
	for (const entry of catalog) {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-matrix-'));
		const id = '11111111-2222-4333-8444-555555555555';
		const configDir = path.join(root, 'codex'),
			cwd = path.join(root, 'project');
		fs.mkdirSync(configDir);
		fs.mkdirSync(cwd);
		const socket = path.join(root, 'rpc.sock');
		const server = await startAppServer({
			socket,
			configDir,
			cwd,
			id,
			version: entry.version,
			scenes: [
				{
					answer: 'Synthetic completion.',
					tools: [
						{
							id: 'tool-version',
							command: 'printf synthetic',
							output: 'synthetic',
							status: 'failed',
						},
					],
				},
			],
		});
		try {
			const args = ['exec', '--json', 'resume', id, 'synthetic prompt'];
			server.state.status = 'active';
			await assert.rejects(runSharedExec(socket, args), /still generating/);
			server.state.status = 'idle';
			server.state.queue.push({ id: 'queued' });
			await assert.rejects(runSharedExec(socket, args), /queued messages/);
			assert.equal(server.state.turns.length, 0);
			server.state.queue.length = 0;
			const output = [];
			await runSharedExec(socket, args, { output: (event) => output.push(event) });
			assert.equal(server.state.version, entry.version);
			const command = output.find(
				(event) => event.type === 'item.completed' && event.item?.type === 'command_execution'
			);
			assert.equal(command.item.aggregated_output, 'synthetic', entry.version);
			assert.equal(command.item.status, 'failed', entry.version);
			assert.equal(server.state.turns.length, 1);
		} finally {
			await server.close();
			fs.rmSync(root, { recursive: true, force: true });
		}
	}
});

test('the protocol report pinpoints removals, type changes and new required arguments', () => {
	const changed = structuredClone(baseline);
	delete changed['method.thread/queue/list'];
	changed['v2/TurnStartParams.input'] = { type: 'string' };
	changed['v2/TurnStartParams.$required'].push('extraArgument');
	assert.deepEqual(
		compare(changed, baseline)
			.map((change) => change.field)
			.sort(),
		['method.thread/queue/list', 'v2/TurnStartParams.$required', 'v2/TurnStartParams.input']
	);
});

test('connector RPC calls, parameters, notifications and item reads stay within the manifest', () => {
	const ts = require('typescript');
	const methods = new Set();
	for (const file of ['rpc.cjs', 'shared-exec.cjs', 'connector-admin.cjs']) {
		const tree = ts.createSourceFile(
			file,
			fs.readFileSync(path.join(__dirname, file), 'utf8'),
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.JS
		);
		const visit = (node) => {
			if (ts.isPropertyAccessExpression(node)) {
				const parts = node.getText(tree).replace(/\?\./g, '.').split('.');
				const allowed = surface.readAliases[file]?.[parts.shift()];
				const read = parts.join('.');
				if (allowed)
					assert.ok(
						allowed.some((field) => field === read || field.startsWith(read + '.')),
						`${file}: undocumented response or notification field ${read}`
					);
			}
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === 'request'
			) {
				const method = node.arguments[0].text;
				assert.ok(surface.requests[method], `${file}: undocumented RPC ${method}`);
				methods.add(method);
				const allowed = surface.definitions[surface.requests[method]].paths.map(
					(field) => field.split('.')[0]
				);
				for (const property of node.arguments[1].properties) {
					if (ts.isSpreadAssignment(property)) {
						assert.equal(property.expression.getText(tree), 'parsed.settings');
						continue;
					}
					assert.ok(allowed.includes(property.name.text), `${method}.${property.name.text}`);
				}
			}
			if (
				ts.isPropertyAccessExpression(node) &&
				/^(item|p\.item)$/.test(node.expression.getText(tree))
			)
				assert.ok(
					surface.itemFields.includes(node.name.text),
					`undocumented item.${node.name.text}`
				);
			if (ts.isBinaryExpression(node) && node.left.getText(tree) === 'event.method')
				assert.ok(
					surface.notifications.includes(node.right.text),
					`undocumented notification ${node.right.text}`
				);
			ts.forEachChild(node, visit);
		};
		visit(tree);
	}
	assert.deepEqual([...methods].sort(), Object.keys(surface.requests).sort());
	const parsed = parseExecArgs([
		'exec',
		'--json',
		'--cd',
		'/tmp',
		'--model',
		'model',
		'--sandbox',
		'workspace-write',
		'-c',
		'model_reasoning_effort="high"',
		'-c',
		'model_reasoning_summary="auto"',
		'resume',
		'11111111-2222-4333-8444-555555555555',
		'prompt',
	]);
	for (const key of Object.keys(parsed.settings))
		assert.ok(surface.definitions['v2/TurnStartParams'].paths.includes(key));
});

test('image generation extension changes remain lossless opaque native items', () => {
	// openai/codex 6aaac694803004a63c6f393d153c96d22521a6b9,
	// ext/items/src/image_generation.rs: GeneratedImageRef is untagged and
	// flattened into ImageGenerationItem, preserving result or fileId on wire.
	for (const content of [{ result: 'synthetic' }, { fileId: 'synthetic-file' }]) {
		const item = { id: 'image-1', type: 'imageGeneration', status: 'completed', ...content };
		assert.deepEqual(JSON.parse(translateItem(item, false)[0].payload.arguments), item);
		assert.deepEqual(JSON.parse(translateItem(item, true)[0].payload.output), item);
	}
});

test('candidate acceptance checks the catalog, protocol and private runtime without admitting daily use', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-native-e2e-'));
	fs.chmodSync(root, 0o700);
	for (const directory of ['codex', 'maestro', 'shared-runtime'])
		fs.mkdirSync(path.join(root, directory));
	try {
		for (const [version, differences, expected] of [
			['codex-cli 0.164.0', [], 0],
			['codex-cli 9.99.0', [], 1],
			['codex-cli 0.164.0', [{ field: 'turn/start.input' }], 1],
		]) {
			const script = path.resolve(__dirname, '../../e2e/fixtures/native/candidate-shared.py');
			const result = spawnSync(
				'python3',
				[
					'-c',
					`
import json, runpy, subprocess, sys
sys.dont_write_bytecode = True
sys.argv = [${JSON.stringify(script)}, '--connector-check']
def check_output(command, **kwargs):
    if command[-1] == '--version': return ${JSON.stringify(version)}
    assert command[-2].endswith('protocol-check.cjs')
    return ${JSON.stringify(JSON.stringify({ differences }))}
subprocess.check_output = check_output
subprocess.run = lambda command, **kwargs: None
runpy.run_path(sys.argv[0], run_name='__main__')
`,
				],
				{
					encoding: 'utf8',
					env: {
						...process.env,
						MAESTRO_E2E_REAL: '1',
						MAESTRO_SHARED_STATE: path.join(root, 'shared-runtime'),
						CODEX_HOME: path.join(root, 'codex'),
						MAESTRO_USER_DATA: path.join(root, 'maestro'),
					},
				}
			);
			assert.equal(result.status, expected, result.stderr);
			if (expected === 0) assert.equal(JSON.parse(result.stdout).state, 'candidate');
		}
		const refused = spawnSync(
			'python3',
			[
				path.resolve(__dirname, '../../e2e/fixtures/native/candidate-shared.py'),
				'--connector-check',
			],
			{
				encoding: 'utf8',
				env: {
					...process.env,
					MAESTRO_SHARED_STATE: path.join(root, 'shared-runtime'),
					MAESTRO_E2E_REAL: '0',
				},
			}
		);
		assert.equal(refused.status, 1);
		assert.match(refused.stderr, /requires a private native E2E runtime/);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
