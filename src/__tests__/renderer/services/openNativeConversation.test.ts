import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	openNativeConversation,
	resetNativeConversationOpens,
	noteDirectSelection,
	type ResumeNativeSession,
} from '../../../renderer/services/openNativeConversation';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import type { ProjectHistoryConversation } from '../../../shared/projectHistory';
import type { Session } from '../../../renderer/types';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';

function record(overrides: Partial<ProjectHistoryConversation> = {}): ProjectHistoryConversation {
	return {
		key: 'codex:host:/acct:native-1',
		projectKey: 'group:g1',
		projectPath: '/projects/app',
		provider: 'codex',
		nativeSessionId: 'native-1',
		title: 'Refactor parser',
		preview: '',
		createdAt: 1,
		modifiedAt: 2,
		messageCount: 3,
		starred: false,
		...overrides,
	};
}

/** Stands in for the canonical resume: fills (or adds) the tab like the real one. */
function fakeResume(ok = true): ResumeNativeSession {
	return vi.fn(async (nativeId, _messages, _name, _starred, _usage, _path, opts) => {
		if (!ok) return false;
		useSessionStore.getState().setSessions((prev) =>
			prev.map((s) => {
				if (s.id !== opts?.targetSessionId) return s;
				const existing = s.aiTabs.find((tab) => tab.agentSessionId === nativeId);
				const log = { id: 'l', timestamp: 1, source: 'user' as const, text: 'hi' };
				if (existing) {
					return {
						...s,
						activeTabId: existing.id,
						aiTabs: s.aiTabs.map((tab) => (tab === existing ? { ...tab, logs: [log] } : tab)),
					};
				}
				const tab = createMockAITab({
					id: `tab-${nativeId}`,
					agentSessionId: nativeId,
					logs: [log],
				});
				return { ...s, activeTabId: tab.id, aiTabs: [...s.aiTabs, tab] };
			})
		);
		return true;
	}) as unknown as ResumeNativeSession;
}

function sessions(): Session[] {
	return useSessionStore.getState().sessions;
}

beforeEach(() => {
	resetNativeConversationOpens();
	useSessionStore.setState({ sessions: [], activeSessionId: '' } as never);
});

