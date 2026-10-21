import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NudgeMessageField } from '../../../renderer/components/NewInstanceModal/NudgeMessageField';
import { SearchModeDropdown } from '../../../renderer/components/AgentSessionsBrowser/components/SearchModeDropdown';
import { QuestionPrompt } from '../../../renderer/components/PermissionPrompt/QuestionPrompt';
import { localizeAgentConfigLabel } from '../../../renderer/i18n/agentConfigLabels';
import { getTranslator } from '../../../renderer/i18n/translate';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { mockTheme } from '../../helpers/mockTheme';

const originalLanguage = useSettingsStore.getState().uiLanguage;
beforeEach(() => useSettingsStore.setState({ uiLanguage: 'en' }));
afterEach(() => {
	cleanup();
	useSettingsStore.setState({ uiLanguage: originalLanguage });
});

const switchToChinese = () => act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));

describe('agent UI language changes', () => {
	it('changes form defaults without remounting or translating the draft', () => {
		function Form() {
			const [value, setValue] = useState('');
			return <NudgeMessageField theme={mockTheme} value={value} onChange={setValue} />;
		}
		render(<Form />);
		const input = screen.getByRole('textbox');
		fireEvent.change(input, { target: { value: 'Use native --model opus. 保留这份草稿。' } });
		switchToChinese();
		expect(screen.getByText('每条消息附加指令')).toBeInTheDocument();
		expect(screen.getByRole('textbox')).toBe(input);
		expect(input).toHaveValue('Use native --model opus. 保留这份草稿。');
		act(() => useSettingsStore.setState({ uiLanguage: 'en' }));
		expect(screen.getByText('Nudge Message')).toBeInTheDocument();
		expect(input).toHaveValue('Use native --model opus. 保留这份草稿。');
	});

	it('keeps native search mode identifiers behind translated labels', () => {
		const onSelect = vi.fn();
		render(
			<SearchModeDropdown
				theme={mockTheme}
				searchMode="all"
				isOpen
				dropdownRef={{ current: null }}
				onToggle={vi.fn()}
				onSelect={onSelect}
			/>
		);
		switchToChinese();
		fireEvent.click(screen.getByText('我的消息'));
		expect(onSelect).toHaveBeenCalledWith('user');
		expect(screen.getByText('全部')).toBeInTheDocument();
	});

	it('keeps provider questions and selected answers unchanged when the chrome switches', () => {
		const onSubmit = vi.fn();
		render(
			<QuestionPrompt
				theme={mockTheme}
				questions={[
					{
						question: 'Pick a native harness',
						header: 'Harness',
						multiSelect: false,
						options: [
							{ label: 'Claude Code', description: 'Keep native tools and account' },
							{ label: 'Codex', description: 'Use existing subscription' },
						],
					},
				]}
				onSubmit={onSubmit}
			/>
		);
		fireEvent.click(screen.getByRole('radio', { name: /Claude Code/ }));
		switchToChinese();
		expect(screen.getByText('Pick a native harness')).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: /Claude Code/ })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		fireEvent.click(screen.getByRole('button', { name: '提交回答' }));
		expect(onSubmit).toHaveBeenCalledWith('Harness: Claude Code');
	});

	it('localizes built-in provider setting labels and preserves unknown provider text', () => {
		const t = getTranslator('zh-CN');
		expect(localizeAgentConfigLabel('Reasoning Effort', t)).toBe('推理强度');
		expect(localizeAgentConfigLabel('How much the model should reason before responding.', t)).toBe(
			'模型在回复前进行推理的强度。'
		);
		for (const original of [
			'claude-opus-5-5',
			'--model',
			'/Users/example/.codex',
			'Custom provider label',
		]) {
			expect(localizeAgentConfigLabel(original, t)).toBe(original);
		}
	});
});
