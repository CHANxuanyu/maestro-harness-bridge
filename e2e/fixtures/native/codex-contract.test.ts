import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
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
	fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n'));
	expect(
		nativeToolIds('codex', file, ['printf first-result', 'printf second-result', 'unrun'])
	).toEqual(['call-first', 'call-second', undefined]);
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
