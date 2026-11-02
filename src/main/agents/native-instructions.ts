import os from 'node:os';
import path from 'node:path';
import {
	getProviderAccountDirCandidates,
	getAgentAccountDirLayers,
	readStoredSessions,
	type ProviderAccountDirsOptions,
} from './provider-account-dirs';
import { getDeepSeekAccountDirs } from './deepseek-preset';
import { getProviderProfileConfig } from '../../shared/providerProfiles';
import { isBlankEnvValue } from '../../shared/agentEnvironment';
import { expandTilde } from '../../shared/pathUtils';
import type { AboutMeTarget } from '../../shared/aboutMe';
import { nativeAboutMeTarget } from '../about-me-files';

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
	const sessions = options.sessions ?? readStoredSessions();
	const deepseekDirs = new Set(
		(await getDeepSeekAccountDirs(options.userDataDir)).map((dir) => path.resolve(dir))
	);
	for (const provider of ['claude-code', 'codex'] as const) {
		const candidates = await getProviderAccountDirCandidates(provider, {
			homeDir,
			env: options.env,
			sessions,
			agentLevelEnvVars: options.agentLevelEnvVars?.[provider],
		});
		const config = getProviderProfileConfig(provider)!;
		const globalDir = options.globalShellEnvVars[config.envVar];
		if (globalDir && !isBlankEnvValue(globalDir)) candidates.push(globalDir.trim());
		if (provider === 'claude-code') candidates.push(...deepseekDirs);
		const layers = getAgentAccountDirLayers(provider, {
			...options,
			agentLevelEnvVars: options.agentLevelEnvVars?.[provider],
		});
		const consumers = new Map<string, string[]>();
		for (const session of sessions) {
			if (session.toolType !== provider || typeof session.id !== 'string') continue;
			const ssh = session.sessionSshRemoteConfig as { enabled?: boolean } | undefined;
			const target = nativeAboutMeTarget(
				{
					toolType: provider,
					customEnvVars: session.customEnvVars as Record<string, string> | undefined,
					sshRemote: !!ssh?.enabled,
				},
				layers
			);
			if (!target) continue;
			consumers.set(target.path, [...(consumers.get(target.path) ?? []), session.id]);
			candidates.push(path.dirname(target.path));
		}
		const files = new Set(
			candidates.map((dir) =>
				path.join(
					path.resolve(expandTilde(dir, homeDir)),
					provider === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md'
				)
			)
		);
		for (const file of files)
			targets.push({
				path: file,
				provider,
				agentIds: [...new Set(consumers.get(file) ?? [])],
				...(provider === 'claude-code' && deepseekDirs.has(path.dirname(file))
					? { deepseek: true as const }
					: {}),
			});
	}
	return targets;
}
