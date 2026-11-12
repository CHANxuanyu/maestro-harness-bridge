#!/usr/bin/env node
// Read-only macOS package baseline. All generated state lives in one temporary root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { distribution } from './perf/summary.mjs';

export function parseBaselineArgs(args) {
	const [artifact, ...flags] = args;
	if (!artifact || !/\.(app|zip)$/i.test(artifact)) {
		throw new Error(
			'Usage: node scripts/hb-baseline.mjs <app.app|package.zip> [--runs N] [--timeout-ms N]'
		);
	}
	const options = { artifact: path.resolve(artifact), runs: 5, timeoutMs: 60_000 };
	for (let index = 0; index < flags.length; index += 2) {
		const key = { '--runs': 'runs', '--timeout-ms': 'timeoutMs' }[flags[index]];
		const value = Number(flags[index + 1]);
		if (!key || !Number.isSafeInteger(value) || value < 1 || (key === 'runs' && value > 100)) {
			throw new Error(`Invalid option: ${flags[index]}`);
		}
		options[key] = value;
	}
	return options;
}

export function parseReadyTiming(timing, launchEpochMs) {
	if (
		!timing ||
		!Number.isFinite(timing.timeOrigin) ||
		!Number.isFinite(timing.ready) ||
		timing.ready < 0 ||
		timing.timeOrigin < launchEpochMs
	) {
		throw new Error('Missing or invalid maestro:renderer.ready timestamp');
	}
	return timing.timeOrigin + timing.ready - launchEpochMs;
}

export function summarizeStartup(samples) {
	if (!samples.length || samples.some((value) => !Number.isFinite(value) || value < 0)) {
		throw new Error('Startup samples must be finite non-negative milliseconds');
	}
	return distribution(samples);
}

export function bundleBytes(directory) {
	let total = 0;
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const item = path.join(directory, entry.name);
		if (entry.isDirectory()) total += bundleBytes(item);
		else if (entry.isFile()) total += fs.statSync(item).size;
	}
	return total;
}

export function baselineEnvironment(root) {
	// Deliberately do not spread process.env: tokens, provider overrides, sync paths
	// and Node injection flags from the invoking shell must never reach the app.
	return {
		PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
		HOME: path.join(root, 'home'),
		USERPROFILE: path.join(root, 'home'),
		TMPDIR: path.join(root, 'tmp'),
		MAESTRO_DEMO_DIR: path.join(root, 'data'),
		MAESTRO_USER_DATA: path.join(root, 'data'),
		CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
		CLAUDE_SECURESTORAGE_CONFIG_DIR: path.join(root, 'claude'),
		CODEX_HOME: path.join(root, 'codex'),
		COPILOT_HOME: path.join(root, 'copilot'),
		GROK_HOME: path.join(root, 'grok'),
		GROK_AUTH_PATH: path.join(root, 'grok', 'auth.json'),
		PI_CODING_AGENT_DIR: path.join(root, 'pi'),
		XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
		XDG_DATA_HOME: path.join(root, 'xdg-data'),
		XDG_CACHE_HOME: path.join(root, 'xdg-cache'),
		XDG_STATE_HOME: path.join(root, 'xdg-state'),
		OPENCODE_CONFIG_DIR: path.join(root, 'opencode'),
		LANG: 'en_US.UTF-8',
	};
}

