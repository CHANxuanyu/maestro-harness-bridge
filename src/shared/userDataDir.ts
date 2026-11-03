/**
 * Maestro's data directory, resolved without Electron.
 *
 * The desktop app gets this from `app.getPath('userData')`. A process that has
 * no Electron - the CLI, and the standalone Cue runner this exists for - has to
 * arrive at the SAME directory, or the two disagree about what state exists.
 *
 * The app's own rule, mirrored here:
 *   1. `MAESTRO_USER_DATA` wins. The app sets it on its OWN process env at
 *      startup (`src/main/index.ts`), so anything the app spawns inherits it and
 *      lands in the right place by construction. A CLI the user starts from
 *      their own terminal does NOT inherit it and falls through to step 2.
 *   2. Otherwise the platform default plus the app name, and the app name is
 *      NOT constant: Electron uses `package.json` `name` ("maestro") when
 *      running unpackaged and the bundle's `productName` ("Maestro") once
 *      packaged. Both spellings exist in the wild, which is why the fallbacks
 *      scattered around this repo disagree with each other.
 *   3. Development adds one more hop: the app redirects to a sibling
 *      `maestro-dev` directory unless `USE_PROD_DATA` is set.
 *
 * Everything is injectable so the branches can be tested without pretending to
 * be another OS.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveSyncDir } from './syncPath';

/** Directory name Electron derives from `package.json` `name`, unpackaged. */
const UNPACKAGED_APP_NAME = 'maestro';
export interface AppProductIdentity {
	productName: string;
	productId: string;
}

declare const __MAESTRO_PRODUCT__: AppProductIdentity | undefined;
const PRODUCT_IDENTITY_FILE = 'maestro-product.json';
/** Sibling directory the app redirects to in development. */
const DEV_APP_NAME = 'maestro-dev';

export interface UserDataDirOptions {
	/** Shipped Resources directory or compiled shared module directory. */
	runtimeDir?: string;
	/** Injected identity for tests and embedding processes. */
	product?: AppProductIdentity;
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	homedir?: string;
	/**
	 * Whether this is a packaged install. Defaults to a probe that does not
	 * import Electron: under Electron, `process.defaultApp` is set only when it
	 * was launched as `electron .`; outside Electron there is no app bundle to
	 * be unpackaged, so the installed spelling is the right assumption (it is
	 * also what `maestro-cli` has always used).
	 */
	isPackaged?: boolean;
	/** Whether this is a development run. Defaults to `NODE_ENV`. */
	isDevelopment?: boolean;
}

function checkedProduct(value: AppProductIdentity): AppProductIdentity {
	if (
		!value ||
		typeof value.productName !== 'string' ||
		!value.productName.trim() ||
		/[\\/]/.test(value.productName) ||
		value.productName === '.' ||
		value.productName === '..' ||
		typeof value.productId !== 'string' ||
		!value.productId
	)
		throw new Error('Invalid packaged Maestro product identity');
	return value;
}

