import { useTabStore } from '../../../renderer/stores/tabStore';
import { transcriptMessagesToLogEntries } from '../../../renderer/utils/transcriptMessages';
import { resolveTerminalTab } from '../../../renderer/utils/terminalTabHelpers';
import { openUiSurface } from '../../../renderer/utils/openUiSurface';
import { buildRightPanelCommands } from '../../../renderer/components/QuickActionsModal/commands/rightPanelCommands';
import { useUIStore } from '../../../renderer/stores/uiStore';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import type { ReactElement } from 'react';
import { act, render as renderView, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef, forwardRef, useEffect, useImperativeHandle } from 'react';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import { mockTheme } from '../../helpers/mockTheme';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import {
	NewShellTerminalPanel,
	type NewShellTerminalPanelHandle,
} from '../../../renderer/components/NewShellTerminalPanel';
import { TasksPanel } from '../../../renderer/components/TasksPanel';
import { openPanelTerminal, panelTerminals } from '../../../renderer/services/newShellTerminal';
import type { LogEntry } from '../../../renderer/types';

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn(), clear: vi.fn() }));
vi.mock('../../../renderer/components/XTerminal', () => ({
	XTerminal: forwardRef(({ sessionId }: { sessionId: string }, ref) => {
		useEffect(() => {
			lifecycle.mount(sessionId);
			return () => lifecycle.unmount(sessionId);
		}, []);
		useImperativeHandle(ref, () => ({
			clear: lifecycle.clear,
			search: vi.fn(),
			write: vi.fn(),
			refresh: vi.fn(),
			focus: vi.fn(),
			syncSize: vi.fn(),
			getSize: () => ({ cols: 40, rows: 20 }),
			getBuffer: () => 'retained output',
		}));
		return <div data-testid="terminal-instance">{sessionId}</div>;
	}),
}));

const render = (element: ReactElement) => renderView(element, { wrapper: LayerStackProvider });

const first = () =>
	createMockSession({
		id: 'first',
		cwd: '/project/worktree',
		projectRoot: '/project',
		aiTabs: [createMockAITab({ id: 'conversation', newShellPanel: { tab: 'terminal' } })],
		activeTabId: 'conversation',
	});

beforeEach(() => {
	vi.clearAllMocks();
	useSettingsStore.setState({ newShell: true });
	useSessionStore.setState({ sessions: [first()], activeSessionId: 'first' });
	window.maestro.process.spawnTerminalTab = vi.fn().mockResolvedValue({ success: true, pid: 42 });
	window.maestro.process.kill = vi.fn().mockResolvedValue(true);
});

