'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const NATIVE =
	'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const rootPath = () =>
	process.env.MAESTRO_SHARED_STATE || path.join(os.homedir(), '.codex', 'maestro-shared-v2');

function readDescriptor(root = rootPath()) {
	const stat = fs.lstatSync(root);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		stat.uid !== process.getuid() ||
		stat.mode & 0o077
	)
		throw new Error('Unsafe shared runtime directory');
	const file = path.join(root, 'runtime.json');
	const info = fs.lstatSync(file);
	if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077)
		throw new Error('Unsafe shared runtime descriptor');
	const value = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (
		typeof value.socket !== 'string' ||
		path.dirname(value.socket) !== root ||
		!Number.isSafeInteger(value.pid)
	)
		throw new Error('Invalid shared runtime descriptor');
	return value;
}
module.exports = { NATIVE, rootPath, readDescriptor };
