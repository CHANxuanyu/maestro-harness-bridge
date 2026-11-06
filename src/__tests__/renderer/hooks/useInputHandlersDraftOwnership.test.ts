/**
 * Draft ownership: text typed in the composer belongs to exactly one AI tab,
 * and it may never be written to a different one.
 *
 * The composer is a single global slot shared by every tab, so attribution has
 * to be tracked explicitly. It used to be inferred from "whichever tab is
 * active right now", which is a different question, and the two answers come
 * apart in two states where the composer is still on screen and typeable:
 *
 *  1. The active agent has no AI tab at all (every AI tab closed with a file
 *     tab still open).
 *  2. `activeSessionId` names an agent whose session object has not landed in
 *     the store yet, so `selectActiveSession` falls back to `sessions[0]`.
 *
 * In both, the inferred answer was the last AI tab of the PREVIOUS agent, and
 * text typed into the composer was flushed onto that stranger's tab (and lost
 * from the composer). These tests pin both windows shut, and pin the recovery:
 * text typed with nowhere to put it is adopted by the tab that materializes,
 * not discarded.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import type { Session, BatchRunState } from '../../../renderer/types';
import { createMockSession as baseCreateMockSession } from '../../helpers/mockSession';

const mockInputContext = {
	slashCommandOpen: false,
	setSlashCommandOpen: vi.fn(),
	selectedSlashCommandIndex: 0,
	setSelectedSlashCommandIndex: vi.fn(),
	tabCompletionOpen: false,
	setTabCompletionOpen: vi.fn(),
	selectedTabCompletionIndex: 0,
	setSelectedTabCompletionIndex: vi.fn(),
	tabCompletionFilter: 'all' as const,
	setTabCompletionFilter: vi.fn(),
	atMentionOpen: false,
	setAtMentionOpen: vi.fn(),
	atMentionFilter: '',
	setAtMentionFilter: vi.fn(),
	atMentionStartIndex: -1,
	setAtMentionStartIndex: vi.fn(),
	selectedAtMentionIndex: 0,
	setSelectedAtMentionIndex: vi.fn(),
	commandHistoryOpen: false,
	setCommandHistoryOpen: vi.fn(),
	commandHistoryFilter: '',
	setCommandHistoryFilter: vi.fn(),
	commandHistorySelectedIndex: 0,
	setCommandHistorySelectedIndex: vi.fn(),
};

vi.mock('../../../renderer/contexts/InputContext', () => ({
	useInputContext: () => mockInputContext,
}));

const mockSyncAiInputToSession = vi.fn();
const mockQueueAiDraftFlush = vi.fn();
const mockSyncTerminalInputToSession = vi.fn();

vi.mock('../../../renderer/hooks/input/useInputSync', () => ({
	useInputSync: vi.fn(() => ({
		flushAiDraft: vi.fn(),
		syncAiInputToSession: mockSyncAiInputToSession,
		queueAiDraftFlush: mockQueueAiDraftFlush,
		syncTerminalInputToSession: mockSyncTerminalInputToSession,
	})),
}));

vi.mock('../../../renderer/hooks/input/useTabCompletion', () => ({
	useTabCompletion: vi.fn(() => ({ getSuggestions: vi.fn().mockReturnValue([]) })),
}));
vi.mock('../../../renderer/hooks/input/useAtMentionCompletion', () => ({
	useAtMentionCompletion: vi.fn(() => ({ getSuggestions: vi.fn().mockReturnValue([]) })),
}));
vi.mock('../../../renderer/hooks/input/useInputProcessing', () => ({
	useInputProcessing: vi.fn(() => ({ processInput: vi.fn(), processInputRef: { current: null } })),
	DEFAULT_IMAGE_ONLY_PROMPT: 'Describe this image',
}));
vi.mock('../../../renderer/hooks/input/useInputKeyDown', () => ({
	useInputKeyDown: vi.fn(() => ({ handleInputKeyDown: vi.fn() })),
}));
vi.mock('../../../renderer/hooks/utils', () => ({
	useDebouncedValue: vi.fn((value: string) => value),
}));
vi.mock('../../../renderer/stores/centerFlashStore', () => ({ notifyCenterFlash: vi.fn() }));

import {
	useInputHandlers,
	type UseInputHandlersDeps,
} from '../../../renderer/hooks/input/useInputHandlers';
import { createMockAITab } from '../../helpers/mockTab';
import { openHandoffTarget } from '../../../renderer/services/aiHandoff';
import { useInputSync } from '../../../renderer/hooks/input/useInputSync';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useComposerInputStore } from '../../../renderer/stores/composerInputStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useGroupChatStore } from '../../../renderer/stores/groupChatStore';
import { useUIStore } from '../../../renderer/stores/uiStore';
import { useFileExplorerStore } from '../../../renderer/stores/fileExplorerStore';
import { useDebouncedPersistence } from '../../../renderer/hooks/utils/useDebouncedPersistence';
import { confirmQuitAfterSave } from '../../../renderer/services/quitSave';

vi.mock('../../../renderer/utils/sentry', () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
}));

function createDefaultBatchState(): BatchRunState {
	return {
		isRunning: false,
		isStopping: false,
		documents: [],
		lockedDocuments: [],
		currentDocumentIndex: 0,
		currentDocTasksTotal: 0,
		currentDocTasksCompleted: 0,
		totalTasksAcrossAllDocs: 0,
		completedTasksAcrossAllDocs: 0,
		loopEnabled: false,
		loopIteration: 0,
		folderPath: '',
		worktreeActive: false,
		totalTasks: 0,
		completedTasks: 0,
		currentTaskIndex: 0,
		startTime: null,
		currentTask: null,
		sessionIds: [],
	} as any;
}

function createMockDeps(overrides: Partial<UseInputHandlersDeps> = {}): UseInputHandlersDeps {
	return {
		inputRef: { current: { focus: vi.fn(), blur: vi.fn() } } as any,
		terminalOutputRef: { current: { focus: vi.fn() } } as any,
		fileTreeKeyboardNavRef: { current: false },
		dragCounterRef: { current: 0 },
		setIsDraggingFile: vi.fn(),
		getBatchState: vi.fn().mockReturnValue(createDefaultBatchState()),
		activeBatchRunState: createDefaultBatchState(),
		processQueuedItemRef: { current: null },
		flushBatchedUpdates: vi.fn(),
		handleHistoryCommand: vi.fn().mockResolvedValue(undefined),
		handleWizardCommand: vi.fn(),
		sendWizardMessageWithThinking: vi.fn().mockResolvedValue(undefined),
		isWizardActiveForCurrentTab: false,
		handleSkillsCommand: vi.fn().mockResolvedValue(undefined),
		allSlashCommands: [],
		allCustomCommands: [],
		sessionsRef: { current: [] },
		activeSessionIdRef: { current: 'session-a' },
		...overrides,
	};
}

const agentA = (): Session =>
	baseCreateMockSession({
		id: 'session-a',
		name: 'Agent A',
		aiTabs: [{ id: 'a1', name: 'A1', inputValue: '', data: [], stagedImages: [] }] as any,
		activeTabId: 'a1',
		inputMode: 'ai',
	} as any);

/** Agent B mid-flight: a file tab is open but it has no AI tab (a legal state). */
const agentBWithoutAiTabs = (): Session =>
	baseCreateMockSession({
		id: 'session-b',
		name: 'Agent B',
		aiTabs: [] as any,
		activeTabId: null as any,
		inputMode: 'ai',
	} as any);

