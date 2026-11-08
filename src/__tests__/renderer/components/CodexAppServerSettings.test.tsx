import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { NewShellSection } from '../../../renderer/components/Settings/tabs/DisplayTab/components/NewShellSection';
import { inputAreaTheme } from './InputArea/_fixtures';
import { SETTINGS_DEFAULTS } from '../../../main/stores/defaults';
import { SETTINGS_METADATA } from '../../../shared/settingsMetadata';

describe('Codex app-server controls', () => {
	beforeEach(() => {
		useSettingsStore.setState({ newShell: false, uiLanguage: 'en' });
	});

	it('defaults off in the main store, renderer and CLI metadata', () => {
		expect(SETTINGS_DEFAULTS.codexAppServer).toBe(false);
		expect(useSettingsStore.getInitialState().codexAppServer).toBe(false);
		expect(SETTINGS_METADATA.codexAppServer.default).toBe(false);
	});

	it('only exposes the experimental switch in the new shell and persists it', () => {
		const { rerender } = render(<NewShellSection theme={inputAreaTheme} />);
		expect(screen.queryByRole('switch', { name: 'Codex interactive prototype' })).toBeNull();
		act(() => useSettingsStore.setState({ newShell: true }));
		rerender(<NewShellSection theme={inputAreaTheme} />);
		fireEvent.click(screen.getByRole('switch', { name: 'Codex interactive prototype' }));
		expect(useSettingsStore.getState().codexAppServer).toBe(true);
		expect(window.maestro.settings.set).toHaveBeenCalledWith('codexAppServer', true);
	});
});
