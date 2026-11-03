import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentModelEffortOptions } from '../../../../renderer/hooks/agent/useAgentModelEffortOptions';
import { DEEPSEEK_PRESET } from '../../../../shared/agentPresets';

const agents = {
	getModels: vi.fn(),
	getConfigOptions: vi.fn(),
	getConfig: vi.fn(),
};

beforeEach(() => {
	vi.clearAllMocks();
	agents.getModels.mockResolvedValue(['opus', 'sonnet', 'haiku']);
	agents.getConfigOptions.mockImplementation(async (_id: string, key: string) =>
		key === 'effort' ? ['low', 'medium', 'high'] : []
	);
	agents.getConfig.mockResolvedValue({ model: 'opus', effort: 'high' });
	(window as any).maestro = { ...((window as any).maestro || {}), agents };
});

describe('useAgentModelEffortOptions', () => {
	it('offers a DeepSeek preset only its own catalog, never Claude models', async () => {
		const { result } = renderHook(() =>
			useAgentModelEffortOptions('claude-code', {
				ANTHROPIC_BASE_URL: DEEPSEEK_PRESET.baseUrl,
				CLAUDE_CONFIG_DIR: '/data/accounts/deepseek-1',
			})
		);
		await waitFor(() => expect(result.current.loaded).toBe(true));
		expect(result.current.models).toEqual([...DEEPSEEK_PRESET.models]);
		expect(result.current.defaultModel).toBe(DEEPSEEK_PRESET.defaultModel);
		// The preset documents no effort levels; Claude's would reach DeepSeek's gateway.
		expect(result.current.efforts).toEqual([]);
		expect(result.current.defaultEffort).toBe('');
		expect(agents.getModels).not.toHaveBeenCalled();
		expect(agents.getConfig).not.toHaveBeenCalled();
	});

	it('keeps asking the agent for a plain Claude Code agent', async () => {
		const { result } = renderHook(() => useAgentModelEffortOptions('claude-code'));
		await waitFor(() => expect(result.current.loaded).toBe(true));
		expect(result.current.models).toEqual(['opus', 'sonnet', 'haiku']);
		expect(result.current.efforts).toEqual(['low', 'medium', 'high']);
		expect(result.current.defaultModel).toBe('opus');
	});
});
