'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const versions = { claude: '2.1.310 (Claude Code)', codex: 'codex-cli 0.163.0-alpha.11.1' };

function installedCli(provider, env = process.env, sharedAcceptance = false) {
	const configured = env[`MAESTRO_E2E_${provider.toUpperCase()}_PATH`];
	const executable = configured || execFileSync('which', [provider], { encoding: 'utf8' }).trim();
	const version = execFileSync(executable, ['--version'], { encoding: 'utf8', env }).trim();
	const reviewedShared =
		sharedAcceptance &&
		provider === 'codex' &&
		require('../../../scripts/codex-shared/versions.json').some(
			(entry) => entry.version === version && ['candidate', 'admitted'].includes(entry.state)
		);
	if (version !== versions[provider] && !reviewedShared)
		throw new Error(`Unsupported ${provider} version: ${version}`);
	return { executable: path.resolve(executable), version };
}

function prepareCredentials(provider, destination, env = process.env) {
	if (provider === 'codex') {
		// Source: src/main/agents/codex-auth.ts. Copy only credentials, never the
		// account config, hooks, databases or existing native session directory.
		const source = path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
		fs.writeFileSync(path.join(destination, 'auth.json'), fs.readFileSync(source), { mode: 0o600 });
		return {};
	}
	if (env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_API_KEY) return {};
	// Claude Code 2.1.310 official package: O0()/Kn() use .credentials.json;
	// wbe(dsr) uses the default macOS service "Claude Code-credentials".
	// Take a read-only access-token snapshot. Never write/refresh the source
	// keychain or copy its refresh token into the acceptance environment.
	const source = path.join(
		env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
		'.credentials.json'
	);
	let credentials;
	if (fs.existsSync(source)) credentials = fs.readFileSync(source, 'utf8');
	else if (process.platform === 'darwin' && !env.CLAUDE_CONFIG_DIR) {
		credentials = execFileSync(
			'security',
			['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
		);
	} else
		throw new Error(
			'Claude login is unavailable. Supply CLAUDE_CODE_OAUTH_TOKEN or an authenticated CLAUDE_CONFIG_DIR.'
		);
	const token = JSON.parse(credentials).claudeAiOauth?.accessToken;
	if (!token)
		throw new Error(
			'Claude login has no access token. Refresh the login before running acceptance.'
		);
	return { CLAUDE_CODE_OAUTH_TOKEN: token };
}

module.exports = { installedCli, prepareCredentials };
