import { describe, it, expect, vi } from 'vitest';
import {
	discoverProjectHistory,
	type ProjectHistoryDependencies,
} from '../../../main/storage/project-history';
import type { AgentSessionInfo, AgentSessionStorage } from '../../../main/agents/session-storage';
import type { ProjectHistoryScope } from '../../../shared/projectHistory';
import type { SshRemoteConfig } from '../../../shared/types';

const scope: ProjectHistoryScope = {
	projectKey: 'group:maestro',
	projectPath: '/repo',
	ownerIds: ['runner'],
};
function native(overrides: Partial<AgentSessionInfo> = {}): AgentSessionInfo {
	return {
		sessionId: 'native-1',
		projectPath: '/repo',
		timestamp: '2026-10-15T10:00:00Z',
		modifiedAt: '2026-10-16T10:00:00Z',
		firstMessage: 'Assistant response',
		firstUserMessage: 'Fix the sidebar',
		messageCount: 2,
		sizeBytes: 200,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		durationSeconds: 1,
		...overrides,
	};
}
function adapter(
	provider: string,
	list = vi.fn().mockResolvedValue([native()])
): AgentSessionStorage {
	return { agentId: provider, listSessions: list } as unknown as AgentSessionStorage;
}
function dependencies(
	overrides: Partial<ProjectHistoryDependencies> = {}
): ProjectHistoryDependencies {
	return {
		storages: [adapter('codex'), adapter('claude-code')],
		owners: [{ id: 'runner', toolType: 'codex', cwd: '/repo' }],
		accountDirs: async (provider) => [`/accounts/${provider}`],
		ownerAccountDir: () => '/accounts/codex',
		remote: () => undefined,
		realpath: async (directory) => directory,
		onError: vi.fn(),
		...overrides,
	};
}

