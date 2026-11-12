import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';
import { resetStores } from '../../../helpers/resetStores';
import { useAppRemoteEventListeners } from '../../../../renderer/hooks/remote/useAppRemoteEventListeners';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { useUIStore } from '../../../../renderer/stores/uiStore';
import { getT } from '../../../../renderer/i18n';

const mocks = vi.hoisted(() => ({
	refresh: vi.fn(),
	openHit: vi.fn(),
	create: vi.fn(),
	split: vi.fn(),
	flush: vi.fn(),
}));
vi.mock('../../../../renderer/services/refreshNativeConversation', async (original) => ({
	...(await original<object>()),
	refreshNativeConversation: mocks.refresh,
}));
vi.mock('../../../../renderer/services/openNativeHistorySearchHit', () => ({
	openNativeHistorySearchHit: mocks.openHit,
}));
vi.mock('../../../../renderer/services/newShellConversation', () => ({
	newProjectConversation: mocks.create,
}));
vi.mock('../../../../renderer/services/newShellSplit', async (original) => ({
	...(await original<object>()),
	splitConversation: mocks.split,
	unsplitConversation: vi.fn(),
}));
vi.mock('../../../../renderer/services/quitSave', () => ({ flushPendingSessionSave: mocks.flush }));
const ack = vi.fn();
const force = vi.fn();
const resume = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	Object.defineProperty(window, 'innerWidth', { value: 1800, configurable: true });
	resetStores(useSessionStore, useSettingsStore, useUIStore);
	useSettingsStore.setState({ newShell: true });
	useSessionStore.setState({
		activeSessionId: 'owner',
		sessions: [
			createMockSession({
				id: 'owner',
				cwd: '/project',
				projectRoot: '/project',
				activeTabId: 'second',
				aiTabs: [
					createMockAITab({ id: 'first' }),
					createMockAITab({
						id: 'second',
						agentSessionId: 'native',
						logs: [
							{
								id: 'plan',
								source: 'tool',
								timestamp: 1,
								text: '',
								metadata: {
									toolState: {
										input: { plan: [{ step: 'Verify parity', status: 'in_progress' }] },
									},
								},
							},
						],
					}),
				],
				executionQueue: [
					{ id: 'queued', tabId: 'first', type: 'message', text: 'Run this', timestamp: 1 },
				],
			}),
		],
	});
	Object.assign(window.maestro.process, { sendRemoteUpdateSessionConfigResponse: ack });
	mocks.refresh.mockResolvedValue({ status: 'unchanged' });
	mocks.openHit.mockImplementation(async (_hit, _resume, located) => {
		located?.({ sessionId: 'owner', tabId: 'second', logId: 'message', revealTurnActivity: true });
		useUIStore.getState().setPendingLogJump({
			sessionId: 'owner',
			tabId: 'second',
			logId: 'message',
			revealTurnActivity: true,
		});
		return true;
	});
	mocks.create.mockResolvedValue({ success: true, agentId: 'owner', tabId: 'created' });
	mocks.split.mockResolvedValue(undefined);
	force.mockResolvedValue({ success: true });
	renderHook(() =>
		useAppRemoteEventListeners({
			sessionsRef: {
				get current() {
					return useSessionStore.getState().sessions;
				},
			},
			setActiveSessionId: useSessionStore.getState().setActiveSessionId,
			setSessions: useSessionStore.getState().setSessions,
			setGroups: useSessionStore.getState().setGroups,
			handleOpenFileTab: vi.fn(),
			refreshFileTree: vi.fn(),
			handleAutoRunRefresh: vi.fn(),
			startBatchRun: vi.fn(),
			stopBatchRun: vi.fn(),
			resumeAfterError: vi.fn(),
			skipCurrentDocument: vi.fn(),
			abortBatchOnError: vi.fn(),
			handleResumeSession: resume,
			handleForceSendQueueItem: force,
		})
	);
});

async function command(request: Record<string, unknown>) {
	ack.mockClear();
	act(() => {
		window.dispatchEvent(
			new CustomEvent('maestro:remoteUpdateSessionConfig', {
				detail: {
					sessionId: 'owner',
					responseChannel: 'reply',
					configPatch: { newShellCommand: request },
				},
			})
		);
	});
	await waitFor(() => expect(ack).toHaveBeenCalled());
	return ack.mock.calls.at(-1)![1];
}

