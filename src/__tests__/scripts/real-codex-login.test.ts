// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TestInfo } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareCredentials } from '../../../e2e/fixtures/native/real-runtime.cjs';
import { createNativeTempDir } from '../../../e2e/fixtures/native/temp-root.cjs';
import { RealCodexApp } from '../../../e2e/fixtures/real-codex';

// No Electron launch, keychain lookup or native CLI execution in this suite.
vi.mock('node:child_process', async (original) => ({
	...(await original<typeof import('node:child_process')>()),
	execFileSync: vi.fn(() => 'codex-cli fixture-version'),
}));
vi.mock('@playwright/test', () => ({
	expect,
	test: { extend: vi.fn() },
	_electron: {
		launch: vi.fn(() => {
			throw new Error('Unexpected Electron launch');
		}),
	},
}));

let root: string;
let source: string;
let destination: string;
let app: RealCodexApp | undefined;
const info = { title: 'fixture', annotations: [] } as unknown as TestInfo;

beforeEach(() => {
	root = createNativeTempDir('maestro-login-unit-');
	source = path.join(root, 'source');
	destination = path.join(root, 'destination');
	fs.mkdirSync(source);
	fs.mkdirSync(destination);
	for (const key of Object.keys(process.env)) {
		if (key.startsWith('MAESTRO_CALLER_')) vi.stubEnv(key, undefined);
	}
	for (const key of [
		'CODEX_API_KEY',
		'ANTHROPIC_API_KEY',
		'CLAUDE_CODE_OAUTH_TOKEN',
		'MAESTRO_E2E_CODEX_MODEL',
		'MAESTRO_E2E_CLAUDE_MODEL',
	])
		vi.stubEnv(key, undefined);
	vi.stubEnv('MAESTRO_E2E_REAL', '1');
	vi.stubEnv('CODEX_HOME', source);
	vi.stubEnv('CLAUDE_CONFIG_DIR', source);
	vi.stubEnv('MAESTRO_E2E_CODEX_PATH', path.join(root, 'codex-cli'));
	vi.stubEnv('MAESTRO_E2E_CLAUDE_PATH', path.join(root, 'claude-cli'));
	vi.stubEnv('MAESTRO_E2E_TEMP_ROOT', root);
	fs.writeFileSync(
		path.join(source, 'auth.json'),
		JSON.stringify({
			auth_mode: 'chatgpt',
			tokens: {
				access_token: 'fake-access',
				refresh_token: 'fake-refresh',
				id_token: 'fake-id',
				account_id: 'fake-account',
			},
			last_refresh: '2026-11-11T00:00:00Z',
		})
	);
	fs.writeFileSync(
		path.join(source, '.credentials.json'),
		JSON.stringify({
			claudeAiOauth: { accessToken: 'fake-claude-access', refreshToken: 'fake-claude-refresh' },
		})
	);
	fs.writeFileSync(path.join(source, 'config.toml'), 'model_provider = "private-provider"');
	vi.mocked(execFileSync).mockClear();
});