async function coldStart(bundle, root, timeoutMs) {
	const { _electron: electron } = await import('playwright');
	const env = baselineEnvironment(root);
	for (const directory of Object.values(env).filter((value) => value.startsWith(root))) {
		fs.mkdirSync(directory.endsWith('auth.json') ? path.dirname(directory) : directory, {
			recursive: true,
		});
	}
	fs.writeFileSync(
		path.join(env.MAESTRO_DEMO_DIR, 'maestro-settings.json'),
		JSON.stringify({
			uiLanguage: 'en',
			crashReportingEnabled: false,
			checkForUpdatesOnStartup: false,
		})
	);
	const executable = execFileSync(
		'/usr/bin/plutil',
		[
			'-extract',
			'CFBundleExecutable',
			'raw',
			'-o',
			'-',
			path.join(bundle, 'Contents', 'Info.plist'),
		],
		{ encoding: 'utf8' }
	).trim();
	if (!executable || path.basename(executable) !== executable)
		throw new Error('Invalid bundle executable');
	const binary = path.join(bundle, 'Contents', 'MacOS', executable);
	const require = createRequire(import.meta.url);
	const playwrightRoot = path.dirname(
		fs.realpathSync(require.resolve('playwright-core/package.json'))
	);
	// macOS HOME alone does not isolate Keychain or absolute native account paths.
	// Refuse access at the OS boundary, including native keyring daemon calls.
	const quote = (value) => JSON.stringify(value);
	const profile = path.join(root, 'baseline.sb');
	fs.writeFileSync(
		profile,
		`(version 1)
(allow default)
(deny file-read* file-write* (subpath ${quote(os.homedir())}))
(allow file-read* (subpath ${quote(bundle)}) (subpath ${quote(playwrightRoot)}))
(allow file-read* file-write* (subpath ${quote(root)}))
(deny file-write* (subpath ${quote(bundle)}))
(deny file-read* file-write* (subpath "/Library/Keychains") (subpath "/System/Library/Keychains"))
(deny process-exec (literal "/usr/bin/security"))
(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.securityd.xpc") (global-name "com.apple.secd"))
(deny network-outbound (remote ip "*:*") )
(allow network-outbound (remote ip "localhost:*"))
`
	);
	// Playwright supplies Electron's inspector/loader arguments to this wrapper.
	// argv is forwarded without interpolation by the shell.
	const wrapper = path.join(root, 'launch');
	fs.writeFileSync(
		wrapper,
		'#!/bin/sh\nexec /usr/bin/sandbox-exec -f "$HB_BASELINE_PROFILE" "$HB_BASELINE_BINARY" "$@"\n',
		{ mode: 0o700 }
	);
	let app;
	try {
		const launchedAt = Date.now();
		app = await electron.launch({
			executablePath: wrapper,
			args: ['--use-mock-keychain'],
			env: { ...env, HB_BASELINE_PROFILE: profile, HB_BASELINE_BINARY: binary },
			timeout: timeoutMs,
		});
		const window = await app.firstWindow({ timeout: timeoutMs });
		await window.waitForFunction(
			() => performance.getEntriesByName('maestro:renderer.ready').length > 0,
			null,
			{ timeout: timeoutMs }
		);
		const timing = await window.evaluate(() => ({
			timeOrigin: performance.timeOrigin,
			ready: performance.getEntriesByName('maestro:renderer.ready')[0].startTime,
		}));
		return parseReadyTiming(timing, launchedAt);
	} finally {
		if (app) {
			// Even an initialization timeout must leave no package process running.
			const kill = setTimeout(() => app.process().kill('SIGKILL'), 10_000);
			try {
				await app.close();
			} finally {
				clearTimeout(kill);
			}
		}
	}
}

export async function baseline(options) {
	if (process.platform !== 'darwin')
		throw new Error('This baseline measures macOS .app packages only');
	const artifact = fs.realpathSync(options.artifact);
	const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hb-baseline-'));
	try {
		let bundle = artifact;
		let zipBytes = null;
		if (artifact.toLowerCase().endsWith('.zip')) {
			zipBytes = fs.statSync(artifact).size;
			const extracted = path.join(root, 'package');
			fs.mkdirSync(extracted);
			// ditto preserves executable modes, framework symlinks and signatures.
			// Input is the trusted release archive, not a playbook/data zip.
			execFileSync('/usr/bin/ditto', ['-x', '-k', artifact, extracted]);
			const apps = fs.readdirSync(extracted).filter((name) => name.endsWith('.app'));
			if (apps.length !== 1)
				throw new Error('Expected exactly one top-level .app in the release zip');
			bundle = fs.realpathSync(path.join(extracted, apps[0]));
		}
		const sizes = {
			zipBytes,
			appBundleBytes: bundleBytes(bundle),
			appAsarBytes: fs.statSync(path.join(bundle, 'Contents', 'Resources', 'app.asar')).size,
		};
		const samples = [];
		for (let index = 0; index < options.runs; index++) {
			const sample = await coldStart(
				bundle,
				path.join(root, `run-${index + 1}`),
				options.timeoutMs
			);
			samples.push(sample);
			console.error(`Run ${index + 1}/${options.runs}: ${sample.toFixed(1)} ms`);
		}
		return {
			artifact: path.basename(artifact),
			measuredAt: new Date().toISOString(),
			platform: process.platform,
			arch: process.arch,
			osRelease: os.release(),
			...sizes,
			startup: { unit: 'ms', samples, ...summarizeStartup(samples) },
			method:
				'Fresh process and profile; launch to first window maestro:renderer.ready; OS page cache retained; macOS sandbox denies real home, Keychain and external network; Playwright instrumentation included',
		};
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		console.log(JSON.stringify(await baseline(parseBaselineArgs(process.argv.slice(2))), null, 2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
