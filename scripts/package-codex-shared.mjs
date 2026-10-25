#!/usr/bin/env node
// Package the opt-in connector without installing it or touching any native session.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	readFileSync,
	writeFileSync,
	copyFileSync,
	chmodSync,
	existsSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const name = `Maestro-Codex-Shared-${version}`;
const output = path.join(root, 'release/codex-shared', name);
if (existsSync(output)) throw new Error(`Output already exists: ${output}`);
mkdirSync(output, { recursive: true });
for (const entry of ['exec-adapter-v2', 'sidecar-v2', 'connector-admin']) {
	await build({
		entryPoints: [path.join(root, 'scripts/codex-shared', `${entry}.cjs`)],
		outfile: path.join(output, `${entry}.bundle.cjs`),
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node22',
		external: ['bufferutil', 'utf-8-validate'],
		legalComments: 'inline',
	});
}
for (const file of ['codex-shared.py', 'enable-sharing.command', 'disable-sharing.command']) {
	copyFileSync(path.join(root, 'scripts/codex-shared', file), path.join(output, file));
	chmodSync(path.join(output, file), 0o755);
}
copyFileSync(path.join(root, 'docs/codex-shared.md'), path.join(output, 'README.md'));
for (const file of [
	'versions.json',
	'protocol-surface.json',
	'protocol-baseline.json',
	'protocol-check.cjs',
])
	copyFileSync(path.join(root, 'scripts/codex-shared', file), path.join(output, file));
copyFileSync(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'));
copyFileSync(
	path.join(path.dirname(require.resolve('ws/package.json')), 'LICENSE'),
	path.join(output, 'WS-LICENSE.txt')
);
const files = {};
for (const file of [
	'exec-adapter-v2.bundle.cjs',
	'sidecar-v2.bundle.cjs',
	'connector-admin.bundle.cjs',
	'codex-shared.py',
	'enable-sharing.command',
	'disable-sharing.command',
	'README.md',
	'LICENSE',
	'WS-LICENSE.txt',
	'versions.json',
	'protocol-surface.json',
	'protocol-baseline.json',
	'protocol-check.cjs',
]) {
	files[file] = createHash('sha256')
		.update(readFileSync(path.join(output, file)))
		.digest('hex');
}
writeFileSync(
	path.join(output, 'MANIFEST.json'),
	`${JSON.stringify(
		{
			state: 'READY_FOR_OPT_IN',
			version,
			nativeVersions: require('./codex-shared/versions.json')
				.filter((entry) => entry.state === 'admitted')
				.map((entry) => entry.version),
			sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
				cwd: root,
				encoding: 'utf8',
			}).trim(),
			files,
		},
		null,
		2
	)}\n`
);
if (process.platform === 'darwin') {
	execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', '--norsrc', output, `${output}.zip`]);
}
console.log(`Prepared opt-in connector: ${output}`);
