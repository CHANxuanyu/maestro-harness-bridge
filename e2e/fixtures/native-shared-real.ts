import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { expect, type NativeApp } from './native-app';
import { realPrompt } from './native-real';
import { RpcClient } from '../../scripts/codex-shared/rpc.cjs';

const exec = promisify(execFile);

export async function startRealShared(native: NativeApp, id: string) {
	const connector = path.resolve(process.env.MAESTRO_E2E_SHARED_PATH!);
	const root = path.join(native.root, 'shared-runtime');
	fs.mkdirSync(root, { mode: 0o700 });
	const env = { ...process.env, ...native.env, MAESTRO_SHARED_STATE: root };
	await exec(connector, ['--connector-check'], { env });
	// Existing codex-shared.py recognizes this native desktop app-server flag.
	// It verifies the installed connector and native executable as usual; no
	// package, runtime identity, auth or signature checks are replaced here.
	const child = spawn(
		connector,
		[
			'app-server',
			'-c',
			'plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=false',
			// Pinned official app-server/tests/suite/v2/request_user_input.rs:
			// request_user_input_default_mode_forwards_non_blocking enables this
			// native feature. Keep it scoped to this temporary acceptance runtime.
			'-c',
			'features.default_mode_request_user_input=true',
		],
		{ env, cwd: native.project, detached: true, stdio: ['pipe', 'ignore', 'pipe'] }
	);
	child.stderr.pipe(fs.createWriteStream(native.outputFile('shared-native.log')));
	const exited = once(child, 'exit');
	let client;
	try {
		const descriptorFile = path.join(root, 'runtime.json');
		await expect.poll(() => child.exitCode === null && fs.existsSync(descriptorFile)).toBe(true);
		const descriptor = JSON.parse(fs.readFileSync(descriptorFile, 'utf8'));
		await exec(connector, ['--connector-verify-runtime'], { env });
		client = new RpcClient(descriptor.socket, 'maestro-e2e-observer', 'observe');
		const approvals: { id: number | string; method: string; params: any }[] = [];
		const state = {
			status: 'idle',
			turns: [] as any[],
			queue: [] as any[],
			tools: new Set<string>(),
		};
		client.on('serverRequest', (request) => approvals.push(request));
		client.on('notification', (event) => {
			if (event.params?.threadId !== id) return;
			if (event.method === 'item/started' && event.params.item.type === 'commandExecution')
				state.tools.add(event.params.turnId);
			if (event.method === 'turn/started') state.status = 'active';
			if (event.method === 'turn/completed') state.status = 'idle';
		});
		await client.initialize();
		await client.request('thread/resume', { threadId: id, excludeTurns: true });
		const initial = await client.request('thread/read', { threadId: id, includeTurns: true });
		const existing = new Set(initial.thread.turns.map((turn) => turn.id));
		async function refresh() {
			const snapshot = await client.request('thread/read', { threadId: id, includeTurns: true });
			state.status = snapshot.thread.status.type;
			state.turns = snapshot.thread.turns.filter((turn) => !existing.has(turn.id));
			state.queue = (await client.request('thread/queue/list', { threadId: id })).data;
		}
		async function interrupt() {
			await refresh();
			const active = state.turns.find((turn) => turn.status === 'inProgress');
			if (active) await client.request('turn/interrupt', { threadId: id, turnId: active.id });
			await expect
				.poll(async () => {
					await refresh();
					return state.status;
				})
				.toBe('idle');
		}
		return {
			state,
			approvals,
			socket: descriptor.socket,
			env: { MAESTRO_SHARED_STATE: root, MAESTRO_E2E_CLI: connector },
			refresh,
			async block(kind: 'active' | 'queued') {
				const started = await client.request('turn/start', {
					threadId: id,
					input: [
						{
							type: 'text',
							text: realPrompt(native, 'Hold this acceptance turn', {
								answer: '',
								tools: [{ id: 'shared-busy', command: 'sleep 120', output: '' }],
								waitForStop: true,
							}),
							text_elements: [],
						},
					],
					approvalPolicy: 'never',
					sandboxPolicy: { type: 'dangerFullAccess' },
					cwd: native.project,
				});
				await expect.poll(() => state.tools.has(started.turn.id)).toBe(true);
				if (kind === 'queued') {
					// Pinned official app-server/tests/suite/v2/thread_queue.rs:
					// interrupt_preserves_queue_and_queue_start_can_resume_a_non_head_item.
					// Queue during a blocked turn, then interrupt to keep it paused while idle.
					await client.request('thread/queue/add', {
						threadId: id,
						clientUserMessageId: randomUUID(),
						input: [{ type: 'text', text: 'Keep this acceptance item queued.', text_elements: [] }],
					});
					await interrupt();
				}
				await refresh();
			},
			approve() {
				const request = approvals.at(-1)!;
				// Pinned app-server-protocol/schema/typescript/v2 response types.
				let result;
				if (request.method === 'item/commandExecution/requestApproval')
					result = { decision: 'accept' };
				else if (request.method === 'item/tool/requestUserInput')
					result = {
						answers: Object.fromEntries(
							request.params.questions.map((question) => [
								question.id,
								{ answers: [question.options?.[0]?.label ?? 'Continue the acceptance test.'] },
							])
						),
					};
				else throw new Error(`Unsupported native confirmation: ${request.method}`);
				client.ws.send(JSON.stringify({ id: request.id, result }));
			},
			async close() {
				try {
					await refresh();
					for (const entry of state.queue)
						await client.request('thread/queue/delete', {
							threadId: id,
							queuedSubmissionId: entry.id,
						});
					await interrupt();
					client.close();
					await exec(connector, ['--connector-stop-idle'], { env });
					await exited;
				} finally {
					client.close();
					if (child.exitCode === null && child.signalCode === null) {
						process.kill(-child.pid!, 'SIGTERM');
						await exited;
					}
				}
			},
		};
	} catch (error) {
		client?.close();
		if (child.exitCode === null && child.signalCode === null) {
			process.kill(-child.pid!, 'SIGTERM');
			await exited;
		}
		throw error;
	}
}
