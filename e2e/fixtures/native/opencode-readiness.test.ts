import { createNativeTempDir } from './temp-root.cjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import {
	createOpenCodeTurn,
	openCodeSchemaReady,
	readOpenCodeState,
} from './opencode-protocol.cjs';

it('distinguishes an existing SQLite file from a complete native schema without hiding errors', () => {
	const root = createNativeTempDir('opencode-readiness-');
	const file = path.join(root, 'opencode.db');
	const db = new DatabaseSync(file);
	try {
		expect(openCodeSchemaReady(file)).toBe(false);
		expect(() => readOpenCodeState(file)).toThrow('no such table: session');
		// A normal fake turn installs the pinned schema and persists its first step.
		const turn = createOpenCodeTurn({ configDir: root, cwd: root, prompt: 'synthetic readiness' });
		try {
			expect(openCodeSchemaReady(file)).toBe(true);
			expect(readOpenCodeState(file).sessions.map((session) => session.id)).toEqual([turn.id]);
		} finally {
			turn.finish('synthetic completion');
		}
		expect(() => openCodeSchemaReady(path.join(root, 'missing.db'))).toThrow();
	} finally {
		db.close();
		fs.rmSync(root, { recursive: true, force: true });
	}
});

it('waits for a writer that is still installing the schema instead of reporting it locked', async () => {
	const root = createNativeTempDir('opencode-busy-');
	const file = path.join(root, 'opencode.db');
	const held = path.join(root, 'lock-held');
	try {
		// A fresh file starts in the rollback journal, so the writer installing the
		// schema locks out readers until it commits (here for 200 ms).
		const writer = spawn(process.execPath, [
			'-e',
			`const { DatabaseSync } = require('node:sqlite');
			const db = new DatabaseSync(${JSON.stringify(file)});
			db.exec('BEGIN EXCLUSIVE');
			for (const name of ['session', 'message', 'part']) db.exec('CREATE TABLE ' + name + ' (id TEXT)');
			require('node:fs').writeFileSync(${JSON.stringify(held)}, '1');
			setTimeout(() => { db.exec('COMMIT'); db.close(); }, 200);`,
		]);
		const exited = new Promise((resolve) => writer.on('exit', resolve));
		await expect.poll(() => fs.existsSync(held), { timeout: 5000 }).toBe(true);
		expect(openCodeSchemaReady(file)).toBe(true);
		await exited;
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
