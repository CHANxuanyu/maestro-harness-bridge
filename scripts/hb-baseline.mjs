#!/usr/bin/env node
// Read-only macOS package baseline. All generated state lives in one temporary root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
	// No OS sandbox: Chromium's own sandbox cannot start inside sandbox-exec,
	// and the GPU process then aborts, which would time a broken app. Isolation
	// comes from the environment above: temporary HOME, data folder and account
	// folders, and a PATH without any provider CLI.
	// A release build disables Electron's inspector arguments, so readiness is
	// observed from outside: the packaged CLI's `status` answers only once the
	// running app serves the CLI bridge from this data folder.
	const cli = path.join(bundle, 'Contents', 'Resources', 'maestro-cli.js');
	const launchedAt = Date.now();
	const child = spawn(binary, ['--use-mock-keychain'], {
		env,
		stdio: 'ignore',
	});
	try {
		while (Date.now() - launchedAt < timeoutMs) {
			if (child.exitCode !== null) throw new Error(`App exited early with ${child.exitCode}`);
			const ready = spawnSync(process.execPath, [cli, 'status'], {
				env,
				stdio: 'ignore',
				timeout: 10_000,
			});
			if (ready.status === 0) return Date.now() - launchedAt;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error(`App did not answer the CLI within ${timeoutMs} ms`);
	} finally {
		// Even an initialization timeout must leave no package process running.
		if (child.exitCode === null) {
			child.kill('SIGTERM');
			const killed = await Promise.race([
				new Promise((resolve) => child.once('exit', () => resolve(true))),
				new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
			]);
			if (!killed) child.kill('SIGKILL');
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
				'Fresh process and profile; launch until the packaged CLI status answers from the isolated data folder (CLI bridge serving); polled every 100 ms; OS page cache retained; temporary HOME, data and account folders, PATH without provider CLIs; no OS sandbox (Chromium cannot start inside sandbox-exec)',
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
