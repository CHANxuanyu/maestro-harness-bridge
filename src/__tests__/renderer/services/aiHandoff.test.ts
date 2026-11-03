import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openHandoffTarget, readHandoffSource } from '../../../renderer/services/aiHandoff';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import { enqueuePromptForTab } from '../../../renderer/services/queuedPrompt';
import type { HandoffOpenRequest } from '../../../shared/aiHandoff';

vi.mock('../../../renderer/services/queuedPrompt', () => ({ enqueuePromptForTab: vi.fn() }));

const draft = {
	text: 'Prepared handoff content',
	estimatedTokens: 6,
	budgetTokens: 8000,
	omittedEntries: 0,
	omittedCharacters: 0,
};
const request = (over: Partial<HandoffOpenRequest> = {}): HandoffOpenRequest => ({
	sourceAgentId: 'source',
	runnerId: 'target',
	provider: 'codex',
	projectPath: '/project',
	config: { toolType: 'codex' },
	draft,
	send: false,
	background: true,
	...over,
});
const sessions = () => useSessionStore.getState().sessions;

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(true);
	vi.mocked(enqueuePromptForTab).mockReturnValue({ id: 'queue-item' } as never);
	useSessionStore.setState({
		sessions: [
			createMockSession({
				id: 'source',
				name: 'Claude',
				toolType: 'claude-code',
				projectRoot: '/project',
				activeTabId: 'source-tab',
				aiTabs: [
					createMockAITab({
						id: 'source-tab',
						name: 'Original',
						agentSessionId: 'native-original',
						inputValue: 'Source draft',
						logs: [
							{ id: 'u', timestamp: 1, source: 'user', text: 'Original question' },
							{ id: 'a', timestamp: 2, source: 'stdout', text: 'Original answer' },
						],
					}),
				],
			}),
			createMockSession({
				id: 'target',
				toolType: 'codex',
				projectRoot: '/project',
				activeTabId: 'target-old',
				aiTabs: [
					createMockAITab({
						id: 'target-old',
						agentSessionId: 'target-native',
						inputValue: 'Target draft',
						logs: [{ id: 'old', timestamp: 0, source: 'user', text: 'Target conversation' }],
					}),
				],
			}),
		],
		activeSessionId: 'source',
	});
});

