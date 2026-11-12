import { createMockAITab, createMockFileTab } from '../../../helpers/mockTab';
/**
 * Covers the `update_session_config` allowlist in useAppRemoteEventListeners -
 * the single gate every CLI-driven per-agent edit passes through.
 *
 * The invariants under test: allowlisted keys are written and flushed to disk
 * before the ack (so a CLI read straight after the write is not racing the
 * renderer's debounced persistence), and anything outside the allowlist is
 * dropped rather than written into Session internals.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useAppRemoteEventListeners } from '../../../../renderer/hooks/remote/useAppRemoteEventListeners';
import { createMockSession } from '../../../helpers/mockSession';
import type { Session } from '../../../../renderer/types';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { getModalActions, useModalStore } from '../../../../renderer/stores/modalStore';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { compactToolOutput } from '../../../../shared/toolOutput';
import { mkdtemp, readFile, rm, stat, writeFile as writeDiskFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../../../renderer/stores/settingsStore', () => ({
	useSettingsStore: Object.assign(vi.fn(), { getState: vi.fn(() => ({})) }),
}));
vi.mock('../../../../renderer/hooks/batch/batchUtils', () => ({ DEFAULT_BATCH_PROMPT: '' }));
vi.mock('../../../../renderer/services/git', () => ({ gitService: {} }));
vi.mock('../../../../renderer/utils/worktreeSpawn', () => ({
	spawnWorktreeAgentAndDispatch: vi.fn(),
}));
vi.mock('../../../../renderer/stores/notificationStore', () => ({ notifyToast: vi.fn() }));
vi.mock('../../../../renderer/utils/browserTabPersistence', () => ({
	getBrowserTabPartition: () => 'persist:test',
}));
vi.mock('../../../../renderer/utils/ids', () => ({ generateId: () => 'new-tab-id' }));

const ack = vi.fn();
const setMany = vi.fn().mockResolvedValue(undefined);

function setup(sessions: Session[], liveState = false) {
	useSessionStore.setState({ sessions });
	const sessionsRef = { current: sessions };
	const setSessions = vi.fn(liveState ? useSessionStore.getState().setSessions : undefined);

	renderHook(() =>
		useAppRemoteEventListeners({
			sessionsRef,
			setActiveSessionId: vi.fn(),
			setSessions,
			setGroups: vi.fn(),
			handleOpenFileTab: vi.fn(),
			refreshFileTree: vi.fn(),
			handleAutoRunRefresh: vi.fn(),
			startBatchRun: vi.fn(),
			stopBatchRun: vi.fn(),
			resumeAfterError: vi.fn(),
			skipCurrentDocument: vi.fn(),
			abortBatchOnError: vi.fn(),
		} as any)
	);

	return { setSessions };
}

/** Run the reducer that setSessions was called with against the given state. */
function applyUpdate(setSessions: Mock, sessions: Session[]): Session[] {
	const updater = setSessions.mock.calls[0][0] as (prev: Session[]) => Session[];
	return updater(sessions);
}

function dispatchPatch(sessionId: string, configPatch: Record<string, unknown>) {
	window.dispatchEvent(
		new CustomEvent('maestro:remoteUpdateSessionConfig', {
			detail: { sessionId, configPatch, responseChannel: 'ch' },
		})
	);
}