/** Packaging writes this identity for both the bundled CLI and standalone runners. */
export function resolveAppProduct(options: UserDataDirOptions = {}): {
	product: AppProductIdentity;
	verified: boolean;
} {
	if (options.product) return { product: checkedProduct(options.product), verified: true };
	if (typeof __MAESTRO_PRODUCT__ !== 'undefined')
		return { product: checkedProduct(__MAESTRO_PRODUCT__), verified: true };
	// Uncompiled checkouts use package metadata. Compiled runners require their shipped identity.
	if (options.runtimeDir || __filename.endsWith('.js')) {
		let directory = options.runtimeDir ?? __dirname;
		for (let level = 0; level < 5; level++) {
			try {
				const product = JSON.parse(
					fs.readFileSync(path.join(directory, PRODUCT_IDENTITY_FILE), 'utf8')
				);
				return { product: checkedProduct(product), verified: true };
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
			const parent = path.dirname(directory);
			if (parent === directory) break;
			directory = parent;
		}
		throw new Error(
			'Packaged Maestro product identity is missing. Set MAESTRO_USER_DATA only with a matching product identity.'
		);
	}
	const pkg = require('../../package.json') as {
		productName?: string;
		build: { productName: string; appId: string };
	};
	return {
		product: checkedProduct({
			productName: pkg.productName || pkg.build.productName,
			productId: pkg.build.appId,
		}),
		verified: false,
	};
}

/** Refuse foreign identities and legacy settings with no evidence of this fork. */
export function assertUserDataDirProduct(dir: string, product: AppProductIdentity): string {
	checkedProduct(product);
	let stored: AppProductIdentity | undefined;
	try {
		stored = checkedProduct(
			JSON.parse(fs.readFileSync(path.join(dir, PRODUCT_IDENTITY_FILE), 'utf8'))
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
			throw new Error(
				`Cannot verify that the data directory belongs to ${product.productName}: ${dir}. ${PRODUCT_IDENTITY_FILE} is unreadable or invalid.`
			);
	}
	if (stored) {
		if (stored.productId !== product.productId || stored.productName !== product.productName)
			throw new Error(`Maestro data directory belongs to a different product: ${dir}`);
		return dir;
	}
	const settingsFile = path.join(resolveSyncDir(dir), 'maestro-settings.json');
	let settings: Record<string, unknown>;
	try {
		settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return dir;
		throw new Error(
			`Cannot verify that the data directory belongs to ${product.productName}: ${dir}. maestro-settings.json is unreadable or invalid.`
		);
	}
	if (
		product.productId === 'com.maestro.i18n.local' &&
		['system', 'en', 'zh-CN'].includes(settings?.uiLanguage as string)
	)
		return dir;
	throw new Error(
		`Cannot verify that the data directory belongs to ${product.productName}: ${dir}`
	);
}

/** Electron chose this directory. Record identity without blocking store recovery or startup. */
export function recordUserDataProduct(
	dir: string,
	warn: (message: string) => void = console.warn
): void {
	try {
		const identity = resolveAppProduct();
		if (!identity.verified) return;
		fs.mkdirSync(dir, { recursive: true });
		try {
			fs.writeFileSync(path.join(dir, PRODUCT_IDENTITY_FILE), JSON.stringify(identity.product), {
				flag: 'wx',
				mode: 0o600,
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			const stored = checkedProduct(
				JSON.parse(fs.readFileSync(path.join(dir, PRODUCT_IDENTITY_FILE), 'utf8'))
			);
			if (
				stored.productId !== identity.product.productId ||
				stored.productName !== identity.product.productName
			)
				throw new Error(`Maestro data directory belongs to a different product: ${dir}`);
		}
	} catch (error) {
		try {
			warn(
				`Could not record Maestro data directory product identity: ${error instanceof Error ? error.message : String(error)}`
			);
		} catch {
			// Even a failed warning reporter must not prevent desktop startup.
		}
	}
}

function platformRoot(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string {
	if (platform === 'darwin') return path.join(home, 'Library', 'Application Support');
	if (platform === 'win32') return env.APPDATA || path.join(home, 'AppData', 'Roaming');
	return env.XDG_CONFIG_HOME || path.join(home, '.config');
}

/**
 * `existsSync` is true for a regular file too, which is not a data directory.
 *
 * Only a missing path answers "no". A permission or I/O error must not come back
 * as an absent directory: the path is right, `MAESTRO_USER_DATA` would not fix
 * it, and the caller needs the real errno to know that.
 */
function isDirectory(candidate: string): boolean {
	try {
		return fs.statSync(candidate).isDirectory();
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR') return false;
		throw error;
	}
}

function probeIsPackaged(): boolean {
	const electronProcess = process as NodeJS.Process & { defaultApp?: boolean };
	if (process.versions.electron) return !electronProcess.defaultApp;
	return true;
}

/**
 * The directory the desktop app stores its data in.
 *
 * Callers that can reach Electron should keep using `app.getPath('userData')`:
 * this is for the ones that cannot.
 *
 * A process with no Electron cannot tell a dev checkout's `maestro` from an
 * installed `Maestro`, so it assumes the installed spelling. A standalone
 * runner must therefore check the directory it got (see
 * `assertUserDataDirExists`) rather than open whatever database happens to be
 * at the computed path.
 */
export function resolveUserDataDir(options: UserDataDirOptions = {}): string {
	const env = options.env ?? process.env;
	// Desktop shared services inherit Electron's already selected folder.
	// Electron running the CLI as Node has no browser process type and keeps
	// the same strict checks as an ordinary Node CLI or standalone runner.
	if (
		env.MAESTRO_USER_DATA &&
		process.versions.electron &&
		(process as NodeJS.Process & { type?: string }).type === 'browser'
	)
		return path.resolve(env.MAESTRO_USER_DATA);
	const identity = resolveAppProduct(options);
	if (env.MAESTRO_USER_DATA) {
		const dir = path.resolve(env.MAESTRO_USER_DATA);
		return identity.verified ? assertUserDataDirProduct(dir, identity.product) : dir;
	}

	const platform = options.platform ?? os.platform();
	const home = options.homedir ?? os.homedir();
	const isPackaged = options.isPackaged ?? probeIsPackaged();
	const isDevelopment = options.isDevelopment ?? env.NODE_ENV === 'development';

	const root = platformRoot(platform, home, env);
	if (!isPackaged && isDevelopment && !env.USE_PROD_DATA) {
		return path.join(root, DEV_APP_NAME);
	}
	const dir = path.join(root, isPackaged ? identity.product.productName : UNPACKAGED_APP_NAME);
	return identity.verified ? assertUserDataDirProduct(dir, identity.product) : dir;
}

/**
 * Refuse to proceed when the resolved directory is not Maestro's.
 *
 * For a process that starts with no app running, an absent directory means the
 * spelling was guessed wrong (a dev checkout writes `maestro`, an install
 * writes `Maestro`), and creating it would open an empty database beside the
 * real one instead of failing. Callers that legitimately create the directory -
 * the app itself, and the CLI's first write - must not call this.
 *
 * Throws with the other candidates it can see, so the fix (`MAESTRO_USER_DATA`)
 * is obvious from the message.
 */
export function assertUserDataDirExists(dir: string, options: UserDataDirOptions = {}): string {
	if (isDirectory(dir)) {
		const identity = resolveAppProduct(options);
		return identity.verified ? assertUserDataDirProduct(dir, identity.product) : dir;
	}

	const env = options.env ?? process.env;
	const platform = options.platform ?? os.platform();
	const home = options.homedir ?? os.homedir();
	const root = platformRoot(platform, home, env);
	const alternatives = [
		resolveAppProduct(options).product.productName,
		UNPACKAGED_APP_NAME,
		DEV_APP_NAME,
	]
		.map((name) => path.join(root, name))
		.filter((candidate) => {
			if (candidate === dir) return false;
			// Asymmetric on purpose: the directory we were ASKED about must report a
			// real error, but a sibling we cannot stat is just not worth naming, and
			// throwing here would replace a good diagnostic with an unrelated one.
			try {
				return isDirectory(candidate);
			} catch {
				return false;
			}
		});

	// A file at the path is a different mistake from nothing at all, and saying
	// "not found" about something the user can see would send them hunting.
	const problem = fs.existsSync(dir) ? 'is not a directory' : 'not found at';

	throw new Error(
		`Maestro data directory ${problem} ${dir}.` +
			(alternatives.length ? ` Found instead: ${alternatives.join(', ')}.` : '') +
			` Set MAESTRO_USER_DATA to the directory the desktop app uses.`
	);
}
