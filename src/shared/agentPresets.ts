/**
 * DeepSeek is a Claude Code configuration, not another harness or AgentId.
 * Sources checked 2026-10-31 (native harness tests pin Claude Code 2.1.310):
 * https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/
 * https://api-docs.deepseek.com/guides/anthropic_api/
 */
export const DEEPSEEK_PRESET = {
	id: 'deepseek',
	toolType: 'claude-code',
	name: 'DeepSeek',
	baseUrl: 'https://api.deepseek.com/anthropic',
	defaultModel: 'deepseek-flash[1m]',
	models: ['deepseek-flash[1m]', 'deepseek-flash', 'deepseek-v4-pro'],
} as const;

export interface DeepSeekPresetRequest {
	apiKey: string;
	model?: string;
	customEnvVars?: Record<string, string>;
}

export interface PreparedAgentPreset {
	toolType: 'claude-code';
	customModel: string;
	customEnvVars: Record<string, string>;
}

/** Existing sessions need no migration or extra provider identity field. */
export function isDeepSeekAgent(toolType: string, env?: Record<string, string>): boolean {
	return toolType === 'claude-code' && env?.ANTHROPIC_BASE_URL === DEEPSEEK_PRESET.baseUrl;
}

export function validateDeepSeekPreset(request: DeepSeekPresetRequest): void {
	if (
		typeof request.apiKey !== 'string' ||
		!request.apiKey.trim() ||
		/[\r\n]/.test(request.apiKey.trim())
	) {
		throw new Error('DeepSeek requires an API key from an environment variable or stdin');
	}
	if (
		request.model !== undefined &&
		!(DEEPSEEK_PRESET.models as readonly string[]).includes(request.model)
	) {
		throw new Error('Select a model from the DeepSeek preset catalog');
	}
	// Routing, credentials and account selection belong to the preset. In
	// particular --env must not turn into an argv-based API-key input.
	for (const key of Object.keys(request.customEnvVars ?? {})) {
		if (
			/^ANTHROPIC_/.test(key) ||
			[
				'CLAUDE_CONFIG_DIR',
				'CLAUDE_SECURESTORAGE_CONFIG_DIR',
				'CLAUDE_CODE_OAUTH_TOKEN',
				'CLAUDE_CODE_USE_BEDROCK',
				'CLAUDE_CODE_USE_VERTEX',
				'CLAUDE_CODE_USE_FOUNDRY',
				'CLAUDE_CODE_SUBAGENT_MODEL',
			].includes(key)
		) {
			throw new Error(
				'Preset routing, credentials, models and account directory cannot be overridden with --env'
			);
		}
	}
}
