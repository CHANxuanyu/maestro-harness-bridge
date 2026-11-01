import os from 'node:os';
import path from 'node:path';
import {
	getProviderAccountDirCandidates,
	type ProviderAccountDirsOptions,
} from './provider-account-dirs';
import { getDeepSeekAccountDirs } from './deepseek-preset';
import { getProviderProfileConfig } from '../../shared/providerProfiles';
import { isBlankEnvValue } from '../../shared/agentEnvironment';
import { expandTilde } from '../../shared/pathUtils';
import type { AboutMeTarget } from '../../shared/aboutMe';

/**
 * User-level instruction paths, verified 2026-10-31 against official docs:
 * https://code.claude.com/docs/en/memory and /en/env-vars (CLAUDE_CONFIG_DIR)
 * https://developers.openai.com/codex/guides/agents-md (CODEX_HOME).
 * Keep account roots distinct even when their transcript pools are shared.
 */
export async function getNativeInstructionFiles(options: {
	userDataDir: string;
	homeDir?: string;
	env?: NodeJS.ProcessEnv;
	globalShellEnvVars: Record<string, string>;
	sessions?: ProviderAccountDirsOptions['sessions'];
	agentLevelEnvVars?: Record<string, Record<string, string>>;
}): Promise<AboutMeTarget[]> {
	const homeDir = options.homeDir ?? os.homedir();
	const targets: AboutMeTarget[] = [];
	for (const provider of ['claude-code', 'codex'] as const) {
		const candidates = await getProviderAccountDirCandidates(provider, {
			homeDir,
			env: options.env,
			sessions: options.sessions,
			agentLevelEnvVars: options.agentLevelEnvVars?.[provider],
		});
		const config = getProviderProfileConfig(provider)!;
		const globalDir = options.globalShellEnvVars[config.envVar];
		if (globalDir && !isBlankEnvValue(globalDir)) candidates.push(globalDir.trim());
		if (provider === 'claude-code')
			candidates.push(...(await getDeepSeekAccountDirs(options.userDataDir)));
		const files = new Set(
			candidates.map((dir) =>
				path.join(
					path.resolve(expandTilde(dir, homeDir)),
					provider === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md'
				)
			)
		);
		for (const file of files) targets.push({ path: file, provider });
	}
	return targets;
}
