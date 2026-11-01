'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function nativeTempRoot() {
	// Keep macOS socket paths short and resolve aliases before encoding a cwd.
	return fs.realpathSync(
		process.env.MAESTRO_E2E_TEMP_ROOT || (process.platform === 'darwin' ? '/tmp' : os.tmpdir())
	);
}

function createNativeTempDir(prefix) {
	return fs.mkdtempSync(path.join(nativeTempRoot(), prefix));
}

module.exports = { nativeTempRoot, createNativeTempDir };
