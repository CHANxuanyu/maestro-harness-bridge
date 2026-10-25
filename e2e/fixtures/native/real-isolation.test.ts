import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import NativeReporter from '../../native-reporter';
import { realExternalTurn } from '../native-real';

it('the shared summary excludes conversation text, paths, diagnostics and native IDs', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-real-report-'));
	const output = path.join(root, 'summary.json');
	try {
		const reporter = new NativeReporter({ output });
		reporter.onTestEnd(
			{
				title: 'claude a: private conversation',
				annotations: [{ type: 'native-cli-version', description: '2.1.310 (Claude Code)' }],
				location: { file: '/private/account' },
			} as any,
			{
				status: 'failed',
				stdout: ['private transcript'],
				errors: [{ message: 'private native ID and token' }],
			} as any
		);
		reporter.onEnd({ status: 'failed' } as any);
		const text = fs.readFileSync(output, 'utf8');
		expect(text).not.toContain('private');
		expect(JSON.parse(text).scenarios).toEqual([
			{ provider: 'claude', scenario: 'a', status: 'failed', cliVersion: '2.1.310 (Claude Code)' },
		]);
		expect(JSON.parse(text).applicationCommit).toMatch(/^[a-f0-9]{40}$/);
	} finally {
		fs.rmSync(root, { recursive: true });
	}
});

it('the real relay preserves arguments, input and output, then holds exit after its child finishes', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-real-relay-'));
	const gate = path.join(root, 'exit');
	const record = path.join(root, 'record.json');
	const childPath = path.join(root, 'cli');
	const control = path.join(root, 'control.json');
	fs.writeFileSync(control, JSON.stringify({ exitGate: gate }));
	fs.writeFileSync(
		childPath,
		`#!${process.execPath}\nconst fs = require('node:fs');\nconst input = fs.readFileSync(0, 'utf8');\nfs.writeFileSync(process.env.RELAY_RECORD, JSON.stringify({ args: process.argv.slice(2), input }));\nprocess.stdout.write('unchanged native bytes\\n');\n`,
		{ mode: 0o700 }
	);
	const args = [
		'exec',
		'--json',
		'resume',
		'native-id',
		'--',
		"a prompt with 'quotes' and $literal",
	];
	const child = spawn(process.execPath, [path.resolve('e2e/fixtures/native/real-cli'), ...args], {
		env: {
			...process.env,
			MAESTRO_E2E_CLI: childPath,
			MAESTRO_E2E_CONTROL: control,
			MAESTRO_E2E_PROCESS: path.join(root, 'pid'),
			RELAY_RECORD: record,
		},
	});
	const exited = once(child, 'exit');
	let output = '';
	child.stdout.on('data', (chunk) => {
		output += chunk;
	});
	child.stdin.end('original stdin');
	try {
		await expect.poll(() => fs.existsSync(record)).toBe(true);
		const pid = Number(fs.readFileSync(path.join(root, 'pid'), 'utf8'));
		await expect
			.poll(() => {
				try {
					process.kill(pid, 0);
					return false;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
					throw error;
				}
			})
			.toBe(true);
		expect(child.exitCode).toBeNull();
		expect(JSON.parse(fs.readFileSync(record, 'utf8'))).toEqual({ args, input: 'original stdin' });
		expect(output).toBe('unchanged native bytes\n');
		fs.writeFileSync(gate, 'exit');
		expect((await exited)[0]).toBe(0);
	} finally {
		fs.writeFileSync(gate, 'exit');
		await exited;
		fs.rmSync(root, { recursive: true });
	}
});

it('an external CLI failure also ends the workload it left in its process group', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-real-external-'));
	const pidFile = path.join(root, 'workload-pid');
	const executable = path.join(root, 'cli');
	fs.writeFileSync(
		executable,
		`#!${process.execPath}\nconst fs = require('node:fs');\nconst { spawn } = require('node:child_process');\nconst child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\nfs.writeFileSync(process.env.WORKLOAD_PID, String(child.pid));\nchild.unref();\nprocess.exitCode = 7;\n`,
		{ mode: 0o700 }
	);
	let pid: number | undefined;
	try {
		await expect(
			realExternalTurn(
				{
					root,
					project: root,
					files: () => [],
					externalCount: 0,
					externalProcesses: new Map(),
					realCli: { executable },
					env: { WORKLOAD_PID: pidFile },
				} as any,
				'claude',
				'External failure cleanup probe',
				{ answer: '' }
			)
		).rejects.toMatchObject({ code: 7 });
		pid = Number(fs.readFileSync(pidFile, 'utf8'));
		await expect
			.poll(() => {
				try {
					process.kill(pid!, 0);
					return false;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
					throw error;
				}
			})
			.toBe(true);
	} finally {
		if (pid) {
			try {
				process.kill(pid, 'SIGTERM');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
			}
		}
		fs.rmSync(root, { recursive: true });
	}
});
