import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({
	app: {
		getPath: () => {
			throw new Error('Inject a temporary directory');
		},
	},
}));
import { prepareDeepSeekPreset } from '../../../main/agents/deepseek-preset';
import { DEEPSEEK_PRESET, isDeepSeekAgent } from '../../../shared/agentPresets';
import { isSecretEnvKey, maskEnvValue, stripBlankEnvVars } from '../../../shared/agentEnvironment';

describe('DeepSeek preset contract', () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	});
	it.each(DEEPSEEK_PRESET.models)(
		'maps %s without retaining ambient Claude credentials or models',
		async (model) => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-preset-'));
			roots.push(root);
			const preset = await prepareDeepSeekPreset(
				{ apiKey: 'synthetic-secret', model, customEnvVars: { EXTRA: 'kept' } },
				root
			);
			const effective = stripBlankEnvVars({
				ANTHROPIC_API_KEY: 'ambient-key',
				CLAUDE_CODE_OAUTH_TOKEN: 'ambient-token',
				CLAUDE_CODE_USE_BEDROCK: '1',
				...preset.customEnvVars,
			});
			expect(effective.ANTHROPIC_API_KEY).toBeUndefined();
			expect(effective.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
			expect(effective.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
			expect(effective.EXTRA).toBe('kept');
			expect(effective.ANTHROPIC_MODEL).toBe(model);
			for (const [key, value] of Object.entries(effective))
				if (key.endsWith('_MODEL')) expect(value).toMatch(/^deepseek-/);
			expect(isDeepSeekAgent(preset.toolType, effective)).toBe(true);
			expect(isDeepSeekAgent('claude-code', {})).toBe(false);
			expect(isDeepSeekAgent('codex', effective)).toBe(false);
			expect(isSecretEnvKey('ANTHROPIC_AUTH_TOKEN')).toBe(true);
			expect(maskEnvValue(effective.ANTHROPIC_AUTH_TOKEN)).not.toContain('synthetic-secret');
		}
	);
});
