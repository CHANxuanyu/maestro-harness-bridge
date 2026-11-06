import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlashCommandPopover } from '../../../../../renderer/components/InputArea/overlays/SlashCommandPopover';
import { useSettingsStore } from '../../../../../renderer/stores/settingsStore';
import { createItemRefs, inputAreaTheme } from '../_fixtures';

afterEach(() => {
	cleanup();
	useSettingsStore.setState({ uiLanguage: 'en' });
});

describe('SlashCommandPopover', () => {
	it.each([
		['en', 'user', 'User'],
		['en', 'project', 'Project'],
		['en', 'reported', 'Reported by tool'],
		['zh-CN', 'user', '用户'],
		['zh-CN', 'project', '项目'],
		['zh-CN', 'reported', '工具上报'],
	] as const)('separates the %s %s source from the command name', (uiLanguage, source, label) => {
		useSettingsStore.setState({ uiLanguage });
		render(
			<SlashCommandPopover
				isOpen
				commands={[{ command: '/before', description: 'Before refresh', source }]}
				inputValueLower="/"
				selectedIndex={0}
				itemRefs={createItemRefs<HTMLButtonElement>()}
				theme={inputAreaTheme}
				setInputValue={vi.fn()}
				setSlashCommandOpen={vi.fn()}
				setSelectedSlashCommandIndex={vi.fn()}
				inputRef={{ current: null }}
			/>
		);
		const button = screen.getByRole('button');
		// A CSS margin does not separate adjacent inline text in Chromium's accessible name.
		expect(button.firstElementChild?.textContent).toBe(`/before ${label}`);
		expect(button).toHaveAccessibleName(`/before ${label} Before refresh`);
	});

	it('labels command sources and keeps the read failure notice visible', () => {
		render(
			<SlashCommandPopover
				isOpen
				commands={[
					{ command: '/review', description: 'Review', source: 'project' },
					{ command: '/user', description: 'User command', source: 'user' },
				]}
				warning="remote-unavailable"
				inputValueLower="/"
				selectedIndex={0}
				itemRefs={createItemRefs<HTMLButtonElement>()}
				theme={inputAreaTheme}
				setInputValue={vi.fn()}
				setSlashCommandOpen={vi.fn()}
				setSelectedSlashCommandIndex={vi.fn()}
				inputRef={{ current: null }}
			/>
		);
		expect(screen.getByText('Project')).toBeInTheDocument();
		expect(screen.getByText('User')).toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent('Could not read commands on the SSH host');
	});

	const commands = [
		{ command: '/clear', description: 'Clear chat history' },
		{ command: '/help', description: 'Show help' },
	];

	it('renders nothing when closed or empty', () => {
		const { rerender } = render(
			<SlashCommandPopover
				isOpen={false}
				commands={commands}
				inputValueLower="/"
				selectedIndex={0}
				itemRefs={createItemRefs<HTMLButtonElement>()}
				theme={inputAreaTheme}
				setInputValue={vi.fn()}
				setSlashCommandOpen={vi.fn()}
				setSelectedSlashCommandIndex={vi.fn()}
				inputRef={{ current: null }}
			/>
		);

		expect(screen.queryByText('/clear')).not.toBeInTheDocument();

		rerender(
			<SlashCommandPopover
				isOpen
				commands={[]}
				inputValueLower="/"
				selectedIndex={0}
				itemRefs={createItemRefs<HTMLButtonElement>()}
				theme={inputAreaTheme}
				setInputValue={vi.fn()}
				setSlashCommandOpen={vi.fn()}
				setSelectedSlashCommandIndex={vi.fn()}
				inputRef={{ current: null }}
			/>
		);

		expect(screen.queryByText('/clear')).not.toBeInTheDocument();
	});

	it('renders commands, descriptions, and selected styling', () => {
		render(
			<SlashCommandPopover
				isOpen
				commands={commands}
				inputValueLower="/"
				selectedIndex={1}
				itemRefs={createItemRefs<HTMLButtonElement>()}
				theme={inputAreaTheme}
				setInputValue={vi.fn()}
				setSlashCommandOpen={vi.fn()}
				setSelectedSlashCommandIndex={vi.fn()}
				inputRef={{ current: null }}
			/>
		);

		expect(screen.getByText('/clear')).toBeInTheDocument();
		expect(screen.getByText('Show help')).toBeInTheDocument();
		expect(screen.getByText('/help').closest('button')).toHaveClass('font-semibold');
	});

	// A SINGLE click has to accept. This popover used to treat a click as
	// "move the highlight" and leave acceptance to a double-click, which a
	// touch screen cannot produce and a phone has no keyboard to substitute
	// for: the menu opened and every tap did nothing.
	it('accepts the command on a single click', () => {
		const setSelected = vi.fn();
		const setInputValue = vi.fn();
		const setOpen = vi.fn();
		const focus = vi.fn();

		render(
			<SlashCommandPopover
				isOpen
				commands={commands}
				inputValueLower="/"
				selectedIndex={0}
				itemRefs={createItemRefs<HTMLButtonElement>()}
				theme={inputAreaTheme}
				setInputValue={setInputValue}
				setSlashCommandOpen={setOpen}
				setSelectedSlashCommandIndex={setSelected}
				inputRef={{ current: { focus } as HTMLTextAreaElement }}
			/>
		);

		const help = screen.getByText('/help').closest('button')!;
		fireEvent.mouseEnter(help);
		fireEvent.click(help);

		expect(setSelected).toHaveBeenCalledWith(1);
		// Trailing space, matching what Tab/Enter writes in useInputKeyDown, so a
		// tapped command and a typed one leave the caret in the same place.
		expect(setInputValue).toHaveBeenCalledWith('/help ');
		expect(setOpen).toHaveBeenCalledWith(false);
		expect(focus).toHaveBeenCalled();
	});
});
