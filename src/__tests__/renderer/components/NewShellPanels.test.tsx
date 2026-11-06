import { useModalStore } from '../../../renderer/stores/modalStore';
import { useTabStore } from '../../../renderer/stores/tabStore';
import { transcriptMessagesToLogEntries } from '../../../renderer/utils/transcriptMessages';
import { resolveTerminalTab } from '../../../renderer/utils/terminalTabHelpers';
import { openUiSurface } from '../../../renderer/utils/openUiSurface';
import { buildRightPanelCommands } from '../../../renderer/components/QuickActionsModal/commands/rightPanelCommands';
import { useUIStore } from '../../../renderer/stores/uiStore';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import type { ReactElement } from 'react';
import {
	act,
	fireEvent,
	renderHook,
	render as renderView,
	screen,
	within,
	waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Profiler, createRef, forwardRef, useEffect, useImperativeHandle } from 'react';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import { mockTheme } from '../../helpers/mockTheme';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import {
	NewShellTerminalPanel,
	type NewShellTerminalPanelHandle,
} from '../../../renderer/components/NewShellTerminalPanel';
import { TerminalView } from '../../../renderer/components/TerminalView';
import { TasksPanel } from '../../../renderer/components/TasksPanel';
import { WindowProvider, useWindowContext } from '../../../renderer/contexts/WindowContext';
import {
	openPanelTerminal,
	panelTerminals,
	selectPanelTerminal,
} from '../../../renderer/services/newShellTerminal';
import type { LogEntry } from '../../../renderer/types';

vi.unmock('lucide-react');