describe('handoff renderer work without UI changes', () => {
	it('extracts exactly the named source without changing drafts, history or selection', async () => {
		const before = JSON.stringify(sessions());
		const snapshot = await readHandoffSource({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			provider: 'claude-code',
		});
		expect(snapshot?.draft.text).toContain('Original question');
		expect(snapshot?.draft.text).toContain('Original answer');
		expect(snapshot?.draft.text).not.toContain('Source draft');
		expect(JSON.stringify(sessions())).toBe(before);
		expect(useSessionStore.getState().activeSessionId).toBe('source');
		expect(window.maestro.sessions.setMany).not.toHaveBeenCalled();
		expect(enqueuePromptForTab).not.toHaveBeenCalled();
	});

	it('does not fall back to another tab when the requested source is gone', async () => {
		expect(
			await readHandoffSource({
				sourceAgentId: 'source',
				sourceTabId: 'gone',
				provider: 'claude-code',
			})
		).toBeNull();
	});

	it('persists a new native-free draft tab in the existing runner without changing either old tab', async () => {
		const sourceBefore = JSON.stringify(sessions()[0]);
		const targetTabBefore = JSON.stringify(sessions()[1].aiTabs[0]);
		const result = await openHandoffTarget(request());
		expect(result).toMatchObject({
			success: true,
			agentId: 'target',
			createdAgent: false,
			state: 'draft',
			draft,
		});
		expect(sessions()).toHaveLength(2);
		const target = sessions().find((item) => item.id === 'target')!;
		expect(target.aiTabs).toHaveLength(2);
		const tab = target.aiTabs.find((item) => item.id === result.tabId)!;
		expect(tab).toMatchObject({
			agentSessionId: null,
			inputValue: draft.text,
			logs: [],
			state: 'idle',
		});
		expect(target.unifiedTabOrder).toContainEqual({ type: 'ai', id: tab.id });
		expect(target.activeTabId).toBe('target-old');
		expect(JSON.stringify(sessions()[0])).toBe(sourceBefore);
		expect(JSON.stringify(target.aiTabs[0])).toBe(targetTabBefore);
		expect(window.maestro.sessions.setMany).toHaveBeenCalled();
		expect(enqueuePromptForTab).not.toHaveBeenCalled();
	});

	it('marks each draft tab with where its draft came from, in an existing or a new runner', async () => {
		const note = {
			sourceAgentId: 'source',
			sourceName: 'Claude',
			sourceProvider: 'claude-code',
			estimatedTokens: draft.estimatedTokens,
			budgetTokens: draft.budgetTokens,
			omittedEntries: draft.omittedEntries,
			omittedCharacters: draft.omittedCharacters,
		};
		const existing = await openHandoffTarget(request());
		const stored = sessions()
			.find((item) => item.id === 'target')!
			.aiTabs.find((tab) => tab.id === existing.tabId)!;
		expect(stored.handoffDraft).toEqual(note);
		// The draft text itself stays only in the composer, never in the note.
		expect(JSON.stringify(stored.handoffDraft)).not.toContain(draft.text);
		// The old tab of the target runner is not a draft.
		expect(sessions().find((item) => item.id === 'target')!.aiTabs[0].handoffDraft).toBeUndefined();

		const created = await openHandoffTarget(
			request({ runnerId: undefined, provider: 'deepseek', config: { toolType: 'claude-code' } })
		);
		expect(created).toMatchObject({ success: true, createdAgent: true });
		const runner = sessions().find((item) => item.id === created.agentId)!;
		expect(runner.aiTabs.find((tab) => tab.id === created.tabId)!.handoffDraft).toEqual(note);
		// The persisted copy is the one that carries the note.
		const saved = vi.mocked(window.maestro.sessions.setMany).mock.calls.at(-1)![0] as Array<{
			aiTabs: Array<{ id: string; handoffDraft?: unknown }>;
		}>;
		expect(saved[0].aiTabs.find((tab) => tab.id === created.tabId)!.handoffDraft).toEqual(note);
	});

	it('only explicit send queues the fresh target tab after its draft is persisted', async () => {
		let persisted = false;
		vi.mocked(window.maestro.sessions.setMany).mockImplementation(async () => {
			persisted = true;
			return true;
		});
		vi.mocked(enqueuePromptForTab).mockImplementation(() => {
			expect(persisted).toBe(true);
			return { id: 'queued' } as never;
		});
		const result = await openHandoffTarget(request({ send: true }));
		expect(result).toMatchObject({ success: true, state: 'queued' });
		expect(enqueuePromptForTab).toHaveBeenCalledExactlyOnceWith({
			sessionId: 'target',
			tabId: result.tabId,
			text: draft.text,
		});
		expect(sessions()[0].aiTabs[0].agentSessionId).toBe('native-original');
	});

	it('reads deferred history without hydrating or modifying the source', async () => {
		const source = sessions()[0];
		useSessionStore.setState({
			sessions: [
				{ ...source, deferredContent: { tabIds: ['source-tab'] } } as typeof source,
				sessions()[1],
			],
		});
		vi.mocked(window.maestro.sessions.getDeferredContent).mockResolvedValue({
			logs: [
				{ id: 'older', timestamp: 0, source: 'user', text: 'Older persisted question' },
				...source.aiTabs[0].logs,
			],
		});
		const before = JSON.stringify(sessions());
		const result = await readHandoffSource({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			provider: 'claude-code',
		});
		expect(result?.draft.text).toContain('Older persisted question');
		expect(result?.draft.text.match(/Original question/g)).toHaveLength(1);
		expect(JSON.stringify(sessions())).toBe(before);
		expect(window.maestro.sessions.setMany).not.toHaveBeenCalled();
	});

	it('returns the saved draft when the send queue refuses it', async () => {
		vi.mocked(enqueuePromptForTab).mockReturnValue(null);
		const result = await openHandoffTarget(request({ send: true }));
		expect(result).toMatchObject({
			success: false,
			code: 'queue-failed',
			agentId: 'target',
			state: 'draft',
			draft,
		});
		expect(sessions()[1].aiTabs.find((tab) => tab.id === result.tabId)?.inputValue).toBe(
			draft.text
		);
	});

	it('does not send or claim success after persistence rejects the new draft', async () => {
		vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(false);
		const result = await openHandoffTarget(request({ send: true }));
		expect(result.success).toBe(false);
		expect(enqueuePromptForTab).not.toHaveBeenCalled();
	});

	it('creates a configured runner once, including when duplicate requests were already in flight', async () => {
		useSessionStore.setState({ sessions: [sessions()[0]] });
		const target = request({
			runnerId: undefined,
			config: {
				toolType: 'codex',
				customPath: '/codex',
				customModel: 'target-model',
				customEnvVars: { CODEX_HOME: '/target-account' },
			},
		});
		const [first, second] = await Promise.all([
			openHandoffTarget(target),
			openHandoffTarget(target),
		]);
		expect(first).toMatchObject({ success: true, createdAgent: true });
		expect(second).toMatchObject({ success: true, createdAgent: false });
		expect(first.agentId).toBe(second.agentId);
		expect(window.maestro.windows.registerSession).toHaveBeenCalledExactlyOnceWith(first.agentId);
		expect(sessions()).toHaveLength(2);
		expect(sessions()[1]).toMatchObject({
			toolType: 'codex',
			projectRoot: '/project',
			customPath: '/codex',
			customModel: 'target-model',
			customEnvVars: { CODEX_HOME: '/target-account' },
			shellLogs: [],
		});
		expect(sessions()[1].aiTabs).toHaveLength(2);
		expect(sessions()[1].aiTabs.every((tab) => tab.agentSessionId === null)).toBe(true);
		expect(enqueuePromptForTab).not.toHaveBeenCalled();
	});
});
