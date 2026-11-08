import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { createNativeTempDir } from './temp-root.cjs';
import { ClaudeOutputParser } from '../../../src/main/parsers/claude-output-parser';

const { createTurn } = createRequire(import.meta.url)('./protocol.cjs');
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it('reports scripted plugin commands through the real Claude parser without a process', () => {
	const root = createNativeTempDir('maestro-command-report-');
	roots.push(root);
	const events: unknown[] = [];
	createTurn({
		provider: 'claude',
		configDir: root,
		cwd: root,
		prompt: 'Fixture prompt',
		slashCommands: ['fixture:review'],
		emit: (event: unknown) => events.push(event),
	});
	const parser = new ClaudeOutputParser();
	const init = parser.parseJsonLine(JSON.stringify(events[0]));
	expect(parser.extractSlashCommands(init!)).toEqual(['fixture:review']);
});
