import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import planEvents from './codex-plan-events.json';
import path from 'node:path';
import { createTurn } from './protocol.cjs';
import { createNativeTempDir } from './temp-root.cjs';
import { nativeIdentity, nativeToolIds } from '../native-real';

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it('Codex exec publishes command output only at completion', () => {
	const root = createNativeTempDir('maestro-codex-contract-');
	roots.push(root);
	const events: any[] = [];
	const turn = createTurn({
		provider: 'codex',
		configDir: root,
		cwd: root,
		prompt: 'Output',
		emit: (event: unknown) => events.push(event),
	});
	const tool = { id: 'command', command: 'printf result', output: 'result' };
	turn.startTool(tool);
	turn.updateTool(tool, 'res');
	expect(events.filter((event) => event.type === 'item.updated')).toEqual([]);
	expect(events.at(-1).item.aggregated_output).toBe('');
	turn.finishTool(tool);
	expect(events.at(-1)).toMatchObject({
		type: 'item.completed',
		item: { aggregated_output: 'result', status: 'completed' },
	});
});

it('finds native command IDs in 11.1 durable CommandExecution items', () => {
	const root = createNativeTempDir('maestro-codex-contract-');
	roots.push(root);
	const file = path.join(root, 'rollout.jsonl');
	// Official rust-v0.163.0-alpha.11.1 protocol/src/{items,protocol}.rs
	// and rollout/src/policy.rs. No private acceptance records are copied.
	const rows = ['first', 'second'].map((name) => ({
		type: 'event_msg',
		payload: {
			type: 'item_completed',
			thread_id: '00000000-0000-0000-0000-000000000001',
			turn_id: 'turn',
			completed_at_ms: 1,
			item: {
				type: 'CommandExecution',
				id: `call-${name}`,
				command: ['/bin/zsh', '-lc', `printf ${name}-result`],
				cwd: root,
				parsed_cmd: [],
				source: 'agent',
				status: 'completed',
				aggregated_output: `${name}-result`,
				exit_code: 0,
			},
		},
	}));
	const modelCalls = ['first', 'legacy'].map((name) => ({
		type: 'response_item',
		payload: {
			type: 'function_call',
			call_id: `model-${name}`,
			arguments: JSON.stringify({ cmd: `printf ${name}-result` }),
		},
	}));
	fs.writeFileSync(file, [...modelCalls, ...rows].map((row) => JSON.stringify(row)).join('\n'));
	expect(
		nativeToolIds('codex', file, [
			'printf first-result',
			'printf second-result',
			'printf legacy-result',
			'unrun',
		])
	).toEqual(['call-first', 'call-second', 'model-legacy', undefined]);
});

it('Codex fixture preserves unknown effort instead of inventing high', () => {
	const root = createNativeTempDir('maestro-codex-contract-');
	roots.push(root);
	const turn = createTurn({
		provider: 'codex',
		configDir: root,
		cwd: root,
		prompt: 'Default effort',
	});
	turn.finish('Answer');
	expect(nativeIdentity('codex', turn.file).effort).toBeNull();
});

it('Codex fixture retains explicitly configured effort', () => {
	const root = createNativeTempDir('maestro-codex-contract-');
	roots.push(root);
	const turn = createTurn({
		provider: 'codex',
		configDir: root,
		cwd: root,
		prompt: 'Configured effort',
		effort: 'high',
	});
	turn.finish('Answer');
	expect(nativeIdentity('codex', turn.file).effort).toBe('high');
});

// Event ordering follows the observed 0.166.0-alpha.6 exec plan turn.
// Text, usage and thread identity are synthetic; no captured private bytes are used.
it('replays every plan event unchanged and permits a following turn', async () => {
	const root = createNativeTempDir('maestro-codex-plan-replay-');
	roots.push(root);
	const script = path.join(root, 'scenario.json');
	fs.writeFileSync(
		script,
		JSON.stringify({
			turns: [
				{ answer: planEvents[9].item!.text, codexExecEvents: planEvents },
				{ answer: 'FOLLOW_UP: still here.' },
			],
		})
	);
	const exec = promisify(execFile);
	const options = {
		cwd: root,
		env: { ...process.env, CODEX_HOME: root, MAESTRO_NATIVE_SCRIPT: script },
	};
	const first = await exec(
		process.execPath,
		[path.resolve('e2e/fixtures/native/codex'), 'exec', '--json', '--', 'Synthetic plan'],
		options
	);
	expect(
		first.stdout
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line))
	).toEqual(planEvents);
	const next = await exec(
		process.execPath,
		[
			path.resolve('e2e/fixtures/native/codex'),
			'exec',
			'--json',
			'resume',
			planEvents[0].thread_id!,
			'--',
			'Synthetic follow-up',
		],
		options
	);
	expect(next.stdout).toContain('FOLLOW_UP: still here.');
	expect(JSON.parse(next.stdout.split('\n')[0]).thread_id).toBe(planEvents[0].thread_id);
	expect(fs.readFileSync(path.join(root, 'fixture-turn-count'), 'utf8')).toBe('2');
});
