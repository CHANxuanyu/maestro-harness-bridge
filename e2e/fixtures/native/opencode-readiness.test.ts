import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import {
	createOpenCodeTurn,
	openCodeSchemaReady,
	readOpenCodeState,
} from './opencode-protocol.cjs';

it('distinguishes an existing SQLite file from a complete native schema without hiding errors', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-readiness-'));
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
