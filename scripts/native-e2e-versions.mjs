// Each reviewed protocol runs the existing g/h assertions, with retries disabled
// by the native Playwright project. The single build is reused across versions.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const versions = JSON.parse(readFileSync(new URL('./codex-shared/versions.json', import.meta.url)));
if (process.env.MAESTRO_E2E_REAL === '1')
	throw new Error('This matrix uses synthetic protocols only');
if (process.platform === 'linux' && !process.env.DISPLAY)
	throw new Error('Run this matrix under xvfb-run');
function run(command, args, env = process.env) {
	const result = spawnSync(command, args, { env, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const target of ['main', 'renderer', 'cli']) run(npm, ['run', `build:${target}`]);
for (const entry of versions) {
	console.log('Synthetic shared protocol: ' + entry.version);
	const args = [
		process.execPath,
		fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url)),
		'test',
		'--project=native',
		'e2e/native-shared.spec.ts',
	];
	if (process.platform === 'linux')
		args.unshift(fileURLToPath(new URL('./test-subprocess-reaper.py', import.meta.url)));
	run(process.platform === 'linux' ? 'python3' : args.shift(), args, {
		...process.env,
		MAESTRO_E2E_CODEX_VERSION: entry.version,
	});
}