afterEach(() => {
	if (app) fs.rmSync(app.root, { recursive: true, force: true });
	app = undefined;
	fs.rmSync(root, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('read-only native login snapshots', () => {
	it('copies only auth.json, blanks refresh_token and preserves the source byte for byte', () => {
		const original = fs.readFileSync(path.join(source, 'auth.json'), 'utf8');
		expect(prepareCredentials('codex', destination, { CODEX_HOME: source })).toEqual({});
		const copy = JSON.parse(fs.readFileSync(path.join(destination, 'auth.json'), 'utf8'));
		expect(copy).toEqual({
			...JSON.parse(original),
			tokens: { ...JSON.parse(original).tokens, refresh_token: '' },
		});
		expect(fs.readdirSync(destination)).toEqual(['auth.json']);
		expect(fs.readFileSync(path.join(source, 'auth.json'), 'utf8')).toBe(original);
		if (process.platform !== 'win32')
			expect(fs.statSync(path.join(destination, 'auth.json')).mode & 0o777).toBe(0o600);
	});

	it('fails clearly for an expired access token without creating a snapshot', () => {
		const payload = Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url');
		fs.writeFileSync(
			path.join(source, 'auth.json'),
			JSON.stringify({
				tokens: { access_token: `fake.${payload}.signature`, refresh_token: 'fake-refresh' },
			})
		);
		expect(() => prepareCredentials('codex', destination, { CODEX_HOME: source })).toThrow(
			/Codex access token has expired/
		);
		expect(fs.readdirSync(destination)).toEqual([]);
	});

	it('rejects malformed token containers without leaking their contents', () => {
		fs.writeFileSync(
			path.join(source, 'auth.json'),
			JSON.stringify({ tokens: 'fake-private-value' })
		);
		expect(() => prepareCredentials('codex', destination, { CODEX_HOME: source })).toThrow(
			/^Codex login snapshot is unavailable/
		);
		expect(fs.readdirSync(destination)).toEqual([]);
	});

	it('does not expose malformed auth contents in the error', () => {
		fs.writeFileSync(path.join(source, 'auth.json'), '{"tokens":fake-private-value}');
		expect(() => prepareCredentials('codex', destination, { CODEX_HOME: source })).toThrow(
			/^Codex login snapshot is unavailable/
		);
		expect(fs.readdirSync(destination)).toEqual([]);
	});
});

describe('real Codex acceptance fixture', () => {
	it('uses subscription login and account defaults without requiring Claude', async () => {
		fs.rmSync(path.join(source, '.credentials.json'));
		app = new RealCodexApp(info, true);
		const config = fs.readFileSync(path.join(app.codex, 'config.toml'), 'utf8');
		expect(config).not.toContain('model_provider');
		for (const line of [
			'hooks = false',
			'plugins = false',
			'apps = false',
			'multi_agent = false',
			'web_search = "disabled"',
			'unbounded_connection_retries = false',
		])
			expect(config).toContain(line);
		expect(
			JSON.parse(fs.readFileSync(path.join(app.codex, 'auth.json'), 'utf8')).tokens.refresh_token
		).toBe('');
		const cli = vi.spyOn(app, 'cli').mockResolvedValue({ success: true, agentId: 'fixture' });
		await app.createCodex();
		expect(cli.mock.calls[0]).not.toContain('--model');
		expect(app.env.HOME).toBe(app.syntheticHome);
		expect(app.env.CODEX_HOME).toBe(app.codex);
	});

	it('prepares Claude access-only credentials for the orchestrator and omits an unset model', async () => {
		app = new RealCodexApp(info, false);
		const cli = vi.spyOn(app, 'cli').mockResolvedValue({ success: true, agentId: 'worker' });
		await app.createClaude();
		expect(app.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('fake-claude-access');
		expect(app.env.ANTHROPIC_API_KEY).toBe('');
		expect(cli.mock.calls[0]).not.toContain('--model');
		expect(fs.readdirSync(app.claude)).toEqual([]);
		expect(JSON.stringify(cli.mock.calls)).not.toContain('fake-');
	});

	it('preserves an explicitly supplied Claude OAuth token', () => {
		vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'fake-environment-access');
		fs.rmSync(path.join(source, '.credentials.json'));
		app = new RealCodexApp(info, false);
		expect(app.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('fake-environment-access');
	});

	it('keeps API credentials and explicit model arguments without reading login files', async () => {
		vi.stubEnv('CODEX_API_KEY', 'fake-codex-key');
		vi.stubEnv('ANTHROPIC_API_KEY', 'fake-claude-key');
		vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'fake-ignored-oauth');
		vi.stubEnv('MAESTRO_E2E_CODEX_MODEL', 'gpt-6-astra');
		vi.stubEnv('MAESTRO_E2E_CLAUDE_MODEL', 'fixture-claude-model');
		fs.rmSync(source, { recursive: true });
		app = new RealCodexApp(info, false);
		expect(app.env.CODEX_API_KEY).toBe('fake-codex-key');
		expect(app.env.ANTHROPIC_API_KEY).toBe('fake-claude-key');
		expect(app.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('');
		expect(fs.existsSync(path.join(app.codex, 'auth.json'))).toBe(false);
		const config = fs.readFileSync(path.join(app.codex, 'config.toml'), 'utf8');
		expect(config).toContain('model_provider = "maestro_real_e2e"');
		expect(config).toContain('env_key = "CODEX_API_KEY"');
		expect(config).toContain('request_max_retries = 0');
		expect(config).toContain('stream_max_retries = 0');
		const cli = vi.spyOn(app, 'cli').mockResolvedValue({ success: true, agentId: 'fixture' });
		await app.createCodex();
		await app.createClaude();
		expect(cli.mock.calls[0].slice(-6, -4)).toEqual(['--model', 'gpt-6-astra']);
		expect(cli.mock.calls[1].slice(-6, -4)).toEqual(['--model', 'fixture-claude-model']);
	});
});
