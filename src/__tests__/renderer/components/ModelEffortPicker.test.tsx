import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ModelEffortPicker,
	type ModelEffortPickerProps,
} from '../../../renderer/components/ModelEffortPicker';
import { ConversationModelEffortPicker } from '../../../renderer/components/ConversationModelEffortPicker';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { useModalStore } from '../../../renderer/stores/modalStore';
import { useTabStore } from '../../../renderer/stores/tabStore';
import { mockTheme } from '../../helpers/mockTheme';
import { createMockSession, createMockAITab, resetAllStores } from '../../helpers';
import { NATIVE_MODEL_DEFAULT, type ProviderModelCatalog } from '../../../shared/modelCatalog';
import {
	parseClaudeModelCatalog,
	parseCodexModelCatalog,
} from '../../../main/agents/model-catalog';
import codex from '../../fixtures/model-catalog/codex.json';
import claude from '../../fixtures/model-catalog/claude.json';
import { DEFAULT_SHORTCUTS } from '../../../renderer/constants/shortcuts';
import { eventMatchesShortcutKeys } from '../../../renderer/utils/shortcutMatch';

vi.mock('../../../main/agents/model-catalog-quota', () => ({ cachedModelCatalogQuota: vi.fn() }));

function catalog(provider: 'codex' | 'claude-code' = 'codex'): ProviderModelCatalog {
	const parsed =
		provider === 'codex' ? parseCodexModelCatalog(codex) : parseClaudeModelCatalog(claude);
	return {
		provider,
		effortLabel: provider === 'codex' ? 'Reasoning' : 'Effort',
		models: parsed.models,
		followDefault: { modelId: parsed.models.find((item) => !item.hidden)!.id, source: 'config' },
		source: { kind: provider === 'codex' ? 'codex-cache' : 'claude-catalog', files: [] },
		stale: false,
	};
}

function Harness(props: Partial<ModelEffortPickerProps>) {
	const [open, setOpen] = useState(false);
	const [selection, setSelection] = useState({
		model: props.model ?? '',
		effort: props.effort,
		remembered: props.remembered ?? {},
	});
	return (
		<LayerStackProvider>
			<textarea
				aria-label="Composer"
				onKeyDown={(event) => {
					if (eventMatchesShortcutKeys(event.nativeEvent, DEFAULT_SHORTCUTS.openModelEffort.keys))
						setOpen(true);
					if (event.key === 'Escape') props.onOpenChange?.(false);
				}}
			/>
			<ModelEffortPicker
				theme={mockTheme}
				catalog={catalog()}
				policy="conversation"
				{...props}
				{...selection}
				open={open}
				onOpenChange={setOpen}
				onChange={(next) => {
					setSelection(next);
					props.onChange?.(next);
				}}
			/>
		</LayerStackProvider>
	);
}

const open = () => fireEvent.click(screen.getByTestId('model-effort-picker'));
const modelRows = () => within(screen.getByRole('listbox', { name: 'Models' }));
const efforts = (name = 'Reasoning') => within(screen.getByRole('listbox', { name }));
const key = (value: string) => fireEvent.keyDown(document.activeElement!, { key: value });

beforeEach(() => {
	resetAllStores();
	useSettingsStore.setState({ uiLanguage: 'en', newShell: true });
	vi.clearAllMocks();
});

