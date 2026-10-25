import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Exercise the real-mode entry with synthetic credentials and the versioned
// fixtures as installed CLIs. This never reads a developer's account directory.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-real-smoke-'));
const claude = path.join(root, 'claude-source');
const codex = path.join(root, 'codex-source');
const grok = path.join(root, 'grok-source');
const runs = path.join(root, 'runs');
const xdg = path.join(root, 'xdg-source');
const opencode = path.join(xdg, 'opencode');
for (const dir of [claude, codex, runs, opencode, grok]) fs.mkdirSync(dir, { recursive: true });
const credentials = new Map([
	[path.join(grok, 'auth.json'), '{}\n'],
	[
		path.join(claude, '.credentials.json'),
		JSON.stringify({
			claudeAiOauth: { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' },
		}),
	],
	[path.join(codex, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'synthetic-api-key' })],
	[
		path.join(opencode, 'auth.json'),
		JSON.stringify({ openai: { type: 'api', key: 'synthetic-api-key' } }),
	],
]);
for (const [file, bytes] of credentials) fs.writeFileSync(file, bytes, { mode: 0o600 });
const env = {
	...process.env,
	MAESTRO_E2E_REAL: '1',
	MAESTRO_E2E_SMOKE: '1',
	MAESTRO_E2E_SHARED_PATH: path.resolve('e2e/fixtures/native/real-shared-cli'),
	MAESTRO_E2E_TEMP_ROOT: runs,
	MAESTRO_E2E_CLAUDE_PATH: path.resolve('e2e/fixtures/native/claude'),
	MAESTRO_E2E_CODEX_PATH: path.resolve('e2e/fixtures/native/codex'),
	MAESTRO_E2E_GROK_PATH: path.resolve('e2e/fixtures/native/grok'),
	GROK_HOME: grok,
	GROK_AUTH_PATH: path.join(grok, 'auth.json'),
	MAESTRO_E2E_OPENCODE_PATH: path.resolve('e2e/fixtures/native/opencode'),
	CLAUDE_CONFIG_DIR: claude,
	CODEX_HOME: codex,
	XDG_DATA_HOME: xdg,
};
for (const key of [
	'CLAUDE_CODE_OAUTH_TOKEN',
	'ANTHROPIC_API_KEY',
	'XAI_API_KEY',
	'GROK_CODE_XAI_API_KEY',
])
	delete env[key];
try {
	const result = spawnSync(process.execPath, ['scripts/native-e2e.mjs', ...process.argv.slice(2)], {
		env,
		stdio: 'inherit',
	});
	if (result.error) throw result.error;
	for (const [file, bytes] of credentials)
		assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'Source credentials changed');
	assert.deepEqual(fs.readdirSync(claude), ['.credentials.json']);
	assert.deepEqual(fs.readdirSync(codex), ['auth.json']);
	assert.deepEqual(fs.readdirSync(opencode), ['auth.json']);
	assert.deepEqual(fs.readdirSync(grok), ['auth.json']);
	assert.deepEqual(fs.readdirSync(runs), [], 'Acceptance left temporary sessions behind');
	process.exitCode = result.status ?? 1;
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