const agentB = (inputValue = ''): Session =>
	baseCreateMockSession({
		id: 'session-b',
		name: 'Agent B',
		aiTabs: [{ id: 'b1', name: 'B1', inputValue, data: [], stagedImages: [] }] as any,
		activeTabId: 'b1',
		inputMode: 'ai',
	} as any);

/** Writes of real text (not the empty-string clears) aimed at a given tab. */
const textWrittenTo = (tabId: string): string[] => [
	...mockSyncAiInputToSession.mock.calls
		.filter(([value, target]) => target === tabId && String(value).trim() !== '')
		.map(([value]) => String(value)),
	...mockQueueAiDraftFlush.mock.calls
		.filter(([target, value]) => target === tabId && String(value).trim() !== '')
		.map(([, value]) => String(value)),
];

beforeEach(() => {
	vi.clearAllMocks();
	useComposerInputStore.setState({
		aiValue: '',
		aiValueTabId: null,
		terminalValue: '',
		aiCommandMode: 'off',
	});
	useSessionStore.setState({ sessions: [agentA()], activeSessionId: 'session-a' } as any);
	useSettingsStore.setState({
		conductorProfile: 'default',
		automaticTabNamingEnabled: true,
	} as any);
	useGroupChatStore.setState({
		activeGroupChatId: null,
		setGroupChatStagedImages: vi.fn(),
	} as any);
	useUIStore.setState({
		activeRightTab: 'files',
		setActiveRightTab: vi.fn(),
		setSuccessFlashNotification: vi.fn(),
		outputSearchOpen: false,
	} as any);
	useFileExplorerStore.setState({ flatFileList: [], setSelectedFileIndex: vi.fn() } as any);
});

afterEach(() => cleanup());

