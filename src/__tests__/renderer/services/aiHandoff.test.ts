import { tileNewTabInSession } from '../../../renderer/services/tileNewTabAction';
import { projectSettingsKey } from '../../../shared/projectSettings';
import { conversationPermissionSnapshot } from '../../../renderer/utils/newConversationPermissions';
import { setCapabilitiesCache } from '../../../renderer/hooks/agent/useAgentCapabilities';
import { AGENT_CAPABILITIES } from '../../../main/agents/capabilities';
import { useOperationStore } from '../../../renderer/stores/operationStore';
import { act, renderHook } from '@testing-library/react';
import { useInputSync } from '../../../renderer/hooks/input/useInputSync';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useComposerInputStore } from '../../../renderer/stores/composerInputStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openHandoffTarget, readHandoffSource } from '../../../renderer/services/aiHandoff';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import { gitService } from '../../../renderer/services/git';
import { enqueuePromptForTab } from '../../../renderer/services/queuedPrompt';
import type { HandoffOpenRequest } from '../../../shared/aiHandoff';
import { requestTabAutoNameForMessage } from '../../../renderer/services/tabAutoNaming';
import { setLiveDraft, clearLiveDraft } from '../../../renderer/utils/liveDraftStore';

vi.mock('../../../renderer/services/git', () => ({ gitService: { getChanges: vi.fn() } }));

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
	cwd: '/project',
	mode: 'handoff',
	origin: {
		kind: 'handoff',
		sourceSessionId: 'source',
		sourceTabId: 'source-tab',
		sourceProvider: 'claude-code',
		sourceTitle: 'Original',
		sourceNativeSessionId: 'native-original',
		createdAt: 1,
	},
	config: { toolType: 'codex' },
	draft,
	send: false,
	background: true,
	...over,
});
const sessions = () => useSessionStore.getState().sessions;

