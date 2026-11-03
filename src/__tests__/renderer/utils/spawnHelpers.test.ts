import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prepareMaestroSystemPrompt } from '../../../renderer/utils/spawnHelpers';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { nativeAboutMePointer } from '../../../shared/aboutMe';

vi.mock('../../../renderer/utils/templateVariables', () => ({
	substituteTemplateVariables: vi.fn((content: string, vars: Record<string, any>) => {
		let result = content;
		for (const [key, value] of Object.entries(vars)) {
			if (typeof value === 'string') {
				result = result.replace(`{{${key}}}`, value);
			}
		}
		return result;
	}),
}));

vi.mock('../../../renderer/services/git', () => ({
	gitService: {
		getStatus: vi.fn().mockResolvedValue({ branch: 'main' }),
	},
}));

describe('prepareMaestroSystemPrompt', () => {
	const baseSession = {
		id: 'session-1',
		cwd: '/test/project',
		isGitRepo: false,
		groupId: 'group-1',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		(window as any).maestro = {
			...(window as any).maestro,
			prompts: {
				get: vi.fn().mockResolvedValue({
					success: true,
					content: 'System prompt for {{activeTabId}}',
				}),
			},
			history: {
				getFilePath: vi.fn().mockResolvedValue('/mock/history/path.jsonl'),
			},
		};
	});

	it('returns undefined when prompt load fails', async () => {
		(window as any).maestro.prompts.get.mockResolvedValue({
			success: false,
			error: 'not found',
		});
		const result = await prepareMaestroSystemPrompt({ session: baseSession });
		expect(result).toBeUndefined();
	});

	it('returns undefined when prompt content is empty', async () => {
		(window as any).maestro.prompts.get.mockResolvedValue({
			success: true,
			content: '',
		});
		const result = await prepareMaestroSystemPrompt({ session: baseSession });
		expect(result).toBeUndefined();
	});

	it('returns substituted prompt', async () => {
		const result = await prepareMaestroSystemPrompt({
			session: baseSession,
			activeTabId: 'tab-42',
		});
		expect(result).toBeDefined();
		expect(typeof result).toBe('string');
		expect((window as any).maestro.prompts.get).toHaveBeenCalledWith('maestro-system-prompt');
	});

	it('resolves git branch when session is a git repo', async () => {
		const { gitService } = await import('../../../renderer/services/git');
		const result = await prepareMaestroSystemPrompt({
			session: { ...baseSession, isGitRepo: true },
		});
		expect(result).toBeDefined();
		expect(gitService.getStatus).toHaveBeenCalledWith('/test/project');
	});

	it('skips git branch when session is not a git repo', async () => {
		const { gitService } = await import('../../../renderer/services/git');
		await prepareMaestroSystemPrompt({
			session: { ...baseSession, isGitRepo: false },
		});
		expect(gitService.getStatus).not.toHaveBeenCalled();
	});

	it('handles git status errors gracefully', async () => {
		const { gitService } = await import('../../../renderer/services/git');
		vi.mocked(gitService.getStatus).mockRejectedValueOnce(new Error('git failed'));
		const result = await prepareMaestroSystemPrompt({
			session: { ...baseSession, isGitRepo: true },
		});
		expect(result).toBeDefined();
	});

	it('fetches history file path for non-SSH sessions', async () => {
		await prepareMaestroSystemPrompt({ session: baseSession });
		expect((window as any).maestro.history.getFilePath).toHaveBeenCalledWith('session-1');
	});

	it('skips history file path for SSH sessions (sshRemoteId)', async () => {
		await prepareMaestroSystemPrompt({
			session: { ...baseSession, sshRemoteId: 'remote-1' },
		});
		expect((window as any).maestro.history.getFilePath).not.toHaveBeenCalled();
	});

	it('skips history file path for SSH sessions (sessionSshRemoteConfig)', async () => {
		await prepareMaestroSystemPrompt({
			session: { ...baseSession, sessionSshRemoteConfig: { enabled: true } },
		});
		expect((window as any).maestro.history.getFilePath).not.toHaveBeenCalled();
	});

	it('handles history file path errors gracefully', async () => {
		(window as any).maestro.history.getFilePath.mockRejectedValueOnce(new Error('history failed'));
		const result = await prepareMaestroSystemPrompt({ session: baseSession });
		expect(result).toBeDefined();
	});

	it('re-injects prompt on every call (no resume-based skip)', async () => {
		// Regression: prior impl returned undefined when a legacy `agentSessionId`
		// was present. Because Claude Code's --append-system-prompt is NOT persisted
		// into the session transcript, resuming with `--resume` dropped the Maestro
		// prompt from turn 2 onward. The prompt MUST be re-injected on every spawn.
		const first = await prepareMaestroSystemPrompt({ session: baseSession });
		const second = await prepareMaestroSystemPrompt({ session: baseSession });
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect((window as any).maestro.prompts.get).toHaveBeenCalledTimes(2);
	});

	// The profile reaches a provider through its own instruction file once that
	// file is synced; sending it in the system prompt as well repeats it, and for
	// Codex puts it in the first visible user message of the native transcript.
	describe('About Me already in the native instruction file', () => {
		const claudeSession = {
			...baseSession,
			toolType: 'claude-code',
			customEnvVars: { CLAUDE_CONFIG_DIR: '/accounts/work' },
		};
		const nativeAnswer = (loaded: boolean, provider: 'claude-code' | 'codex' = 'claude-code') => ({
			success: true,
			content: 'Real profile',
			estimatedTokens: 3,
			files: [],
			native: { loaded, provider, path: '/accounts/work/CLAUDE.md' },
		});

		beforeEach(() => {
			useSettingsStore.setState({ conductorProfile: 'Real profile' });
			(window as any).maestro.prompts.get.mockResolvedValue({
				success: true,
				content: 'Profile: {{conductorProfile}}',
			});
			(window as any).maestro.settings = {
				...(window as any).maestro.settings,
				aboutMe: vi.fn().mockResolvedValue(nativeAnswer(false)),
			};
		});

		it('names the file instead of repeating the profile when it is loaded there', async () => {
			(window as any).maestro.settings.aboutMe.mockResolvedValue(nativeAnswer(true));
			const result = await prepareMaestroSystemPrompt({ session: claudeSession });
			expect(result).toBe(`Profile: ${nativeAboutMePointer('claude-code')}`);
			expect(result).not.toContain('Real profile');
			expect((window as any).maestro.settings.aboutMe).toHaveBeenCalledWith({
				action: 'native',
				agent: {
					toolType: 'claude-code',
					customEnvVars: { CLAUDE_CONFIG_DIR: '/accounts/work' },
					sshRemote: false,
				},
			});
		});

		it('uses the Codex wording for a Codex agent', async () => {
			(window as any).maestro.settings.aboutMe.mockResolvedValue(nativeAnswer(true, 'codex'));
			const result = await prepareMaestroSystemPrompt({
				session: { ...baseSession, toolType: 'codex' },
			});
			expect(result).toBe(`Profile: ${nativeAboutMePointer('codex')}`);
		});

		it('keeps the profile when the native file does not hold it', async () => {
			const result = await prepareMaestroSystemPrompt({ session: claudeSession });
			expect(result).toBe('Profile: Real profile');
		});

		it('keeps the profile when the check fails', async () => {
			(window as any).maestro.settings.aboutMe.mockRejectedValue(new Error('IPC gone'));
			const result = await prepareMaestroSystemPrompt({ session: claudeSession });
			expect(result).toBe('Profile: Real profile');
		});

		it('does not ask about an SSH agent, whose files live on the remote host', async () => {
			const result = await prepareMaestroSystemPrompt({
				session: { ...claudeSession, sessionSshRemoteConfig: { enabled: true } },
			});
			expect(result).toBe('Profile: Real profile');
			expect((window as any).maestro.settings.aboutMe).not.toHaveBeenCalled();
		});

		it('does not ask when there is no profile', async () => {
			useSettingsStore.setState({ conductorProfile: '' });
			await prepareMaestroSystemPrompt({ session: claudeSession });
			expect((window as any).maestro.settings.aboutMe).not.toHaveBeenCalled();
		});
	});
});