it('returns the live normalized tasks and empty state', async () => {
	expect(await command({ action: 'tasks', tabId: 'second' })).toMatchObject({
		success: true,
		data: {
			tabId: 'second',
			empty: false,
			list: { tasks: [{ content: 'Verify parity', status: 'in_progress' }], completed: 0 },
		},
	});
});
it('sets and clears the sidebar query through shared state', async () => {
	expect(await command({ action: 'sidebar-search', text: 'needle' })).toMatchObject({
		success: true,
		data: { query: 'needle' },
	});
	expect(useUIStore.getState()).toHaveProperty('newShellSidebarSearch', 'needle');
	expect(await command({ action: 'sidebar-search', text: '' })).toMatchObject({
		success: true,
		data: { query: '' },
	});
});
it('opens and closes project settings', async () => {
	expect(await command({ action: 'project-settings', path: '/project' })).toMatchObject({
		success: true,
		data: { open: true },
	});
	expect(await command({ action: 'project-settings', close: true })).toMatchObject({
		success: true,
		data: { open: false },
	});
});
it('creates and splits in one acknowledged renderer command', async () => {
	expect(await command({ action: 'new-split', ratio: 0.6 })).toMatchObject({
		success: true,
		data: { agentId: 'owner', tabId: 'created' },
	});
	expect(mocks.create).toHaveBeenCalled();
	expect(mocks.split).toHaveBeenCalledWith('owner', 'created', 0.6);
});
it('uses the queue force path', async () => {
	expect(await command({ action: 'force-send', itemId: 'queued' })).toMatchObject({
		success: true,
		data: { itemId: 'queued' },
	});
	expect(force).toHaveBeenCalledWith('owner', 'queued');
});
it('refreshes through the sidebar service', async () => {
	expect(await command({ action: 'refresh', tabId: 'second' })).toMatchObject({
		success: true,
		data: { status: 'unchanged' },
	});
	expect(mocks.refresh).toHaveBeenCalledWith({ sessionId: 'owner', tabId: 'second' });
});
it('switches then immediately reads the live selection before persistence', async () => {
	useSessionStore
		.getState()
		.setSessions((sessions) => sessions.map((s) => ({ ...s, activeTabId: 'first' })));
	expect(await command({ action: 'flush-inventory' })).toMatchObject({
		success: true,
		data: { activeSessionId: 'owner', activeTabId: 'first' },
	});
	expect(mocks.flush).toHaveBeenCalledOnce();
});
it('opens a content hit through the canonical navigator', async () => {
	const hit = {
		conversation: {
			key: 'native',
			ownerId: 'owner',
			provider: 'codex',
			nativeSessionId: 'native',
			projectPath: '/project',
		},
		message: { uuid: 'message', role: 'assistant', text: 'needle' },
		matchPreview: 'needle',
	};
	expect(await command({ action: 'open-hit', hit })).toMatchObject({
		success: true,
		data: { tabId: 'second', logId: 'message' },
	});
	expect(mocks.openHit).toHaveBeenCalledWith(hit, resume, expect.any(Function));
});