/** Let the handler's awaited setMany + ack settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(useSettingsStore.getState).mockReturnValue({ newShell: false } as never);
	(window as any).maestro = {
		process: {
			sendRemoteUpdateSessionConfigResponse: ack,
			kill: vi.fn().mockResolvedValue(undefined),
		},
		sessions: { setMany },
		agents: {
			getCapabilities: vi.fn().mockResolvedValue({ supportsReadOnlyMode: true }),
		},
	};
});

describe('maestro:remoteUpdateSessionConfig', () => {
	it.each([true, false])(
		'opens Edit Agent from the saved CLI config in newShell=%s',
		async (newShell) => {
			vi.mocked(useSettingsStore.getState).mockReturnValue({ newShell } as never);
			// /tmp does not exist on Windows; use the platform temp directory.
			const root = await mkdtemp(join(tmpdir(), 'maestro-config-sync-'));
			const file = join(root, 'sessions.json');
			const owner = createMockSession({
				customPath: '/fixture/next-path',
				enableMaestroP: false,
				maestroPMode: 'dynamic',
			});
			try {
				await writeDiskFile(file, JSON.stringify([owner]));
				setMany.mockImplementationOnce(async (sessions: Session[]) => {
					await writeDiskFile(file, JSON.stringify(sessions));
					return true;
				});
				setup([owner], true);
				dispatchPatch(owner.id, {
					customPath: '/fixture/custom-path',
					enableMaestroP: true,
					maestroPMode: 'dynamic',
				});
				await waitFor(() => expect(ack).toHaveBeenCalledWith('ch', { success: true }));
				const [disk] = JSON.parse(await readFile(file, 'utf8'));
				const current = useSessionStore.getState().sessions[0];
				expect(current).toEqual(disk);
				expect(current.customPath).toBe('/fixture/custom-path');
				// Sidebar equality deliberately retains this pre-edit object.
				getModalActions().setEditAgentSession(owner);
				expect(useModalStore.getState().getData('editAgent')?.session).toEqual(disk);
			} finally {
				useModalStore.getState().closeAll();
				await rm(root, { recursive: true, force: true });
			}
		}
	);

	it('updates and persists the account environment while preserving the legacy command report', async () => {
		vi.mocked(useSettingsStore.getState).mockReturnValue({ newShell: true } as never);
		const session = createMockSession({
			customEnvVars: { CLAUDE_CONFIG_DIR: '/temporary/account-a' },
			agentCommands: [{ command: '/plugin:review', description: '' }],
		});
		const { setSessions } = setup([session]);
		const customEnvVars = { CLAUDE_CONFIG_DIR: '/temporary/account-b' };
		dispatchPatch(session.id, { customEnvVars });
		await flush();
		const [updated] = applyUpdate(setSessions, [session]);
		expect(updated.customEnvVars).toEqual(customEnvVars);
		expect(updated.agentCommands).toBe(session.agentCommands);
		expect(setMany).toHaveBeenCalledWith([updated], []);
		expect(ack).toHaveBeenCalledWith('ch', { success: true });
		expect(setMany.mock.invocationCallOrder[0]).toBeLessThan(ack.mock.invocationCallOrder[0]);
	});

	it('tightens every new-shell tab when the next provider cannot keep standard permission', async () => {
		vi.mocked(useSettingsStore.getState).mockReturnValue({ newShell: true } as never);
		const session = createMockSession({
			toolType: 'claude-code',
			aiTabs: [
				createMockAITab({ id: 'standard', permissionMode: 'standard', readOnlyMode: false }),
				createMockAITab({ id: 'readonly', readOnlyMode: true }),
				createMockAITab({ id: 'full', permissionMode: 'full', readOnlyMode: false }),
			],
		});
		const { setSessions } = setup([session]);
		dispatchPatch(session.id, { toolType: 'codex' });
		await flush();
		const [updated] = applyUpdate(setSessions, [session]);
		expect(
			updated.aiTabs.map(({ permissionMode, readOnlyMode }) => ({ permissionMode, readOnlyMode }))
		).toEqual([
			{ permissionMode: 'readonly', readOnlyMode: true },
			{ permissionMode: 'readonly', readOnlyMode: true },
			{ permissionMode: 'full', readOnlyMode: false },
		]);
		expect(session.aiTabs[0].permissionMode).toBe('standard');
		expect(setMany).toHaveBeenCalledWith([updated], []);
		expect(ack).toHaveBeenCalledWith('ch', { success: true });
	});

	it('refuses the entire new-shell provider switch when one tab cannot retain its restriction', async () => {
		vi.mocked(useSettingsStore.getState).mockReturnValue({ newShell: true } as never);
		vi.mocked(window.maestro.agents.getCapabilities).mockResolvedValue({
			supportsReadOnlyMode: false,
		} as never);
		const session = createMockSession({
			toolType: 'claude-code',
			aiTabs: [createMockAITab({ permissionMode: 'readonly', readOnlyMode: true })],
		});
		const { setSessions } = setup([session]);
		dispatchPatch(session.id, { toolType: 'gemini' });
		await flush();
		expect(setSessions).not.toHaveBeenCalled();
		expect(setMany).not.toHaveBeenCalled();
		expect(window.maestro.process.kill).not.toHaveBeenCalled();
		expect(ack).toHaveBeenCalledWith('ch', {
			success: false,
			error: 'This tool cannot preserve the source conversation permissions.',
		});
	});

	it.each(['idle', 'busy'] as const)(
		'keeps old tool cards and native identity on a new-shell provider switch while %s',
		async (state) => {
			vi.mocked(useSettingsStore.getState).mockReturnValue({ newShell: true } as never);
			const source = {
				provider: 'claude-code',
				nativeSessionId: 'claude-native',
				projectPath: '/synthetic',
				ownerAgentId: 'session-1',
				accountDir: '/synthetic/claude',
			};
			const tab = createMockAITab({
				id: 'old-tab',
				agentSessionId: source.nativeSessionId,
				state,
				turnProvider: 'claude-code',
				inputValue: 'draft',
				saveToHistory: false,
				logs: [
					{
						id: 'old-tool',
						timestamp: 1,
						source: 'tool',
						text: 'Bash',
						metadata: {
							toolCallId: 'full-output-call',
							nativeToolCallId: 'full-output-call',
							toolOutputSource: source,
							toolState: {
								status: 'completed',
								output: compactToolOutput('x'.repeat(9000) + 'OLD_TAIL').output,
							},
						},
					},
				],
			});
			const session = createMockSession({
				id: 'session-1',
				toolType: 'claude-code',
				state,
				aiPid: state === 'busy' ? 123 : 0,
				aiTabs: [tab, createMockAITab({ id: 'other-tab' })],
				activeTabId: tab.id,
				filePreviewTabs: [createMockFileTab({ id: 'file' })],
				customPath: '/synthetic/claude',
				customEnvVars: { CLAUDE_CONFIG_DIR: source.accountDir },
				customEnvVarsDisabled: { OLD_SETTING: 'old' },
				customEffort: 'high',
			});
			const { setSessions } = setup([session]);
			dispatchPatch(session.id, { toolType: 'codex' });
			await flush();
			const [updated] = applyUpdate(setSessions, [session]);
			expect(updated.aiTabs.map((entry) => entry.id)).toEqual(['old-tab', 'other-tab']);
			expect(updated.activeTabId).toBe(tab.id);
			expect(updated.aiTabs[0]).toMatchObject({
				agentSessionId: null,
				logs: tab.logs,
				inputValue: 'draft',
				saveToHistory: false,
				state,
				turnProvider: 'claude-code',
				providerSessions: { 'claude-code': { agentSessionId: source.nativeSessionId } },
			});
			expect(updated.filePreviewTabs).toBe(session.filePreviewTabs);
			expect(updated.closedTabHistory).toBe(session.closedTabHistory);
			expect(updated.unifiedTabOrder).toBe(session.unifiedTabOrder);
			expect(updated.executionQueue).toBe(session.executionQueue);
			expect(updated.state).toBe(state);
			expect(updated.aiPid).toBe(session.aiPid);
			expect(updated.toolType).toBe('codex');
			expect(updated.customPath).toBeUndefined();
			expect(updated.customEnvVars).toBeUndefined();
			expect(updated.customEnvVarsDisabled).toBeUndefined();
			expect(updated.customEffort).toBeUndefined();
			expect(window.maestro.process.kill).not.toHaveBeenCalled();
			expect(setMany).toHaveBeenCalledWith([updated], []);
			expect(JSON.stringify(updated)).not.toContain('OLD_TAIL');
			expect(ack).toHaveBeenCalledWith('ch', { success: true });
		}
	);

	it('keeps the classic CLI provider reset behavior', async () => {
		const tab = createMockAITab({ id: 'old-tab', agentSessionId: 'claude-native' });
		const session = createMockSession({
			id: 'session-1',
			toolType: 'claude-code',
			aiTabs: [tab],
			activeTabId: tab.id,
			state: 'busy',
			aiPid: 123,
		});
		const { setSessions } = setup([session]);
		dispatchPatch(session.id, { toolType: 'codex' });
		await flush();
		const [updated] = applyUpdate(setSessions, [session]);
		expect(updated.aiTabs).toHaveLength(1);
		expect(updated.aiTabs[0]).toMatchObject({
			id: 'new-tab-id',
			agentSessionId: null,
			logs: [],
			state: 'idle',
		});
		expect(updated.activeTabId).toBe('new-tab-id');
		expect(updated).toMatchObject({
			toolType: 'codex',
			state: 'idle',
			aiPid: 0,
			closedTabHistory: [],
			filePreviewTabs: [],
			executionQueue: [],
		});
		expect(window.maestro.process.kill).toHaveBeenCalledWith('session-1-ai');
		expect(setMany).toHaveBeenCalledWith([updated], []);
	});

	it('writes the bookmark flag so the CLI can pin an agent in the Left Bar', async () => {
		const sessions = [createMockSession({ id: 'session-1', bookmarked: false })];
		const { setSessions } = setup(sessions);

		dispatchPatch('session-1', { bookmarked: true });
		await flush();

		const [updated] = applyUpdate(setSessions, sessions);
		expect(updated.bookmarked).toBe(true);
		expect(ack).toHaveBeenCalledWith('ch', { success: true });
	});

	it('clears the bookmark on an explicit false rather than treating it as unset', async () => {
		const sessions = [createMockSession({ id: 'session-1', bookmarked: true })];
		const { setSessions } = setup(sessions);

		dispatchPatch('session-1', { bookmarked: false });
		await flush();

		expect(applyUpdate(setSessions, sessions)[0].bookmarked).toBe(false);
	});

	it('flushes the bookmark to disk before acking, so a follow-up CLI read is not stale', async () => {
		const sessions = [createMockSession({ id: 'session-1', bookmarked: false })];
		setup(sessions);

		dispatchPatch('session-1', { bookmarked: true });
		await flush();

		expect(setMany).toHaveBeenCalledWith(
			[expect.objectContaining({ id: 'session-1', bookmarked: true })],
			[]
		);
	});

	it('ignores keys outside the allowlist', async () => {
		const sessions = [createMockSession({ id: 'session-1' })];
		const { setSessions } = setup(sessions);

		dispatchPatch('session-1', { bookmarked: true, aiPid: 99999, name: 'hijacked' });
		await flush();

		const [updated] = applyUpdate(setSessions, sessions);
		expect(updated.bookmarked).toBe(true);
		expect(updated.aiPid).toBe(sessions[0].aiPid);
		expect(updated.name).toBe(sessions[0].name);
	});

	it('rejects a patch containing nothing editable', async () => {
		const sessions = [createMockSession({ id: 'session-1' })];
		const { setSessions } = setup(sessions);

		dispatchPatch('session-1', { aiPid: 1 });
		await flush();

		expect(setSessions).not.toHaveBeenCalled();
		expect(ack).toHaveBeenCalledWith('ch', {
			success: false,
			error: 'No editable config fields in patch',
		});
	});

	it('rejects an unknown agent', async () => {
		setup([createMockSession({ id: 'session-1' })]);

		dispatchPatch('nope', { bookmarked: true });
		await flush();

		expect(ack).toHaveBeenCalledWith('ch', { success: false, error: 'Agent not found' });
	});
});

describe('maestro:remoteUpdateSessionConfig with a tabId', () => {
	/** An agent whose second tab is the one under test. */
	function twoTabSession() {
		const session = createMockSession({ id: 'session-1' });
		session.aiTabs = [
			{ ...session.aiTabs[0], id: 'tab-1', hasUnread: false, saveToHistory: true },
			{ ...session.aiTabs[0], id: 'tab-2', hasUnread: false, saveToHistory: true },
		];
		return session;
	}

	it.each([false, true])(
		'gates and persists CLI change grouping only on the requested conversation, new shell %s',
		async (newShell) => {
			const sessions = [twoTabSession()];
			vi.mocked(useSettingsStore.getState).mockReturnValue({ newShell } as never);
			const { setSessions } = setup(sessions);
			dispatchPatch('session-1', { tabId: 'tab-2', newShellPanelAction: 'changes-turns' });
			await flush();
			if (newShell) {
				const updated = applyUpdate(setSessions, sessions)[0];
				expect(updated.aiTabs[0].newShellPanel).toEqual(sessions[0].aiTabs[0].newShellPanel);
				expect(updated.aiTabs[1].newShellPanel).toEqual({
					tab: 'changes',
					open: true,
					changesView: 'turn',
				});
				expect(setMany).toHaveBeenCalled();
				expect(ack).toHaveBeenCalledWith('ch', expect.objectContaining({ success: true }));
			} else {
				expect(setSessions).not.toHaveBeenCalled();
				expect(setMany).not.toHaveBeenCalled();
				expect(ack).toHaveBeenCalledWith('ch', {
					success: false,
					error: 'This panel requires the new shell',
				});
			}
		}
	);
	it.each([false, true])(
		'sets a file buffer through its conversation without touching classic selection, new shell %s',
		async (newShell) => {
			const sessions = [twoTabSession()];
			sessions[0].filePreviewTabs = [
				createMockFileTab({ id: 'file', path: '/project/a.ts', content: 'before' }),
			];
			sessions[0].activeFileTabId = 'classic-file';
			sessions[0].aiTabs[1].newShellPanel = { tab: 'files', fileTabId: 'file' };
			const { useSettingsStore } = await import('../../../../renderer/stores/settingsStore');
			vi.mocked(useSettingsStore.getState).mockReturnValue({ newShell } as never);
			const { setSessions } = setup(sessions);
			dispatchPatch('session-1', {
				tabId: 'tab-2',
				newShellPanelAction: 'edit',
				newShellFileContent: 'after',
				newShellFileLine: 7,
			});
			await flush();
			const updated = applyUpdate(setSessions, sessions)[0];
			expect(updated.filePreviewTabs[0]).toMatchObject({
				editMode: true,
				editContent: 'after',
				pendingScrollToLine: 7,
			});
			expect(updated.activeFileTabId).toBe('classic-file');
			expect(setMany).toHaveBeenCalledWith([updated], []);
			expect(ack).toHaveBeenCalledWith('ch', { success: true });
		}
	);

	it.each([undefined, 'remote'])(
		'saves the file buffer through FilePreview and waits for its persisted result on host %s',
		async (sshRemoteId) => {
			const sessions = [twoTabSession()];
			sessions[0].sshRemoteId = sshRemoteId;
			sessions[0].filePreviewTabs = [
				createMockFileTab({
					id: 'file',
					path: '/project/a.ts',
					content: 'before',
					editContent: 'after',
				}),
			];
			sessions[0].aiTabs[1].newShellPanel = { tab: 'files', fileTabId: 'file' };
			const writeFile = vi.fn().mockResolvedValue(true);
			window.maestro.fs = {
				stat: vi.fn().mockResolvedValue({ modifiedAt: new Date(1000).toISOString() }),
				writeFile,
			} as never;
			setup(sessions);
			dispatchPatch('session-1', { tabId: 'tab-2', newShellPanelAction: 'save' });
			await flush();
			expect(writeFile).toHaveBeenCalledWith('/project/a.ts', 'after', sshRemoteId);
			expect(setMany.mock.calls[0][0][0].filePreviewTabs[0]).toMatchObject({
				content: 'after',
				editContent: undefined,
				lastModified: 1000,
			});
			expect(ack).toHaveBeenCalledWith('ch', { success: true });
		}
	);

	it('writes real file bytes before acknowledging the CLI panel save', async () => {
		const dir = await mkdtemp(join(process.cwd(), '.panel-save-'));
		try {
			const path = join(dir, 'a.ts');
			await writeDiskFile(path, 'before');
			const sessions = [twoTabSession()];
			sessions[0].filePreviewTabs = [
				createMockFileTab({ id: 'file', path, content: 'before', editContent: 'after' }),
			];
			sessions[0].aiTabs[1].newShellPanel = { tab: 'files', fileTabId: 'file' };
			let releaseWrite!: () => void;
			const gate = new Promise<void>((resolve) => {
				releaseWrite = resolve;
			});
			const writeFile = vi.fn(async (filePath: string, content: string) => {
				await gate;
				await writeDiskFile(filePath, content, 'utf8');
				return { success: true };
			});
			window.maestro.fs = {
				stat: vi.fn(async (filePath: string) => ({
					modifiedAt: (await stat(filePath)).mtime.toISOString(),
				})),
				writeFile,
			} as never;
			setup(sessions);
			dispatchPatch('session-1', { tabId: 'tab-2', newShellPanelAction: 'save' });
			await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
			expect(ack).not.toHaveBeenCalled();
			expect(setMany).not.toHaveBeenCalled();
			expect(await readFile(path, 'utf8')).toBe('before');
			releaseWrite();
			await waitFor(() => expect(ack).toHaveBeenCalledWith('ch', { success: true }));
			expect(await readFile(path, 'utf8')).toBe('after');
			expect(setMany.mock.calls[0][0][0].filePreviewTabs[0]).toMatchObject({
				content: 'after',
				editContent: undefined,
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it.each([undefined, 'remote'])(
		'rejects loading and closed file saves on host %s',
		async (sshRemoteId) => {
			const sessions = [twoTabSession()];
			sessions[0].sshRemoteId = sshRemoteId;
			sessions[0].filePreviewTabs = [
				createMockFileTab({ id: 'file', path: '/project/a.ts', isLoading: true }),
			];
			sessions[0].aiTabs[1].newShellPanel = { tab: 'files', fileTabId: 'file' };
			const writeFile = vi.fn();
			const stat = vi.fn(async () => {
				useSessionStore.setState({ sessions: [{ ...sessions[0], filePreviewTabs: [] }] });
				return { modifiedAt: new Date(1000).toISOString() };
			});
			window.maestro.fs = { stat, writeFile } as never;
			setup(sessions);
			dispatchPatch('session-1', { tabId: 'tab-2', newShellPanelAction: 'save' });
			await flush();
			expect(stat).not.toHaveBeenCalled();
			expect(ack).toHaveBeenLastCalledWith('ch', {
				success: false,
				error: 'File save was cancelled',
			});
			sessions[0].filePreviewTabs[0].isLoading = false;
			dispatchPatch('session-1', { tabId: 'tab-2', newShellPanelAction: 'save' });
			await flush();
			expect(stat).toHaveBeenCalledOnce();
			expect(writeFile).not.toHaveBeenCalled();
			expect(setMany).not.toHaveBeenCalled();
			expect(ack).toHaveBeenLastCalledWith('ch', {
				success: false,
				error: 'File save was cancelled',
			});
			expect(ack).toHaveBeenCalledTimes(2);
		}
	);

	it('returns a file write failure to the CLI without acknowledging success', async () => {
		const sessions = [twoTabSession()];
		sessions[0].filePreviewTabs = [
			createMockFileTab({ id: 'file', path: '/project/a.ts', editContent: 'after' }),
		];
		sessions[0].aiTabs[1].newShellPanel = { tab: 'files', fileTabId: 'file' };
		window.maestro.fs = {
			stat: vi.fn().mockResolvedValue({ modifiedAt: new Date(1000).toISOString() }),
			writeFile: vi.fn().mockRejectedValue(new Error('fixture write failed')),
		} as never;
		setup(sessions);
		dispatchPatch('session-1', { tabId: 'tab-2', newShellPanelAction: 'save' });
		await flush();
		expect(ack).toHaveBeenCalledExactlyOnceWith('ch', {
			success: false,
			error: 'fixture write failed',
		});
		expect(setMany).not.toHaveBeenCalled();
		expect(useSessionStore.getState().sessions[0].filePreviewTabs[0].editContent).toBe('after');
	});

	it('does not acknowledge a panel write when persistence fails', async () => {
		setup([twoTabSession()]);
		setMany.mockResolvedValueOnce(false);
		dispatchPatch('session-1', { tabId: 'tab-2', newShellPanelAction: 'files' });
		await flush();
		expect(ack).toHaveBeenCalledWith('ch', {
			success: false,
			error: 'The tab config could not be saved',
		});
	});

	it('persists the file-list back action without touching the classic file tab', async () => {
		const sessions = [twoTabSession()];
		sessions[0].activeFileTabId = 'classic-file';
		sessions[0].aiTabs[1].newShellPanel = { tab: 'files', fileTabId: 'file', open: true };
		const { setSessions } = setup(sessions);
		dispatchPatch('session-1', { tabId: 'tab-2', newShellPanelAction: 'back' });
		await flush();
		const updated = applyUpdate(setSessions, sessions)[0];
		expect(updated.aiTabs[1].newShellPanel).toEqual({
			tab: 'files',
			fileTabId: undefined,
			open: true,
		});
		expect(updated.activeFileTabId).toBe('classic-file');
		expect(setMany).toHaveBeenCalledWith([updated], []);
	});

	it.each(['full', 'standard', 'readonly'] as const)(
		'sets %s with the same permission field patch as the composer',
		async (permissionMode) => {
			window.maestro.agents = {
				getCapabilities: vi
					.fn()
					.mockResolvedValue({ supportsStandardPermissionMode: true, supportsReadOnlyMode: true }),
			} as any;
			const sessions = [twoTabSession()];
			const { setSessions } = setup(sessions);
			dispatchPatch('session-1', { tabId: 'tab-2', permissionMode });
			await flush();
			expect(applyUpdate(setSessions, sessions)[0].aiTabs[1]).toMatchObject({
				permissionMode,
				readOnlyMode: permissionMode === 'readonly',
			});
			expect(setMany).toHaveBeenCalled();
			expect(ack).toHaveBeenCalledWith('ch', { success: true });
		}
	);
	it.each(['interactive', 'dynamic'] as const)(
		'refuses CLI standard for Claude %s without changing the tab',
		async (maestroPMode) => {
			vi.mocked(useSettingsStore.getState).mockReturnValue({ newShell: true } as any);
			window.maestro.agents = {
				getCapabilities: vi
					.fn()
					.mockResolvedValue({ supportsStandardPermissionMode: true, supportsReadOnlyMode: true }),
			} as any;
			const session = {
				...twoTabSession(),
				toolType: 'claude-code' as const,
				enableMaestroP: true,
				maestroPMode,
			};
			const { setSessions } = setup([session]);
			dispatchPatch('session-1', { tabId: 'tab-2', permissionMode: 'standard' });
			await flush();
			expect(setSessions).not.toHaveBeenCalled();
			expect(ack).toHaveBeenCalledWith('ch', {
				success: false,
				error:
					'This conversation uses TUI Wrapper or Dynamic, so Standard cannot take effect. Choose Read-only or Full Access, or switch to claude -p.',
			});
		}
	);

	it('rejects an unsupported permission mode before changing the tab', async () => {
		window.maestro.agents = {
			getCapabilities: vi
				.fn()
				.mockResolvedValue({ supportsStandardPermissionMode: false, supportsReadOnlyMode: true }),
		} as any;
		const { setSessions } = setup([twoTabSession()]);
		dispatchPatch('session-1', { tabId: 'tab-2', permissionMode: 'standard' });
		await flush();
		expect(setSessions).not.toHaveBeenCalled();
		expect(ack).toHaveBeenCalledWith('ch', {
			success: false,
			error: 'Permission mode is not supported by this provider',
		});
	});

	it('patches only the targeted tab', async () => {
		const sessions = [twoTabSession()];
		const { setSessions } = setup(sessions);

		dispatchPatch('session-1', { tabId: 'tab-2', hasUnread: true });
		await flush();

		const [updated] = applyUpdate(setSessions, sessions);
		expect(updated.aiTabs[0].hasUnread).toBe(false);
		expect(updated.aiTabs[1].hasUnread).toBe(true);
		expect(ack).toHaveBeenCalledWith('ch', { success: true });
	});

	it('flushes the tab flag to disk before acking', async () => {
		setup([twoTabSession()]);

		dispatchPatch('session-1', { tabId: 'tab-2', saveToHistory: false });
		await flush();

		const [[persisted]] = setMany.mock.calls.at(-1) as [Session[]];
		expect(persisted.aiTabs[1].saveToHistory).toBe(false);
		expect(persisted.aiTabs[0].saveToHistory).toBe(true);
	});

	it('ignores tab keys outside the allowlist', async () => {
		const sessions = [twoTabSession()];
		const { setSessions } = setup(sessions);

		dispatchPatch('session-1', { tabId: 'tab-1', starred: true, logs: [], agentSessionId: 'x' });
		await flush();

		const [updated] = applyUpdate(setSessions, sessions);
		expect(updated.aiTabs[0].starred).toBe(true);
		expect(updated.aiTabs[0].agentSessionId).toBe(sessions[0].aiTabs[0].agentSessionId);
	});

	it('rejects an unknown tab instead of silently patching nothing', async () => {
		const { setSessions } = setup([twoTabSession()]);

		dispatchPatch('session-1', { tabId: 'tab-nope', hasUnread: true });
		await flush();

		expect(setSessions).not.toHaveBeenCalled();
		expect(ack).toHaveBeenCalledWith('ch', { success: false, error: 'Tab not found' });
	});

	it('writes the composer-chip settings (thinking, read-only, model, effort)', async () => {
		const sessions = [twoTabSession()];
		const { setSessions } = setup(sessions);

		dispatchPatch('session-1', {
			tabId: 'tab-2',
			showThinking: 'sticky',
			readOnlyMode: true,
			customModel: 'opus',
			customEffort: 'high',
			enterToSend: false,
		});
		await flush();

		const [updated] = applyUpdate(setSessions, sessions);
		expect(updated.aiTabs[1].showThinking).toBe('sticky');
		expect(updated.aiTabs[1].readOnlyMode).toBe(true);
		expect(updated.aiTabs[1].customModel).toBe('opus');
		expect(updated.aiTabs[1].customEffort).toBe('high');
		expect(updated.aiTabs[1].enterToSend).toBe(false);
		expect(ack).toHaveBeenCalledWith('ch', { success: true });
	});

	it('clears an override on null so the tab inherits again', async () => {
		const sessions = [twoTabSession()];
		sessions[0].aiTabs[1] = { ...sessions[0].aiTabs[1], customModel: 'opus', enterToSend: false };
		const { setSessions } = setup(sessions);

		dispatchPatch('session-1', { tabId: 'tab-2', customModel: null, enterToSend: null });
		await flush();

		const [updated] = applyUpdate(setSessions, sessions);
		expect(updated.aiTabs[1].customModel).toBeUndefined();
		expect(updated.aiTabs[1].enterToSend).toBeUndefined();
	});

	it('rejects a wrongly-typed tab value instead of persisting it', async () => {
		const { setSessions } = setup([twoTabSession()]);

		dispatchPatch('session-1', { tabId: 'tab-1', readOnlyMode: 'yes' });
		await flush();

		expect(setSessions).not.toHaveBeenCalled();
		expect(ack).toHaveBeenCalledWith('ch', {
			success: false,
			error: "Invalid value for tab field 'readOnlyMode'",
		});
	});

	it('rejects an unknown thinking mode', async () => {
		const { setSessions } = setup([twoTabSession()]);

		dispatchPatch('session-1', { tabId: 'tab-1', showThinking: 'loud' });
		await flush();

		expect(setSessions).not.toHaveBeenCalled();
		expect(ack).toHaveBeenCalledWith('ch', {
			success: false,
			error: "Invalid value for tab field 'showThinking'",
		});
	});

	it('rejects a tab-targeted patch with no editable tab fields', async () => {
		const { setSessions } = setup([twoTabSession()]);

		// `bookmarked` is agent state, not tab state - it must not leak across.
		dispatchPatch('session-1', { tabId: 'tab-1', bookmarked: true });
		await flush();

		expect(setSessions).not.toHaveBeenCalled();
		expect(ack).toHaveBeenCalledWith('ch', {
			success: false,
			error: 'No editable tab fields in patch',
		});
	});
});

it('allows CLI standard permission for the enabled local Codex prototype', async () => {
	vi.mocked(useSettingsStore.getState).mockReturnValue({
		newShell: true,
		codexAppServer: true,
	} as never);
	vi.mocked(window.maestro.agents.getCapabilities).mockResolvedValue({
		supportsCodexAppServer: true,
	} as never);
	const session = createMockSession({
		id: 'session-1',
		toolType: 'codex',
		aiTabs: [createMockAITab({ id: 'tab-2' })],
	});
	setup([session]);
	dispatchPatch('session-1', { tabId: 'tab-2', permissionMode: 'standard' });
	await flush();
	expect(ack).toHaveBeenCalledWith('ch', { success: true });
});

it('reports a new-shell tool configuration persistence failure instead of claiming success', async () => {
	vi.mocked(useSettingsStore.getState).mockReturnValue({ newShell: true } as never);
	const session = createMockSession({ customPath: '/fixture/old' });
	setup([session]);
	setMany.mockResolvedValueOnce(false);
	dispatchPatch(session.id, { customPath: '/fixture/new' });
	await flush();
	expect(ack).toHaveBeenCalledWith('ch', { success: false, error: expect.any(String) });
	expect(useSessionStore.getState().sessions[0].customPath).toBe('/fixture/old');
});

it('merges queued new-shell CLI edits against the store before React refreshes its ref', async () => {
	vi.mocked(useSettingsStore.getState).mockReturnValue({ newShell: true } as never);
	const session = createMockSession({ customPath: '/fixture/old', customArgs: '--old' });
	const { setSessions } = setup([session]);
	setSessions.mockImplementation(useSessionStore.getState().setSessions);
	dispatchPatch(session.id, { customPath: '/fixture/new' });
	dispatchPatch(session.id, { customArgs: '--new' });
	await waitFor(() => expect(ack).toHaveBeenCalledTimes(2));
	expect(setMany.mock.calls.at(-1)![0][0]).toMatchObject({
		customPath: '/fixture/new',
		customArgs: '--new',
	});
});
