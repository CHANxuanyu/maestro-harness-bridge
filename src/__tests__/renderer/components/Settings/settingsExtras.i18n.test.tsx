import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateAutocompleteDropdown } from '../../../../renderer/components/TemplateAutocompleteDropdown';
import { DualPaneFileEditor } from '../../../../renderer/components/shared/DualPaneFileEditor';
import { templateVariableDescription } from '../../../../renderer/components/shared/templateVariableI18n';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { getTranslator } from '../../../../renderer/i18n';
import { localizeBuiltinExtension } from '../../../../renderer/components/Settings/Extensions/extensionI18n';
import {
	BUILTIN_FEATURES,
	builtinExtension,
	type UnifiedExtension,
} from '../../../../renderer/components/Settings/Extensions/extensionModel';
import { ENCORE_FEATURE_DEFAULTS } from '../../../../shared/encoreFeatureDefaults';
import type { EncoreFeatureFlags } from '../../../../renderer/types';
import { mockTheme } from '../../../helpers/mockTheme';

describe('settings extras language switching', () => {
	beforeEach(() => {
		useSettingsStore.setState({ uiLanguage: 'en' });
	});

	afterEach(() => {
		cleanup();
		useSettingsStore.setState({ uiLanguage: 'en' });
	});

	it('switches autocomplete descriptions live while inserting the original variable', () => {
		const onSelect = vi.fn();
		render(
			<TemplateAutocompleteDropdown
				theme={mockTheme}
				state={{
					isOpen: true,
					position: { top: 0, left: 0 },
					selectedIndex: 0,
					searchText: '',
					filteredVariables: [{ variable: '{{AGENT_NAME}}', description: 'Agent name' }],
				}}
				onSelect={onSelect}
			/>
		);
		expect(screen.getByText('Agent name')).toBeInTheDocument();
		act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));
		expect(screen.getByText('智能体名称')).toBeInTheDocument();
		fireEvent.click(screen.getByText('{{AGENT_NAME}}'));
		expect(onSelect).toHaveBeenCalledWith('{{AGENT_NAME}}');
		expect(
			templateVariableDescription('{{AGENT_NAME}}', 'My custom explanation', getTranslator('zh-CN'))
		).toBe('My custom explanation');
	});

	it('updates editor chrome without remounting the unsaved prompt editor', () => {
		render(
			<DualPaneFileEditor
				theme={mockTheme}
				items={[{ id: 'prompt.md', label: 'My original prompt' }]}
				selectedId="prompt.md"
				onSelect={vi.fn()}
				editorTitle="My original prompt"
				showModifiedBadge
				renderEditorBody={() => (
					<textarea aria-label="prompt source" defaultValue="Keep {{AGENT_NAME}} exactly" />
				)}
				primaryAction={{ label: 'Custom action', onClick: vi.fn() }}
			/>
		);
		const editor = screen.getByRole('textbox', { name: 'prompt source' });
		fireEvent.change(editor, { target: { value: 'Unsaved user text {{AGENT_NAME}}' } });
		expect(screen.getByText('Modified')).toBeInTheDocument();
		act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));
		expect(screen.getByText('已修改')).toBeInTheDocument();
		expect(screen.getByRole('textbox', { name: 'prompt source' })).toBe(editor);
		expect(editor).toHaveValue('Unsaved user text {{AGENT_NAME}}');
		expect(screen.getByRole('button', { name: 'Custom action' })).toBeInTheDocument();
	});

	it('localizes built-in plugin display text without changing capabilities or plugin content', () => {
		const definition = BUILTIN_FEATURES.find((feature) => feature.flag === 'coworking');
		expect(definition).toBeDefined();
		const original = builtinExtension(definition!, ENCORE_FEATURE_DEFAULTS as EncoreFeatureFlags);
		const localized = localizeBuiltinExtension(original, getTranslator('zh-CN'));
		expect(localized.name).toBe('协作');
		expect(localized.id).toBe(original.id);
		expect(localized.permissions?.map(({ capability, scope }) => ({ capability, scope }))).toEqual(
			original.permissions?.map(({ capability, scope }) => ({ capability, scope }))
		);
		expect(original.name).toBe('Coworking');
		for (const feature of BUILTIN_FEATURES) {
			const english = builtinExtension(feature, ENCORE_FEATURE_DEFAULTS as EncoreFeatureFlags);
			expect(localizeBuiltinExtension(english, getTranslator('en'))).toEqual(english);
		}
		const thirdParty: UnifiedExtension = { ...original, key: 'plugin:custom', kind: 'plugin' };
		expect(localizeBuiltinExtension(thirdParty, getTranslator('zh-CN'))).toBe(thirdParty);
	});
});
