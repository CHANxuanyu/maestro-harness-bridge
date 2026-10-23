'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readStart } = require('./process-start-identity.cjs');
const { RpcClient } = require('./rpc.cjs');
const { proxyStdio } = require('./stdio-proxy.cjs');
const native =
	'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const [socket, pidString, parentString, argsHash, log] = process.argv.slice(2);
const pid = Number(pidString),
	desktopPid = Number(parentString),
	root = path.dirname(socket);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let published = false;
function ownsNative() {
	try {
		return (
			execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
				.trim()
				.startsWith(native + ' ') &&
			execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).includes(
				'--listen unix://' + socket
			)
		);
	} catch {
		return false;
	}
}
(async () => {
	for (let i = 0; i < 200 && !fs.existsSync(socket); i++) {
		process.kill(pid, 0);
		await delay(50);
	}
	if (!fs.existsSync(socket) || !ownsNative())
		throw Error('Native shared service did not become ready');
	const client = new RpcClient(socket, 'maestro_sidecar_health', 'observe');
	let info;
	try {
		info = await client.initialize();
	} finally {
		client.close();
	}
	const socketTarget = fs.realpathSync(socket),
		socketStat = fs.statSync(socketTarget);
	if (!socketStat.isSocket() || socketStat.uid !== process.getuid())
		throw Error('Native socket target identity mismatch');
	const descriptor = {
		version: 2,
		socketTarget,
		socketDev: socketStat.dev,
		socketIno: socketStat.ino,
		pid,
		desktopPid,
		sidecarPid: process.pid,
		socket,
		native,
		argsHash,
		userAgent: info.userAgent,
		startedAt: new Date().toISOString(),
		nativeStart: readStart(pid),
		log,
		launch: 'native-exec-with-sidecar',
	};
	const tmp = path.join(root, 'runtime.' + process.pid + '.tmp');
	fs.writeFileSync(tmp, JSON.stringify(descriptor, null, 2), { flag: 'wx', mode: 0o600 });
	fs.renameSync(tmp, path.join(root, 'runtime.json'));
	published = true;
	const mutex = path.join(root, 'starting');
	const owner = JSON.parse(fs.readFileSync(path.join(mutex, 'owner.json')));
	if (owner.pid === pid) fs.rmSync(mutex, { recursive: true });
	await proxyStdio(socket);
	// A desktop disconnect is not a Stop. Never kill an already-published core;
	// desktop owns its actual PID and normal process shutdown.
})().catch((e) => {
	process.stderr.write('Shared sidecar: ' + e.message + '\n');
	// Before publishing, no desktop or Maestro request could have reached this
	// owned startup core. A failed setup must not leave it holding resources.
	if (!published && ownsNative())
		try {
			process.kill(pid, 'SIGTERM');
		} catch {}
	process.exitCode = 1;
});
