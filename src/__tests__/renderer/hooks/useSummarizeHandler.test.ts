import { useSettingsStore } from '../../../renderer/stores/settingsStore';
/**
 * Tests for useSummarizeAndContinue - handleSummarizeAndContinue (Tier 3E)
 *
 * Tests the high-level handler that validates, runs summarization,
 * updates session state, and shows toast notifications.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../../renderer/services/contextSummarizer', () => ({
	contextSummarizationService: {
		canSummarize: vi.fn().mockReturnValue(true),
		getMinContextUsagePercent: vi.fn().mockReturnValue(50),
		summarizeContext: vi.fn().mockResolvedValue({
			summarizedLogs: [{ id: 'log-1', timestamp: Date.now(), source: 'user', text: 'compacted' }],
			originalTokens: 10000,
			compactedTokens: 3000,
		}),
		formatCompactedTabName: vi.fn((name: string) => `${name || 'Tab'} Compacted`),
		cancelSummarization: vi.fn(),
	},
}));

vi.mock('../../../renderer/stores/notificationStore', async () => {
	const actual = await vi.importActual('../../../renderer/stores/notificationStore');
	return { ...actual, notifyToast: vi.fn() };
});

vi.mock('../../../renderer/utils/tabHelpers', async () => {
	const actual = await vi.importActual('../../../renderer/utils/tabHelpers');
	return {
		...actual,
		createTabAtPosition: vi.fn((session: any, options: any) => {
			const newTab = {
				id: 'new-tab-1',
				agentSessionId: null,
				name: options.name,
				starred: false,
				logs: options.logs || [],
				inputValue: '',
				stagedImages: [],
				createdAt: Date.now(),
				state: 'idle',
				saveToHistory: options.saveToHistory ?? true,
			};
			return {
				tab: newTab,
				session: {
					...session,
					aiTabs: [...session.aiTabs, newTab],
				},
			};
		}),
	};
});

import { useSummarizeAndContinue } from '../../../renderer/hooks/agent/useSummarizeAndContinue';
import { contextSummarizationService } from '../../../renderer/services/contextSummarizer';
import { notifyToast } from '../../../renderer/stores/notificationStore';
import { createTabAtPosition } from '../../../renderer/utils/tabHelpers';
import { useOperationStore } from '../../../renderer/stores/operationStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import type { Session, AITab } from '../../../renderer/types';
import { createMockAITab } from '../../helpers/mockTab';
import { createMockSession as baseCreateMockSession } from '../../helpers/mockSession';

// ============================================================================
// Helpers
// ============================================================================

function createMockTab(overrides: Partial<AITab> = {}): AITab {
	return createMockAITab({
		agentSessionId: 'agent-session-1',
		name: 'Tab 1',
		logs: [
			{ id: 'log-1', timestamp: Date.now(), source: 'user', text: 'hello' },
			{ id: 'log-2', timestamp: Date.now(), source: 'assistant', text: 'world' },
		],
		saveToHistory: true,
		...overrides,
	});
}

// Thin wrapper: pre-populates an AI tab and raises contextUsage above the
// summarization threshold so the summarize handler will actually run.
function createMockSession(overrides: Partial<Session> = {}): Session {
	return baseCreateMockSession({
		cwd: '/projects/test',
		fullPath: '/projects/test',
		projectRoot: '/projects/test',
		contextUsage: 75,
		aiTabs: [createMockTab()],
		activeTabId: 'tab-1',
		...overrides,
	});
}

function seedActiveSession(session: Session | null) {
	if (session) {
		useSessionStore.setState({
			sessions: [session],
			activeSessionId: session.id,
		} as any);
	} else {
		useSessionStore.setState({
			sessions: [],
			activeSessionId: null,
		} as any);
	}
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
	useSettingsStore.setState({ newShell: false });
	vi.clearAllMocks();

	// Reset stores
	useOperationStore.getState().resetAll();
	useSessionStore.setState({
		sessions: [],
		activeSessionId: '',
		sessionsLoaded: false,
		initialLoadComplete: false,
	});

	window.maestro.process.onRemoteSummarizeContext = vi.fn(() => vi.fn());
	window.maestro.process.sendRemoteSummarizeContextResponse = vi.fn();

	// Default: canSummarize returns true
	(contextSummarizationService.canSummarize as ReturnType<typeof vi.fn>).mockReturnValue(true);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('compacted conversation settings', () => {
	it.each([
		{
			customModel: 'chosen-model',
			customEffort: 'high',
			permissionMode: 'standard' as const,
			readOnlyMode: false,
			showThinking: 'sticky' as const,
			enterToSend: false,
			saveToHistory: false,
		},
		{
			permissionMode: 'readonly' as const,
			readOnlyMode: true,
			showThinking: 'on' as const,
			enterToSend: true,
		},
		{ readOnlyMode: true },
		{},
	])('preserves explicit settings and inheritance: %j', async (settings) => {
		useSettingsStore.setState({ newShell: true });
		const actual = await vi.importActual<typeof import('../../../renderer/utils/tabHelpers')>(
			'../../../renderer/utils/tabHelpers'
		);
		vi.mocked(createTabAtPosition).mockImplementationOnce(actual.createTabAtPosition);
		const source = createMockTab({
			...settings,
			saveToHistory: settings.saveToHistory,
			commandMode: 'shell',
		});
		seedActiveSession(
			createMockSession({
				aiTabs: [source],
				activeTabId: source.id,
				customModel: 'agent-model',
				customEffort: 'medium',
			})
		);
		const { result } = renderHook(() => useSummarizeAndContinue());
		await act(async () => {
			const compacted = await result.current.startSummarize(source.id);
			expect(compacted).not.toBeNull();
			const tab = compacted!.updatedSession.aiTabs.find((tab) => tab.id === compacted!.newTabId)!;
			for (const key of [
				'customModel',
				'customEffort',
				'permissionMode',
				'readOnlyMode',
				'showThinking',
				'enterToSend',
				'saveToHistory',
			] as const) {
				expect(tab[key], key).toBe(source[key]);
			}
			expect(tab.commandMode).toBeUndefined();
			expect(tab.agentSessionId).toBeNull();
			expect(tab.inputValue).toBe('');
			expect(compacted!.updatedSession.customModel).toBe('agent-model');
			expect(compacted!.updatedSession.customEffort).toBe('medium');
		});
	});
});

describe('handleSummarizeAndContinue (Tier 3E)', () => {
	it('returns when no session is provided', async () => {
		seedActiveSession(null);
		const { result } = renderHook(() => useSummarizeAndContinue());

		await act(async () => {
			result.current.handleSummarizeAndContinue();
		});

		expect(contextSummarizationService.canSummarize).not.toHaveBeenCalled();
		expect(notifyToast).not.toHaveBeenCalled();
	});

	it('returns when inputMode is terminal', async () => {
		const session = createMockSession({ inputMode: 'terminal' });

		seedActiveSession(session);
		const { result } = renderHook(() => useSummarizeAndContinue());

		await act(async () => {
			result.current.handleSummarizeAndContinue();
		});

		expect(contextSummarizationService.canSummarize).not.toHaveBeenCalled();
		expect(notifyToast).not.toHaveBeenCalled();
	});

	it('shows warning toast when canSummarize fails', async () => {
		(contextSummarizationService.canSummarize as ReturnType<typeof vi.fn>).mockReturnValue(false);

		const session = createMockSession();

		seedActiveSession(session);
		const { result } = renderHook(() => useSummarizeAndContinue());

		await act(async () => {
			result.current.handleSummarizeAndContinue();
		});

		expect(notifyToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'warning',
				title: 'Cannot Compact',
			})
		);
	});

	it('calls startSummarize with the active tab id', async () => {
		const session = createMockSession();
		useSessionStore.setState({
			sessions: [session],
			activeSessionId: session.id,
		});

		seedActiveSession(session);
		const { result } = renderHook(() => useSummarizeAndContinue());

		await act(async () => {
			result.current.handleSummarizeAndContinue();
			// Allow the .then() promise chain to resolve
			await vi.waitFor(() => {
				expect(contextSummarizationService.summarizeContext).toHaveBeenCalled();
			});
		});

		expect(contextSummarizationService.summarizeContext).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceSessionId: 'session-1',
				sourceTabId: 'tab-1',
			}),
			expect.any(Array),
			expect.any(Function)
		);
	});

	it('updates session on success', async () => {
		const session = createMockSession();
		useSessionStore.setState({
			sessions: [session],
			activeSessionId: session.id,
		});

		seedActiveSession(session);
		const { result } = renderHook(() => useSummarizeAndContinue());

		await act(async () => {
			result.current.handleSummarizeAndContinue();
			await vi.waitFor(() => {
				expect(createTabAtPosition).toHaveBeenCalled();
			});
		});

		// Session should have been updated in the store via setSessions
		const updatedSessions = useSessionStore.getState().sessions;
		expect(updatedSessions.length).toBeGreaterThan(0);

		const updatedSession = updatedSessions.find((s) => s.id === session.id);
		expect(updatedSession).toBeDefined();
		// Should have a new tab added by createTabAtPosition
		expect(updatedSession!.aiTabs.length).toBeGreaterThan(session.aiTabs.length);
		// Active tab should be switched to the new tab
		expect(updatedSession!.activeTabId).toBe('new-tab-1');
	});

	it('shows success toast on success', async () => {
		const session = createMockSession();
		useSessionStore.setState({
			sessions: [session],
			activeSessionId: session.id,
		});

		seedActiveSession(session);
		const { result } = renderHook(() => useSummarizeAndContinue());

		await act(async () => {
			result.current.handleSummarizeAndContinue();
			await vi.waitFor(() => {
				expect(notifyToast).toHaveBeenCalledWith(
					expect.objectContaining({
						type: 'success',
						title: 'Context Compacted',
					})
				);
			});
		});
	});

	it('clears tab state on success', async () => {
		const session = createMockSession();
		useSessionStore.setState({
			sessions: [session],
			activeSessionId: session.id,
		});

		seedActiveSession(session);
		const { result } = renderHook(() => useSummarizeAndContinue());

		await act(async () => {
			result.current.handleSummarizeAndContinue();
			await vi.waitFor(() => {
				expect(createTabAtPosition).toHaveBeenCalled();
			});
		});

		// After success the tab state should be cleared
		const tabState = useOperationStore.getState().summarizeStates.get('tab-1');
		expect(tabState).toBeUndefined();
	});

	it('uses explicit tabId parameter when provided', async () => {
		const tab2 = createMockTab({ id: 'tab-2', name: 'Tab 2' });
		const session = createMockSession({
			aiTabs: [createMockTab(), tab2],
			activeTabId: 'tab-1',
		});
		useSessionStore.setState({
			sessions: [session],
			activeSessionId: session.id,
		});

		seedActiveSession(session);
		const { result } = renderHook(() => useSummarizeAndContinue());

		await act(async () => {
			result.current.handleSummarizeAndContinue('tab-2');
			await vi.waitFor(() => {
				expect(contextSummarizationService.summarizeContext).toHaveBeenCalled();
			});
		});

		expect(contextSummarizationService.summarizeContext).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceTabId: 'tab-2',
			}),
			expect.any(Array),
			expect.any(Function)
		);
	});

	it('shows error toast when summarization fails', async () => {
		const session = createMockSession();
		useSessionStore.setState({
			sessions: [session],
			activeSessionId: session.id,
		});

		// Make summarizeContext reject
		(
			contextSummarizationService.summarizeContext as ReturnType<typeof vi.fn>
		).mockRejectedValueOnce(new Error('Summarization failed'));

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		seedActiveSession(session);
		const { result } = renderHook(() => useSummarizeAndContinue());

		await act(async () => {
			result.current.handleSummarizeAndContinue();
			await vi.waitFor(() => {
				expect(notifyToast).toHaveBeenCalledWith(
					expect.objectContaining({
						type: 'error',
						title: 'Compaction Failed',
					})
				);
			});
		});

		// createTabAtPosition should NOT have been called
		expect(createTabAtPosition).not.toHaveBeenCalled();

		consoleSpy.mockRestore();
	});
});

it('accepts CLI compaction for the named background tab through the same handler', async () => {
	const active = createMockSession({ id: 'active' });
	const target = createMockSession({
		id: 'target',
		aiTabs: [createMockTab({ id: 'target-tab', permissionMode: 'standard' })],
		activeTabId: 'target-tab',
	});
	useSessionStore.setState({ sessions: [active, target], activeSessionId: active.id });
	renderHook(() => useSummarizeAndContinue());
	const listener = vi.mocked(window.maestro.process.onRemoteSummarizeContext).mock.calls[0]?.[0];
	expect(listener).toBeTypeOf('function');
	await act(async () => {
		listener!(target.id, 'reply', 'target-tab', true);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(window.maestro.process.sendRemoteSummarizeContextResponse).toHaveBeenCalledWith(
		'reply',
		true
	);
	expect(useSessionStore.getState().activeSessionId).toBe(active.id);
	const updated = useSessionStore.getState().sessions.find((s) => s.id === target.id)!;
	expect(updated.activeTabId).toBe('target-tab');
	expect(updated.aiTabs.at(-1)?.permissionMode).toBe('standard');
});

it.each(['missing', 'busy', 'too-small'])(
	'rejects CLI compaction of %s targets without invoking the summarizer',
	(reason) => {
		const session = createMockSession();
		if (reason === 'busy') session.aiTabs[0].state = 'busy';
		if (reason === 'too-small')
			vi.mocked(contextSummarizationService.canSummarize).mockReturnValue(false);
		seedActiveSession(session);
		renderHook(() => useSummarizeAndContinue());
		const listener = vi.mocked(window.maestro.process.onRemoteSummarizeContext).mock.calls[0][0];
		act(() =>
			listener(session.id, 'reply', reason === 'missing' ? 'absent' : session.aiTabs[0].id, true)
		);
		expect(window.maestro.process.sendRemoteSummarizeContextResponse).toHaveBeenCalledWith(
			'reply',
			false
		);
		expect(contextSummarizationService.summarizeContext).not.toHaveBeenCalled();
	}
);
