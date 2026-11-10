import { notifyToast } from '../../../../renderer/stores/notificationStore';
import { WindowProvider, useWindowContext } from '../../../../renderer/contexts/WindowContext';
import { createElement, forwardRef } from 'react';
import { render, screen } from '@testing-library/react';
import { NewShellTerminalPanel } from '../../../../renderer/components/NewShellTerminalPanel';
import { LayerStackProvider } from '../../../../renderer/contexts/LayerStackContext';
import { mockTheme } from '../../../helpers/mockTheme';
import { useUIStore } from '../../../../renderer/stores/uiStore';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';
import { useAppRemoteEventListeners } from '../../../../renderer/hooks/remote/useAppRemoteEventListeners';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { openPanelTerminal } from '../../../../renderer/services/newShellTerminal';

vi.mock('../../../../renderer/components/XTerminal', () => ({ XTerminal: forwardRef(() => null) }));

vi.mock('../../../../renderer/stores/notificationStore', () => ({ notifyToast: vi.fn() }));

const ack = vi.fn();
const saved = vi.fn().mockResolvedValue(true);
const opened = vi.fn();
const listed = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	useSettingsStore.setState({ newShell: true, uiLanguage: 'en' });
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
		sendRemoteWriteTerminalTabResponse: vi.fn(),
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
	it('resolves active web navigation from the addressed live conversation before persistence', async () => {
		const firstTab = createMockAITab({
			id: 'web-one',
			newShellPanel: { tab: 'web', open: true, webUrl: 'http://localhost:5173/one' },
		});
		act(() =>
			useSessionStore.getState().updateSession('second', {
				activeTabId: 'web-two',
				aiTabs: [firstTab, createMockAITab({ id: 'web-two' })],
			})
		);
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:remoteUpdateSessionConfig', {
					detail: {
						sessionId: 'second',
						responseChannel: 'ack',
						configPatch: {
							tabId: 'active',
							newShellPanelAction: 'web',
							newShellWebUrl: 'http://localhost:5173/two',
						},
					},
				})
			)
		);
		await waitFor(() => expect(ack).toHaveBeenCalledWith('ack', { success: true }));
		const current = useSessionStore.getState();
		expect(current.sessions[1].aiTabs[0]).toEqual(firstTab);
		expect(current.sessions[1].aiTabs[1].newShellPanel).toEqual({
			tab: 'web',
			open: true,
			webUrl: 'http://localhost:5173/two',
		});
		expect(saved).toHaveBeenCalledWith([current.sessions[1]], []);
		expect(current.activeSessionId).toBe('first');
		expect(current.sessions[0].aiTabs[0].newShellPanel).toBeUndefined();
	});
	it('persists the web URL only on the addressed conversation before acknowledgement', async () => {
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:remoteUpdateSessionConfig', {
					detail: {
						sessionId: 'second',
						responseChannel: 'ack',
						configPatch: {
							tabId: 'second-conversation',
							newShellPanelAction: 'web',
							newShellWebUrl: 'http://localhost:5173/',
						},
					},
				})
			)
		);
		await waitFor(() => expect(ack).toHaveBeenCalledWith('ack', { success: true }));
		expect(saved.mock.calls[0][0][0].aiTabs[0].newShellPanel).toEqual({
			tab: 'web',
			open: true,
			webUrl: 'http://localhost:5173/',
		});
		expect(useSessionStore.getState().sessions[0].aiTabs[0].newShellPanel).toBeUndefined();
	});
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
			expect.objectContaining({ sessionId: `second-terminal-${newId}`, cwd: '/project' })
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
		expect(
			useSessionStore.getState().sessions[1].aiTabs[0].newShellPanel?.terminalTabId
		).toBeUndefined();
		expect(useSessionStore.getState().sessions[0].terminalTabs.map((tab) => tab.id)).toEqual([
			second.tab.id,
		]);
		expect(
			saved.mock.lastCall![0].find((s: { id: string }) => s.id === 'first').terminalTabs
		).toHaveLength(1);
	});

	it.each([false, true])(
		'closing the last terminal preserves tasks with open=%s and does not spawn',
		async (open) => {
			const terminal = openPanelTerminal('first')!;
			useSessionStore.getState().updateSession('first', {
				aiTabs: [
					createMockAITab({
						id: 'first-conversation',
						newShellPanel: {
							tab: 'tasks',
							open,
							terminalTabId: terminal.tab.id,
						},
					}),
				],
			});
			useUIStore.setState({ rightPanelOpen: open });
			render(
				createElement(() => {
					const source = useSessionStore((s) => s.sessions[0]);
					const panel = source.aiTabs[0].newShellPanel;
					return createElement(NewShellTerminalPanel, {
						session: source,
						theme: mockTheme,
						visible: panel?.tab === 'terminal' && panel.open === true,
					});
				}),
				{ wrapper: LayerStackProvider }
			);
			act(() =>
				window.dispatchEvent(
					new CustomEvent('maestro:remoteUpdateSessionConfig', {
						detail: {
							sessionId: 'first',
							responseChannel: 'ack',
							configPatch: {
								tabId: 'first-conversation',
								newShellPanelAction: 'terminal-close',
								newShellTerminalId: terminal.tab.id,
							},
						},
					})
				)
			);
			await waitFor(() => expect(ack).toHaveBeenCalledWith('ack', { success: true }));
			expect(useSessionStore.getState().sessions[0].aiTabs[0].newShellPanel).toEqual({
				tab: 'tasks',
				open,
				terminalTabId: undefined,
			});
			expect(useSessionStore.getState().sessions[0].terminalTabs).toEqual([]);
			expect(useUIStore.getState().rightPanelOpen).toBe(open);
			expect(screen.getByTestId('terminal-panel')).not.toBeVisible();
			expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
		}
	);

	it('restarts the shared owner from the CLI even while its panel is hidden', async () => {
		const terminal = openPanelTerminal('first')!;
		useSessionStore.getState().updateSession('first', {
			terminalTabs: [{ ...terminal.tab, state: 'exited', exitCode: 1 }],
		});
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:remoteUpdateSessionConfig', {
					detail: {
						sessionId: 'second',
						responseChannel: 'ack',
						configPatch: {
							tabId: 'second-conversation',
							newShellPanelAction: 'terminal-restart',
							newShellTerminalId: terminal.tab.id,
						},
					},
				})
			)
		);
		await waitFor(() => expect(ack).toHaveBeenCalledWith('ack', { success: true }));
		expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: `first-terminal-${terminal.tab.id}`,
			})
		);
		expect(useSessionStore.getState().sessions[0].terminalTabs[0]).toMatchObject({
			id: terminal.tab.id,
			pid: 41,
			state: 'idle',
		});
		expect(
			saved.mock.lastCall![0].find((s: { id: string }) => s.id === 'first').terminalTabs[0].pid
		).toBe(41);
	});

	it.each(['terminal-select', 'terminal-close', 'terminal-restart'])(
		'rejects %s after the shared owner changes host',
		async (action) => {
			for (const id of ['first', 'second'])
				useSessionStore.getState().updateSession(id, {
					sessionSshRemoteConfig: { enabled: true, remoteId: 'h1' },
				});
			const terminal = openPanelTerminal('first')!;
			useSessionStore
				.getState()
				.updateSession('first', { sessionSshRemoteConfig: { enabled: true, remoteId: 'h2' } });
			act(() =>
				window.dispatchEvent(
					new CustomEvent('maestro:remoteUpdateSessionConfig', {
						detail: {
							sessionId: 'second',
							responseChannel: 'ack',
							configPatch: {
								tabId: 'second-conversation',
								newShellPanelAction: action,
								newShellTerminalId: terminal.tab.id,
							},
						},
					})
				)
			);
			await waitFor(() =>
				expect(ack).toHaveBeenCalledWith('ack', {
					success: false,
					error: expect.stringContaining('Terminal not found'),
				})
			);
			expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
			expect(window.maestro.process.kill).not.toHaveBeenCalled();
			expect(saved).not.toHaveBeenCalled();
		}
	);

	it.each(['terminal-select', 'terminal-close', 'terminal-restart'])(
		'only permits closing a previous host terminal from its owner: %s',
		async (action) => {
			useSessionStore
				.getState()
				.updateSession('first', { sessionSshRemoteConfig: { enabled: true, remoteId: 'h1' } });
			const terminal = openPanelTerminal('first')!;
			useSessionStore.getState().updateSession('first', {
				terminalTabs: [{ ...terminal.tab, pid: 41, state: 'busy' }],
				sessionSshRemoteConfig: { enabled: true, remoteId: 'h2' },
			});

			act(() =>
				window.dispatchEvent(
					new CustomEvent('maestro:remoteUpdateSessionConfig', {
						detail: {
							sessionId: 'first',
							responseChannel: 'ack',
							configPatch: {
								tabId: 'first-conversation',
								newShellPanelAction: action,
								newShellTerminalId: terminal.tab.id,
							},
						},
					})
				)
			);
			await waitFor(() =>
				expect(ack).toHaveBeenCalledWith(
					'ack',
					action === 'terminal-close'
						? { success: true }
						: { success: false, error: expect.stringContaining('previous host') }
				)
			);
			expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
			if (action === 'terminal-close') {
				expect(window.maestro.process.kill).toHaveBeenCalledWith(
					`first-terminal-${terminal.tab.id}`
				);
				expect(useSessionStore.getState().sessions[0].terminalTabs).toEqual([]);
				expect(
					saved.mock.lastCall![0].find((s: { id: string }) => s.id === 'first').terminalTabs
				).toEqual([]);
			} else {
				expect(window.maestro.process.kill).not.toHaveBeenCalled();
				expect(saved).not.toHaveBeenCalled();
			}
		}
	);

	it('lists previous host terminals globally and for their owner without marking them active', () => {
		const terminal = openPanelTerminal('first')!;
		useSessionStore.getState().updateSession('first', {
			terminalTabs: [{ ...terminal.tab, pid: 41, state: 'busy' }],
			sessionSshRemoteConfig: { enabled: true, remoteId: 'h2' },
		});
		for (const sessionId of [undefined, 'first']) {
			act(() =>
				window.dispatchEvent(
					new CustomEvent('maestro:listTerminalTabs', {
						detail: { sessionId, responseChannel: 'list' },
					})
				)
			);
			expect(listed.mock.lastCall![1]).toEqual([
				expect.objectContaining({
					tabId: terminal.tab.id,
					agentId: 'first',
					pid: 41,
					active: false,
				}),
			]);
		}
	});

	it.each(['terminal-select', 'terminal-close', 'terminal-restart'])(
		'explains another window owns the terminal for %s',
		async (action) => {
			const terminal = openPanelTerminal('second')!;
			vi.mocked(window.maestro.windows.getState).mockResolvedValue({
				id: 'primary',
				sessionIds: ['first'],
				activeSessionId: 'first',
			} as Awaited<ReturnType<typeof window.maestro.windows.getState>>);
			vi.mocked(window.maestro.windows.list).mockResolvedValue([
				{ id: 'primary', isMain: true, sessionIds: ['first'], activeSessionId: 'first' },
				{ id: 'secondary', isMain: false, sessionIds: ['second'], activeSessionId: 'second' },
			]);
			const context = renderHook(() => useWindowContext(), { wrapper: WindowProvider });
			await waitFor(() => expect(context.result.current.ownsSession('second', true)).toBe(false));
			await waitFor(() => expect(context.result.current.ownsSession('first', true)).toBe(true));
			act(() =>
				window.dispatchEvent(
					new CustomEvent('maestro:remoteUpdateSessionConfig', {
						detail: {
							sessionId: 'first',
							responseChannel: 'ack',
							configPatch: {
								tabId: 'first-conversation',
								newShellPanelAction: action,
								newShellTerminalId: terminal.tab.id,
							},
						},
					})
				)
			);
			await waitFor(() =>
				expect(ack).toHaveBeenCalledWith('ack', {
					success: false,
					error: 'Error: Target terminal belongs to another window',
				})
			);
			expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
			expect(window.maestro.process.kill).not.toHaveBeenCalled();
			expect(saved).not.toHaveBeenCalled();
		}
	);

	it('refuses CLI input to a terminal left on the previous host', () => {
		const terminal = openPanelTerminal('first')!;
		useSessionStore.getState().updateSession('first', {
			terminalTabs: [{ ...terminal.tab, pid: 41, state: 'busy' }],
			sessionSshRemoteConfig: { enabled: true, remoteId: 'h2' },
		});
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:writeTerminalTab', {
					detail: {
						sessionId: 'first',
						tabRef: terminal.tab.id,
						data: 'must-not-run',
						responseChannel: 'write',
					},
				})
			)
		);
		expect(window.maestro.process.sendRemoteWriteTerminalTabResponse).toHaveBeenCalledWith(
			'write',
			false,
			{ error: `No terminal tab matching "${terminal.tab.id}"` }
		);
		expect(window.maestro.process.write).not.toHaveBeenCalled();
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

it.each([false, true])(
	'localizes background terminal failures with newShell=%s',
	async (newShell) => {
		act(() => useSettingsStore.setState({ newShell, uiLanguage: 'zh-CN' }));
		vi.mocked(window.maestro.process.spawnTerminalTab).mockRejectedValueOnce(
			new Error('PTY unavailable')
		);
		act(() =>
			window.dispatchEvent(
				new CustomEvent('maestro:openTerminalTab', {
					detail: { sessionId: 'first', background: true, responseChannel: 'open' },
				})
			)
		);
		await waitFor(() =>
			expect(notifyToast).toHaveBeenCalledWith({
				type: 'error',
				title: '终端启动失败',
				message: 'PTY unavailable',
			})
		);
	}
);
