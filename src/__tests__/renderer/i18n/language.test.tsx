import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FontConfigurationPanel } from '../../../renderer/components/FontConfigurationPanel';
import { applyDocumentLanguage, getSystemLocale } from '../../../renderer/i18n/documentLanguage';
import { getAppLocale, getT, useI18n, useT } from '../../../renderer/i18n/useI18n';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { mockTheme } from '../../helpers/mockTheme';

let systemLanguages: readonly string[];
const initialState = useSettingsStore.getInitialState();

beforeEach(() => {
	systemLanguages = ['en-US'];
	vi.spyOn(navigator, 'languages', 'get').mockImplementation(() => systemLanguages);
	vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
	useSettingsStore.setState({ ...initialState, uiLanguage: 'en' });
	applyDocumentLanguage('en');
});

afterEach(() => {
	cleanup();
	useSettingsStore.setState(initialState);
	vi.restoreAllMocks();
});

describe('resolved UI language', () => {
	it('prefers the first system language and falls back when it is unavailable', () => {
		systemLanguages = ['zh-TW', 'en-US'];
		expect(getSystemLocale()).toBe('zh-TW');
		expect(applyDocumentLanguage('system')).toBe('zh-CN');
		expect(document.documentElement.lang).toBe('zh-CN');
		systemLanguages = [];
		expect(getSystemLocale()).toBe('en-US');
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('');
		expect(getSystemLocale()).toBe('en');
	});

	it('keeps an explicit preference when the operating system language changes', () => {
		const { result } = renderHook(() => useI18n());
		act(() => {
			systemLanguages = ['zh-CN'];
			window.dispatchEvent(new Event('languagechange'));
		});
		expect(result.current.locale).toBe('en');
		expect(result.current.t('settings.language.heading')).toBe('Language');
		expect(document.documentElement.lang).toBe('en');
	});

	it('updates both the rendered copy and document language when following the system', () => {
		useSettingsStore.setState({ uiLanguage: 'system' });
		const { result } = renderHook(() => useI18n());
		expect(result.current.locale).toBe('en');
		act(() => {
			systemLanguages = ['zh-Hans-CN'];
			window.dispatchEvent(new Event('languagechange'));
		});
		expect(result.current.locale).toBe('zh-CN');
		expect(result.current.t('settings.language.heading')).toBe('语言');
		expect(document.documentElement.lang).toBe('zh-CN');
		act(() => {
			systemLanguages = ['fr-FR'];
			window.dispatchEvent(new Event('languagechange'));
		});
		expect(result.current.locale).toBe('en');
		expect(document.documentElement.lang).toBe('en');
	});

	it('removes its system listener when the consumer unmounts', () => {
		const add = vi.spyOn(window, 'addEventListener');
		const remove = vi.spyOn(window, 'removeEventListener');
		const { unmount } = renderHook(() => useT());
		const listener = add.mock.calls.find(([type]) => type === 'languagechange')?.[1];
		expect(listener).toBeTypeOf('function');
		unmount();
		expect(remove).toHaveBeenCalledWith('languagechange', listener);
	});

	it('keeps translator references stable for unrelated settings and refreshes outside React', () => {
		const { result } = renderHook(() => useI18n());
		const first = result.current;
		act(() => useSettingsStore.setState({ conductorProfile: 'User-owned English text' }));
		expect(result.current).toBe(first);
		act(() => useSettingsStore.getState().setUiLanguage('zh-CN'));
		expect(result.current.t).not.toBe(first.t);
		expect(result.current.tRich).not.toBe(first.tRich);
		expect(getAppLocale()).toBe('zh-CN');
		expect(getT()('settings.language.heading')).toBe('语言');
		expect(useSettingsStore.getState().conductorProfile).toBe('User-owned English text');
	});

	it('switches an actual settings editor without remounting or losing its draft', () => {
		const addFont = vi.fn();
		render(
			<FontConfigurationPanel
				fontFamily="Roboto Mono"
				setFontFamily={vi.fn()}
				systemFonts={[]}
				fontsLoaded={false}
				fontLoading={false}
				customFonts={[]}
				onAddCustomFont={addFont}
				onRemoveCustomFont={vi.fn()}
				onFontInteraction={vi.fn()}
				theme={mockTheme}
			/>
		);
		const input = screen.getByPlaceholderText('Add custom font name...');
		fireEvent.change(input, { target: { value: 'My Custom Font 123' } });
		input.focus();
		act(() => useSettingsStore.getState().setUiLanguage('zh-CN'));
		expect(screen.getByPlaceholderText('添加自定义字体名称...')).toBe(input);
		expect(input).toHaveValue('My Custom Font 123');
		expect(input).toHaveFocus();
		expect(screen.getByRole('combobox')).toHaveValue('Roboto Mono');
		expect(addFont).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole('button', { name: '添加' }));
		expect(addFont).toHaveBeenCalledWith('My Custom Font 123');
	});
});