afterEach(() => window.history.replaceState({}, '', '/'));

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn(), clear: vi.fn() }));
vi.mock('../../../renderer/components/XTerminal', () => ({
	XTerminal: forwardRef(({ sessionId, ptyPid }: { sessionId: string; ptyPid?: number }, ref) => {
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
		return (
			<div data-testid="terminal-instance" data-pty-pid={ptyPid}>
				{sessionId}
			</div>
		);
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
	useSettingsStore.setState({ newShell: true, uiLanguage: 'en' });
	useSessionStore.setState({ sessions: [first()], activeSessionId: 'first' });
	window.maestro.process.spawnTerminalTab = vi.fn().mockResolvedValue({ success: true, pid: 42 });
	window.maestro.process.kill = vi.fn().mockResolvedValue(true);
});

describe('new shell terminals', () => {
	it.each([
		['en', 'No terminal open', 'New terminal', 'Terminal did not start: PTY unavailable'],
		['zh-CN', '没有打开的终端', '新建终端', '终端没有启动：PTY unavailable'],
	] as const)(
		'retains a spawn failure until a successful retry in %s',
		async (locale, empty, create, failure) => {
			useSettingsStore.setState({ uiLanguage: locale });
			vi.mocked(window.maestro.process.spawnTerminalTab).mockRejectedValueOnce(
				new Error('PTY unavailable')
			);
			render(<NewShellTerminalPanel session={first()} theme={mockTheme} visible />);
			await waitFor(() => expect(screen.queryByTestId('terminal-instance')).toBeNull());
			expect(screen.getByRole('alert')).toHaveTextContent(failure);
			expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1);
			const emptyState = screen.getByTestId('terminal-empty');
			expect(emptyState).toHaveTextContent(empty);
			expect(emptyState).toHaveClass('flex', 'items-center', 'justify-center', 'text-sm');
			expect(emptyState).toHaveStyle({ color: mockTheme.colors.textDim });
			let finish!: (result: { success: boolean; pid: number }) => void;
			vi.mocked(window.maestro.process.spawnTerminalTab).mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					})
			);
			fireEvent.click(within(emptyState).getByRole('button', { name: create }));
			await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(2));
			expect(screen.getByRole('alert')).toHaveTextContent(failure);
			expect(screen.queryByTestId('terminal-empty')).toBeNull();
			await act(async () => finish({ success: true, pid: 43 }));
			expect(screen.queryByRole('alert')).toBeNull();
			expect(screen.getByTestId('terminal-instance')).toHaveAttribute('data-pty-pid', '43');
		}
	);

	it('offers a new terminal after the last terminal closes', async () => {
		render(<NewShellTerminalPanel session={first()} theme={mockTheme} visible />);
		await waitFor(() =>
			expect(screen.getByTestId('terminal-instance')).toHaveAttribute('data-pty-pid', '42')
		);
		const closedId = useSessionStore.getState().sessions[0].terminalTabs[0].id;
		act(() => useTabStore.getState().closeTerminalTab(closedId));
		expect(screen.getByTestId('terminal-empty')).toHaveTextContent('No terminal open');
		fireEvent.click(
			within(screen.getByTestId('terminal-empty')).getByRole('button', { name: 'New terminal' })
		);
		await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(2));
		expect(useSessionStore.getState().sessions[0].terminalTabs[0].id).not.toBe(closedId);
		expect(screen.queryByTestId('terminal-empty')).toBeNull();
	});

	it('does not show the empty state while the automatic spawn is pending', async () => {
		let finish!: (result: { success: boolean; pid: number }) => void;
		vi.mocked(window.maestro.process.spawnTerminalTab).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		render(<NewShellTerminalPanel session={first()} theme={mockTheme} visible />);
		expect(screen.queryByTestId('terminal-empty')).toBeNull();
		await act(async () => finish({ success: true, pid: 42 }));
		expect(screen.queryByTestId('terminal-empty')).toBeNull();
	});

	it('never commits the empty state during automatic opening on a new visit', async () => {
		const commits: boolean[] = [];
		const view = render(
			<Profiler
				id="terminal"
				onRender={() => commits.push(!!screen.queryByTestId('terminal-empty'))}
			>
				<NewShellTerminalPanel session={first()} theme={mockTheme} visible />
			</Profiler>
		);
		await waitFor(() =>
			expect(screen.getByTestId('terminal-instance')).toHaveAttribute('data-pty-pid', '42')
		);
		expect(commits).not.toContain(true);
		act(() =>
			useTabStore
				.getState()
				.closeTerminalTab(useSessionStore.getState().sessions[0].terminalTabs[0].id)
		);
		expect(screen.getByTestId('terminal-empty')).toBeInTheDocument();
		const other = createMockSession({ ...first(), id: 'other', cwd: '/other' });
		act(() => useSessionStore.getState().setSessions((s) => [...s, other]));
		commits.length = 0;
		view.rerender(
			<Profiler
				id="terminal"
				onRender={() => commits.push(!!screen.queryByTestId('terminal-empty'))}
			>
				<NewShellTerminalPanel session={other} theme={mockTheme} visible />
			</Profiler>
		);
		await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(2));
		expect(commits).not.toContain(true);
	});

	it('shows the empty state when automatic opening throws before creating a tab', () => {
		const invalid = createMockSession({
			...first(),
			sessionSshRemoteConfig: { enabled: true, remoteId: '' },
		});
		useSessionStore.getState().setSessions([invalid]);
		render(<NewShellTerminalPanel session={invalid} theme={mockTheme} visible />);
		expect(screen.getByTestId('terminal-empty')).toHaveTextContent('No terminal open');
		expect(screen.getByRole('alert')).toHaveTextContent(
			'Terminal did not start: SSH is enabled but no remote is configured'
		);
		fireEvent.click(
			within(screen.getByTestId('terminal-empty')).getByRole('button', { name: 'New terminal' })
		);
		expect(screen.getByRole('alert')).toHaveTextContent(
			'Terminal did not start: SSH is enabled but no remote is configured'
		);
		expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
	});

	it('keeps an immediate shell exit reason after its terminal is removed', async () => {
		render(<NewShellTerminalPanel session={first()} theme={mockTheme} visible />);
		await waitFor(() =>
			expect(screen.getByTestId('terminal-instance')).toHaveAttribute('data-pty-pid', '42')
		);
		const terminalId = useSessionStore.getState().sessions[0].terminalTabs[0].id;
		act(() =>
			vi.mocked(window.maestro.process.onExit).mock.lastCall![0](`first-terminal-${terminalId}`, 1)
		);
		await waitFor(() => expect(screen.queryByTestId('terminal-instance')).toBeNull());
		expect(screen.getByRole('alert')).toHaveTextContent(
			'Terminal did not start: Shell exited immediately (exit code: 1).'
		);
		expect(screen.getByTestId('terminal-empty')).toBeInTheDocument();
	});

	it('does not carry another conversation failure into a pending automatic spawn', async () => {
		vi.mocked(window.maestro.process.spawnTerminalTab).mockRejectedValueOnce(
			new Error('PTY unavailable')
		);
		const view = render(<NewShellTerminalPanel session={first()} theme={mockTheme} visible />);
		await waitFor(() => expect(screen.getByTestId('terminal-empty')).toBeInTheDocument());
		expect(screen.getByRole('alert')).toHaveTextContent('PTY unavailable');
		const other = createMockSession({ ...first(), id: 'other', cwd: '/other' });
		act(() => useSessionStore.getState().setSessions((s) => [...s, other]));
		let finish!: (result: { success: boolean; pid: number }) => void;
		vi.mocked(window.maestro.process.spawnTerminalTab).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		view.rerender(<NewShellTerminalPanel session={other} theme={mockTheme} visible />);
		try {
			expect(screen.queryByRole('alert')).toBeNull();
		} finally {
			await act(async () => finish({ success: true, pid: 43 }));
		}
	});

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
		expect(two.session.id).toBe('second');
		expect(panelTerminals(useSessionStore.getState().sessions, first())).toHaveLength(2);
		expect(useSessionStore.getState().sessions.every((s) => s.inputMode === 'ai')).toBe(true);
	});

	it('removes a shared terminal after its owner changes host, including explicit CLI addressing', () => {
		const ssh = { enabled: true, remoteId: 'h1' };
		const a = createMockSession({ ...first(), sessionSshRemoteConfig: ssh });
		const b = createMockSession({ ...first(), id: 'second', sessionSshRemoteConfig: ssh });
		useSessionStore.getState().setSessions([a, b]);
		const old = openPanelTerminal(a.id)!;
		openPanelTerminal(b.id);
		useSessionStore.getState().updateSession(a.id, {
			sessionSshRemoteConfig: { enabled: true, remoteId: 'h2' },
		});
		const sessions = useSessionStore.getState().sessions;
		expect(panelTerminals(sessions, b)).toEqual([]);
		expect(selectPanelTerminal(b.id, old.tab.id)).toBe(false);
		expect(resolveTerminalTab(sessions, b.id, old.tab.id, true)).toBeNull();
		expect(resolveTerminalTab(sessions, b.id, undefined, true)).toBeNull();
		expect(openPanelTerminal(b.id, { additional: true })!.session.id).toBe(b.id);
	});

	it.each([
		[false, 'en', '2 terminals are still running on the previous host', 'Close'],
		[true, 'en', '2 terminals are still running on the previous host', 'Close'],
		[true, 'zh-CN', '有 2 个终端还在上一台主机上运行', '关闭'],
	] as const)(
		'closes previous host terminals through their owner with busy=%s and locale=%s',
		async (busy, uiLanguage, message, closeLabel) => {
			useSettingsStore.setState({ uiLanguage });
			const owner = createMockSession({
				...first(),
				sessionSshRemoteConfig: { enabled: true, remoteId: 'h1' },
			});
			useSessionStore.getState().setSessions([owner]);
			const one = openPanelTerminal(owner.id)!;
			const two = openPanelTerminal(owner.id, { additional: true })!;
			useSessionStore.getState().updateSession(owner.id, {
				terminalTabs: [one.tab, two.tab].map((tab) => ({ ...tab, pid: 41, state: 'busy' })),
				sessionSshRemoteConfig: { enabled: true, remoteId: 'h2' },
			});
			window.maestro.process.isTerminalBusy = vi.fn().mockResolvedValue(busy);
			render(<NewShellTerminalPanel session={owner} theme={mockTheme} visible />);
			await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1));
			expect(screen.getByRole('status')).toHaveTextContent(message);
			expect(screen.queryByRole('combobox')).toBeNull();
			expect(screen.queryByText(`first-terminal-${one.tab.id}`)).toBeNull();
			expect(screen.queryByText(`first-terminal-${two.tab.id}`)).toBeNull();
			expect(selectPanelTerminal(owner.id, one.tab.id)).toBe(false);
			expect(window.maestro.process.kill).not.toHaveBeenCalled();
			fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${closeLabel}$`) }));
			await waitFor(() => expect(window.maestro.process.isTerminalBusy).toHaveBeenCalledTimes(2));
			for (const terminal of [one, two])
				expect(window.maestro.process.isTerminalBusy).toHaveBeenCalledWith(
					`first-terminal-${terminal.tab.id}`
				);
			if (busy) {
				await waitFor(() => expect(useModalStore.getState().isOpen('confirm')).toBe(true));
				expect(window.maestro.process.kill).not.toHaveBeenCalled();
				act(() => useModalStore.getState().getData('confirm')!.onConfirm());
			}
			await waitFor(() => expect(window.maestro.process.kill).toHaveBeenCalledTimes(2));
			for (const terminal of [one, two])
				expect(window.maestro.process.kill).toHaveBeenCalledWith(
					`first-terminal-${terminal.tab.id}`
				);
			expect(screen.queryByRole('status')).toBeNull();
			expect(useSessionStore.getState().sessions[0].terminalTabs).toHaveLength(1);
			expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1);
		}
	);

	it('registers explicit cwd in its actual pool without requiring the owner directory to match', () => {
		const a = first();
		const b = createMockSession({ ...first(), id: 'second', cwd: '/other' });
		useSessionStore.getState().setSessions([a, b]);
		const terminal = openPanelTerminal(a.id, { cwd: '/other' })!;
		const sessions = useSessionStore.getState().sessions;
		expect(panelTerminals(sessions, a)).toEqual([]);
		expect(panelTerminals(sessions, b).map(({ tab }) => tab.id)).toEqual([terminal.tab.id]);
		expect(selectPanelTerminal(a.id, terminal.tab.id)).toBe(false);
		expect(resolveTerminalTab(sessions, a.id, terminal.tab.id, true)).toBeNull();
		expect(resolveTerminalTab(sessions, b.id, terminal.tab.id, true)?.tab.id).toBe(terminal.tab.id);
		expect(openPanelTerminal(b.id)!.tab.id).toBe(terminal.tab.id);
	});

	it('does not reuse, select, close or restart another window terminal', async () => {
		const a = first();
		const b = createMockSession({ ...first(), id: 'second' });
		useSessionStore.getState().setSessions([a, b]);
		const foreign = openPanelTerminal(a.id)!;
		window.history.replaceState({}, '', '/?windowId=secondary');
		vi.mocked(window.maestro.windows.getState).mockResolvedValue({
			id: 'secondary',
			sessionIds: [b.id],
			activeSessionId: b.id,
		} as Awaited<ReturnType<typeof window.maestro.windows.getState>>);
		vi.mocked(window.maestro.windows.list).mockResolvedValue([
			{ id: 'primary', isMain: true, sessionIds: [a.id], activeSessionId: a.id },
			{ id: 'secondary', isMain: false, sessionIds: [b.id], activeSessionId: b.id },
		]);
		const context = renderHook(() => useWindowContext(), { wrapper: WindowProvider });
		try {
			await waitFor(() => expect(context.result.current.ownsSession(b.id)).toBe(true));
			expect(panelTerminals(useSessionStore.getState().sessions, b)).toEqual([]);
			expect(selectPanelTerminal(b.id, foreign.tab.id)).toBe(false);
			expect(
				resolveTerminalTab(useSessionStore.getState().sessions, b.id, foreign.tab.id, true)
			).toBeNull();
			expect(openPanelTerminal(a.id)).toBeNull();
			act(() => {
				useTabStore.getState().closeTerminalTab(foreign.tab.id);
				useTabStore.getState().restartTerminalTab(foreign.tab.id);
			});
			expect(window.maestro.process.kill).not.toHaveBeenCalled();
			expect(openPanelTerminal(b.id)!.session.id).toBe(b.id);
		} finally {
			context.unmount();
			window.history.replaceState({}, '', '/');
		}
	});

	it('waits for primary window ownership before starting restored terminals', async () => {
		const b = createMockSession({ ...first(), id: 'second' });
		useSessionStore.getState().setSessions([first(), b]);
		openPanelTerminal('first');
		let hydrate!: (value: Awaited<ReturnType<typeof window.maestro.windows.getState>>) => void;
		vi.mocked(window.maestro.windows.getState).mockReturnValue(
			new Promise((resolve) => {
				hydrate = resolve;
			})
		);
		vi.mocked(window.maestro.windows.list).mockResolvedValue([
			{ id: 'primary', isMain: true, sessionIds: [b.id], activeSessionId: b.id },
			{ id: 'secondary', isMain: false, sessionIds: ['first'], activeSessionId: 'first' },
		]);
		const view = render(
			<WindowProvider>
				<NewShellTerminalPanel session={b} theme={mockTheme} visible />
			</WindowProvider>
		);
		expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
		expect(screen.queryByTestId('terminal-empty')).toBeNull();
		await act(async () =>
			hydrate({ id: 'primary', sessionIds: [b.id], activeSessionId: b.id } as Awaited<
				ReturnType<typeof window.maestro.windows.getState>
			>)
		);
		await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1));
		expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: expect.stringMatching(/^second-terminal-/) })
		);
		expect(window.maestro.process.kill).not.toHaveBeenCalled();
		view.unmount();
	});

	it('opens once per visit and ignores ownership refresh after the last terminal closes', async () => {
		vi.mocked(window.maestro.windows.getState).mockImplementation(
			async () =>
				({
					id: 'primary',
					sessionIds: ['first'],
					activeSessionId: 'first',
				}) as Awaited<ReturnType<typeof window.maestro.windows.getState>>
		);
		vi.mocked(window.maestro.windows.list).mockImplementation(async () => [
			{ id: 'primary', isMain: true, sessionIds: ['first'], activeSessionId: 'first' },
		]);
		const view = render(
			<WindowProvider>
				<NewShellTerminalPanel session={first()} theme={mockTheme} visible />
			</WindowProvider>
		);
		await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1));
		act(() =>
			useTabStore
				.getState()
				.closeTerminalTab(useSessionStore.getState().sessions[0].terminalTabs[0].id)
		);
		expect(useSessionStore.getState().sessions[0].terminalTabs).toEqual([]);
		const refresh = vi.mocked(window.maestro.windows.onSessionMoved).mock.lastCall![0];
		await act(async () => refresh({} as never));
		expect(useSessionStore.getState().sessions[0].terminalTabs).toEqual([]);
		expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1);
		view.rerender(
			<WindowProvider>
				<NewShellTerminalPanel session={first()} theme={mockTheme} visible={false} />
			</WindowProvider>
		);
		view.rerender(
			<WindowProvider>
				<NewShellTerminalPanel session={first()} theme={mockTheme} visible />
			</WindowProvider>
		);
		await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(2));
		act(() => {
			useTabStore
				.getState()
				.closeTerminalTab(useSessionStore.getState().sessions[0].terminalTabs[0].id);
			useSessionStore.getState().updateSession('first', {
				aiTabs: [createMockAITab({ id: 'next-conversation' })],
				activeTabId: 'next-conversation',
			});
		});
		await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(3));
		await act(async () => refresh({} as never));
		expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(3);
	});

	it('starts a classic restored terminal once window ownership finishes loading', async () => {
		const terminal = openPanelTerminal('first')!;
		useSettingsStore.setState({ newShell: false });
		let hydrate!: (value: Awaited<ReturnType<typeof window.maestro.windows.getState>>) => void;
		vi.mocked(window.maestro.windows.getState).mockReturnValue(
			new Promise((resolve) => {
				hydrate = resolve;
			})
		);
		vi.mocked(window.maestro.windows.list).mockResolvedValue([
			{ id: 'primary', isMain: true, sessionIds: ['first'], activeSessionId: 'first' },
		]);
		render(
			<WindowProvider>
				<TerminalView
					session={terminal.session}
					theme={mockTheme}
					fontFamily="monospace"
					onTabPidChange={vi.fn()}
					onTabStateChange={vi.fn()}
					isVisible
				/>
			</WindowProvider>
		);
		expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
		expect(screen.queryByTestId('terminal-empty')).toBeNull();
		await act(async () =>
			hydrate({ id: 'primary', sessionIds: ['first'], activeSessionId: 'first' } as Awaited<
				ReturnType<typeof window.maestro.windows.getState>
			>)
		);
		await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1));
		expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: `first-terminal-${terminal.tab.id}` })
		);
	});

	it.each(['rejection', 'null', 'list failure'])(
		'starts classic terminals after ownership %s',
		async (failure) => {
			const terminal = openPanelTerminal('first')!;
			useSettingsStore.setState({ newShell: false });
			vi.mocked(window.maestro.windows.getState).mockResolvedValue({
				id: 'primary',
				sessionIds: ['first'],
				activeSessionId: 'first',
			} as Awaited<ReturnType<typeof window.maestro.windows.getState>>);
			vi.mocked(window.maestro.windows.list).mockResolvedValue([]);
			if (failure === 'rejection')
				vi.mocked(window.maestro.windows.getState).mockRejectedValue(new Error('fixture failure'));
			else if (failure === 'null')
				vi.mocked(window.maestro.windows.getState).mockResolvedValue(null);
			else vi.mocked(window.maestro.windows.list).mockRejectedValue(new Error('fixture failure'));
			render(
				<WindowProvider>
					<TerminalView
						session={terminal.session}
						theme={mockTheme}
						fontFamily="monospace"
						onTabPidChange={vi.fn()}
						onTabStateChange={vi.fn()}
						isVisible
					/>
				</WindowProvider>
			);
			await waitFor(() =>
				expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledExactlyOnceWith(
					expect.objectContaining({ sessionId: `first-terminal-${terminal.tab.id}` })
				)
			);
		}
	);

	it.each([
		[
			'rejection',
			'en',
			'/',
			'Window ownership could not be confirmed. The terminal was not started',
		],
		['null', 'zh-CN', '/', '无法确认窗口归属，终端没有启动'],
		[
			'list failure',
			'en',
			'/',
			'Window ownership could not be confirmed. The terminal was not started',
		],
		['null', 'zh-CN', '/?windowId=secondary', '无法确认窗口归属，终端没有启动'],
	])(
		'shows new shell ownership %s in %s at %s and can recover',
		async (failure, locale, url, message) => {
			useSettingsStore.setState({ uiLanguage: locale as 'en' | 'zh-CN' });
			window.history.replaceState({}, '', url);
			vi.mocked(window.maestro.windows.getState).mockResolvedValue({
				id: url === '/' ? 'primary' : 'secondary',
				sessionIds: ['first'],
				activeSessionId: 'first',
			} as Awaited<ReturnType<typeof window.maestro.windows.getState>>);
			vi.mocked(window.maestro.windows.list).mockResolvedValue([]);
			if (failure === 'rejection')
				vi.mocked(window.maestro.windows.getState).mockRejectedValueOnce(
					new Error('fixture failure')
				);
			else if (failure === 'null')
				vi.mocked(window.maestro.windows.getState).mockResolvedValueOnce(null);
			else
				vi.mocked(window.maestro.windows.list).mockRejectedValueOnce(new Error('fixture failure'));
			render(
				<WindowProvider>
					<NewShellTerminalPanel session={first()} theme={mockTheme} visible />
				</WindowProvider>
			);
			await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
			expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
			expect(useSessionStore.getState().sessions[0].terminalTabs).toEqual([]);
			await act(async () =>
				vi.mocked(window.maestro.windows.onSessionMoved).mock.lastCall![0]({} as never)
			);
			await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1));
			expect(screen.queryByRole('alert')).toBeNull();
		}
	);

	it('restarts an exited shared terminal in its real owner without clearing output', async () => {
		const b = createMockSession({ ...first(), id: 'second' });
		useSessionStore.getState().setSessions([first(), b]);
		const terminal = openPanelTerminal('first')!;
		useSessionStore.getState().updateSession('first', {
			terminalTabs: [{ ...terminal.tab, state: 'exited', exitCode: 255 }],
		});
		useSessionStore.getState().setActiveSessionId(b.id);
		render(<NewShellTerminalPanel session={b} theme={mockTheme} visible />);
		expect(screen.getByRole('status')).toHaveTextContent('Terminal exited (255)');
		expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
		const instance = screen.getByTestId('terminal-instance');
		fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
		await waitFor(() => expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1));
		expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: `first-terminal-${terminal.tab.id}`,
			})
		);
		expect(screen.getByTestId('terminal-instance')).toBe(instance);
		expect(lifecycle.clear).not.toHaveBeenCalled();
		expect(lifecycle.unmount).not.toHaveBeenCalled();
		expect(useSessionStore.getState().sessions[0].inputMode).toBe('ai');
	});

	it('delivers the restarted PID to the retained xterm for an unchanged panel size', async () => {
		const terminal = openPanelTerminal('first')!;
		useSessionStore.getState().updateSession('first', {
			terminalTabs: [{ ...terminal.tab, pid: 41, state: 'busy' }],
		});
		render(<NewShellTerminalPanel session={first()} theme={mockTheme} visible />);
		const instance = screen.getByTestId('terminal-instance');
		await act(async () => useTabStore.getState().restartTerminalTab(terminal.tab.id));
		expect(window.maestro.process.spawnTerminalTab).toHaveBeenCalledTimes(1);
		expect(instance).toHaveAttribute('data-pty-pid', '42');
		expect(screen.getByTestId('terminal-instance')).toBe(instance);
		expect(lifecycle.clear).not.toHaveBeenCalled();
		expect(lifecycle.unmount).not.toHaveBeenCalled();
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

	it('surfaces a restart failure while retaining the exited terminal and its output', async () => {
		const terminal = openPanelTerminal('first')!;
		useSessionStore.getState().updateSession('first', {
			terminalTabs: [{ ...terminal.tab, state: 'exited', startupCommand: 'echo fixture' }],
		});
		render(<NewShellTerminalPanel session={first()} theme={mockTheme} visible />);
		expect(screen.getByRole('status')).toHaveTextContent(/^Terminal exited$/);
		const instance = screen.getByTestId('terminal-instance');
		vi.mocked(window.maestro.process.spawnTerminalTab).mockResolvedValue({
			success: false,
			pid: 0,
		});
		fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
		await waitFor(() =>
			expect(screen.getByRole('alert')).toHaveTextContent('could not be started')
		);
		expect(screen.getByTestId('terminal-instance')).toBe(instance);
		expect(lifecycle.clear).not.toHaveBeenCalled();
		expect(useSessionStore.getState().sessions[0].terminalTabs[0].state).toBe('exited');
	});

	it('refuses restarting a terminal after its owner changed host', async () => {
		const terminal = openPanelTerminal('first')!;
		useSessionStore
			.getState()
			.updateSession('first', { sessionSshRemoteConfig: { enabled: true, remoteId: 'new-host' } });
		await expect(useTabStore.getState().restartTerminalTab(terminal.tab.id)).rejects.toThrow(
			/host/
		);
		expect(window.maestro.process.kill).not.toHaveBeenCalled();
		expect(window.maestro.process.spawnTerminalTab).not.toHaveBeenCalled();
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
		const sessions = useSessionStore.getState().sessions;
		expect(panelTerminals(sessions, sessions[0])).toEqual([]);
		expect(resolveTerminalTab(sessions, 'first', 'stale-terminal', true)).toBeNull();
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
			expect(screen.getByText('Working')).toHaveStyle({ color: mockTheme.colors.textMain });
			expect(screen.getByText('Working')).toHaveClass('font-medium');
			for (const [text, icon, color] of [
				['Done', 'check', mockTheme.colors.textDim],
				['Working', 'circle-dot', mockTheme.colors.accent],
				['Next', 'circle', mockTheme.colors.textDim],
			]) {
				const row = screen.getByText(text).closest('li')!;
				const box = row.querySelector('span')!;
				expect(box).toHaveClass('w-4', 'h-4', 'shrink-0');
				expect(box).toHaveStyle({ color });
				expect(box.querySelector(`svg.lucide-${icon}`)).not.toBeNull();
				expect(row.style.opacity).toBe('');
			}
			expect(screen.getByText('Done')).toHaveStyle({ color: mockTheme.colors.textDim });
			expect(screen.getByText('Next')).toHaveStyle({ color: mockTheme.colors.textMain });
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

	it.each([
		[
			'en',
			'The tools in this conversation have not provided a task list. Checklists in replies are not shown here.',
		],
		['zh-CN', '这条对话的工具尚未提供任务清单。回复正文里的清单不会显示在这里。'],
	] as const)(
		'explains missing tool data in %s without turning prose into tasks',
		(uiLanguage, text) => {
			useSettingsStore.setState({ uiLanguage });
			render(
				<TasksPanel
					logs={[
						{
							id: 'prose-plan',
							timestamp: 1,
							source: 'stdout',
							text: 'I have no update_plan tool.\n- [x] First\n- [x] Second',
						},
					]}
					theme={mockTheme}
				/>
			);
			expect(screen.getByTestId('tasks-empty')).toHaveTextContent(text);
			expect(screen.queryByRole('list')).toBeNull();
		}
	);
});