describe('openNativeConversation', () => {
	it('focuses a tab already open on that native id in another compatible runner', async () => {
		const runner = createMockSession({
			id: 'runner-b',
			toolType: 'codex',
			projectRoot: '/elsewhere',
			aiTabs: [createMockAITab({ id: 'open', agentSessionId: 'native-1' })],
		});
		useSessionStore.setState({ sessions: [runner] } as never);
		const resume = fakeResume();

		const result = await openNativeConversation(record(), 'Refactor parser', resume);

		expect(result).toEqual({ status: 'opened', ownerId: 'runner-b' });
		expect(sessions()).toHaveLength(1);
		expect(vi.mocked(resume).mock.calls[0][6]).toMatchObject({ targetSessionId: 'runner-b' });
		expect(useSessionStore.getState().activeSessionId).toBe('runner-b');
	});

	it('creates exactly one runner for a history with no owner, preserving account and host, with no extra tab', async () => {
		const resume = fakeResume();
		const result = await openNativeConversation(
			record({ accountEnvVar: 'CODEX_HOME', accountDir: '/acct', sshRemoteId: 'host' }),
			'Refactor parser',
			resume
		);

		expect(result.status).toBe('opened');
		const [created] = sessions();
		expect(created).toMatchObject({
			toolType: 'codex',
			projectRoot: '/projects/app',
			groupId: 'g1',
			customEnvVars: { CODEX_HOME: '/acct' },
			sessionSshRemoteConfig: { enabled: true, remoteId: 'host' },
		});
		// The initial tab was bound to the native id and filled; no blank tab beside it.
		expect(created.aiTabs).toHaveLength(1);
		expect(created.aiTabs[0].agentSessionId).toBe('native-1');
		expect(created.aiTabs[0].logs).toHaveLength(1);
		// No model, effort or permission override is invented.
		expect(created.customModel).toBeUndefined();
		expect(created.customEffort).toBeUndefined();
		expect(useSessionStore.getState().activeSessionId).toBe(created.id);

		// The read is pinned to the exact pool the row came from.
		expect(vi.mocked(resume).mock.calls[0][6]).toMatchObject({
			targetSessionId: created.id,
			configDir: '/acct',
		});

		// A second click (main now names the new runner) focuses the same
		// conversation instead of duplicating it.
		await openNativeConversation(
			record({
				ownerId: created.id,
				accountEnvVar: 'CODEX_HOME',
				accountDir: '/acct',
				sshRemoteId: 'host',
			}),
			'Refactor parser',
			resume
		);
		expect(sessions()).toHaveLength(1);
		expect(sessions()[0].aiTabs).toHaveLength(1);
	});

	it('keeps provider-level env vars on a runner it creates, since agent env replaces them', async () => {
		const getConfig = vi
			.fn()
			.mockResolvedValue({ customEnvVars: { OPENAI_BASE_URL: 'https://gw' } });
		const previous = (window.maestro as any).agents;
		(window.maestro as any).agents = { ...previous, getConfig };
		try {
			await openNativeConversation(
				record({ accountEnvVar: 'CODEX_HOME', accountDir: '/acct' }),
				'',
				fakeResume()
			);
			expect(sessions()[0].customEnvVars).toEqual({
				OPENAI_BASE_URL: 'https://gw',
				CODEX_HOME: '/acct',
			});
		} finally {
			(window.maestro as any).agents = previous;
		}
	});

	it('reuses the default-account runner main named, even though it sets no env var', async () => {
		const runner = createMockSession({
			id: 'default-runner',
			toolType: 'codex',
			projectRoot: '/projects/app',
			customEnvVars: undefined,
		});
		useSessionStore.setState({ sessions: [runner] } as never);
		const resume = fakeResume();
		const result = await openNativeConversation(
			record({
				ownerId: 'default-runner',
				accountEnvVar: 'CODEX_HOME',
				accountDir: '/home/u/.codex',
			}),
			'',
			resume
		);
		expect(result).toEqual({ status: 'opened', ownerId: 'default-runner' });
		expect(sessions()).toHaveLength(1);
		expect(vi.mocked(resume).mock.calls[0][6]).toMatchObject({
			targetSessionId: 'default-runner',
			configDir: '/home/u/.codex',
		});
	});

	it('does not focus a tab on the same native id in ANOTHER account pool', async () => {
		const otherPool = createMockSession({
			id: 'other-pool',
			toolType: 'codex',
			projectRoot: '/projects/app',
			customEnvVars: { CODEX_HOME: '/work' },
			aiTabs: [createMockAITab({ id: 'work-tab', agentSessionId: 'native-1', logs: [] })],
		});
		const mine = createMockSession({ id: 'mine', toolType: 'codex', projectRoot: '/projects/app' });
		useSessionStore.setState({ sessions: [otherPool, mine] } as never);
		const resume = fakeResume();
		const result = await openNativeConversation(
			record({ ownerId: 'mine', accountEnvVar: 'CODEX_HOME', accountDir: '/home/u/.codex' }),
			'',
			resume
		);
		expect(result).toEqual({ status: 'opened', ownerId: 'mine' });
		expect(sessions().find((s) => s.id === 'other-pool')?.aiTabs[0].logs).toEqual([]);
	});

	it('does not reuse a runner signed into a different account', async () => {
		const other = createMockSession({
			id: 'other-account',
			toolType: 'codex',
			projectRoot: '/projects/app',
			customEnvVars: { CODEX_HOME: '/someone-else' },
		});
		useSessionStore.setState({ sessions: [other] } as never);
		await openNativeConversation(
			record({ ownerId: 'other-account', accountEnvVar: 'CODEX_HOME', accountDir: '/acct' }),
			'',
			fakeResume()
		);
		expect(sessions()).toHaveLength(2);
		expect(sessions()[1].customEnvVars).toMatchObject({ CODEX_HOME: '/acct' });
	});

	it('removes a runner it created when the transcript cannot be opened, and starts nothing new', async () => {
		const resume = fakeResume(false);
		const result = await openNativeConversation(record(), 'Refactor parser', resume);
		expect(result).toEqual({ status: 'failed' });
		expect(sessions()).toEqual([]);
		expect(useSessionStore.getState().activeSessionId).toBe('');
	});

	it('leaves an existing owner untouched when its open fails', async () => {
		const owner = createMockSession({
			id: 'owner',
			toolType: 'codex',
			projectRoot: '/projects/app',
		});
		useSessionStore.setState({ sessions: [owner] } as never);
		const result = await openNativeConversation(
			record({ ownerId: 'owner' }),
			'',
			fakeResume(false)
		);
		expect(result.status).toBe('failed');
		expect(sessions()).toEqual([owner]);
	});

	it('gives focus to the newest click when an older open finishes last', async () => {
		const a = createMockSession({ id: 'a', toolType: 'codex', projectRoot: '/projects/app' });
		const b = createMockSession({ id: 'b', toolType: 'claude-code', projectRoot: '/projects/app' });
		useSessionStore.setState({ sessions: [a, b], activeSessionId: '' } as never);
		let releaseA!: () => void;
		const inner = fakeResume();
		const resume = vi.fn(async (...args: Parameters<ResumeNativeSession>) => {
			if (args[0] === 'native-a') await new Promise<void>((resolve) => (releaseA = resolve));
			return inner(...args);
		}) as unknown as ResumeNativeSession;

		const first = openNativeConversation(
			record({ nativeSessionId: 'native-a', ownerId: 'a' }),
			'',
			resume
		);
		// A's transcript read is in flight when the user clicks B.
		await vi.waitFor(() => expect(releaseA).toBeTypeOf('function'));
		const second = openNativeConversation(
			record({ nativeSessionId: 'native-b', provider: 'claude-code', ownerId: 'b' }),
			'',
			resume
		);
		releaseA();

		expect(await first).toEqual({ status: 'superseded' });
		expect(await second).toEqual({ status: 'opened', ownerId: 'b' });
		expect(useSessionStore.getState().activeSessionId).toBe('b');
	});

	it('puts the user back on a tab they picked directly while an open of the same runner loaded', async () => {
		const owner = createMockSession({
			id: 'owner',
			toolType: 'codex',
			projectRoot: '/projects/app',
			activeTabId: 'mine',
			aiTabs: [createMockAITab({ id: 'mine' })],
		});
		useSessionStore.setState({ sessions: [owner], activeSessionId: 'owner' } as never);
		let release!: () => void;
		const inner = fakeResume();
		const resume = vi.fn(async (...args: Parameters<ResumeNativeSession>) => {
			await new Promise<void>((resolve) => (release = resolve));
			return inner(...args);
		}) as unknown as ResumeNativeSession;

		const pending = openNativeConversation(record({ ownerId: 'owner' }), '', resume);
		await vi.waitFor(() => expect(release).toBeTypeOf('function'));
		noteDirectSelection('owner', 'mine');
		release();

		expect(await pending).toEqual({ status: 'superseded' });
		expect(sessions()[0].activeTabId).toBe('mine');
	});
});
