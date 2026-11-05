#!/usr/bin/env node
// Build the separately named Apple Silicon preview without installing or publishing it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
	throw new Error('This preview packaging command is validated only on Apple Silicon macOS.');
}
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const hash = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {
	cwd: root,
	encoding: 'utf8',
}).trim();
const product = { productName: 'Maestro I18n', productId: 'com.maestro.i18n.local' };
const env = {
	...process.env,
	MAESTRO_PRODUCT_NAME: product.productName,
	MAESTRO_PRODUCT_ID: product.productId,
	VITE_APP_VERSION: `${pkg.version} ${hash} (preview)`,
	VITE_COMMIT_HASH: hash,
	MAESTRO_SENTRY_DSN: '',
	MAESTRO_OFFICIAL_BUILD: '',
	CSC_IDENTITY_AUTO_DISCOVERY: 'false',
};
execFileSync('npm', ['run', 'build'], { cwd: root, env, stdio: 'inherit' });
writeFileSync(
	path.join(root, 'dist/main/harness-bridge-entry.cjs'),
	"process.env.MAESTRO_SKIP_PROTOCOL_REGISTRATION = '1';\nrequire('./index.js');\n"
);
const config = structuredClone(pkg.build);
config.appId = product.productId;
config.productName = product.productName;
config.protocols = [];
config.publish = null;
config.directories.output = 'release/harness-bridge';
config.extraMetadata = {
	name: 'maestro-i18n',
	productName: product.productName,
	main: 'dist/main/harness-bridge-entry.cjs',
};
config.mac.extraResources.push({ from: 'dist/maestro-product.json', to: 'maestro-product.json' });
config.mac.identity = '-';
config.mac.notarize = false;
config.mac.target = ['zip'];
config.mac.artifactName = 'Maestro-I18n-${version}-mac-${arch}.${ext}';
// Native rebuilds can embed the builder's home directory in Mach-O debug symbols.
// Strip only debugging records in the packaged copy, before electron-builder signs it.
config.afterPack = path.join(root, 'scripts/strip-native-debug-paths.cjs');
mkdirSync(path.join(root, 'release'), { recursive: true });
const configPath = path.join(root, 'release/harness-bridge-builder.json');
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
execFileSync(
	path.join(root, 'node_modules/.bin/electron-builder'),
	['--config', configPath, '--mac', '--arm64', '--publish', 'never'],
	{ cwd: root, env, stdio: 'inherit' }
);
