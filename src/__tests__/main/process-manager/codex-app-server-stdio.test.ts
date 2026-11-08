// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { CodexOutputParser } from '../../../main/parsers/codex-output-parser';
import {
	CodexAppServerSession,
	type CodexAppServerApproval,
} from '../../../main/process-manager/CodexAppServerSession';
const { createNativeTempDir } = require('../../../../e2e/fixtures/native/temp-root.cjs');

it.each(['accept', 'decline'] as const)(
	'runs the synthetic stdio fixture and applies %s exactly once',
	async (decision) => {
		const root = createNativeTempDir('maestro-u5-stdio-');
		const child = spawn(
			process.execPath,
			[
				path.resolve('e2e/fixtures/native/codex-app-server'),
				'app-server',
				'-c',
				'tools.update_plan.enabled=true',
			],
			{
				cwd: root,
				env: { MAESTRO_APP_SERVER_FIXTURE_ROOT: root },
				stdio: ['pipe', 'pipe', 'pipe'],
			}
		);
		let approve!: (value: 'accept' | 'decline') => void;
		let requested!: (value: CodexAppServerApproval) => void;
		const permission = new Promise<CodexAppServerApproval>((resolve) => {
			requested = resolve;
		});
		let complete!: (code: number) => void;
		const done = new Promise<number>((resolve) => {
			complete = resolve;
		});
		const events: any[] = [];
		const session = new CodexAppServerSession({
			cwd: root,
			prompt: 'file approval U5_PLAN',
			imagePaths: [],
			settings: {
				approvalPolicy: 'on-request',
				sandbox: 'workspace-write',
				onPermissionRequest: (request) => {
					requested(request);
					return new Promise((resolve) => {
						approve = resolve;
					});
				},
			},
			send: (line) => {
				child.stdin.write(line);
			},
			onEvent: (event) => events.push(event),
			onDone: complete,
		});
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (data) => session.handleData(data));
		const exited = new Promise<void>((resolve) => child.on('close', () => resolve()));
		try {
			await session.start();
			const request = await permission;
			expect(request.method).toBe('item/fileChange/requestApproval');
			expect(request.changes).toEqual([
				expect.objectContaining({ path: path.join(root, 'approved.txt') }),
			]);
			expect(fs.existsSync(path.join(root, 'approved.txt'))).toBe(false);
			approve(decision);
			expect(await done).toBe(0);
			expect(fs.existsSync(path.join(root, 'approved.txt'))).toBe(decision === 'accept');
			expect(events.filter((event) => event.payload?.phase === 'final_answer')).toHaveLength(1);
			vi.stubEnv('CODEX_HOME', root);
			const parser = new CodexOutputParser();
			const planEvents = events
				.map((event) => parser.parseJsonObject(event))
				.filter((event) => event?.toolName === 'update_plan');
			expect(planEvents).toHaveLength(2);
			expect(planEvents[0]).toMatchObject({
				type: 'tool_use',
				toolState: {
					input: {
						plan: [
							{ step: 'Inspect synthetic fixture', status: 'completed' },
							{ step: 'Wait for synthetic steer', status: 'in_progress' },
							{ step: 'Record synthetic results', status: 'pending' },
						],
					},
				},
			});
			expect(planEvents[1]?.toolState?.status).toBe('completed');

			const receipts = fs
				.readFileSync(path.join(root, 'app-server-receipts.jsonl'), 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line));
			expect(receipts[0]).toEqual({ argv: ['app-server', '-c', 'tools.update_plan.enabled=true'] });
			expect(receipts.filter((message) => message.id === 900)).toEqual([
				{ id: 900, result: { decision } },
			]);
			expect(receipts.filter((message) => message.method === 'turn/start')).toHaveLength(1);
		} finally {
			vi.unstubAllEnvs();
			session.dispose();
			child.kill('SIGKILL');
			await exited;
			fs.rmSync(root, { recursive: true, force: true });
		}
	}
);