it.each([
	'tasks',
	'refresh',
	'open-hit',
	'sidebar-search',
	'project-settings',
	'new-split',
	'force-send',
	'flush-inventory',
])('rejects %s in the classic shell', async (action) => {
	useSettingsStore.setState({ newShell: false });
	expect(await command({ action })).toMatchObject({ success: false, error: expect.any(String) });
	expect(mocks.create).not.toHaveBeenCalled();
	expect(force).not.toHaveBeenCalled();
});
it('returns the same empty-state text when the provider cleared its list', async () => {
	useSessionStore
		.getState()
		.setSessions((sessions) =>
			sessions.map((s) => ({ ...s, aiTabs: s.aiTabs.map((tab) => ({ ...tab, logs: [] })) }))
		);
	expect(await command({ action: 'tasks', tabId: 'second' })).toMatchObject({
		success: true,
		data: {
			list: null,
			empty: true,
			emptyText:
				'The tools in this conversation have not provided a task list. Checklists in replies are not shown here.',
		},
	});
});
it('does not acknowledge a pending force dispatch and reports its failure', async () => {
	let finish!: (value: { success: boolean; error?: string }) => void;
	force.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	act(() => {
		window.dispatchEvent(
			new CustomEvent('maestro:remoteUpdateSessionConfig', {
				detail: {
					sessionId: 'owner',
					responseChannel: 'reply',
					configPatch: { newShellCommand: { action: 'force-send', itemId: 'queued' } },
				},
			})
		);
	});
	expect(force).toHaveBeenCalled();
	expect(ack).not.toHaveBeenCalled();
	await act(async () => finish({ success: false, error: 'spawn rejected' }));
	expect(ack).toHaveBeenCalledWith('reply', { success: false, error: 'spawn rejected' });
});
it.each(['target-tab-busy', 'needs-forced-parallel', 'awaiting-consult', 'no-target-tab'])(
	'refuses force send for %s',
	async (reason) => {
		useSettingsStore.setState({ forcedParallelExecution: false });
		useSessionStore.getState().setSessions((sessions) =>
			sessions.map((s) => ({
				...s,
				aiTabs:
					reason === 'no-target-tab'
						? []
						: s.aiTabs.map((tab) => ({
								...tab,
								state:
									(reason === 'target-tab-busy' && tab.id === 'first') ||
									(reason === 'needs-forced-parallel' && tab.id === 'second')
										? 'busy'
										: 'idle',
							})),
				executionQueue: s.executionQueue.map((item) => ({
					...item,
					awaitingConsult: reason === 'awaiting-consult' ? true : undefined,
				})),
			}))
		);
		expect(await command({ action: 'force-send', itemId: 'queued' })).toMatchObject({
			success: false,
			error: expect.any(String),
		});
		expect(force).not.toHaveBeenCalled();
	}
);
it.each([
	{ action: 'unknown' },
	{ action: 'tasks', tabId: 'missing' },
	{ action: 'sidebar-search', text: 42 },
	{ action: 'new-split', ratio: 0.9 },
	{ action: 'refresh', tabId: 'second', extra: true },
])('refuses invalid requests %j', async (request) => {
	expect(await command(request)).toMatchObject({ success: false, error: expect.any(String) });
	expect(mocks.create).not.toHaveBeenCalled();
});
it('reports a busy native refresh without success', async () => {
	mocks.refresh.mockResolvedValueOnce({ status: 'skipped', reason: 'busy' });
	expect(await command({ action: 'refresh', tabId: 'second' })).toEqual({
		success: false,
		error: 'Native refresh skipped: busy',
	});
});

it('uses the queued card Chinese reason when parallel execution is disabled', async () => {
	useSettingsStore.setState({ uiLanguage: 'zh-CN', forcedParallelExecution: false });
	useSessionStore.getState().setSessions((sessions) =>
		sessions.map((session) => ({
			...session,
			aiTabs: session.aiTabs.map((tab) =>
				tab.id === 'second' ? { ...tab, state: 'busy' as const } : tab
			),
		}))
	);
	expect(await command({ action: 'force-send', itemId: 'queued' })).toEqual({
		success: false,
		error: getT()('workflows.queue.parallelOff'),
	});
	expect(force).not.toHaveBeenCalled();
});
it('rejects a narrow window before creating a split conversation', async () => {
	const width = window.innerWidth;
	Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
	try {
		expect(await command({ action: 'new-split' })).toMatchObject({
			success: false,
			error: expect.any(String),
		});
		expect(mocks.create).not.toHaveBeenCalled();
	} finally {
		Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
	}
});

it('returns the located identity even when the transcript consumed its pending jump', async () => {
	mocks.openHit.mockImplementationOnce(async (_hit, _resume, located) => {
		located?.({ sessionId: 'owner', tabId: 'second', logId: 'consumed', revealTurnActivity: true });
		useUIStore.getState().setPendingLogJump(null);
		return true;
	});
	const hit = {
		conversation: { nativeSessionId: 'native', provider: 'codex', projectPath: '/project' },
		message: { uuid: 'message', role: 'assistant', text: 'needle' },
	};
	expect(await command({ action: 'open-hit', hit })).toMatchObject({
		success: true,
		data: { tabId: 'second', logId: 'consumed' },
	});
});
