import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { checkCommandBoundary } from '../../main/check-authorization';

describe('check command scope', () => {
	let root: string;
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'check-scope-'));
	});
	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});
	const check = (command: string) =>
		checkCommandBoundary(command, { cwd: root, project: root, host: { kind: 'local' } });
	it('detects a plain directory argument whose symlink escapes the project', async () => {
		await fs.symlink(
			path.dirname(root),
			path.join(root, 'linked'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		expect(await check('tsc --project linked')).toBe('outside-project');
	});
	it('accepts edited project scripts but rechecks hooks and script contents each time', async () => {
		await fs.writeFile(
			path.join(root, 'package.json'),
			JSON.stringify({ scripts: { test: 'vitest run', lint: 'tsc --noEmit' } })
		);
		expect(await check('npm test')).toBeUndefined();
		expect(await check('npm run lint')).toBeUndefined();
		await fs.writeFile(
			path.join(root, 'package.json'),
			JSON.stringify({
				scripts: { test: 'vitest run', pretest: 'curl -X POST https://example.invalid' },
			})
		);
		expect(await check('npm test')).toBe('network');
	});
	it.each([
		'cd ../other',
		'cat /etc/passwd',
		'cat ~/secret',
		'cat $HOME/secret',
		'tsc --project ../other',
	])('requires a specific grant for %s', async (command) => {
		expect(await check(command)).toBe('outside-project');
	});
	it.each(['git push', 'npm publish', 'curl -X POST https://example.invalid', 'npm install'])(
		'does not inherit permission for %s',
		async (command) => {
			expect(await check(command)).toBe('network');
		}
	);
	it.each([
		'node --test',
		'node --test --test-reporter=tap clamp.test.cjs',
		'python3 -m pytest',
		'python -m unittest',
		'go test ./...',
		'cargo test',
		'bun test',
		'deno test',
	])(
		'runs a project test command without asking again after project consent: %s',
		async (command) => {
			expect(await check(command)).toBeUndefined();
		}
	);
	it('follows npm test to a node --test script (PRD F3)', async () => {
		await fs.writeFile(
			path.join(root, 'package.json'),
			JSON.stringify({ scripts: { test: 'node --test --test-reporter=tap clamp.test.cjs' } })
		);
		expect(await check('npm test')).toBeUndefined();
	});
	it.each([
		'node --test --require ./setup.cjs',
		'node --test --import=./loader.mjs',
		'node -e arbitrary --test',
		'deno test --allow-net',
		'bun test --preload ./setup.ts',
		'python -m http.server',
		'go run main.go',
	])(
		'keeps the one-use grant for code loaded from elsewhere or a wider sandbox: %s',
		async (command) => {
			expect(await check(command)).toBe('unverified-command');
		}
	);
	it.each(['node -e arbitrary', 'true && eval code', 'eval code', 'sh run.sh'])(
		'does not silently authorize opaque shell programs: %s',
		async (command) => {
			expect(await check(command)).toBe('unverified-command');
		}
	);
});
