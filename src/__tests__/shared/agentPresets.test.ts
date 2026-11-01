import { describe, it, expect } from 'vitest';
import { DEEPSEEK_PRESET, agentProviderId, sessionProviderId } from '../../shared/agentPresets';
import { getAgentDisplayName } from '../../shared/agentMetadata';

const deepseekEnv = {
	ANTHROPIC_BASE_URL: DEEPSEEK_PRESET.baseUrl,
	CLAUDE_CONFIG_DIR: '/data/accounts/deepseek-1',
};

describe('provider identity', () => {
	it('names a DeepSeek preset agent as its own provider', () => {
		expect(agentProviderId('claude-code', deepseekEnv)).toBe('deepseek');
		expect(getAgentDisplayName(agentProviderId('claude-code', deepseekEnv))).toBe('DeepSeek');
	});

	it('keeps every other agent on its tool type', () => {
		expect(agentProviderId('claude-code')).toBe('claude-code');
		expect(agentProviderId('claude-code', { ANTHROPIC_BASE_URL: 'https://gateway.example' })).toBe(
			'claude-code'
		);
		// The preset is a Claude Code configuration; the same env on another tool is not DeepSeek.
		expect(agentProviderId('codex', deepseekEnv)).toBe('codex');
	});

	it('reads an agent record', () => {
		expect(sessionProviderId({ toolType: 'claude-code', customEnvVars: deepseekEnv })).toBe(
			'deepseek'
		);
		expect(sessionProviderId({ toolType: 'codex' })).toBe('codex');
	});
});
