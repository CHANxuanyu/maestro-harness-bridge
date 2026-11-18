import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createNativeTempDir } from './temp-root.cjs';
import { teamM2Brief } from './team-m2.cjs';
import { buildTeamTurnPrompt } from '../../../src/shared/team/prompts';
import { reduceLedger } from '../../../src/shared/team/ledger';
import { baseline, ledger } from '../../../src/__tests__/shared/team/fixtures';

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
	for (const child of children.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) {
			const exited = once(child, 'exit');
			child.kill('SIGKILL');
			await exited;
		}
	}
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it('M3 restart fixture holds completion after writing external effects, then releases the real stream', async () => {
	const root = createNativeTempDir('team-m3-restart-');
	roots.push(root);
	const gate = path.join(root, 'release');
	const script = path.join(root, 'script.json');
	fs.writeFileSync(
		script,
		JSON.stringify({ teamM3: { seat: 'dev', scenario: 'restart', gate, brief: teamM2Brief } })
	);
	const child = spawn(
		process.execPath,
		[
			path.resolve('e2e/fixtures/native/codex'),
			'exec',
			'--json',
			'--',
			buildTeamTurnPrompt('work', 'dev', reduceLedger(ledger(...baseline))),
		],
		{ cwd: root, env: { ...process.env, CODEX_HOME: root, MAESTRO_NATIVE_SCRIPT: script } }
	);
	children.push(child);
	let output = '';
	child.stdout!.on('data', (chunk) => {
		output += chunk;
	});
	await expect.poll(() => fs.existsSync(path.join(root, 'result.html'))).toBe(true);
	expect(fs.readFileSync(path.join(root, 'result.html'), 'utf8')).toContain('implemented');
	expect(output).not.toContain('turn.completed');
	expect(child.exitCode).toBeNull();
	fs.writeFileSync(gate, 'release');
	await expect.poll(() => output.includes('turn.completed')).toBe(true);
});
