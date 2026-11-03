import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareMaestroSystemPromptCli } from '../../../cli/services/system-prompt';
import { nativeAboutMePointer, type AboutMeApplied } from '../../../shared/aboutMe';
import { isolateAgentEnv } from '../../helpers/agentEnvIsolation';
import type { SessionInfo } from '../../../shared/types';

vi.mock('../../../cli/services/prompt-loader', () => ({
	getCliPrompt: async () => 'Profile: {{CONDUCTOR_PROFILE}}\nAuthority is unchanged.',
}));
vi.mock('../../../cli/services/git-utils', () => ({ isGitRepo: () => false }));

let root: string;
let account: string;
let settings: Record<string, unknown>;
const content = 'Synthetic conductor preference: explain assumptions.';
const block = `<!-- maestro:about-me:start -->\n${content}\n<!-- maestro:about-me:end -->`;
const saveSettings = () =>
	fs.writeFile(path.join(root, 'maestro-settings.json'), JSON.stringify(settings));
const session = (toolType: 'claude-code' | 'codex'): SessionInfo => ({
	id: 'synthetic-agent',
	name: 'Synthetic',
	toolType,
	cwd: root,
});

describe('standalone CLI native About Me prompt', () => {
	isolateAgentEnv(['CLAUDE_CONFIG_DIR', 'CODEX_HOME']);
	beforeEach(async () => {
		root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'maestro-cli-profile-')));
		account = path.join(root, 'account');
		await fs.mkdir(account);
		vi.stubEnv('MAESTRO_USER_DATA', root);
		vi.spyOn(os, 'homedir').mockReturnValue(root);
		settings = {
			conductorProfile: content,
			shellEnvVars: { CLAUDE_CONFIG_DIR: account, CODEX_HOME: account },
		};
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await fs.rm(root, { recursive: true, force: true });
	});

	it.each(['claude-code', 'codex'] as const)(
		'uses the shared %s pointer only for a current owned native block without a desktop connection',
		async (provider) => {
			const file = path.join(account, provider === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md');
			await fs.writeFile(file, block);
			settings.aboutMeApplied = {
				[file]: { provider, resolvedPath: file, block } satisfies AboutMeApplied,
			};
			await saveSettings();
			const prompt = await prepareMaestroSystemPromptCli(session(provider));
			expect(prompt).toContain(nativeAboutMePointer(provider));
			expect(prompt).not.toContain(content);
			expect(prompt).toContain('Authority is unchanged.');
			await fs.writeFile(file, block.replace(content, 'Edited externally'));
			expect(await prepareMaestroSystemPromptCli(session(provider))).toContain(content);
			await fs.writeFile(file, block);
			settings.aboutMeApplied = {};
			await saveSettings();
			expect(await prepareMaestroSystemPromptCli(session(provider))).toContain(content);
		}
	);

	it('honors provider env replacement, live own env, SSH and Codex overrides', async () => {
		const file = path.join(account, 'AGENTS.md');
		await fs.writeFile(file, block);
		settings.aboutMeApplied = { [file]: { provider: 'codex', resolvedPath: file, block } };
		settings.shellEnvVars = { CODEX_HOME: path.join(root, 'unsynced') };
		await saveSettings();
		await fs.writeFile(
			path.join(root, 'maestro-agent-configs.json'),
			JSON.stringify({ configs: { codex: { customEnvVars: { CODEX_HOME: account } } } })
		);
		expect(await prepareMaestroSystemPromptCli(session('codex'))).toContain(
			nativeAboutMePointer('codex')
		);
		expect(
			await prepareMaestroSystemPromptCli({ ...session('codex'), customEnvVars: {} })
		).toContain(content);
		const local = { ...session('codex'), customEnvVars: { CODEX_HOME: account } };
		expect(await prepareMaestroSystemPromptCli(local)).not.toContain(content);
		expect(
			await prepareMaestroSystemPromptCli({
				...local,
				sessionSshRemoteConfig: { enabled: true, remoteId: 'synthetic-remote' },
			})
		).toContain(content);
		await fs.writeFile(path.join(account, 'AGENTS.override.md'), 'Override');
		expect(await prepareMaestroSystemPromptCli(local)).toContain(content);
		await fs.unlink(path.join(account, 'AGENTS.override.md'));
		settings.conductorProfile = 'A pending profile';
		await saveSettings();
		expect(await prepareMaestroSystemPromptCli(local)).toContain('A pending profile');
	});
});
