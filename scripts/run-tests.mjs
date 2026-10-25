import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = [
	process.execPath,
	'--max-old-space-size=8192',
	fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
	'run',
	...process.argv.slice(2),
];
const command = process.platform === 'linux' ? 'python3' : args.shift();
if (process.platform === 'linux') {
	args.unshift(fileURLToPath(new URL('./test-subprocess-reaper.py', import.meta.url)));
}
const child = spawn(command, args, { stdio: 'inherit' });
child.on('error', (error) => {
	console.error(error);
	process.exitCode = 1;
});
child.on('exit', (code) => {
	process.exitCode = code ?? 1;
});
