import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createNativeTempDir } from './temp-root.cjs';
import { moveClaudeToolResultToChild } from './tool-output';
import type { TestInfo } from '@playwright/test';
vi.mock('node:child_process', async (original) => ({
	...(await original<typeof import('node:child_process')>()),
	execFile: vi.fn((_file, _args, _options, callback) =>
		callback(
			Object.assign(new Error('exit 1'), { stdout: 'synthetic stdout', stderr: 'synthetic stderr' })
		)
	),
}));
import { NativeApp } from '../native-app';
const require = createRequire(import.meta.url);
const { createTurn } = require('./protocol.cjs');
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it('moves only the selected child result while retaining string user content in the parent', () => {
	const root = createNativeTempDir('tool-output-child-');
	roots.push(root);
	const turn = createTurn({
		provider: 'claude',
		configDir: root,
		cwd: root,
		id: 'parent',
		prompt: 'String user message',
	});
	const tool = {
		id: 'child-call',
		command: 'synthetic child',
		output: 'x'.repeat(9000) + 'CHILD_TAIL',
	};
	turn.startTool(tool);
	turn.finishTool(tool);
	turn.finishTool({ id: 'other-call', output: 'unrelated parent result' });
	turn.finish('Synthetic answer');
	const original = fs
		.readFileSync(turn.file, 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	expect(original[0].message.content).toBe('String user message');
	const child = moveClaudeToolResultToChild(turn.file, turn.id, tool.id);
	expect(
		fs
			.readFileSync(child, 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line))
	).toEqual([original[2]]);
	expect(
		fs
			.readFileSync(turn.file, 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line))
	).toEqual([original[0], original[1], original[3], original[4]]);
	expect(fs.readFileSync(child, 'utf8')).toContain('CHILD_TAIL');
	expect(fs.readFileSync(turn.file, 'utf8')).not.toContain('CHILD_TAIL');
});
it('keeps CLI stdout and stderr in fixture failures', async () => {
	const native = new NativeApp({ title: 'synthetic CLI diagnostic' } as TestInfo, {
		providerCli: false,
	});
	roots.push(native.root);
	await expect(native.cli('native-history', 'tool-output', 'native', 'call')).rejects.toThrow(
		'stdout:\nsynthetic stdout\nstderr:\nsynthetic stderr'
	);
});
it('models exec item counters independently of rollout call IDs', () => {
	const root = createNativeTempDir('tool-output-fixture-');
	roots.push(root);
	const events: any[] = [];
	const turn = createTurn({
		provider: 'codex',
		configDir: root,
		cwd: root,
		id: 'native',
		prompt: 'synthetic',
		emit: (event: any) => events.push(event),
	});
	const tool = {
		id: 'call_native',
		itemId: 'item_7',
		command: 'synthetic command',
		output: 'x'.repeat(9000) + 'TAIL',
	};
	turn.startTool(tool);
	turn.finishTool(tool);
	const items = events.filter((event) => event.item?.type === 'command_execution');
	expect(items.map((event) => event.item.id)).toEqual(['item_7', 'item_7']);
	const file = path.join(
		root,
		'sessions',
		'2026',
		'10',
		'24',
		'rollout-2026-10-24T00-00-00-native.jsonl'
	);
	const rows = fs
		.readFileSync(file, 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	expect(
		rows
			.filter((row) => row.payload?.type === 'function_call_output')
			.map((row) => row.payload.call_id)
	).toEqual(['call_native']);
});
