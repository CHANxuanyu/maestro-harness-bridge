'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { canonicalStart, readStart } = require('./process-start-identity.cjs');
const { readDescriptor, NATIVE } = require('./runtime.cjs');
const { runSharedExec } = require('./shared-exec.cjs');
(async () => {
	const d = readDescriptor();
	if (d.version !== 2 || d.launch !== 'native-exec-with-sidecar')
		throw Error('This runtime was not started by the verified native launcher');
	const cmd = execFileSync('/bin/ps', ['-p', String(d.pid), '-o', 'command='], {
		encoding: 'utf8',
	}).trim();
	const start = readStart(d.pid);
	if (
		!cmd.startsWith(NATIVE + ' ') ||
		!cmd.includes('--listen unix://' + d.socket) ||
		canonicalStart(start) !== canonicalStart(d.nativeStart)
	)
		throw Error(
			'Shared runtime process has exited or changed; no native fallback or fork was started'
		);
	// Native macOS transport exposes a symlink to its own short socket path.
	const target = fs.realpathSync(d.socket),
		s = fs.statSync(target);
	if (
		target !== d.socketTarget ||
		!s.isSocket() ||
		s.uid !== process.getuid() ||
		s.dev !== d.socketDev ||
		s.ino !== d.socketIno
	)
		throw Error('Shared runtime socket identity mismatch');
	if (process.argv.length === 3 && process.argv[2] === '--verify-runtime') {
		process.stdout.write(
			JSON.stringify({ verified: true, pid: d.pid, nativeStart: canonicalStart(start) }) + '\n'
		);
		return;
	}
	const result = await runSharedExec(d.socket, process.argv.slice(2));
	if (result.interrupted) process.exitCode = 130;
})().catch((e) => {
	process.stdout.write(
		JSON.stringify({ type: 'error', message: 'Shared Codex: ' + e.message }) + '\n'
	);
	process.exitCode = 1;
});
