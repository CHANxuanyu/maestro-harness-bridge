/**
 * useWindowState
 *
 * Bridges the renderer's panel-collapse UI state (the global {@link useUIStore}
 * `leftSidebarOpen` / `rightPanelOpen`) to the main process so each window
 * remembers its OWN collapsed panels. Because every window is a separate
 * renderer with its own `useUIStore` instance, the in-memory state is already
 * per-window; this hook adds the missing piece - reading the persisted
 * per-window state on mount and writing changes back through
 * `window.maestro.windows.*`, debounced. Panel collapse is therefore per-window,
 * not a single global setting shared across windows.
 *
 * Mapping: a collapsed panel is "not open", so
 * `leftPanelCollapsed = !leftSidebarOpen` and `rightPanelCollapsed =
 * !rightPanelOpen`. The left sidebar's third "hidden" state has no slot in the
 * persisted {@link WindowState} schema and is intentionally not round-tripped.
 *
 * Wiring this hook into the app is a separate step; on its own it is an additive,
 * self-contained bridge.
 */

import { useEffect, useRef } from 'react';
import type { WindowPanelState } from '../../../shared/window-types';
import { useUIStore } from '../../stores/uiStore';
import { selectActiveSession, useSessionStore } from '../../stores/sessionStore';
import { selectNewShellEnabled, useSettingsStore } from '../../stores/settingsStore';
import { useDebouncedCallback } from '../utils/useThrottle';

/**
 * How long to wait after the last panel toggle before persisting. Collapsing a
 * panel can fire rapidly (drag, keyboard repeat), so we coalesce to the final
 * state rather than writing every intermediate value.
 */
const PANEL_STATE_PERSIST_DELAY_MS = 400;

/**
 * Read and persist this window's panel-collapse state. Hydrates the global UI
 * store from the window's persisted state on mount, then persists subsequent
 * changes (debounced) to the main process, keyed per-window.
 */
export function useWindowState(): void {
	const leftSidebarOpen = useUIStore((s) => s.leftSidebarOpen);
	const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
	const setLeftSidebarOpen = useUIStore((s) => s.setLeftSidebarOpen);

	// True once the window's persisted state has been read and applied. We must
	// not persist before this (it would clobber the saved value with the store's
	// defaults), and we record the hydrated value so the store change that
	// hydration itself triggers is not written straight back.
	const hydratedRef = useRef(false);
	const lastPersistedRef = useRef<WindowPanelState | null>(null);

	// Typed as (...args: unknown[]) to satisfy useDebouncedCallback's generic
	// constraint (matching the codebase convention); we pass a single
	// WindowPanelState and narrow it here.
	const { debouncedCallback: persistPanelState } = useDebouncedCallback((...args: unknown[]) => {
		void window.maestro?.windows?.setPanelState(args[0] as WindowPanelState);
	}, PANEL_STATE_PERSIST_DELAY_MS);

	// Hydrate the global panel state from this window's persisted per-window state
	// on mount. `cancelled` guards against applying a late resolve after unmount.
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const settings = useSettingsStore.getState();
			const [state, savedNewShell] = await Promise.all([
				window.maestro?.windows?.getState?.(),
				settings.settingsLoaded
					? selectNewShellEnabled(settings)
					: window.maestro?.settings?.get('newShell'),
			]);
			if (cancelled) return;
			if (state) {
				// Settings and sessions hydrate independently. Use the saved shell if
				// settings are still pending, then read the current conversation.
				const currentSettings = useSettingsStore.getState();
				const newShell = currentSettings.settingsLoaded
					? selectNewShellEnabled(currentSettings)
					: savedNewShell === true;
				const session = selectActiveSession(useSessionStore.getState());
				const conversationOpen = newShell
					? session?.aiTabs.find((tab) => tab.id === session.activeTabId)?.newShellPanel?.open
					: undefined;
				const open = conversationOpen ?? !state.rightPanelCollapsed;
				lastPersistedRef.current = {
					leftPanelCollapsed: state.leftPanelCollapsed,
					rightPanelCollapsed: state.rightPanelCollapsed,
				};
				setLeftSidebarOpen(!state.leftPanelCollapsed);
				// Hydration is a read, not a toggle: the setter would overwrite the
				// conversation's saved choice with the window's fallback value.
				useUIStore.setState((current) => ({
					rightPanelOpen: open,
					rightPanelManuallyOpened:
						current.rightPanelManuallyOpened || conversationOpen !== undefined || open,
				}));
			}
			hydratedRef.current = true;
		})();
		return () => {
			cancelled = true;
		};
	}, [setLeftSidebarOpen]);

	// Persist (debounced) whenever the panel state changes after hydration. The
	// equality check skips the no-op write that hydration's own state update would
	// otherwise trigger, so only genuine user toggles reach the main process.
	useEffect(() => {
		if (!hydratedRef.current) return;
		const next: WindowPanelState = {
			leftPanelCollapsed: !leftSidebarOpen,
			rightPanelCollapsed: !rightPanelOpen,
		};
		const last = lastPersistedRef.current;
		if (
			last &&
			last.leftPanelCollapsed === next.leftPanelCollapsed &&
			last.rightPanelCollapsed === next.rightPanelCollapsed
		) {
			return;
		}
		lastPersistedRef.current = next;
		persistPanelState(next);
	}, [leftSidebarOpen, rightPanelOpen, persistPanelState]);
}
