import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
	DEEPSEEK_PRESET,
	validateDeepSeekPreset,
	type DeepSeekPresetRequest,
	type PreparedAgentPreset,
} from '../../shared/agentPresets';

/** Called only on explicit agent creation, never while opening a preset picker. */
export async function prepareDeepSeekPreset(
	request: DeepSeekPresetRequest,
	userDataDir = app.getPath('userData')
): Promise<PreparedAgentPreset> {
	validateDeepSeekPreset(request);
	const parent = path.join(userDataDir, 'accounts');
	await fs.mkdir(parent, { recursive: true, mode: 0o700 });
	const configDir = await fs.mkdtemp(path.join(parent, 'deepseek-'));
	const model = request.model ?? DEEPSEEK_PRESET.defaultModel;
	return {
		toolType: 'claude-code',
		customModel: model,
		customEnvVars: {
			...request.customEnvVars,
			ANTHROPIC_BASE_URL: DEEPSEEK_PRESET.baseUrl,
			ANTHROPIC_AUTH_TOKEN: request.apiKey.trim(),
			ANTHROPIC_MODEL: model,
			ANTHROPIC_DEFAULT_OPUS_MODEL: model,
			ANTHROPIC_DEFAULT_SONNET_MODEL: model,
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
			CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
			// The existing spawn merge treats blanks as unset, canceling ambient
			// Claude billing credentials and alternate cloud routing. Official env
			// reference: https://code.claude.com/docs/en/env-vars (2026-10-31).
			ANTHROPIC_API_KEY: '',
			ANTHROPIC_CUSTOM_HEADERS: '',
			CLAUDE_CODE_OAUTH_TOKEN: '',
			CLAUDE_CODE_USE_BEDROCK: '',
			CLAUDE_CODE_USE_VERTEX: '',
			CLAUDE_CODE_USE_FOUNDRY: '',
			CLAUDE_CONFIG_DIR: configDir,
		},
	};
}