describe('new shell terminals', () => {
	it('starts lazily and keeps the same xterm across collapse, panel and conversation switches', async () => {
		const session = first();
		const { rerender } = render(
			<NewShellTerminalPanel session={session} theme={mockTheme} visible={false} />
		);
		expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
		rerender(<NewShellTerminalPanel session={session} theme={mockTheme} visible />);
		await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1));
		const terminal = screen.getByTestId('terminal-instance');
		rerender(<NewShellTerminalPanel session={session} theme={mockTheme} visible={false} />);
		expect(screen.getByTestId('terminal-instance')).toBe(terminal);
		const other = createMockSession({ id: 'other', cwd: '/elsewhere' });
		act(() => useSessionStore.getState().setSessions((s) => [...s, other]));
		rerender(<NewShellTerminalPanel session={other} theme={mockTheme} visible={false} />);
		rerender(<NewShellTerminalPanel session={session} theme={mockTheme} visible />);
		expect(screen.getByTestId('terminal-instance')).toBe(terminal);
		expect(lifecycle.mount).toHaveBeenCalledTimes(1);
		expect(lifecycle.unmount).not.toHaveBeenCalled();
		expect(window.maestro.process.kill).not.toHaveBeenCalled();
	});

	it('routes terminal search, clear and close through the mounted shared view', async () => {
		const ref = createRef<NewShellTerminalPanelHandle>();
		render(<NewShellTerminalPanel ref={ref} session={first()} theme={mockTheme} visible />);
		await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1));
		const terminalId = useSessionStore.getState().sessions[0].terminalTabs[0].id;
		act(() => ref.current!.clearActiveTerminal());
		expect(lifecycle.clear).toHaveBeenCalledTimes(1);
		expect(window.maestro.process.write).toHaveBeenCalledWith(
			`first-terminal-${terminalId}`,
			'\x0c'
		);
		act(() => ref.current!.openTerminalSearch());
		expect(screen.getByPlaceholderText('Search...')).toBeVisible();
		window.maestro.process.isTerminalBusy = vi.fn().mockResolvedValue(false);
		act(() => ref.current!.closeActiveTerminal());
		await waitFor(() => expect(screen.queryByTestId('terminal-instance')).toBeNull());
		expect(window.maestro.process.kill).toHaveBeenCalledWith(`first-terminal-${terminalId}`);
		expect(useSessionStore.getState().sessions[0].aiTabs[0].id).toBe('conversation');
	});

	it('shares a directory across providers, keeps worktrees separate, and creates a second only explicitly', () => {
		const second = createMockSession({
			id: 'second',
			toolType: 'codex',
			cwd: '/project/worktree/',
		});
		const root = createMockSession({ id: 'root', cwd: '/project' });
		useSessionStore.getState().setSessions([first(), second, root]);
		const one = openPanelTerminal('first')!;
		expect(openPanelTerminal('second')!.tab.id).toBe(one.tab.id);
		expect(panelTerminals(useSessionStore.getState().sessions, root)).toHaveLength(0);
		const two = openPanelTerminal('second', { additional: true })!;
		expect(two.tab.id).not.toBe(one.tab.id);
		expect(panelTerminals(useSessionStore.getState().sessions, first())).toHaveLength(2);
		expect(useSessionStore.getState().sessions.every((s) => s.inputMode === 'ai')).toBe(true);
	});

	it('spawns SSH worktrees remotely and never shares with local or another host', async () => {
		const remote = createMockSession({
			...first(),
			id: 'remote',
			cwd: '/remote/worktree',
			sessionSshRemoteConfig: {
				enabled: true,
				remoteId: 'host',
				workingDirOverride: '/remote/worktree',
			},
		});
		const local = createMockSession({ id: 'local', cwd: '/remote/worktree' });
		const otherHost = createMockSession({
			...remote,
			id: 'other-host',
			sessionSshRemoteConfig: { enabled: true, remoteId: 'other' },
		});
		useSessionStore.setState({ sessions: [remote, local, otherHost], activeSessionId: remote.id });
		render(<NewShellTerminalPanel session={remote} theme={mockTheme} visible />);
		await waitFor(() =>
			expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledWith(
				expect.objectContaining({
					cwd: '/remote/worktree',
					sessionSshRemoteConfig: {
						enabled: true,
						remoteId: 'host',
						workingDirOverride: '/remote/worktree',
					},
				})
			)
		);
		expect(panelTerminals(useSessionStore.getState().sessions, local)).toHaveLength(0);
		expect(panelTerminals(useSessionStore.getState().sessions, otherHost)).toHaveLength(0);
	});

	it('closes a shared terminal in its owner and moves every conversation to the remaining one', () => {
		const second = createMockSession({ ...first(), id: 'second' });
		useSessionStore.getState().setSessions([first(), second]);
		const one = openPanelTerminal('first')!;
		openPanelTerminal('second');
		const two = openPanelTerminal('first', { additional: true })!;
		useSessionStore.getState().setActiveSessionId('second');
		useTabStore.getState().closeTerminalTab(one.tab.id);
		expect(window.maestro.process.kill).toHaveBeenCalledWith(`first-terminal-${one.tab.id}`);
		expect(
			panelTerminals(useSessionStore.getState().sessions, second).map((t) => t.tab.id)
		).toEqual([two.tab.id]);
		expect(
			resolveTerminalTab(useSessionStore.getState().sessions, 'second', undefined, true)?.tab.id
		).toBe(two.tab.id);
		expect(
			resolveTerminalTab(useSessionStore.getState().sessions, 'second', undefined, false)
		).toBeNull();
	});

	it('retains directory membership after cd and honors the legacy SSH host field', () => {
		const remote = createMockSession({
			...first(),
			sshRemoteId: 'legacy',
			remoteCwd: '/remote/worktree',
		});
		useSessionStore.getState().setSessions([remote]);
		const opened = openPanelTerminal(remote.id)!;
		expect(opened.tab.cwd).toBe('/remote/worktree');
		useSessionStore
			.getState()
			.updateSession(remote.id, { terminalTabs: [{ ...opened.tab, cwd: '/remote/subfolder' }] });
		expect(openPanelTerminal(remote.id)!.tab.id).toBe(opened.tab.id);
	});

	it('registers palette and CLI surface entry points only in the new shell', () => {
		const args = {
			autoRunDisabled: true,
			setRightPanelOpen: vi.fn(),
			setActiveRightTab: vi.fn(),
			setQuickActionOpen: vi.fn(),
			shortcuts: {},
		};
		const commands = buildRightPanelCommands(args);
		expect(commands.find((c) => c.id === 'goToTasks')?.shortcut?.keys).toEqual([
			'Meta',
			'Shift',
			'7',
		]);
		commands.find((c) => c.id === 'goToTasks')!.action();
		expect(useSessionStore.getState().sessions[0].aiTabs[0].newShellPanel?.tab).toBe('tasks');
		expect(useUIStore.getState().rightPanelOpen).toBe(true);
		expect(openUiSurface('terminal-panel')).toEqual({ ok: true });
		expect(useSessionStore.getState().sessions[0].aiTabs[0].newShellPanel?.tab).toBe('terminal');
		useSettingsStore.setState({ newShell: false });
		expect(buildRightPanelCommands(args).map((c) => c.id)).not.toContain('goToTasks');
		expect(openUiSurface('tasks-panel').ok).toBe(false);
	});

	it('refuses a missing SSH host without creating a local terminal', () => {
		useSessionStore.getState().setSessions([
			createMockSession({
				...first(),
				sessionSshRemoteConfig: { enabled: true, remoteId: null },
			}),
		]);
		expect(() => openPanelTerminal('first')).toThrow(/SSH/);
		expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
	});

	it('does nothing in the classic shell', () => {
		useSettingsStore.setState({ newShell: false });
		expect(openPanelTerminal('first')).toBeNull();
		render(<NewShellTerminalPanel session={first()} theme={mockTheme} visible />);
		expect(screen.queryByTestId('terminal-instance')).toBeNull();
		expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
	});
});

