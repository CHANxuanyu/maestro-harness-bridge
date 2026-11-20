'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function nativeTempRoot() {
	// Keep macOS socket paths short and resolve aliases before encoding a cwd.
	// The native resolver also expands Windows 8.3 names (RUNNER~1), which the
	// JavaScript one keeps, so the path matches what fs.promises.realpath sees.
	return fs.realpathSync.native(
		process.env.MAESTRO_E2E_TEMP_ROOT || (process.platform === 'darwin' ? '/tmp' : os.tmpdir())
	);
}

function createNativeTempDir(prefix) {
	return fs.mkdtempSync(path.join(nativeTempRoot(), prefix));
}

module.exports = { nativeTempRoot, createNativeTempDir };