describe('project native history discovery', () => {
	it('lists every native harness under a project without requiring a matching runner', async () => {
		const result = await discoverProjectHistory([scope], dependencies());
		expect(result.conversations).toHaveLength(2);
		expect(result.conversations.find((r) => r.provider === 'codex')?.ownerId).toBe('runner');
		expect(result.conversations.find((r) => r.provider === 'claude-code')).toMatchObject({
			ownerId: undefined,
			accountDir: '/accounts/claude-code',
			accountEnvVar: 'CLAUDE_CONFIG_DIR',
			title: 'Fix the sidebar',
		});
	});
	it('keeps identical IDs in different account pools distinct and selects only a compatible owner', async () => {
		const result = await discoverProjectHistory(
			[scope],
			dependencies({
				storages: [adapter('codex')],
				accountDirs: async () => ['/work', '/personal'],
				ownerAccountDir: () => '/personal',
			})
		);
		expect(result.conversations).toHaveLength(2);
		expect(new Set(result.conversations.map((r) => r.key)).size).toBe(2);
		expect(result.conversations.find((r) => r.accountDir === '/personal')?.ownerId).toBe('runner');
		expect(result.conversations.find((r) => r.accountDir === '/work')?.ownerId).toBeUndefined();
	});
	it('deduplicates aliased pools and duplicate scopes without rereading or copying history', async () => {
		const list = vi.fn().mockResolvedValue([native()]);
		const result = await discoverProjectHistory(
			[scope, scope],
			dependencies({
				storages: [adapter('codex', list)],
				accountDirs: async () => ['/account', '/alias'],
				realpath: async () => '/same/pool',
			})
		);
		expect(result.conversations).toHaveLength(1);
		expect(list).toHaveBeenCalledTimes(1);
	});
	it('assigns a descendant session to its most specific project and uses the original working path', async () => {
		const list = vi.fn().mockResolvedValue([native({ projectPath: '/repo/sub' })]);
		const result = await discoverProjectHistory(
			[scope, { ...scope, projectKey: 'sub', projectPath: '/repo/sub', ownerIds: [] }],
			dependencies({ storages: [adapter('codex', list)] })
		);
		expect(result.conversations).toHaveLength(1);
		expect(result.conversations[0]).toMatchObject({
			projectKey: 'sub',
			projectPath: '/repo/sub',
			ownerId: undefined,
		});
	});
	it('excludes empty and automatic transcripts and preserves renamed native titles', async () => {
		const list = vi
			.fn()
			.mockResolvedValue([
				native({ sessionId: 'empty', messageCount: 0 }),
				native({ sessionId: 'guardian', origin: 'auto' }),
				native({ sessionName: 'Native title' }),
			]);
		const result = await discoverProjectHistory(
			[scope],
			dependencies({ storages: [adapter('codex', list)] })
		);
		expect(result.conversations).toHaveLength(1);
		expect(result.conversations[0].title).toBe('Native title');
	});
	it('retains the native title alias when an open tab has a local custom name', async () => {
		const result = await discoverProjectHistory(
			[scope],
			dependencies({
				storages: [
					adapter(
						'codex',
						vi
							.fn()
							.mockResolvedValue([
								native({ sessionName: 'Native Codex title', nativeTitle: 'Native Codex title' }),
							])
					),
				],
				owners: [
					{
						id: 'runner',
						toolType: 'codex',
						cwd: '/repo',
						aiTabs: [{ agentSessionId: 'native-1', name: 'My custom tab' }],
					},
				],
			})
		);
		expect(result.conversations[0]).toMatchObject({
			title: 'My custom tab',
			nativeTitle: 'Native Codex title',
			nativeSessionId: 'native-1',
		});
	});
	it('keeps provider title separate from an adapter display-name override', async () => {
		const result = await discoverProjectHistory(
			[scope],
			dependencies({
				storages: [
					adapter(
						'claude-code',
						vi
							.fn()
							.mockResolvedValue([
								native({ sessionName: 'Maestro override', nativeTitle: 'Claude original' }),
							])
					),
				],
			})
		);
		expect(result.conversations[0]).toMatchObject({
			title: 'Maestro override',
			nativeTitle: 'Claude original',
		});
	});
	it('keeps usable providers when another pool fails, and returns a retryable error', async () => {
		const deps = dependencies({
			storages: [
				adapter('codex', vi.fn().mockRejectedValue(new Error('Unreadable'))),
				adapter('claude-code'),
			],
		});
		const result = await discoverProjectHistory([scope], deps);
		expect(result.conversations.map((r) => r.provider)).toEqual(['claude-code']);
		expect(result.errors).toEqual([
			{ projectKey: scope.projectKey, provider: 'codex', message: 'Unreadable' },
		]);
		expect(deps.onError).toHaveBeenCalledOnce();
	});
	it('never falls back to local sessions for an unavailable remote', async () => {
		const list = vi.fn();
		const result = await discoverProjectHistory(
			[{ ...scope, sshRemoteId: 'gone' }],
			dependencies({ storages: [adapter('codex', list)] })
		);
		expect(list).not.toHaveBeenCalled();
		expect(result.conversations).toHaveLength(0);
		expect(result.errors).toHaveLength(1);
	});
	it('does not scan local accounts when browsing an SSH project', async () => {
		const list = vi.fn().mockResolvedValue([native()]);
		const accountDirs = vi.fn();
		const remote = { id: 'host', enabled: true } as SshRemoteConfig;
		const result = await discoverProjectHistory(
			[{ ...scope, sshRemoteId: 'host', ownerIds: [] }],
			dependencies({ storages: [adapter('codex', list)], accountDirs, remote: () => remote })
		);
		expect(accountDirs).not.toHaveBeenCalled();
		expect(list).toHaveBeenCalledWith('/repo', remote, undefined);
		expect(result.conversations[0].sshRemoteId).toBe('host');
	});
	it('hides only an exact internal utility prompt, keeping ordinary requests about naming', async () => {
		const prefix =
			'Generate a 2-4 word tab name for this coding task. Output ONLY the name, nothing else.';
		const list = vi
			.fn()
			.mockResolvedValue([
				native({ sessionId: 'utility', firstUserMessage: prefix + '\nRules:' }),
				native({ sessionId: 'real', firstUserMessage: 'Please fix the tab naming feature' }),
			]);
		const result = await discoverProjectHistory(
			[scope],
			dependencies({ storages: [adapter('codex', list)], internalPromptPrefixes: [prefix] })
		);
		expect(result.conversations.map((row) => row.nativeSessionId)).toEqual(['real']);
	});

	it('rejects malformed scopes before scanning', async () => {
		const list = vi.fn();
		await expect(
			discoverProjectHistory(
				[{ ...scope, projectPath: '' }],
				dependencies({ storages: [adapter('codex', list)] })
			)
		).rejects.toThrow('Invalid project history scope');
		expect(list).not.toHaveBeenCalled();
	});
});
