/**
 * Tests for useWindowState
 *
 * useWindowState bridges the global UI store's panel-collapse state to the main
 * process so each window remembers its OWN collapsed panels. The behaviour that
 * matters: it hydrates the store from this window's persisted per-window state
 * on mount, persists later toggles (debounced) through
 * `window.maestro.windows.setPanelState`, and never writes the value it just
 * hydrated straight back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWindowState } from '../../../renderer/hooks/ui/useWindowState';
import { useUIStore } from '../../../renderer/stores/uiStore';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import type { WindowState } from '../../../shared/window-types';

const windows = () => window.maestro.windows;

/** Build a full WindowState, overriding only the fields a test cares about. */
function makeState(partial: Partial<WindowState>): WindowState {
	return {
		id: 'w1',
		x: 0,
		y: 0,
		width: 1200,
		height: 800,
		isMaximized: false,
		isFullScreen: false,
		sessionIds: [],
		activeSessionId: null,
		leftPanelCollapsed: false,
		rightPanelCollapsed: false,
		...partial,
	};
}

describe('useWindowState', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useSettingsStore.setState({ newShell: false, settingsLoaded: true });
		useSessionStore.setState({ sessions: [], activeSessionId: '' });
		// Reset the global panel state to the store defaults (both open).
		useUIStore.setState({ leftSidebarOpen: true, rightPanelOpen: true });
		vi.mocked(windows().getState).mockResolvedValue(null);
		vi.mocked(windows().setPanelState).mockResolvedValue(undefined);
	});

	it.each([false, true])(
		'restores saved shell=%s before settings hydration without rewriting conversation preferences',
		async (newShell) => {
			useSettingsStore.setState({ newShell: true, settingsLoaded: false });
			vi.mocked(window.maestro.settings.get).mockResolvedValueOnce(newShell);
			const panel = { tab: 'changes' as const, open: true };
			const session = createMockSession({
				id: 'restored',
				activeTabId: 'conversation',
				aiTabs: [createMockAITab({ id: 'conversation', newShellPanel: panel })],
			});
			useSessionStore.setState({ sessions: [session], activeSessionId: session.id });
			vi.mocked(windows().getState).mockResolvedValue(
				makeState({ leftPanelCollapsed: true, rightPanelCollapsed: true })
			);
			renderHook(() => useWindowState());
			await waitFor(() => expect(useUIStore.getState().leftSidebarOpen).toBe(false));
			expect(useSessionStore.getState().sessions[0].aiTabs[0].newShellPanel).toEqual(panel);
			expect(useUIStore.getState().rightPanelOpen).toBe(newShell);
			expect(window.maestro.settings.get).toHaveBeenCalledWith('newShell');
		}
	);

	it('uses the window fallback without creating a conversation preference', async () => {
		useSettingsStore.setState({ newShell: true });
		const session = createMockSession({
			id: 'restored',
			activeTabId: 'conversation',
			aiTabs: [createMockAITab({ id: 'conversation' })],
		});
		useSessionStore.setState({ sessions: [session], activeSessionId: session.id });
		vi.mocked(windows().getState).mockResolvedValue(
			makeState({ leftPanelCollapsed: true, rightPanelCollapsed: false })
		);
		renderHook(() => useWindowState());
		await waitFor(() => expect(useUIStore.getState().leftSidebarOpen).toBe(false));
		expect(useUIStore.getState().rightPanelOpen).toBe(true);
		expect(useSessionStore.getState().sessions[0].aiTabs[0].newShellPanel).toBeUndefined();
	});

	it('hydrates the UI store from the persisted per-window state on mount', async () => {
		vi.mocked(windows().getState).mockResolvedValue(
			makeState({ leftPanelCollapsed: true, rightPanelCollapsed: false })
		);

		renderHook(() => useWindowState());

		// collapsed -> panel not open; not collapsed -> panel open
		await waitFor(() => expect(useUIStore.getState().leftSidebarOpen).toBe(false));
		expect(windows().getState).toHaveBeenCalled();
		expect(useUIStore.getState().leftSidebarOpen).toBe(false);
		expect(useUIStore.getState().rightPanelOpen).toBe(true);
	});

	it('leaves the store untouched when no persisted state is returned', async () => {
		vi.mocked(windows().getState).mockResolvedValue(null);

		renderHook(() => useWindowState());

		await waitFor(() => expect(windows().getState).toHaveBeenCalled());
		expect(useUIStore.getState().leftSidebarOpen).toBe(true);
		expect(useUIStore.getState().rightPanelOpen).toBe(true);
	});

	it('does not write the just-hydrated value back to the main process', async () => {
		vi.mocked(windows().getState).mockResolvedValue(
			makeState({ leftPanelCollapsed: true, rightPanelCollapsed: true })
		);

		renderHook(() => useWindowState());

		await waitFor(() => expect(useUIStore.getState().leftSidebarOpen).toBe(false));
		// The equality guard skips scheduling a persist for the hydrated value, so
		// no write is queued at all - nothing to wait for.
		expect(windows().setPanelState).not.toHaveBeenCalled();
	});

	it('persists a panel toggle through windows.setPanelState (debounced)', async () => {
		vi.mocked(windows().getState).mockResolvedValue(makeState({}));

		renderHook(() => useWindowState());
		await waitFor(() => expect(windows().getState).toHaveBeenCalled());

		// User collapses the right panel.
		act(() => {
			useUIStore.getState().setRightPanelOpen(false);
		});

		// Debounced: nothing written synchronously.
		expect(windows().setPanelState).not.toHaveBeenCalled();

		await waitFor(() =>
			expect(windows().setPanelState).toHaveBeenCalledWith({
				leftPanelCollapsed: false,
				rightPanelCollapsed: true,
			})
		);
	});

	it('coalesces rapid toggles into a single final-state write', async () => {
		vi.mocked(windows().getState).mockResolvedValue(makeState({}));

		renderHook(() => useWindowState());
		await waitFor(() => expect(windows().getState).toHaveBeenCalled());

		// Collapse then immediately re-open within the debounce window.
		act(() => {
			useUIStore.getState().setLeftSidebarOpen(false);
		});
		act(() => {
			useUIStore.getState().setLeftSidebarOpen(true);
		});

		await waitFor(() => expect(windows().setPanelState).toHaveBeenCalled());
		expect(windows().setPanelState).toHaveBeenCalledTimes(1);
		expect(windows().setPanelState).toHaveBeenLastCalledWith({
			leftPanelCollapsed: false,
			rightPanelCollapsed: false,
		});
	});
});
