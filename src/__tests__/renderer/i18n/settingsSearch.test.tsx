import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ALL_SEARCHABLE_SETTINGS,
	type SearchableSetting,
	searchSettings,
} from '../../../renderer/components/Settings/searchableSettings';
import {
	SettingsSearchInput,
	SettingsSearchResults,
	useSettingsSearch,
} from '../../../renderer/components/Settings/SettingsSearch';
import { localizeSearchableSetting } from '../../../renderer/i18n/settingsSearch';
import { localizeShortcutLabel } from '../../../renderer/i18n/shortcutLabels';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { mockTheme } from '../../helpers/mockTheme';

const initialState = useSettingsStore.getInitialState();

beforeEach(() => {
	useSettingsStore.setState({ ...initialState, uiLanguage: 'en' });
});

afterEach(() => {
	cleanup();
	useSettingsStore.setState(initialState);
});

function Search({
	onNavigate,
}: {
	onNavigate: (tab: SearchableSetting['tab'], id: string) => void;
}) {
	const state = useSettingsSearch({ isOpen: true, onSearchActiveChange: () => {}, onNavigate });
	return (
		<>
			<SettingsSearchInput theme={mockTheme} {...state} onClear={state.clear} />
			<SettingsSearchResults theme={mockTheme} {...state} onNavigate={onNavigate} />
		</>
	);
}

describe('localized settings search', () => {
	it.each([
		['语言', 'general-language'],
		['language', 'general-language'],
		['字体', 'display-fonts'],
		['font', 'display-fonts'],
		['环境变量', 'environment-global-vars'],
		['environment', 'environment-global-vars'],
		['主题', 'theme-picker'],
		['theme', 'theme-picker'],
	])('finds %s in the Chinese UI with a stable jump target', (query, id) => {
		const result = searchSettings(query, 'zh-CN').find((entry) => entry.id === id);
		expect(result).toBeDefined();
		expect(result?.tab).toBe(ALL_SEARCHABLE_SETTINGS.find((entry) => entry.id === id)?.tab);
	});

	it('localizes display fields without changing source entries or navigation values', () => {
		const source = ALL_SEARCHABLE_SETTINGS.find((entry) => entry.id === 'general-language')!;
		const snapshot = structuredClone(source);
		const translated = localizeSearchableSetting(source, 'zh-CN');
		expect(source).toEqual(snapshot);
		expect(translated).toMatchObject({ id: source.id, tab: source.tab });
		expect(translated.jumpToId).toBe(source.jumpToId);
		expect(translated.label).toBe('界面语言');
		expect(translated.tabLabel).toBe('通用');
		expect(localizeSearchableSetting(source, 'en')).toBe(source);
	});

	it('preserves the query and keyboard navigation through a live language change', () => {
		const navigate = vi.fn();
		render(<Search onNavigate={navigate} />);
		const input = screen.getByRole('textbox', { name: 'Search settings' });
		fireEvent.change(input, { target: { value: 'language' } });
		input.focus();
		act(() => useSettingsStore.getState().setUiLanguage('zh-CN'));
		expect(screen.getByRole('textbox', { name: '搜索设置' })).toBe(input);
		expect(input).toHaveValue('language');
		expect(input).toHaveFocus();
		expect(screen.getByText('界面语言')).toBeInTheDocument();
		fireEvent.keyDown(input, { key: 'Enter' });
		expect(navigate).toHaveBeenCalledWith('general', 'general-language');
	});

	it('localizes a shortcut action without changing stored English labels or custom content', () => {
		const shortcut = { id: 'newTab', label: 'New Tab' };
		expect(localizeShortcutLabel('zh-CN', shortcut)).toBe('新建标签页');
		expect(shortcut.label).toBe('New Tab');
		expect(localizeShortcutLabel('en', shortcut)).toBe('New Tab');
		expect(localizeShortcutLabel('zh-CN', { id: 'custom-action', label: 'My action' })).toBe(
			'My action'
		);
	});
});