describe('latest conversation tasks', () => {
	it.each(['claude-code', 'codex', 'deepseek'])(
		'reads %s history, updates live, clears an empty list',
		(provider) => {
			const input =
				provider === 'codex'
					? {
							plan: [
								{ step: 'Done', status: 'completed' },
								{ step: 'Working', status: 'in_progress' },
								{ step: 'Next', status: 'pending' },
							],
						}
					: {
							todos: [
								{ content: 'Done', status: 'completed' },
								{ content: 'Working', status: 'in_progress' },
								{ content: 'Next', status: 'pending' },
							],
						};
			const log: LogEntry = {
				id: 'plan',
				timestamp: 1,
				source: 'tool',
				text: provider === 'codex' ? 'update_plan' : 'TodoWrite',
				metadata: { toolState: { input } },
			};
			const { rerender } = render(<TasksPanel logs={[log]} theme={mockTheme} />);
			expect(screen.getByTestId('tasks-progress')).toHaveTextContent('1 / 3');
			expect(screen.getByText('Working').closest('li')).toHaveStyle({
				color: mockTheme.colors.accent,
			});
			expect(screen.getByText('Done').closest('li')).toHaveStyle({ opacity: '0.5' });
			expect(screen.getByText('Done')).not.toHaveStyle({ textDecoration: 'line-through' });
			expect(screen.queryByRole('button')).toBeNull();
			const next = {
				...log,
				id: 'next',
				timestamp: 2,
				metadata: { toolState: { input: { todos: [{ content: 'Latest', status: 'pending' }] } } },
			};
			rerender(<TasksPanel logs={[log, next]} theme={mockTheme} />);
			expect(screen.getByText('Latest')).toBeInTheDocument();
			expect(screen.queryByText('Working')).toBeNull();
			rerender(
				<TasksPanel
					logs={[log, { ...next, metadata: { toolState: { input: { todos: [] } } } }]}
					theme={mockTheme}
				/>
			);
			expect(screen.getByTestId('tasks-empty')).toBeInTheDocument();
		}
	);

	it.each(['claude-code', 'codex', 'deepseek'])(
		'uses the native history adapter for %s',
		(provider) => {
			const input =
				provider === 'codex'
					? { plan: [{ step: 'Historical plan', status: 'in_progress' }] }
					: { todos: [{ content: 'Historical plan', status: 'in_progress' }] };
			const logs = transcriptMessagesToLogEntries([
				{
					uuid: 'native-tool',
					type: 'assistant',
					content: '',
					timestamp: '2026-11-06T00:00:00Z',
					toolUse:
						provider === 'codex'
							? [{ name: 'update_plan', args: JSON.stringify(input) }]
							: [{ type: 'tool_use', name: 'TodoWrite', id: 'todo', input }],
				},
			]);
			render(<TasksPanel logs={logs} theme={mockTheme} />);
			expect(screen.getByText('Historical plan')).toBeInTheDocument();
			expect(screen.getByTestId('tasks-progress')).toHaveTextContent('0 / 1');
		}
	);

	it('shows an empty state for a conversation without tasks', () => {
		render(<TasksPanel logs={[]} theme={mockTheme} />);
		expect(screen.getByTestId('tasks-empty')).toBeInTheDocument();
		expect(screen.queryByRole('list')).toBeNull();
	});
});