describe('catalog picker', () => {
	it('keeps built-in effort choices when a fallback has no resolved model', () => {
		const data: ProviderModelCatalog = {
			...catalog(),
			models: [],
			followDefault: { modelId: null, source: 'unresolved' },
			source: { kind: 'fallback', files: [] },
			fallbackEfforts: [
				{ id: 'low', description: '' },
				{ id: 'high', description: '' },
			],
		};
		render(<Harness catalog={data} />);
		open();
		expect(efforts().getAllByRole('option')).toHaveLength(2);
		expect(modelRows().getByRole('option')).toHaveTextContent('Default unresolved');
	});
	it('keeps vendor order, metadata and groups; folds older models and filters across groups', () => {
		const data = catalog('claude-code');
		render(<Harness catalog={data} />);
		open();
		expect(
			modelRows()
				.getAllByRole('option')
				.map((row) => row.textContent)
		).toEqual([
			expect.stringContaining('Follow default'),
			...data.models
				.filter((item) => !item.hidden && item.group === 'current')
				.map((item) => expect.stringContaining(item.displayName)),
		]);
		expect(screen.queryByText('Opus 4.6')).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'More models' }));
		expect(
			modelRows()
				.getAllByRole('option')
				.slice(1)
				.map((row) => row.textContent)
		).toEqual(
			data.models
				.filter((item) => !item.hidden)
				.map((item) => expect.stringContaining(item.displayName))
		);
		fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Haiku 4.5' } });
		expect(modelRows().getAllByRole('option')).toHaveLength(1);
		expect(screen.queryByRole('listbox', { name: 'Effort' })).not.toBeInTheDocument();
	});

	it('shows the resolved native default and reports an unresolved default honestly', () => {
		const data = catalog();
		const { rerender } = render(<Harness catalog={data} />);
		open();
		expect(modelRows().getByRole('option', { name: /Follow default.*Astra/ })).toBeInTheDocument();
		rerender(
			<Harness catalog={{ ...data, followDefault: { modelId: null, source: 'unresolved' } }} />
		);
		expect(
			modelRows().getByRole('option', { name: /Follow default.*Default unresolved/ })
		).toBeInTheDocument();
	});

	it('offers only Luna levels and explains switching away from Ultra', () => {
		render(<Harness model="astra" effort="ultra" />);
		open();
		fireEvent.click(modelRows().getByRole('option', { name: /GPT-6-Luna/ }));
		expect(efforts().queryByRole('option', { name: /^Ultra/ })).not.toBeInTheDocument();
		expect(efforts().getByRole('option', { name: /^High.*Default/ })).toBeInTheDocument();
		expect(screen.getByText(/Switching to GPT-6-Luna uses/)).toBeInTheDocument();
	});

	it('uses Claude Extra, omits Extra for Opus 4.6 and omits the column for Haiku 4.5', () => {
		render(<Harness catalog={catalog('claude-code')} />);
		open();
		expect(efforts('Effort').getByRole('option', { name: /^Extra/ })).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'More models' }));
		fireEvent.click(modelRows().getByRole('option', { name: /Opus 4.6/ }));
		expect(efforts('Effort').queryByRole('option', { name: /^Extra/ })).not.toBeInTheDocument();
		fireEvent.click(modelRows().getByRole('option', { name: /Haiku 4.5/ }));
		expect(screen.queryByRole('listbox', { name: 'Effort' })).not.toBeInTheDocument();
	});

	it('remembers Astra Ultra across Sol and back, including a remount', () => {
		const onChange = vi.fn();
		const { unmount } = render(<Harness model="astra" onChange={onChange} />);
		open();
		fireEvent.click(efforts().getByRole('option', { name: /^Ultra/ }));
		open();
		fireEvent.click(modelRows().getByRole('option', { name: /^Sol/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		const saved = onChange.mock.lastCall![0];
		unmount();
		render(<Harness {...saved} onChange={onChange} />);
		open();
		fireEvent.click(modelRows().getByRole('option', { name: /^Astra/ }));
		expect(efforts().getByRole('option', { name: /^Ultra/ })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		expect(onChange.mock.lastCall![0]).toMatchObject({ model: 'astra', effort: 'ultra' });
	});

	it('shows fallback banner and no fabricated quota', () => {
		render(<Harness catalog={{ ...catalog(), error: 'unreadable' }} />);
		open();
		expect(screen.getByText(/Could not read this provider/)).toBeInTheDocument();
		expect(screen.queryByTestId('model-picker-quota')).not.toBeInTheDocument();
	});

	it('shows every sampled window with remaining percent and reset time, including zero remaining', () => {
		render(
			<Harness
				catalog={{
					...catalog(),
					quota: {
						sampledAt: '2026-01-01T00:00:00Z',
						stale: false,
						windows: [
							{ id: 'session', remainingPercent: 62, resetsAt: '2026-01-02T12:00:00Z' },
							{ id: 'weekly', remainingPercent: 0 },
						],
					},
				}}
			/>
		);
		open();
		expect(screen.getByTestId('model-picker-quota')).toHaveTextContent('Session: 62% remaining');
		expect(screen.getByTestId('model-picker-quota')).toHaveTextContent('resets');
		expect(screen.getByTestId('model-picker-quota')).toHaveTextContent('Weekly: 0% remaining');
	});

	it('revalidates remembered Ultra under team-seat policy', () => {
		const onChange = vi.fn();
		render(
			<Harness
				policy="team-seat"
				model="astra"
				effort="ultra"
				remembered={{ astra: 'ultra' }}
				onChange={onChange}
			/>
		);
		open();
		expect(efforts().queryByRole('option', { name: /^Ultra/ })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		expect(onChange.mock.lastCall![0].effort).toBe('high');
	});

	it('changes model and effort in five presses using the registered chord; Esc restores the opener and never stops a turn', async () => {
		const onChange = vi.fn();
		const stop = vi.fn();
		render(<Harness onChange={onChange} running onOpenChange={stop} />);
		const composer = screen.getByRole('textbox', { name: 'Composer' });
		composer.focus();
		fireEvent.keyDown(composer, { key: '.', code: 'Period', ctrlKey: true, altKey: true }); // 1
		expect(screen.getByRole('combobox')).toHaveFocus();
		key('ArrowDown');
		key('ArrowRight');
		key('ArrowDown');
		key('Enter'); // 5 in total
		expect(onChange.mock.lastCall![0]).toMatchObject({ model: 'astra', effort: 'xhigh' });
		await waitFor(() => expect(composer).toHaveFocus());
		fireEvent.keyDown(composer, { key: '.', code: 'Period', ctrlKey: true, altKey: true });
		expect(screen.getByText(/Changes apply to the next turn/)).toBeInTheDocument();
		key('Escape');
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(composer).toHaveFocus();
		expect(stop).not.toHaveBeenCalled();
	});

	it('Tab enters efforts, Shift-Tab returns to the filter, Esc restores the clicked pill', async () => {
		render(<Harness model="astra" />);
		const pill = screen.getByTestId('model-effort-picker');
		pill.focus();
		open();
		key('Tab');
		expect(screen.getByRole('listbox', { name: 'Reasoning' })).toHaveFocus();
		fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
		expect(screen.getByRole('combobox')).toHaveFocus();
		key('Escape');
		await waitFor(() => expect(pill).toHaveFocus());
	});

	it('keeps active descendant IDs valid and does not borrow effort levels for a typed custom model', () => {
		render(<Harness model="astra" />);
		open();
		const filter = screen.getByRole('combobox');
		expect(document.getElementById(filter.getAttribute('aria-activedescendant')!)).toHaveAttribute(
			'aria-selected',
			'true'
		);
		fireEvent.change(filter, { target: { value: 'custom-preview-id' } });
		expect(screen.queryByRole('listbox', { name: 'Reasoning' })).not.toBeInTheDocument();
	});

	it('never restores a team-seat native Ultra default', () => {
		const data = catalog();
		data.models.find((item) => item.id === 'astra')!.defaultEffort = 'ultra';
		const onChange = vi.fn();
		render(
			<Harness
				catalog={data}
				policy="team-seat"
				model="astra"
				remembered={{ astra: 'ultra' }}
				onChange={onChange}
			/>
		);
		open();
		key('Enter');
		expect(onChange.mock.lastCall![0].effort).toBe('low');
	});

	it('returns to the clicked pill even when the platform did not focus it on click', async () => {
		render(<Harness />);
		screen.getByRole('textbox', { name: 'Composer' }).focus();
		open();
		key('Escape');
		await waitFor(() => expect(screen.getByTestId('model-effort-picker')).toHaveFocus());
	});

	it('renders Chinese explanations with vendor level names', () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		render(<Harness model="astra" />);
		open();
		expect(screen.getByText('Extra High')).toBeInTheDocument();
		expect(screen.getByRole('dialog').textContent).not.toMatch(/\u8d85\u9ad8|\u6781\u9ad8/);
	});
});

describe('conversation adapter', () => {
	it('falls back on a rejected catalog and rechecks a changed native default on reopen, not render', async () => {
		const owner = createMockSession({
			id: 's',
			toolType: 'codex',
			activeTabId: 't',
			aiTabs: [createMockAITab({ id: 't' })],
		});
		const getCatalog = vi
			.fn()
			.mockRejectedValueOnce(new Error('unreadable'))
			.mockResolvedValue(catalog());
		window.maestro.agents.getModelCatalog = getCatalog;
		const props = {
			theme: mockTheme,
			session: owner,
			availableModels: ['existing-model'],
			availableEfforts: ['high'],
		};
		const { rerender } = render(
			<LayerStackProvider>
				<ConversationModelEffortPicker {...props} />
			</LayerStackProvider>
		);
		await act(async () => {});
		getCatalog.mockRejectedValueOnce(new Error('unreadable'));
		await act(async () => {
			open();
		});
		expect(modelRows().getByRole('option', { name: /^existing-model/ })).toBeInTheDocument();
		expect(screen.getByText(/Could not read this provider/)).toBeInTheDocument();
		key('Escape');
		const changed = { ...catalog(), followDefault: { modelId: 'sol', source: 'config' as const } };
		getCatalog.mockResolvedValue(changed);
		await act(async () => {
			open();
		});
		expect(modelRows().getByRole('option', { name: /Follow default.*Sol/ })).toBeInTheDocument();
		const reads = getCatalog.mock.calls.length;
		rerender(
			<LayerStackProvider>
				<ConversationModelEffortPicker {...props} />
			</LayerStackProvider>
		);
		expect(getCatalog).toHaveBeenCalledTimes(reads);
	});

	it('persists both overrides and account-scoped memory atomically without changing a running turn', async () => {
		const tab = createMockAITab({ id: 't', state: 'busy', turnModel: 'sol', turnEffort: 'low' });
		const owner = createMockSession({
			id: 's',
			toolType: 'codex',
			activeTabId: 't',
			aiTabs: [tab],
			customModel: 'sol',
			customEffort: 'low',
		});
		useSessionStore.setState({ sessions: [owner], activeSessionId: 's' });
		const getCatalog = vi.fn().mockResolvedValue({ ...catalog(), accountKey: 'account-one' });
		window.maestro.agents.getModelCatalog = getCatalog;
		const props = {
			theme: mockTheme,
			availableModels: ['astra', 'sol'],
			availableEfforts: ['low', 'high', 'ultra'],
		};
		const { rerender } = render(
			<LayerStackProvider>
				<ConversationModelEffortPicker {...props} session={owner} />
			</LayerStackProvider>
		);
		await waitFor(() => expect(getCatalog).toHaveBeenCalledTimes(1));
		await act(async () => useModalStore.getState().openModal('modelEffort', { tabId: 't' }));
		await waitFor(() => expect(getCatalog).toHaveBeenCalledTimes(2));
		fireEvent.click(modelRows().getByRole('option', { name: /Follow default/ }));
		fireEvent.click(efforts().getByRole('option', { name: /^Ultra/ }));
		const saved = useSessionStore.getState().sessions[0];
		expect(saved.aiTabs[0]).toMatchObject({
			customModel: NATIVE_MODEL_DEFAULT,
			customEffort: 'ultra',
			modelEfforts: { 'account-one': { astra: 'ultra' } },
			turnModel: 'sol',
			turnEffort: 'low',
			state: 'busy',
		});
		rerender(
			<LayerStackProvider>
				<ConversationModelEffortPicker {...props} session={saved} />
			</LayerStackProvider>
		);
		expect(getCatalog).toHaveBeenCalledTimes(2);
		act(() =>
			useTabStore.getState().setTabModelEffort('s', 't', 'account-two', {
				model: 'sol',
				effort: 'high',
				remembered: { sol: 'high' },
			})
		);
		expect(useSessionStore.getState().sessions[0].aiTabs[0].modelEfforts).toEqual({
			'account-one': { astra: 'ultra', sol: 'low' },
			'account-two': { sol: 'high' },
		});
	});
});
