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
const runs = path.join(root, 'runs');
for (const dir of [claude, codex, runs]) fs.mkdirSync(dir);
const credentials = new Map([
	[
		path.join(claude, '.credentials.json'),
		JSON.stringify({
			claudeAiOauth: { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' },
		}),
	],
	[path.join(codex, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'synthetic-api-key' })],
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
	CLAUDE_CONFIG_DIR: claude,
	CODEX_HOME: codex,
};
for (const key of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']) delete env[key];
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
	assert.deepEqual(fs.readdirSync(runs), [], 'Acceptance left temporary sessions behind');
	process.exitCode = result.status ?? 1;
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
