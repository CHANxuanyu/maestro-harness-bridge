import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiLanguagePreference } from '../../../shared/i18n';
import { LanguageSection } from '../../../renderer/components/Settings/tabs/GeneralTab/components/LanguageSection';
import { useSettings } from '../../../renderer/hooks/settings/useSettings';
import { useMaestroCliState } from '../../../renderer/components/Settings/tabs/GeneralTab/hooks/useMaestroCliState';
import { useSyncStorageState } from '../../../renderer/components/Settings/tabs/GeneralTab/hooks/useSyncStorageState';
import { translate } from '../../../renderer/i18n/translate';
import { loadAllSettings, useSettingsStore } from '../../../renderer/stores/settingsStore';
import { mockTheme } from '../../helpers/mockTheme';

const initialState = useSettingsStore.getInitialState();
const originalMaestroCli = window.maestro.maestroCli;

beforeEach(() => {
	vi.clearAllMocks();
	window.maestro.maestroCli = { checkStatus: vi.fn(), installOrUpdate: vi.fn() };
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
	useSettingsStore.setState({ ...initialState, uiLanguage: 'en' });
	vi.mocked(window.maestro.settings.getAll).mockResolvedValue({ cueTimeBackfillApplied: true });
});

afterEach(() => {
	cleanup();
	useSettingsStore.setState(initialState);
	vi.restoreAllMocks();
	window.maestro.maestroCli = originalMaestroCli;
});

function LanguageSettings() {
	const uiLanguage = useSettingsStore((state) => state.uiLanguage);
	const setUiLanguage = useSettingsStore((state) => state.setUiLanguage);
	return (
		<LanguageSection theme={mockTheme} uiLanguage={uiLanguage} setUiLanguage={setUiLanguage} />
	);
}

describe('persisted UI language', () => {
	it('defaults to following the system', () => {
		expect(initialState.uiLanguage).toBe('system');
	});

	it.each(['system', 'en', 'zh-CN'] as const)(
		'persists the canonical %s preference',
		(preference) => {
			useSettingsStore.getState().setUiLanguage(preference);
			expect(useSettingsStore.getState().uiLanguage).toBe(preference);
			expect(window.maestro.settings.set).toHaveBeenCalledWith('uiLanguage', preference);
			expect(document.documentElement.lang).toBe(preference === 'zh-CN' ? 'zh-CN' : 'en');
		}
	);

	it('normalizes an invalid runtime setter input before persisting it', () => {
		useSettingsStore.getState().setUiLanguage('zh-CN');
		useSettingsStore.getState().setUiLanguage('unsupported' as UiLanguagePreference);
		expect(useSettingsStore.getState().uiLanguage).toBe('system');
		expect(window.maestro.settings.set).toHaveBeenLastCalledWith('uiLanguage', 'system');
	});

	it.each(['zh-CN', 'en', 'system'] as const)(
		'hydrates %s without rewriting it',
		async (preference) => {
			vi.mocked(window.maestro.settings.getAll).mockResolvedValue({
				uiLanguage: preference,
				cueTimeBackfillApplied: true,
			});
			await loadAllSettings();
			expect(useSettingsStore.getState().uiLanguage).toBe(preference);
			expect(useSettingsStore.getState().settingsLoaded).toBe(true);
			expect(window.maestro.settings.set).not.toHaveBeenCalledWith('uiLanguage', expect.anything());
		}
	);

	it.each([undefined, null, 'fr', { value: 'zh-CN' }, ['en']])(
		'resets a missing or invalid hydrated preference to system: %j',
		async (preference) => {
			useSettingsStore.setState({ uiLanguage: 'zh-CN', settingsLoaded: true });
			vi.mocked(window.maestro.settings.getAll).mockResolvedValue({
				...(preference === undefined ? {} : { uiLanguage: preference }),
				cueTimeBackfillApplied: true,
			});
			await loadAllSettings();
			expect(useSettingsStore.getState().uiLanguage).toBe('system');
			expect(document.documentElement.lang).toBe('en');
		}
	);

	it('preserves a language selection made during an external settings reload', async () => {
		useSettingsStore.setState({ settingsLoaded: true });
		let finishRead!: (settings: Record<string, unknown>) => void;
		vi.mocked(window.maestro.settings.getAll).mockReturnValueOnce(
			new Promise((resolve) => {
				finishRead = resolve;
			})
		);
		const pending = loadAllSettings();
		useSettingsStore.getState().setUiLanguage('zh-CN');
		finishRead({ uiLanguage: 'en', cueTimeBackfillApplied: true });
		await pending;
		expect(useSettingsStore.getState().uiLanguage).toBe('zh-CN');
	});

	it('hydrates through useSettings and reacts to another window or CLI write', async () => {
		vi.mocked(window.maestro.settings.getAll).mockResolvedValue({
			uiLanguage: 'en',
			cueTimeBackfillApplied: true,
		});
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.settingsLoaded).toBe(true));
		const externalChange = vi
			.mocked(window.maestro.settings.onExternalChange)
			.mock.calls.at(-1)?.[0];
		expect(externalChange).toBeTypeOf('function');
		vi.mocked(window.maestro.settings.getAll).mockResolvedValue({
			uiLanguage: 'zh-CN',
			cueTimeBackfillApplied: true,
		});
		await act(async () => {
			externalChange?.();
		});
		await waitFor(() => expect(result.current.uiLanguage).toBe('zh-CN'));
		expect(document.documentElement.lang).toBe('zh-CN');
		act(() => result.current.setUiLanguage('en'));
		expect(window.maestro.settings.set).toHaveBeenLastCalledWith('uiLanguage', 'en');
	});

	it('exposes native language names and changes only the stored preference', () => {
		render(<LanguageSettings />);
		fireEvent.click(screen.getByRole('button', { name: '简体中文' }));
		expect(screen.getByText('语言')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
		expect(window.maestro.settings.set).toHaveBeenLastCalledWith('uiLanguage', 'zh-CN');
		fireEvent.click(screen.getByRole('button', { name: '跟随系统' }));
		expect(screen.getByText('Following the system language: English.')).toBeInTheDocument();
		expect(window.maestro.settings.set).toHaveBeenLastCalledWith('uiLanguage', 'system');
	});
});

describe('localized settings status messages', () => {
	it('retranslates an existing CLI error without repeating the status check', async () => {
		vi.spyOn(window.maestro.maestroCli, 'checkStatus').mockRejectedValue(new Error('test failure'));
		const { result } = renderHook(() => useMaestroCliState({ isOpen: true }));
		await waitFor(() =>
			expect(result.current.statusError).toBe('Failed to check Maestro CLI status')
		);
		act(() => useSettingsStore.getState().setUiLanguage('zh-CN'));
		expect(result.current.statusError).toBe(translate('zh-CN', 'settings.general.cli.checkFailed'));
		expect(window.maestro.maestroCli.checkStatus).toHaveBeenCalledTimes(1);
	});

	it('retranslates an existing storage error without restarting the operation', async () => {
		vi.spyOn(window.maestro.sync, 'getDefaultPath').mockRejectedValue(new Error('test failure'));
		const { result } = renderHook(() => useSyncStorageState({ isOpen: true }));
		await waitFor(() =>
			expect(result.current.syncError).toBe(translate('en', 'settings.general.storage.loadFailed'))
		);
		act(() => useSettingsStore.getState().setUiLanguage('zh-CN'));
		expect(result.current.syncError).toBe(
			translate('zh-CN', 'settings.general.storage.loadFailed')
		);
		expect(window.maestro.sync.getDefaultPath).toHaveBeenCalledTimes(1);
	});
});
