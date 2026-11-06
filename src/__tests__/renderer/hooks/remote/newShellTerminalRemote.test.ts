import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';
import { useAppRemoteEventListeners } from '../../../../renderer/hooks/remote/useAppRemoteEventListeners';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { openPanelTerminal } from '../../../../renderer/services/newShellTerminal';

const ack = vi.fn();
const saved = vi.fn().mockResolvedValue(true);
const opened = vi.fn();
const listed = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	useSettingsStore.setState({ newShell: true });
	useSessionStore.setState({
		activeSessionId: 'first',
		sessions: ['first', 'second'].map((id) =>
			createMockSession({
				id,
				cwd: '/project',
				activeTabId: `${id}-conversation`,
				aiTabs: [createMockAITab({ id: `${id}-conversation` })],
			})
		),
	});
	Object.assign(window.maestro.process, {
		sendRemoteUpdateSessionConfigResponse: ack,
		sendRemoteOpenTerminalTabResponse: opened,
		sendRemoteListTerminalTabsResponse: listed,
		spawnTerminalTab: vi.fn().mockResolvedValue({ success: true, pid: 41 }),
		kill: vi.fn().mockResolvedValue(true),
	});
	window.maestro.sessions.setMany = saved;
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
		})
	);
});

describe('new shell terminal CLI bridge', () => {
	it.each(['terminal', 'tasks'])(
		'persists the %s panel on the addressed conversation',
		async (action) => {
			act(() =>
				window.dispatchEvent(
					new CustomEvent('maestro:remoteUpdateSessionConfig', {
						detail: {
							sessionId: 'second',
							responseChannel: 'ack',
							configPatch: { tabId: 'second-conversation', newShellPanelAction: action },
						},
					})
				)
			);
			await waitFor(() => expect(ack).toHaveBeenCalledWith('ack', { success: true }));
			expect(saved.mock.calls[0][0][0].aiTabs[0].newShellPanel).toEqual({
				tab: action,
				open: true,
			});
			expect(useSessionStore.getState().activeSessionId).toBe('first');
			expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
		}
	);

	it('opens an additional shared terminal in the background and lists it from either conversation', async () => {
		const first = openPanelTerminal('first')!;
		const selectedBefore = useSessionStore.getState().sessions[0].aiTabs[0].newShellPanel;
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:openTerminalTab', {
					detail: {
						sessionId: 'second',
						config: { command: 'echo fixture' },
						background: true,
						responseChannel: 'open',
					},
				})
			)
		);
		await waitFor(() => expect(opened).toHaveBeenCalledWith('open', true, expect.any(String)));
		const newId = opened.mock.calls[0][2];
		expect(newId).not.toBe(first.tab.id);
		expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: `first-terminal-${newId}`, cwd: '/project' })
		);
		expect(useSessionStore.getState().activeSessionId).toBe('first');
		expect(useSessionStore.getState().sessions[0].aiTabs[0].newShellPanel).toEqual(selectedBefore);
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:listTerminalTabs', {
					detail: { sessionId: 'second', responseChannel: 'list' },
				})
			)
		);
		expect(listed.mock.calls[0][1].map((tab: { tabId: string }) => tab.tabId)).toEqual([
			first.tab.id,
			newId,
		]);
	});

	it('selects and closes the real shared owner, with an acknowledged persisted result', async () => {
		const first = openPanelTerminal('first')!;
		const second = openPanelTerminal('first', { additional: true })!;
		for (const action of ['terminal-select', 'terminal-close']) {
			ack.mockClear();
			act(() =>
				window.dispatchEvent(
					new CustomEvent('maestro:remoteUpdateSessionConfig', {
						detail: {
							sessionId: 'second',
							responseChannel: 'ack',
							configPatch: {
								tabId: 'second-conversation',
								newShellPanelAction: action,
								newShellTerminalId: first.tab.id,
							},
						},
					})
				)
			);
			await waitFor(() => expect(ack).toHaveBeenCalledWith('ack', { success: true }));
		}
		expect(window.maestro.process.kill).toHaveBeenCalledWith(`first-terminal-${first.tab.id}`);
		expect(useSessionStore.getState().sessions[1].aiTabs[0].newShellPanel?.terminalTabId).toBe(
			second.tab.id
		);
		expect(
			saved.mock.lastCall![0].find((s: { id: string }) => s.id === 'first').terminalTabs
		).toHaveLength(1);
	});

	it('rejects panel mutations in the classic shell', async () => {
		useSettingsStore.setState({ newShell: false });
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:remoteUpdateSessionConfig', {
					detail: {
						sessionId: 'first',
						responseChannel: 'ack',
						configPatch: { tabId: 'first-conversation', newShellPanelAction: 'terminal' },
					},
				})
			)
		);
		await waitFor(() =>
			expect(ack).toHaveBeenCalledWith('ack', {
				success: false,
				error: expect.stringContaining('new shell'),
			})
		);
		expect(saved).not.toHaveBeenCalled();
	});
});
