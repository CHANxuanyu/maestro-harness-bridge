import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { createNativeTempDir } from './temp-root.cjs';
import { acceptanceEnabled, prepareAcceptanceProviders } from './real-runtime.cjs';

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it('requires both explicit opt-ins and refuses smoke or CI even with inherited switches', () => {
	const opted = { MAESTRO_E2E_REAL: '1', MAESTRO_E2E_RELAY: '1' };
	expect(acceptanceEnabled('RELAY', {})).toBe(false);
	expect(acceptanceEnabled('RELAY', { MAESTRO_E2E_REAL: '1' })).toBe(false);
	expect(acceptanceEnabled('RELAY', { MAESTRO_E2E_RELAY: '1' })).toBe(false);
	expect(acceptanceEnabled('RELAY', opted)).toBe(true);
	expect(acceptanceEnabled('RELAY', { ...opted, MAESTRO_E2E_SMOKE: '1' })).toBe(false);
	expect(acceptanceEnabled('RELAY', { ...opted, CI: '1' })).toBe(false);
});

it('caps concurrent team launches across providers while leaving version probes free', async () => {
	const root = createNativeTempDir('maestro-team-budget-');
	roots.push(root);
	const budgetDirectory = path.join(root, 'budget');
	fs.mkdirSync(budgetDirectory);
	const relay = path.resolve('e2e/fixtures/native/real-cli');
	const controls = ['claude', 'codex'].map((provider) => {
		const control = path.join(root, `${provider}.json`);
		fs.writeFileSync(
			control,
			JSON.stringify({
				record: path.join(root, `${provider}.jsonl`),
				maxInvocations: 3,
				budgetDirectory,
			})
		);
		return control;
	});
	const invoke = (control: string, args: string[]) =>
		promisify(execFile)(process.execPath, [relay, ...args], {
			env: {
				...process.env,
				MAESTRO_E2E_CLI: process.execPath,
				MAESTRO_E2E_CONTROL: control,
				MAESTRO_E2E_PROCESS: `${control}.pid`,
			},
			timeout: 10_000,
		});
	await invoke(controls[0], ['--version']);
	expect(fs.readdirSync(budgetDirectory)).toEqual([]);
	const results = await Promise.allSettled(
		Array.from({ length: 12 }, (_, index) =>
			invoke(controls[index % 2], ['-e', "process.stdout.write('paid-launch')"])
		)
	);
	expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
	for (const result of results) {
		if (result.status === 'fulfilled') expect(result.value.stdout).toBe('paid-launch');
		else expect(result.reason.stderr).toContain('Acceptance shared turn budget exceeded');
	}
	expect(fs.readdirSync(budgetDirectory)).toHaveLength(3);
	await invoke(controls[1], ['--version']);
	expect(fs.readdirSync(budgetDirectory)).toHaveLength(3);
});

it('prechecks the Claude child snapshot before starting even the parent version probe', () => {
	const root = createNativeTempDir('maestro-acceptance-precheck-');
	roots.push(root);
	const source = path.join(root, 'source');
	const destination = path.join(root, 'destination');
	fs.mkdirSync(source);
	fs.mkdirSync(destination);
	const auth = JSON.stringify({
		claudeAiOauth: { accessToken: 'expired-access', refreshToken: 'never-copy', expiresAt: 1 },
	});
	fs.writeFileSync(path.join(source, '.credentials.json'), auth);
	fs.writeFileSync(
		path.join(source, 'auth.json'),
		JSON.stringify({ tokens: { access_token: 'test', refresh_token: 'never-copy' } })
	);
	const marker = path.join(root, 'binary-was-invoked');
	const executable = path.join(root, 'cli');
	fs.writeFileSync(
		executable,
		`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected');\n`,
		{ mode: 0o700 }
	);
	const env = {
		CODEX_HOME: source,
		CLAUDE_CONFIG_DIR: source,
		MAESTRO_E2E_CODEX_PATH: executable,
		MAESTRO_E2E_CLAUDE_PATH: executable,
		MAESTRO_E2E_CODEX_MODEL: 'test-codex',
		MAESTRO_E2E_CLAUDE_MODEL: 'test-claude',
	};
	expect(() =>
		prepareAcceptanceProviders(
			['codex', 'claude'],
			{ codex: destination, claude: destination },
			env
		)
	).toThrow(
		'Claude access token has expired. Refresh the login outside acceptance before running again; snapshots cannot refresh.'
	);
	expect(fs.existsSync(marker)).toBe(false);
	expect(fs.readFileSync(path.join(source, '.credentials.json'), 'utf8')).toBe(auth);
	expect(fs.readFileSync(path.join(destination, 'auth.json'), 'utf8')).not.toContain('never-copy');
});

it('does not fall back to real home or keychain when an account source was not selected', () => {
	expect(() => prepareAcceptanceProviders(['claude'], {}, {})).toThrow('Set CLAUDE_CONFIG_DIR');
	expect(() => prepareAcceptanceProviders(['codex'], {}, {})).toThrow('Set CODEX_HOME');
	expect(() => prepareAcceptanceProviders(['deepseek'], {}, {})).toThrow(
		'MAESTRO_E2E_DEEPSEEK_KEY'
	);
});

it('DeepSeek pins the harness without opening a Claude login or returning its supplied key', () => {
	const root = createNativeTempDir('maestro-deepseek-precheck-');
	roots.push(root);
	const env = {
		MAESTRO_E2E_DEEPSEEK_KEY: 'never-return-this-key',
		MAESTRO_E2E_CLAUDE_PATH: path.resolve('e2e/fixtures/native/claude'),
	};
	const homes = { home: root, claude: root, codex: root };
	const result = prepareAcceptanceProviders(['deepseek'], homes, env);
	expect(result.credentials).toEqual({});
	expect(result.tools.deepseek).toEqual({
		executable: env.MAESTRO_E2E_CLAUDE_PATH,
		version: '2.1.310 (Claude Code)',
		model: undefined,
	});
	expect(JSON.stringify(result)).not.toContain(env.MAESTRO_E2E_DEEPSEEK_KEY);
	expect(fs.readdirSync(root)).toEqual([]);
	expect(() =>
		prepareAcceptanceProviders(['deepseek'], homes, {
			...env,
			MAESTRO_E2E_CLAUDE_EXPECT_VERSION: 'unreviewed-version',
		})
	).toThrow('Unsupported claude version');
});

it('reads the keychain only when it is chosen explicitly, and never together with a directory', () => {
	expect(() =>
		prepareAcceptanceProviders(
			['claude'],
			{},
			{
				MAESTRO_E2E_CLAUDE_LOGIN: 'keychain',
				CLAUDE_CONFIG_DIR: '/tmp/claude-login',
			}
		)
	).toThrow('not both');
	expect(() =>
		prepareAcceptanceProviders(['claude'], {}, { MAESTRO_E2E_CLAUDE_LOGIN: 'other' })
	).toThrow('Set CLAUDE_CONFIG_DIR');
});
