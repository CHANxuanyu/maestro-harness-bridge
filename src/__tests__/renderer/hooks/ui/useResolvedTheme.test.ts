import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useResolvedTheme } from '../../../../renderer/hooks/ui/useResolvedTheme';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';

vi.mock('../../../../renderer/hooks/usePluginContributions', () => ({
	usePluginContributions: () => ({ themes: [] }),
}));

let prefersDark = false;
const listeners = new Set<() => void>();

function installMatchMedia() {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		get matches() {
			return query === '(prefers-color-scheme: dark)' && prefersDark;
		},
		media: query,
		addEventListener: (_: string, fn: () => void) => listeners.add(fn),
		removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
	})) as never;
}

function setSystem(dark: boolean) {
	prefersDark = dark;
	listeners.forEach((fn) => fn());
}

describe('useResolvedTheme and the system appearance', () => {
	const original = window.matchMedia;
	afterEach(() => {
		window.matchMedia = original;
		listeners.clear();
		useSettingsStore.setState({ activeThemeId: 'clay-dark', followSystemAppearance: true });
	});

	it('follows the system between Clay Dark and Clay Light, live', () => {
		installMatchMedia();
		prefersDark = false;
		useSettingsStore.setState({ activeThemeId: 'clay-dark', followSystemAppearance: true });
		const { result } = renderHook(() => useResolvedTheme());
		expect(result.current.id).toBe('clay-light');
		act(() => setSystem(true));
		expect(result.current.id).toBe('clay-dark');
	});

	it('draws the stored theme when following is off', () => {
		installMatchMedia();
		prefersDark = false;
		useSettingsStore.setState({ activeThemeId: 'clay-dark', followSystemAppearance: false });
		const { result } = renderHook(() => useResolvedTheme());
		expect(result.current.id).toBe('clay-dark');
	});

	it('leaves a theme without a pair alone', () => {
		installMatchMedia();
		prefersDark = false;
		useSettingsStore.setState({ activeThemeId: 'dracula', followSystemAppearance: true });
		const { result } = renderHook(() => useResolvedTheme());
		expect(result.current.id).toBe('dracula');
	});
});
