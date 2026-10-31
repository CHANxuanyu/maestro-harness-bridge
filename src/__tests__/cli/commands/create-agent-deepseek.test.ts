import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../cli/services/maestro-client', () => ({ withMaestroClient: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:fs')>()),
	readFileSync: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import { createAgent } from '../../../cli/commands/create-agent';
import { withMaestroClient } from '../../../cli/services/maestro-client';

describe('DeepSeek creation credentials', () => {
	const send = vi.fn();
	const output = vi.fn();
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'log').mockImplementation(output);
		vi.spyOn(console, 'error').mockImplementation(output);
		vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		vi.stubEnv('DEEPSEEK_TEST_KEY', 'synthetic-secret-value');
		send.mockResolvedValue({ success: true, sessionId: 'created' });
		vi.mocked(withMaestroClient).mockImplementation((run) => run({ sendCommand: send } as never));
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	const options = (extra: Record<string, unknown>) =>
		({
			cwd: '/project',
			type: 'claude-code',
			preset: 'deepseek',
			json: true,
			...extra,
		}) as Parameters<typeof createAgent>[1];

	it('reads the key by environment name and never echoes it', async () => {
		await createAgent('DeepSeek', options({ apiKeyEnv: 'DEEPSEEK_TEST_KEY' }));
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'create_preset_session',
				preset: 'deepseek',
				presetApiKey: 'synthetic-secret-value',
				toolType: 'claude-code',
			}),
			'create_session_result'
		);
		expect(JSON.stringify(output.mock.calls)).not.toContain('synthetic-secret-value');
	});

	it('reads a key from stdin without accepting a key value flag', async () => {
		vi.mocked(readFileSync).mockReturnValue('synthetic-stdin-key\n');
		await createAgent('DeepSeek', options({ apiKeyStdin: true }));
		expect(readFileSync).toHaveBeenCalledWith(0, 'utf8');
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({ presetApiKey: 'synthetic-stdin-key' }),
			'create_session_result'
		);
		expect(JSON.stringify(output.mock.calls)).not.toContain('synthetic-stdin-key');
	});

	it.each([
		{},
		{ apiKeyEnv: 'MISSING_DEEPSEEK_TEST_KEY' },
		{ apiKeyEnv: 'DEEPSEEK_TEST_KEY', apiKeyStdin: true },
		{ apiKeyEnv: 'DEEPSEEK_TEST_KEY', type: 'codex' },
		{ apiKeyEnv: 'DEEPSEEK_TEST_KEY', env: ['ANTHROPIC_AUTH_TOKEN=argv-secret'] },
		{ apiKeyEnv: 'DEEPSEEK_TEST_KEY', env: ['ANTHROPIC_AUTH_TOKEN argv-secret'] },
	])('rejects invalid credential selection before contacting the app: %j', async (extra) => {
		await createAgent('DeepSeek', options(extra));
		expect(send).not.toHaveBeenCalled();
		expect(process.exit).toHaveBeenCalledWith(1);
		expect(JSON.stringify(output.mock.calls)).not.toContain('argv-secret');
	});
});