describe('composer draft ownership', () => {
	it.each([
		{ entry: 'request', images: false },
		{ entry: 'request', images: true },
		{ entry: 'confirm', images: false },
		{ entry: 'confirm', images: true },
	])(
		'saves live drafts before $entry completes without blur, timers or another render, images $images',
		async ({ entry, images }) => {
			vi.useFakeTimers();
			const actual = await vi.importActual<
				typeof import('../../../renderer/hooks/input/useInputSync')
			>('../../../renderer/hooks/input/useInputSync');
			const previous = vi.mocked(useInputSync).getMockImplementation()!;
			vi.mocked(useInputSync).mockImplementation(actual.useInputSync);
			const session = baseCreateMockSession({
				id: 'session-a',
				activeTabId: 'a1',
				aiTabs: [createMockAITab({ id: 'a1', inputValue: 'Draft before the move' })],
				terminalDraftInput: 'old terminal draft',
			});
			const peer = baseCreateMockSession({ id: 'peer' });
			useSessionStore.setState({ sessions: [session, peer], sessionsReadOk: true });
			let saveRequest: () => void | Promise<void>;
			vi.mocked(window.maestro.app.onQuitSaveRequest).mockImplementation((save) => {
				saveRequest = save;
				return vi.fn();
			});
			vi.mocked(window.maestro.sessions.setAll).mockResolvedValue(true);
			vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(true);
			const loaded = { current: true };
			const harness = renderHook(() => ({
				input: useInputHandlers(createMockDeps()),
				persistence: useDebouncedPersistence(loaded, undefined, (id) => id === session.id),
			}));
			try {
				await act(async () => {
					harness.result.current.persistence.flushNow(useSessionStore.getState().sessions);
				});
				vi.mocked(window.maestro.sessions.setMany).mockClear();
				let finishSave!: (saved: boolean) => void;
				vi.mocked(window.maestro.sessions.setMany).mockImplementationOnce(
					() => new Promise((resolve) => (finishSave = resolve))
				);
				let completed = false;
				await act(async () => {
					useComposerInputStore.getState().setAiValue('Draft before the window closes');
					useComposerInputStore.getState().setAiCommandMode('shell');
					useComposerInputStore.getState().setTerminalValue('latest terminal draft');
					if (images) {
						harness.result.current.input.setStagedImages(['maestro-image://draft-image']);
					} else {
						expect(harness.result.current.persistence.isPending).toBe(false);
					}
					expect(useSessionStore.getState().sessions[0].aiTabs[0].inputValue).toBe(
						'Draft before the move'
					);
					const saving = Promise.resolve(
						entry === 'request' ? saveRequest!() : confirmQuitAfterSave()
					).then(() => (completed = true));
					const written = vi.mocked(window.maestro.sessions.setMany).mock.calls[0][0] as Session[];
					expect(written.map((s) => s.id)).toEqual([session.id]);
					expect(written[0].aiTabs[0]).toMatchObject({
						inputValue: 'Draft before the window closes',
						commandMode: 'shell',
						stagedImages: images ? ['maestro-image://draft-image'] : [],
					});
					expect(written[0].terminalDraftInput).toBe('latest terminal draft');
					expect(completed).toBe(false);
					finishSave(true);
					await saving;
				});
				expect(completed).toBe(true);
			} finally {
				harness.unmount();
				vi.mocked(useInputSync).mockImplementation(previous);
				vi.useRealTimers();
			}
		}
	);

	it.each([false, true])(
		'retains a reused handoff draft through actual tab-switch effects, new shell %s',
		async (newShell) => {
			const actual = await vi.importActual<
				typeof import('../../../renderer/hooks/input/useInputSync')
			>('../../../renderer/hooks/input/useInputSync');
			const previous = vi.mocked(useInputSync).getMockImplementation()!;
			vi.mocked(useInputSync).mockImplementation(actual.useInputSync);
			useSettingsStore.setState({ newShell });
			const source = baseCreateMockSession({
				id: 'session-a',
				cwd: '/project',
				activeTabId: 'a1',
				aiTabs: [createMockAITab({ id: 'a1' })],
			});
			const target = baseCreateMockSession({
				id: 'session-b',
				cwd: '/project',
				toolType: 'codex',
				activeTabId: 'b1',
				aiTabs: [createMockAITab({ id: 'b1', logs: [], inputValue: '', agentSessionId: null })],
			});
			useSessionStore.setState({ sessions: [source, target], activeSessionId: target.id });
			vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(true);
			const harness = renderHook(() => useInputHandlers(createMockDeps()));
			try {
				await act(() =>
					openHandoffTarget({
						sourceAgentId: source.id,
						runnerId: target.id,
						provider: 'codex',
						config: { toolType: 'codex' },
						cwd: '/project',
						projectPath: '/project',
						mode: 'handoff',
						origin: {
							kind: 'handoff',
							sourceSessionId: source.id,
							sourceTabId: 'a1',
							sourceProvider: 'claude-code',
							createdAt: 1,
						},
						draft: {
							text: 'retained handoff',
							estimatedTokens: 4,
							budgetTokens: 8000,
							omittedEntries: 0,
							omittedCharacters: 0,
						},
						send: false,
						background: false,
					})
				);
				expect(useComposerInputStore.getState().aiValue).toBe('retained handoff');
				act(() => useSessionStore.getState().setActiveSessionId(source.id));
				expect(useSessionStore.getState().sessions[1].aiTabs[0].inputValue).toBe(
					'retained handoff'
				);
				act(() => useSessionStore.getState().setActiveSessionId(target.id));
				expect(useComposerInputStore.getState().aiValueTabId).toBe('b1');
				expect(useComposerInputStore.getState().aiValue).toBe('retained handoff');
			} finally {
				harness.unmount();
				vi.mocked(useInputSync).mockImplementation(previous);
				useSettingsStore.setState({ newShell: false });
			}
		}
	);

	it('attributes typing to the active tab on an ordinary agent switch', () => {
		renderHook(() => useInputHandlers(createMockDeps()));

		act(() => {
			useSessionStore.setState({
				sessions: [agentA(), agentB()],
				activeSessionId: 'session-b',
			} as any);
		});
		act(() => {
			useComposerInputStore.getState().setAiValue('typed on B');
		});

		expect(textWrittenTo('b1')).toContain('typed on B');
		expect(textWrittenTo('a1')).toEqual([]);
	});

	it('does not file text on the previous agent when the new one has no AI tab yet', () => {
		renderHook(() => useInputHandlers(createMockDeps()));

		// Land on an agent with a file tab open and no AI tab.
		act(() => {
			useSessionStore.setState({
				sessions: [agentA(), agentBWithoutAiTabs()],
				activeSessionId: 'session-b',
			} as any);
		});
		act(() => {
			useComposerInputStore.getState().setAiValue('half a thought');
		});
		// Its AI tab materializes.
		act(() => {
			useSessionStore.setState({
				sessions: [agentA(), agentB()],
				activeSessionId: 'session-b',
			} as any);
		});

		expect(textWrittenTo('a1')).toEqual([]);
		// The text the user typed is not thrown away: the tab adopts it.
		expect(useComposerInputStore.getState().aiValue).toBe('half a thought');
		expect(useComposerInputStore.getState().aiValueTabId).toBe('b1');
	});

	it('does not file text on sessions[0] while activeSessionId runs ahead of the store', () => {
		renderHook(() => useInputHandlers(createMockDeps()));

		// A freshly created agent is active before its session object lands, so
		// selectActiveSession falls back to sessions[0] - a different agent.
		act(() => {
			useSessionStore.setState({ sessions: [agentA()], activeSessionId: 'session-b' } as any);
		});
		act(() => {
			useComposerInputStore.getState().setAiValue('typed for the new agent');
		});
		act(() => {
			useSessionStore.setState({
				sessions: [agentA(), agentB()],
				activeSessionId: 'session-b',
			} as any);
		});

		expect(textWrittenTo('a1')).toEqual([]);
		expect(useComposerInputStore.getState().aiValue).toBe('typed for the new agent');
		expect(useComposerInputStore.getState().aiValueTabId).toBe('b1');
	});

	it('keeps the incoming tab own draft rather than overwriting it with orphan text', () => {
		renderHook(() => useInputHandlers(createMockDeps()));

		act(() => {
			useSessionStore.setState({
				sessions: [agentA(), agentBWithoutAiTabs()],
				activeSessionId: 'session-b',
			} as any);
		});
		act(() => {
			useComposerInputStore.getState().setAiValue('orphan text');
		});
		act(() => {
			useSessionStore.setState({
				sessions: [agentA(), agentB('B already had a draft')],
				activeSessionId: 'session-b',
			} as any);
		});

		expect(useComposerInputStore.getState().aiValue).toBe('B already had a draft');
		expect(useComposerInputStore.getState().aiValueTabId).toBe('b1');
		expect(textWrittenTo('a1')).toEqual([]);
	});

	it('flushes a draft to its owner, not to the tab that happens to be active', () => {
		renderHook(() => useInputHandlers(createMockDeps()));

		act(() => {
			useComposerInputStore.getState().setAiValue('belongs to a1');
		});
		act(() => {
			useSessionStore.setState({
				sessions: [agentA(), agentB()],
				activeSessionId: 'session-b',
			} as any);
		});

		expect(textWrittenTo('a1')).toContain('belongs to a1');
		expect(textWrittenTo('b1')).toEqual([]);
	});
});
