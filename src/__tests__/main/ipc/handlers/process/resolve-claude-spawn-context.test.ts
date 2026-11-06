import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveClaudeSpawnContext } from '../../../../../main/ipc/handlers/process/resolve-claude-spawn-context';
import { resolveClaudeSpawnMode } from '../../../../../main/agents/resolveClaudeSpawnMode';
import { ensureRemoteMaestroPProbed } from '../../../../../main/agents/probeRemoteMaestroP';
import type { SpawnProcessConfig } from '../../../../../main/ipc/handlers/process/spawn-types';
import type { AgentConfig } from '../../../../../main/agents/definitions';

vi.mock('../../../../../main/agents/resolveClaudeSpawnMode', () => ({
	resolveClaudeSpawnMode: vi.fn(() => ({ mode: 'api', reason: 'auto', maestroPBinPath: null })),
}));
vi.mock('../../../../../main/agents/probeRemoteMaestroP', () => ({
	ensureRemoteMaestroPProbed: vi.fn(),
}));
vi.mock('../../../../../main/stores/claudeUsageStore', () => ({
	resolveConfigDirKey: vi.fn(),
}));
vi.mock('../../../../../main/ipc/handlers/process/claude-transcript-sanitize', () => ({
	sanitizeClaudeTranscriptBeforeApiResume: vi.fn(),
}));

describe('new shell standard approval transport', () => {
	beforeEach(() => vi.clearAllMocks());

	it.each([
		{ newShell: true, permissionMode: 'standard', expected: true },
		{ newShell: false, permissionMode: 'standard', expected: false },
		{ newShell: true, permissionMode: 'full', expected: false },
		{ newShell: true, permissionMode: 'readonly', expected: false },
	] as const)('requires the relay only for new shell standard: %j', async (scenario) => {
		const config: SpawnProcessConfig = {
			sessionId: 'approval-session-ai-tab',
			toolType: 'claude-code',
			command: 'claude',
			cwd: '/tmp/approval-project',
			args: ['--print'],
			permissionMode: scenario.permissionMode,
		};
		await resolveClaudeSpawnContext(
			config,
			{
				id: 'claude-code',
				interactiveCommand: 'maestro-p',
				interactiveModeArgs: [],
			} as unknown as AgentConfig,
			{
				sessionsStore: {
					get: () => [
						{ id: 'approval-session', enableMaestroP: true, maestroPMode: 'interactive' },
					],
				} as never,
				settingsStore: {
					get: (key: string, fallback: unknown) =>
						key === 'newShell' ? scenario.newShell : fallback,
				} as never,
				envLayers: {},
			}
		);
		expect(resolveClaudeSpawnMode).toHaveBeenCalledWith(
			expect.objectContaining({
				tokenMode: 'interactive',
				requirePermissionRelay: scenario.expected,
			})
		);
		expect(ensureRemoteMaestroPProbed).not.toHaveBeenCalled();
	});
});
