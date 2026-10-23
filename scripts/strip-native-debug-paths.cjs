'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// afterPack runs on the copied app, never on the developer's node_modules or
// installed application. Signing occurs afterward in electron-builder.
module.exports = async function stripNativeDebugPaths(context) {
	if (context.electronPlatformName !== 'darwin') return;
	const root = path.join(
		context.appOutDir,
		`${context.packager.appInfo.productFilename}.app`,
		'Contents/Resources/app.asar.unpacked'
	);
	const machoMagic = new Set([
		'cffaedfe',
		'cefaedfe',
		'feedfacf',
		'feedface',
		'cafebabe',
		'bebafeca',
		'cafebabf',
		'bfbafeca',
	]);
	let count = 0;
	function visit(dir) {
		for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
			const file = path.join(dir, item.name);
			if (item.isDirectory()) visit(file);
			else if (item.isFile() && (item.name.endsWith('.node') || item.name === 'spawn-helper')) {
				const header = Buffer.alloc(4);
				const fd = fs.openSync(file, 'r');
				try {
					fs.readSync(fd, header, 0, 4, 0);
				} finally {
					fs.closeSync(fd);
				}
				if (!machoMagic.has(header.toString('hex'))) continue;
				// -S removes debugging symbols, preserving executable code and exports.
				execFileSync('/usr/bin/strip', ['-S', file]);
				count++;
			}
		}
	}
	if (fs.existsSync(root)) visit(root);
	console.log(`Removed native debug records from ${count} packaged Mach-O files.`);
};
