import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.MAESTRO_E2E_REAL === '1' && process.env.CI && process.env.MAESTRO_E2E_SMOKE !== '1')
	throw new Error(
		'Real-account acceptance runs only locally. Use test:e2e:real-smoke for synthetic credentials.'
	);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args) {
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const target of ['main', 'renderer', 'cli']) run(npm, ['run', `build:${target}`]);
const args = [
	process.execPath,
	fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url)),
	'test',
	'--project=native',
	...process.argv.slice(2),
];
if (process.platform === 'linux') {
	args.unshift(fileURLToPath(new URL('./test-subprocess-reaper.py', import.meta.url)));
	if (!process.env.DISPLAY)
		run('xvfb-run', ['-a', '--server-args=-screen 0 1600x1000x24', 'python3', ...args]);
	else run('python3', args);
} else run(args.shift(), args);