beforeEach(() => {
	for (const [id, capabilities] of Object.entries(AGENT_CAPABILITIES))
		setCapabilitiesCache(id, capabilities);
	window.maestro.windows = {
		...window.maestro.windows,
		getConversationPermissions: vi.fn().mockResolvedValue([]),
	};
	vi.clearAllMocks();
	window.maestro.settings.projectSettings = vi.fn(async (command) => ({
		success: true,
		scope: command.scope,
		settings: useSettingsStore.getState().projectSettings[projectSettingsKey(command.scope)] ?? {},
	}));
	useOperationStore.getState().resetAll();
	clearLiveDraft('source-tab');
	useSettingsStore.setState({
		newShell: false,
		projectSettings: {},
		uiLanguage: 'en',
		automaticTabNamingEnabled: true,
	});
	useComposerInputStore.getState().loadAiDraft('', '', 'off');
	clearLiveDraft('target-empty');
	vi.mocked(window.maestro.sessions.setMany).mockResolvedValue(true);
	vi.mocked(enqueuePromptForTab).mockReturnValue({ id: 'queue-item' } as never);
	useSessionStore.setState({
		sessions: [
			createMockSession({
				id: 'source',
				name: 'Claude',
				toolType: 'claude-code',
				cwd: '/project',
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
				cwd: '/project',
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
	it.each(['handoff', 'review'] as const)(
		'reuses a sole empty target for %s in both shells',
		async (mode) => {
			for (const newShell of [false, true]) {
				useSettingsStore.setState({ newShell });
				useSessionStore.getState().updateSession('target', {
					aiTabs: [
						createMockAITab({ id: 'target-empty', logs: [], agentSessionId: null, inputValue: '' }),
					],
					activeTabId: 'target-empty',
					unifiedTabOrder: [{ type: 'ai', id: 'target-empty' }],
				});
				const result = await openHandoffTarget(
					request({ mode, origin: { ...request().origin, kind: mode }, background: false })
				);
				expect(result).toMatchObject({ success: true, tabId: 'target-empty', createdAgent: false });
				const target = sessions()[1];
				expect(target.aiTabs).toHaveLength(1);
				expect(target.activeTabId).toBe('target-empty');
				expect(target.unifiedTabOrder).toEqual([{ type: 'ai', id: 'target-empty' }]);
				expect(target.aiTabs[0].inputValue).toBe(draft.text);
			}
		}
	);

	it.each([false, true])(
		'keeps a reused composer draft across tab switches, new shell %s',
		async (newShell) => {
			useSettingsStore.setState({ newShell });
			useSessionStore.getState().updateSession('target', {
				aiTabs: [
					createMockAITab({ id: 'target-empty', inputValue: '', logs: [], agentSessionId: null }),
				],
				activeTabId: 'target-empty',
			});
			useSessionStore.getState().setActiveSessionId('target');
			useComposerInputStore.getState().loadAiDraft('target-empty', '', 'off');
			const sync = renderHook(() =>
				useInputSync({ setSessions: useSessionStore.getState().setSessions })
			);
			await act(() => openHandoffTarget(request({ background: false })));
			expect(useComposerInputStore.getState().aiValue).toBe(draft.text);
			act(() => {
				const composer = useComposerInputStore.getState();
				useSessionStore.getState().setActiveSessionId('source');
				sync.result.current.syncAiInputToSession(composer.aiValue, {
					tabId: composer.aiValueTabId!,
				});
				useComposerInputStore.getState().loadAiDraft('source-tab', 'Source draft', 'off');
				useSessionStore.getState().setActiveSessionId('target');
				useComposerInputStore
					.getState()
					.loadAiDraft('target-empty', sessions()[1].aiTabs[0].inputValue, 'off');
			});
			expect(sessions()[1].aiTabs[0].inputValue).toBe(draft.text);
			expect(useComposerInputStore.getState().aiValue).toBe(draft.text);
		}
	);

	it.each(['handoff', 'review'] as const)(
		'preserves classic automatic naming for %s',
		async (mode) => {
			const result = await openHandoffTarget(request({ mode, send: true }));
			const target = sessions()[1];
			const tab = target.aiTabs.find((item) => item.id === result.tabId)!;
			expect(tab.name).toBeNull();
			expect(result.title).toBeUndefined();
			requestTabAutoNameForMessage(target, tab.id, '# Handoff\nSource: internal');
			expect(window.maestro.tabNaming.generateTabName).toHaveBeenCalledOnce();
		}
	);

	it('keeps the first source title through consecutive handoffs', async () => {
		useSettingsStore.setState({ newShell: true, uiLanguage: 'zh-CN' });
		useSessionStore.getState().updateSession('source', {
			aiTabs: [
				{
					...sessions()[0].aiTabs[0],
					name: '接手：Original',
					origin: request().origin,
				},
			],
		});
		const snapshot = await readHandoffSource({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			provider: 'claude-code',
		});
		expect(snapshot?.sourceTitle).toBe('Original');
		const result = await openHandoffTarget(
			request({
				mode: 'review',
				origin: { ...request().origin, kind: 'review', sourceTitle: snapshot?.sourceTitle },
			})
		);
		expect(result.title).toBe('复核：Original');
	});

	it.each([
		'message',
		'native',
		'draft',
		'live draft',
		'composer draft',
		'image',
		'busy',
		'deferred',
		'queued',
		'multiple',
	])('preserves a target with %s', async (reason) => {
		const tab = createMockAITab({
			id: 'target-empty',
			logs: [],
			agentSessionId: null,
			inputValue: '',
		});
		if (reason === 'message')
			tab.logs = [{ id: 'old', timestamp: 1, source: 'user', text: 'Keep me' }];
		if (reason === 'native') tab.agentSessionId = 'native';
		if (reason === 'draft') tab.inputValue = ' ';
		if (reason === 'live draft') setLiveDraft(tab.id, 'unsaved');
		if (reason === 'composer draft')
			useComposerInputStore.getState().loadAiDraft(tab.id, 'unsaved', 'off');
		if (reason === 'image') tab.stagedImages = ['data:image/png;base64,synthetic'];
		if (reason === 'busy') tab.state = 'busy';
		const tabs = reason === 'multiple' ? [tab, createMockAITab({ id: 'another' })] : [tab];
		useSessionStore.getState().updateSession('target', {
			aiTabs: tabs,
			...(reason === 'deferred' ? { deferredContent: { tabIds: [tab.id] } } : {}),
			...(reason === 'queued'
				? {
						executionQueue: [
							{
								id: 'queued',
								tabId: tab.id,
								type: 'message' as const,
								text: 'Pending send',
								timestamp: 1,
							},
						],
					}
				: {}),
		});
		const before = JSON.stringify(tabs);
		const result = await openHandoffTarget(request());
		expect(result.success).toBe(true);
		expect(result.tabId).not.toBe(tab.id);
		expect(sessions()[1].aiTabs).toHaveLength(tabs.length + 1);
		expect(JSON.stringify(sessions()[1].aiTabs.slice(0, tabs.length))).toBe(before);
	});

	it.each([
		['en', 'handoff', 'Continued: Original'],
		['en', 'review', 'Review: Original'],
		['zh-CN', 'handoff', '接手：Original'],
		['zh-CN', 'review', '复核：Original'],
	] as const)(
		'names %s %s before sending and keeps it during automatic naming',
		async (uiLanguage, mode, name) => {
			useSettingsStore.setState({ uiLanguage, newShell: true });
			const result = await openHandoffTarget(
				request({ mode, origin: { ...request().origin, kind: mode }, send: true })
			);
			expect(result).toMatchObject({ success: true, title: name });
			const target = sessions()[1];
			const tab = target.aiTabs.find((item) => item.id === result.tabId)!;
			expect(tab.name).toBe(name);
			expect(tab.origin).toMatchObject({ kind: mode, sourceTitle: 'Original' });
			const saved = vi.mocked(window.maestro.sessions.setMany).mock.calls[0][0] as ReturnType<
				typeof sessions
			>;
			expect(saved[0].aiTabs.find((item) => item.id === tab.id)?.name).toBe(name);
			requestTabAutoNameForMessage(target, tab.id, '# Handoff\nSource: internal');
			expect(sessions()[1].aiTabs.find((item) => item.id === tab.id)?.name).toBe(name);
			expect(window.maestro.tabNaming.generateTabName).not.toHaveBeenCalled();
			expect(enqueuePromptForTab).toHaveBeenCalledWith({
				sessionId: target.id,
				tabId: tab.id,
				text: draft.text,
			});
		}
	);

	it('retains the source title in a snapshot and uses the tool name when there is no title', async () => {
		useSettingsStore.setState({ newShell: true });
		const snapshot = await readHandoffSource({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			provider: 'claude-code',
		});
		expect(snapshot).toMatchObject({ sourceTitle: 'Original' });
		useSessionStore.getState().updateSession('source', { aiTabs: [] });
		const result = await openHandoffTarget(
			request({
				origin: { ...request().origin, sourceTitle: undefined },
				sourcePermission: snapshot?.sourcePermission,
			})
		);
		expect(result).toMatchObject({ title: 'Continued: Claude Code' });
	});

	it('keeps a captured title in a new runner when the source lives in another window', async () => {
		useSettingsStore.setState({ newShell: true });
		useSessionStore.setState({ sessions: [] });
		const result = await openHandoffTarget(
			request({
				runnerId: undefined,
				sourcePermission: { permissionMode: 'readonly', readOnlyMode: true },
			})
		);
		expect(result).toMatchObject({
			success: true,
			createdAgent: true,
			title: 'Continued: Original',
		});
		expect(sessions()[0].aiTabs[0]).toMatchObject({
			name: 'Continued: Original',
			inputValue: draft.text,
			origin: { sourceTitle: 'Original' },
		});
	});

	it.each([false, true])(
		'replaces only empty conversations with live drafts, new shell %s',
		async (newShell) => {
			useSettingsStore.setState({ newShell });
			useSessionStore.getState().updateSession('source', {
				aiTabs: [
					createMockAITab({
						id: 'source-tab',
						logs: [],
						agentSessionId: null,
						inputValue: 'older',
						customModel: 'source-only',
						customEffort: 'high',
					}),
				],
			});
			useComposerInputStore.getState().loadAiDraft('source-tab', 'half written', 'off');
			useSessionStore
				.getState()
				.updateSession('target', { customModel: 'target-model', customEffort: 'low' });
			const result = await openHandoffTarget(
				request({ newConversation: { replaceTabId: 'source-tab' }, background: false })
			);
			expect(result.success).toBe(newShell);
			expect(enqueuePromptForTab).not.toHaveBeenCalled();
			if (newShell) {
				expect(sessions().find((s) => s.id === 'source')).toBeUndefined();
				expect(window.maestro.sessions.setMany).toHaveBeenCalledWith(expect.any(Array), ['source']);
				const tab = sessions()
					.find((s) => s.id === 'target')!
					.aiTabs.find((tab) => tab.id === result.tabId)!;
				expect(tab.inputValue).toBe('half written');
				expect(tab.origin).toBeUndefined();
				expect(tab.handoffDraft).toBeUndefined();
				expect(tab.customModel).toBeUndefined();
				expect(tab.customEffort).toBeUndefined();
				expect(sessions().find((s) => s.id === 'target')).toMatchObject({
					customModel: 'target-model',
					customEffort: 'low',
				});
			} else expect(sessions()[0].aiTabs).toHaveLength(1);
			useSettingsStore.setState({ newShell: false });
		}
	);

	it.each([
		'message',
		'busy',
		'native',
		'stored draft',
		'live draft',
		'composer draft',
		'image',
	] as const)('retains the source when %s changes during target persistence', async (change) => {
		useSettingsStore.setState({ newShell: true });
		useSessionStore.getState().updateSession('source', {
			aiTabs: [
				createMockAITab({
					id: 'source-tab',
					logs: [],
					agentSessionId: null,
					inputValue: 'draft',
				}),
			],
		});
		useComposerInputStore.getState().loadAiDraft('source-tab', 'draft', 'off');
		let release!: (saved: boolean) => void;
		vi.mocked(window.maestro.sessions.setMany).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		const pending = openHandoffTarget(
			request({ newConversation: { replaceTabId: 'source-tab' }, background: false })
		);
		await vi.waitFor(() => expect(release).toBeTypeOf('function'));
		const source = sessions()[0];
		const tab = source.aiTabs[0];
		if (change === 'message')
			tab.logs = [{ id: 'new', timestamp: 4, source: 'user', text: 'keep this' }];
		if (change === 'busy') tab.state = 'busy';
		if (change === 'native') tab.agentSessionId = 'new-native';
		if (change === 'stored draft') tab.inputValue = 'changed draft';
		if (change === 'live draft') setLiveDraft(tab.id, 'changed draft');
		if (change === 'composer draft') useComposerInputStore.getState().setAiValue('changed draft');
		if (change === 'image') tab.stagedImages = ['data:image/png;base64,new'];
		useSessionStore.getState().updateSession(source.id, { aiTabs: [{ ...tab }] });
		release(true);
		await pending;
		expect(sessions().find((s) => s.id === 'source')?.aiTabs).toEqual([tab]);
		expect(
			vi
				.mocked(window.maestro.sessions.setMany)
				.mock.calls.every(
					([saved, removed]) =>
						!removed?.includes('source') &&
						!(saved as (typeof source)[]).some(
							(s) => s.id === 'source' && !s.aiTabs.some((t) => t.id === 'source-tab')
						)
				)
		).toBe(true);
		expect(useSessionStore.getState().activeSessionId).toBe('source');
	});

	it('holds and releases the source send lock around failed persistence', async () => {
		useSettingsStore.setState({ newShell: true });
		useSessionStore.getState().updateSession('source', {
			aiTabs: [createMockAITab({ id: 'source-tab', logs: [], agentSessionId: null })],
		});
		let release!: (saved: boolean) => void;
		vi.mocked(window.maestro.sessions.setMany).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		const pending = openHandoffTarget(request({ newConversation: { replaceTabId: 'source-tab' } }));
		await vi.waitFor(() => expect(release).toBeTypeOf('function'));
		const locked = useOperationStore.getState().tabReplacementLocks?.['source-tab'];
		release(false);
		expect((await pending).success).toBe(false);
		expect(locked).toBe(1);
		expect(useOperationStore.getState().tabReplacementLocks?.['source-tab']).toBeUndefined();
		expect(sessions()[0].aiTabs[0].id).toBe('source-tab');
	});

	it.each(['composer', 'live draft', 'stored draft', 'other tab'] as const)(
		'restores source changes during source persistence: %s',
		async (change) => {
			useSettingsStore.setState({ newShell: true });
			useSessionStore.getState().updateSession('source', {
				aiTabs: [
					createMockAITab({
						id: 'source-tab',
						logs: [],
						agentSessionId: null,
						inputValue: 'draft',
					}),
				],
			});
			useComposerInputStore.getState().loadAiDraft('source-tab', 'draft', 'off');
			let release!: (saved: boolean) => void;
			vi.mocked(window.maestro.sessions.setMany)
				.mockResolvedValueOnce(true)
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							release = resolve;
						})
				);
			const pending = openHandoffTarget(
				request({ newConversation: { replaceTabId: 'source-tab' }, background: false })
			);
			await vi.waitFor(() => expect(release).toBeTypeOf('function'));
			if (change === 'composer')
				useComposerInputStore.getState().setAiValue('latest unsaved draft');
			else if (change === 'live draft') setLiveDraft('source-tab', 'latest unsaved draft');
			else if (change === 'stored draft')
				useSessionStore.getState().updateSession('source', {
					aiTabs: [{ ...sessions()[0].aiTabs[0], inputValue: 'latest unsaved draft' }],
				});
			else
				useSessionStore.getState().updateSession('source', {
					aiTabs: [
						...sessions()[0].aiTabs,
						createMockAITab({ id: 'new-other', inputValue: 'other content' }),
					],
				});
			release(true);
			await pending;
			expect(vi.mocked(window.maestro.sessions.setMany).mock.calls[1][1]).toEqual([]);
			const source = sessions().find((s) => s.id === 'source')!;
			expect(source).toBeDefined();
			const restored = vi
				.mocked(window.maestro.sessions.setMany)
				.mock.calls.at(-1)![0] as (typeof source)[];
			expect(restored[0].id).toBe('source');
			if (change !== 'other tab')
				expect(restored[0].aiTabs[0].inputValue).toBe('latest unsaved draft');
			else
				expect(restored[0].aiTabs.find((t) => t.id === 'new-other')?.inputValue).toBe(
					'other content'
				);
			expect(useSessionStore.getState().activeSessionId).toBe('source');
		}
	);

	it('reads replacement text and images from the owning live composer', async () => {
		useSettingsStore.setState({ newShell: true });
		useSessionStore.getState().updateSession('source', {
			aiTabs: [
				createMockAITab({
					id: 'source-tab',
					logs: [],
					agentSessionId: null,
					inputValue: 'stale',
					stagedImages: ['data:image/png;base64,live'],
				}),
			],
		});
		useComposerInputStore.getState().loadAiDraft('source-tab', 'latest draft', 'shell');
		const snapshot = await readHandoffSource({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			provider: 'claude-code',
			emptyConversation: true,
		});
		expect(snapshot).toMatchObject({
			draft: { text: 'latest draft' },
			emptyConversation: { stagedImages: ['data:image/png;base64,live'], commandMode: 'shell' },
		});
	});

	it('uses a remote owner snapshot without writing or deleting its stale mirror', async () => {
		useSettingsStore.setState({ newShell: true });
		const before = JSON.stringify(sessions()[0]);
		const result = await openHandoffTarget(
			request({
				newConversation: {
					replaceTabId: 'source-tab',
					source: { stagedImages: ['data:image/png;base64,live'], commandMode: 'shell' },
				},
				draft: { ...draft, text: 'latest draft' },
			})
		);
		expect(result.success).toBe(true);
		expect(JSON.stringify(sessions()[0])).toBe(before);
		expect(sessions()[1].aiTabs.find((t) => t.id === result.tabId)).toMatchObject({
			inputValue: 'latest draft',
			stagedImages: ['data:image/png;base64,live'],
			commandMode: 'shell',
		});
		expect(window.maestro.sessions.setMany).toHaveBeenCalledExactlyOnceWith(
			[expect.objectContaining({ id: 'target' })],
			[]
		);
	});

	it('persists review origin and read-only mode before queueing', async () => {
		const origin = { ...request().origin, kind: 'review' as const };
		vi.mocked(window.maestro.agents.get).mockResolvedValue({
			capabilities: { supportsReadOnlyMode: true },
		} as never);
		const result = await openHandoffTarget(request({ mode: 'review', origin, send: true }));
		expect(result).toMatchObject({ success: true, mode: 'review' });
		const saved = vi.mocked(window.maestro.sessions.setMany).mock.calls[0][0] as ReturnType<
			typeof sessions
		>;
		expect(saved[0].aiTabs.find((tab) => tab.id === result.tabId)).toMatchObject({
			origin,
			readOnlyMode: true,
			permissionMode: 'readonly',
		});
	});

	it('reads review changes in the SSH worktree and records the native source', async () => {
		useSessionStore.setState({
			sessions: sessions().map((session) =>
				session.id === 'source'
					? {
							...session,
							sessionSshRemoteConfig: {
								enabled: true,
								remoteId: 'remote',
								workingDirOverride: '/remote/tree',
							},
						}
					: session
			),
		});
		vi.mocked(gitService.getChanges).mockResolvedValue({
			root: '/remote/tree',
			branch: 'topic',
			files: [],
			totals: { files: 0, additions: 0, deletions: 0 },
			truncated: false,
		});
		const snapshot = await readHandoffSource({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			provider: 'claude-code',
			mode: 'review',
		});
		expect(snapshot).toMatchObject({
			cwd: '/remote/tree',
			sourceNativeSessionId: 'native-original',
		});
		expect(gitService.getChanges).toHaveBeenCalledWith('/project', 'remote', '/remote/tree');
		expect(snapshot?.draft.text).toContain('git diff HEAD');
	});

	it('creates an SSH reviewer in the effective worktree and refuses a stale runner', async () => {
		const ssh = { enabled: true, remoteId: 'remote', workingDirOverride: '/remote/tree' };
		vi.mocked(window.maestro.agents.get).mockResolvedValue({
			capabilities: { supportsReadOnlyMode: false },
		} as never);
		const stale = await openHandoffTarget(
			request({ cwd: '/remote/tree', sessionSshRemoteConfig: ssh, mode: 'review' })
		);
		expect(stale).toMatchObject({ success: false, code: 'unavailable' });
		const result = await openHandoffTarget(
			request({
				runnerId: undefined,
				cwd: '/remote/tree',
				sessionSshRemoteConfig: ssh,
				mode: 'review',
			})
		);
		const target = sessions().find((item) => item.id === result.agentId)!;
		expect(target).toMatchObject({
			cwd: '/remote/tree',
			shellCwd: '/remote/tree',
			sessionSshRemoteConfig: ssh,
		});
		expect(target.aiTabs.find((tab) => tab.id === result.tabId)?.readOnlyMode).not.toBe(true);
		expect(window.maestro.agents.get).toHaveBeenCalledWith('codex', 'remote');
	});

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
		expect(tab.origin).toEqual(request().origin);
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

describe('new shell permission boundaries', () => {
	it.each(['handoff', 'review'] as const)('keeps readonly in a %s target', async (mode) => {
		useSettingsStore.setState({ newShell: true });
		sessions()[0].aiTabs[0].readOnlyMode = true;
		const result = await openHandoffTarget(request({ mode }));
		expect(result.success).toBe(true);
		expect(sessions()[1].aiTabs.find((tab) => tab.id === result.tabId)).toMatchObject({
			permissionMode: 'readonly',
			readOnlyMode: true,
		});
	});

	it('tightens standard to readonly when switching to Codex', async () => {
		useSettingsStore.setState({ newShell: true });
		sessions()[0].aiTabs[0].permissionMode = 'standard';
		const result = await openHandoffTarget(request());
		expect(sessions()[1].aiTabs.find((tab) => tab.id === result.tabId)).toMatchObject({
			permissionMode: 'readonly',
			readOnlyMode: true,
		});
	});

	it('keeps permission when changing the tool in an empty conversation', async () => {
		useSettingsStore.setState({ newShell: true });
		sessions()[0].aiTabs = [
			createMockAITab({
				id: 'source-tab',
				logs: [],
				agentSessionId: null,
				inputValue: '',
				readOnlyMode: true,
			}),
		];
		const result = await openHandoffTarget(
			request({ newConversation: { replaceTabId: 'source-tab' } })
		);
		expect(result.success).toBe(true);
		expect(
			sessions()
				.find((session) => session.id === result.agentId)
				?.aiTabs.find((tab) => tab.id === result.tabId)
		).toMatchObject({ permissionMode: 'readonly', readOnlyMode: true });
	});
});

describe('permission metadata across renderer owners', () => {
	it('project provider creation uses fresh owner permissions instead of stale full copies', async () => {
		useSettingsStore.setState({ newShell: true });
		window.maestro.windows = {
			...window.maestro.windows,
			getConversationPermissions: vi.fn(async (ids: string[]) =>
				ids.map((sessionId, index) => ({
					...conversationPermissionSnapshot(sessionId)!,
					tabs: [
						{
							id: `${sessionId}-tab`,
							lastActivity: index + 1,
							permissionMode: 'readonly' as const,
							readOnlyMode: true,
						},
					],
				}))
			),
		};
		const result = await openHandoffTarget(
			request({ newConversation: {}, origin: { ...request().origin, sourceTabId: '' } })
		);
		expect(result.success).toBe(true);
		expect(
			sessions()
				.find((session) => session.id === result.agentId)
				?.aiTabs.find((tab) => tab.id === result.tabId)
		).toMatchObject({ permissionMode: 'readonly', readOnlyMode: true });
		expect(window.maestro.windows.getConversationPermissions).toHaveBeenCalled();
	});

	it('captures legacy permission without reading history or building a handoff', async () => {
		sessions()[0].aiTabs[0].readOnlyMode = true;
		const result = await readHandoffSource({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			provider: 'claude-code',
			permissionOnly: true,
		});
		expect(result).toMatchObject({
			sourcePermission: { permissionMode: 'readonly', readOnlyMode: true },
			draft: { text: '' },
		});
		expect(gitService.getChanges).not.toHaveBeenCalled();
	});
	it('carries the exact handoff source permission even if another tab is more recent', async () => {
		sessions()[0].aiTabs[0].permissionMode = 'standard';
		sessions()[0].aiTabs.push(createMockAITab({ permissionMode: 'full' }));
		const result = await readHandoffSource({
			sourceAgentId: 'source',
			sourceTabId: 'source-tab',
			provider: 'claude-code',
		});
		expect(result?.sourcePermission).toEqual({ permissionMode: 'standard', readOnlyMode: false });
	});
	it('uses the snapshot when the empty source is in another window', async () => {
		useSettingsStore.setState({ newShell: true });
		useSessionStore.setState({ sessions: [sessions()[1]] });
		const result = await openHandoffTarget(
			request({
				sourcePermission: { permissionMode: 'readonly', readOnlyMode: true },
				newConversation: { replaceTabId: 'remote-empty', source: { stagedImages: [] } },
			})
		);
		expect(result.success).toBe(true);
		expect(sessions()[0].aiTabs.find((tab) => tab.id === result.tabId)).toMatchObject({
			permissionMode: 'readonly',
			readOnlyMode: true,
		});
	});
	it('inherits the latest project permission from the project plus provider picker', async () => {
		useSettingsStore.setState({ newShell: true });
		sessions()[0].aiTabs[0].readOnlyMode = true;
		sessions()[0].aiTabs[0].createdAt = 20;
		sessions()[1].aiTabs[0].createdAt = 1;
		const result = await openHandoffTarget(
			request({ newConversation: {}, origin: { ...request().origin, sourceTabId: '' } })
		);
		expect(result.success).toBe(true);
		expect(sessions()[1].aiTabs.find((tab) => tab.id === result.tabId)).toMatchObject({
			permissionMode: 'readonly',
			readOnlyMode: true,
		});
	});
	it.each([
		['interactive', false],
		['dynamic', false],
		['interactive', true],
		['dynamic', true],
	] as const)(
		'tightens handoff to Claude %s with existing target=%s',
		async (maestroPMode, existing) => {
			useSettingsStore.setState({ newShell: true });
			vi.mocked(window.maestro.agents.getCapabilities).mockResolvedValueOnce({
				supportsStandardPermissionMode: true,
				supportsReadOnlyMode: true,
			} as never);
			if (existing)
				useSessionStore
					.getState()
					.updateSession('target', { toolType: 'claude-code', enableMaestroP: true, maestroPMode });
			const result = await openHandoffTarget(
				request({
					runnerId: existing ? 'target' : undefined,
					config: {
						toolType: 'claude-code',
						...(existing ? {} : { enableMaestroP: true, maestroPMode }),
					},
					provider: existing ? 'claude-code' : 'deepseek',
					sourcePermission: { permissionMode: 'standard', readOnlyMode: false },
				})
			);
			expect(result.success).toBe(true);
			const target = sessions().find((session) => session.id === result.agentId)!;
			expect(target).toMatchObject({ enableMaestroP: true, maestroPMode });
			expect(target.aiTabs.find((tab) => tab.id === result.tabId)).toMatchObject({
				permissionMode: 'readonly',
				readOnlyMode: true,
			});
		}
	);

	it('preserves standard in a supported Claude or DeepSeek target', async () => {
		useSettingsStore.setState({ newShell: true });
		vi.mocked(window.maestro.agents.getCapabilities).mockResolvedValueOnce({
			supportsStandardPermissionMode: true,
			supportsReadOnlyMode: true,
		} as never);
		const result = await openHandoffTarget(
			request({
				runnerId: undefined,
				config: { toolType: 'claude-code' },
				provider: 'deepseek',
				sourcePermission: { permissionMode: 'standard', readOnlyMode: false },
			})
		);
		expect(result.success).toBe(true);
		expect(
			sessions()
				.find((session) => session.id === result.agentId)
				?.aiTabs.find((tab) => tab.id === result.tabId)
		).toMatchObject({ permissionMode: 'standard', readOnlyMode: false });
	});
});

it('refuses a new shell handoff when neither the source nor its permission snapshot is available', async () => {
	useSettingsStore.setState({ newShell: true });
	useSessionStore.getState().updateSession('source', { aiTabs: [] });
	const before = sessions()[1].aiTabs;
	const result = await openHandoffTarget(request());
	expect(result).toMatchObject({ success: false, code: 'unavailable' });
	expect(sessions()[1].aiTabs).toEqual(before);
});

describe('project conversation configuration isolation', () => {
	it('creates a separate runner for project environment changes and preserves old account identity', async () => {
		useSettingsStore.setState({
			newShell: true,
			projectSettings: {
				'[null,"/project"]': {
					defaultProvider: 'codex',
					defaultModel: 'project-model',
					defaultReasoningEffort: 'high',
					defaultPermissionMode: 'readonly',
					envVars: { CODEX_HOME: '/synthetic/project-account', PROJECT_VALUE: 'new' },
				},
			},
		});
		const oldTarget = sessions()[1];
		useSessionStore.getState().updateSession('target', {
			customEnvVars: { CODEX_HOME: '/synthetic/old-account', PRESERVED: 'yes' },
		});
		const result = await openHandoffTarget(
			request({
				newConversation: {},
				sourcePermission: { permissionMode: 'full', readOnlyMode: false },
				config: {
					toolType: 'codex',
					customEnvVars: { CODEX_HOME: '/synthetic/old-account', PRESERVED: 'yes' },
				},
			})
		);
		expect(result.success).toBe(true);
		expect(result.agentId).not.toBe('target');
		const owner = sessions().find((session) => session.id === result.agentId)!;
		expect(owner.customEnvVars).toEqual({
			CODEX_HOME: '/synthetic/project-account',
			PROJECT_VALUE: 'new',
			PRESERVED: 'yes',
		});
		expect(owner.aiTabs[0]).toMatchObject({
			customModel: 'project-model',
			customEffort: 'high',
			permissionMode: 'readonly',
		});
		expect(sessions().find((session) => session.id === 'target')!.aiTabs).toEqual(oldTarget.aiTabs);
		expect(sessions().find((session) => session.id === 'target')!.customEnvVars?.CODEX_HOME).toBe(
			'/synthetic/old-account'
		);
	});
});

it('inherits current conversation model, effort and account above project defaults', async () => {
	useSettingsStore.setState({
		newShell: true,
		projectSettings: {
			'[null,"/project"]': {
				defaultModel: 'project-model',
				defaultReasoningEffort: 'high',
				defaultPermissionMode: 'full',
				fullAccessAcknowledged: true,
				envVars: { CODEX_HOME: '/synthetic/new-account', PROJECT_ONLY: 'new' },
			},
		},
	});
	useSessionStore.getState().updateSession('target', {
		customEnvVars: { CODEX_HOME: '/synthetic/current-account' },
		aiTabs: [
			createMockAITab({
				id: 'current',
				customModel: 'current-model',
				customEffort: 'low',
				permissionMode: 'readonly',
			}),
		],
	});
	const result = await openHandoffTarget(
		request({
			sourceAgentId: 'target',
			newConversation: { sourceTabId: 'current' },
			config: { toolType: 'codex' },
		})
	);
	expect(result.success).toBe(true);
	const owner = sessions().find((session) => session.id === result.agentId)!;
	expect(owner.customEnvVars).toEqual({
		CODEX_HOME: '/synthetic/current-account',
		PROJECT_ONLY: 'new',
	});
	expect(owner.aiTabs.find((tab) => tab.id === result.tabId)).toMatchObject({
		customModel: 'current-model',
		customEffort: 'low',
		permissionMode: 'readonly',
	});
});

it('clears a project environment override for future conversations without changing an old runner', async () => {
	useSettingsStore.setState({
		newShell: true,
		projectSettings: { '[null,"/project"]': { envVars: {} } },
	});
	useSessionStore.getState().updateSession('target', {
		customEnvVars: { CODEX_HOME: '/synthetic/project-account', PROJECT_VALUE: 'old' },
		projectSettingsBaseEnv: { CODEX_HOME: '/synthetic/base-account' },
	} as never);
	const result = await openHandoffTarget(
		request({
			newConversation: {},
			sourcePermission: { permissionMode: 'full', readOnlyMode: false },
			config: {
				toolType: 'codex',
				customEnvVars: { CODEX_HOME: '/synthetic/project-account', PROJECT_VALUE: 'old' },
			},
		})
	);
	expect(result.success).toBe(true);
	expect(result.agentId).not.toBe('target');
	expect(sessions().find((session) => session.id === result.agentId)?.customEnvVars).toEqual({
		CODEX_HOME: '/synthetic/base-account',
	});
	expect(sessions().find((session) => session.id === 'target')?.customEnvVars?.PROJECT_VALUE).toBe(
		'old'
	);
});

it('loads project environment through the dedicated service after general settings hydration redacts it', async () => {
	useSettingsStore.setState({
		newShell: true,
		projectSettings: { '[null,"/project"]': { envVars: {} } },
	});
	vi.mocked(window.maestro.settings.projectSettings).mockResolvedValueOnce({
		success: true,
		scope: { projectPath: '/project' },
		settings: { envVars: { PROJECT_TOKEN: 'synthetic-private-token' } },
	});
	const result = await openHandoffTarget(
		request({ newConversation: {}, sourcePermission: { permissionMode: 'full' } })
	);
	expect(result.success).toBe(true);
	expect(sessions().find((session) => session.id === result.agentId)?.customEnvVars).toEqual({
		PROJECT_TOKEN: 'synthetic-private-token',
	});
});

it('creates a tiled project conversation with its resolved environment and actual owner', async () => {
	Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
	useSettingsStore.setState({
		newShell: true,
		newShellSplit: null,
		projectSettings: {
			'[null,"/project"]': {
				defaultProvider: 'codex',
				envVars: { PROJECT_ONLY: 'synthetic-project-env' },
			},
		},
	});
	const oldTarget = structuredClone(sessions()[1]);
	window.maestro.context.conversation = vi.fn(async () =>
		openHandoffTarget(
			request({
				newConversation: {},
				sourcePermission: { permissionMode: 'readonly' },
				background: true,
			})
		)
	);
	expect(await tileNewTabInSession('source', 'ai')).toBe(true);
	expect(window.maestro.context.conversation).toHaveBeenCalledWith(
		expect.objectContaining({
			action: 'new-conversation',
			sourceAgentId: 'source',
			targetProvider: 'codex',
			background: true,
		})
	);
	const split = useSettingsStore.getState().newShellSplit!;
	expect(split.left).toEqual({ sessionId: 'source', tabId: 'source-tab' });
	expect(split.right.sessionId).not.toBe('target');
	const created = sessions().find((session) => session.id === split.right.sessionId)!;
	expect(created.customEnvVars).toEqual({ PROJECT_ONLY: 'synthetic-project-env' });
	expect(created.aiTabs.find((tab) => tab.id === split.right.tabId)?.permissionMode).toBe(
		'readonly'
	);
	expect(sessions().find((session) => session.id === 'target')).toEqual(oldTarget);
});
