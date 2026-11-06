import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createNativeTempDir } from './temp-root.cjs';
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
