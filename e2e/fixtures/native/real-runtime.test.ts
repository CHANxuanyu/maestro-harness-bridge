import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { installedCli, prepareCredentials } = require('./real-runtime.cjs');
const roots: string[] = [];
function dirs() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-real-credentials-'));
	roots.push(root);
	const source = path.join(root, 'source'),
		destination = path.join(root, 'destination');
	fs.mkdirSync(source);
	fs.mkdirSync(destination);
	return { source, destination };
}
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});
it('Codex copies only auth bytes and leaves the account and existing sessions unchanged', () => {
	const { source, destination } = dirs();
	const auth = '{"OPENAI_API_KEY":"synthetic-acceptance-token"}\n';
	fs.writeFileSync(path.join(source, 'auth.json'), auth);
	fs.mkdirSync(path.join(source, 'sessions'));
	fs.writeFileSync(path.join(source, 'sessions', 'existing.jsonl'), 'private sentinel');
	fs.writeFileSync(path.join(source, 'config.toml'), 'unrelated setting');
	prepareCredentials('codex', destination, { CODEX_HOME: source });
	expect(fs.readdirSync(destination)).toEqual(['auth.json']);
	expect(fs.readFileSync(path.join(destination, 'auth.json'), 'utf8')).toBe(auth);
	expect(fs.statSync(path.join(destination, 'auth.json')).mode & 0o777).toBe(0o600);
	expect(fs.readFileSync(path.join(source, 'auth.json'), 'utf8')).toBe(auth);
	expect(fs.readFileSync(path.join(source, 'sessions', 'existing.jsonl'), 'utf8')).toBe(
		'private sentinel'
	);
});
it('Claude takes only the access token and never copies refresh tokens or sessions', () => {
	const { source, destination } = dirs();
	const auth = JSON.stringify({
		claudeAiOauth: { accessToken: 'synthetic-access', refreshToken: 'private-refresh' },
	});
	fs.writeFileSync(path.join(source, '.credentials.json'), auth);
	fs.mkdirSync(path.join(source, 'projects'));
	expect(prepareCredentials('claude', destination, { CLAUDE_CONFIG_DIR: source })).toEqual({
		CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-access',
	});
	expect(fs.readdirSync(destination)).toEqual([]);
	expect(fs.readFileSync(path.join(source, '.credentials.json'), 'utf8')).toBe(auth);
});
it('a missing selected account fails without falling back to another account', () => {
	const { source, destination } = dirs();
	expect(() => prepareCredentials('codex', destination, { CODEX_HOME: source })).toThrow();
	expect(() => prepareCredentials('claude', destination, { CLAUDE_CONFIG_DIR: source })).toThrow(
		'Claude login is unavailable'
	);
});
it('OpenCode copies only the native auth file into its isolated XDG data directory', () => {
	const { source, destination } = dirs();
	const account = path.join(source, 'opencode');
	fs.mkdirSync(account);
	const auth = JSON.stringify({ openai: { type: 'api', key: 'synthetic-api-key' } });
	fs.writeFileSync(path.join(account, 'auth.json'), auth);
	fs.writeFileSync(path.join(account, 'opencode.db'), 'private database sentinel');
	prepareCredentials('opencode', destination, { XDG_DATA_HOME: source });
	expect(fs.readdirSync(destination)).toEqual(['auth.json']);
	expect(fs.readFileSync(path.join(destination, 'auth.json'), 'utf8')).toBe(auth);
	expect(fs.readFileSync(path.join(account, 'auth.json'), 'utf8')).toBe(auth);
	expect(fs.readFileSync(path.join(account, 'opencode.db'), 'utf8')).toBe(
		'private database sentinel'
	);
	expect(fs.statSync(path.join(destination, 'auth.json')).mode & 0o777).toBe(0o600);
});
it.each(['claude', 'codex', 'opencode'])(
	'uses the supplied %s executable and its locked version',
	(provider) => {
		const executable = path.resolve(`e2e/fixtures/native/${provider}`);
		expect(
			installedCli(provider, {
				...process.env,
				[`MAESTRO_E2E_${provider.toUpperCase()}_PATH`]: executable,
			}).executable
		).toBe(executable);
	}
);

it('permits only reviewed exact candidates in shared real acceptance', () => {
	const { source } = dirs();
	const executable = path.join(source, 'codex');
	const writeVersion = (version: string) =>
		fs.writeFileSync(
			executable,
			`#!/usr/bin/env node\nconsole.log(${JSON.stringify(version)});\n`,
			{ mode: 0o755 }
		);
	const env = { ...process.env, MAESTRO_E2E_CODEX_PATH: executable };
	writeVersion('codex-cli 0.164.0');
	expect(() => installedCli('codex', env)).toThrow('Unsupported codex version');
	expect(installedCli('codex', env, true).version).toBe('codex-cli 0.164.0');
	writeVersion('codex-cli 9.99.0');
	expect(() => installedCli('codex', env, true)).toThrow('Unsupported codex version');
});
