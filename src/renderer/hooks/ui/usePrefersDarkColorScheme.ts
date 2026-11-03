import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void): () => void {
	if (typeof window === 'undefined' || !window.matchMedia) return () => {};
	const mql = window.matchMedia(QUERY);
	mql.addEventListener('change', onChange);
	return () => mql.removeEventListener('change', onChange);
}

function read(): boolean {
	if (typeof window === 'undefined' || !window.matchMedia) return true;
	return window.matchMedia(QUERY).matches;
}

/**
 * Whether the system is in dark mode, live. Electron reports the OS appearance
 * through `prefers-color-scheme`, so this follows a macOS or Windows switch
 * without a restart. Without `matchMedia` (jsdom) it answers dark, the mode the
 * default theme was designed in.
 */
export function usePrefersDarkColorScheme(): boolean {
	return useSyncExternalStore(subscribe, read, read);
}
