import os from 'node:os';
import type { AgentAccountDirLayers } from '../../shared/agentAccountDir';
import { readAgentConfig, readSettingValue } from './storage';

/** The CLI reads its own stores; account precedence stays in the shared resolver. */
export function readCliAccountDirLayers(toolType: string): AgentAccountDirLayers {
	return {
		agentLevelEnvVars: readAgentConfig(toolType).customEnvVars as
			| Record<string, string>
			| undefined,
		globalShellEnvVars: readSettingValue('shellEnvVars') as Record<string, string> | undefined,
		env: process.env,
		homeDir: os.homedir(),
	};
}
