import { useState } from 'react';
import * as horizontalScroll from '../../../../renderer/hooks/ui/useHorizontalScroll';
/**
 * Tests for SegmentedControl.
 *
 * The pill bar replaced three hand-rolled `.map()`-over-buttons copies, none of
 * which had keyboard support. These tests pin the parts a caller cannot see by
 * eye: radio semantics, arrow-key movement, and the single tab stop that keeps
 * a five-option bar from eating five tabs of focus order.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from '../../../../renderer/components/ui/SegmentedControl';
import { mockTheme } from '../../../helpers/mockTheme';

type Mode = 'name' | 'created' | 'queries';

const OPTIONS = [
	{ value: 'name' as Mode, label: 'Name' },
	{ value: 'created' as Mode, label: 'Created' },
	{ value: 'queries' as Mode, label: 'Queries', title: 'Most queries first' },
];

const renderControl = (value: Mode, onChange = vi.fn()) => {
	render(
		<SegmentedControl
			value={value}
			onChange={onChange}
			options={OPTIONS}
			theme={mockTheme}
			ariaLabel="Sort agents"
			testId="sort"
		/>
	);
	return onChange;
};

describe('SegmentedControl', () => {
	it('renders one segment per option inside a labelled radiogroup', () => {
		renderControl('name');

		const group = screen.getByRole('radiogroup', { name: 'Sort agents' });
		expect(group).toBeInTheDocument();
		expect(screen.getAllByRole('radio')).toHaveLength(3);
		expect(screen.getByTestId('sort-created')).toHaveTextContent('Created');
	});

	it('marks only the active segment as checked', () => {
		renderControl('created');

		expect(screen.getByTestId('sort-name')).toHaveAttribute('aria-checked', 'false');
		expect(screen.getByTestId('sort-created')).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByTestId('sort-queries')).toHaveAttribute('aria-checked', 'false');
	});

	it('reports the clicked value', () => {
		const onChange = renderControl('name');

		fireEvent.click(screen.getByTestId('sort-queries'));
		expect(onChange).toHaveBeenCalledWith('queries');
	});

	// One tab stop, not one per option: a five-option sort bar should cost a
	// single Tab press to skip, the way a native radio group does.
	it('keeps a single tab stop that follows the selection', () => {
		renderControl('created');

		expect(screen.getByTestId('sort-name')).toHaveAttribute('tabindex', '-1');
		expect(screen.getByTestId('sort-created')).toHaveAttribute('tabindex', '0');
		expect(screen.getByTestId('sort-queries')).toHaveAttribute('tabindex', '-1');
	});

	it('moves the selection with the arrow keys', () => {
		const onChange = renderControl('created');
		const group = screen.getByRole('radiogroup', { name: 'Sort agents' });

		fireEvent.keyDown(group, { key: 'ArrowRight' });
		expect(onChange).toHaveBeenCalledWith('queries');

		fireEvent.keyDown(group, { key: 'ArrowLeft' });
		expect(onChange).toHaveBeenCalledWith('name');
	});

	it('wraps around at both ends', () => {
		const onChange = renderControl('name');
		const group = screen.getByRole('radiogroup', { name: 'Sort agents' });

		fireEvent.keyDown(group, { key: 'ArrowLeft' });
		expect(onChange).toHaveBeenCalledWith('queries');
	});

	it('ignores keys it does not own so the host can still use them', () => {
		const onChange = renderControl('name');
		const group = screen.getByRole('radiogroup', { name: 'Sort agents' });

		fireEvent.keyDown(group, { key: 'ArrowUp' });
		fireEvent.keyDown(group, { key: 'Escape' });
		fireEvent.keyDown(group, { key: 'a' });

		expect(onChange).not.toHaveBeenCalled();
	});

	// A bar wider than its row used to lose its last segments outright:
	// `overflow-hidden` clipped them, so they were invisible AND unclickable
	// with no scrollbar to hint they were there. On a phone the five-way sort
	// bar lost two options.
	it('scrolls sideways rather than clipping the segments it cannot fit', () => {
		renderControl('name');

		const group = screen.getByRole('radiogroup');
		expect(group).toHaveClass('overflow-x-auto', 'overflow-y-hidden', 'max-w-full', 'min-w-0');
		expect(group).not.toHaveClass('overflow-hidden');
		// Every segment keeps its width inside that scroller - a squeezed
		// segment reads as a different label, not a narrower one.
		expect(screen.getByTestId('sort-name')).toHaveClass('shrink-0');
	});

	it('surfaces the optional per-segment tooltip', () => {
		renderControl('name');

		expect(screen.getByTestId('sort-queries')).toHaveAttribute('title', 'Most queries first');
		expect(screen.getByTestId('sort-name')).not.toHaveAttribute('title');
	});

	// The host's container query picks which form is visible, so both must be
	// in the DOM with the short one hidden by default.
	it('renders both label forms when a short label is given', () => {
		render(
			<SegmentedControl
				value="name"
				onChange={vi.fn()}
				options={[{ value: 'name', label: 'Full Name', shortLabel: 'Name' }]}
				theme={mockTheme}
				ariaLabel="Sort agents"
				testId="sort"
			/>
		);

		expect(screen.getByText('Full Name')).toHaveClass('segmented-label-full');
		expect(screen.getByText('Name')).toHaveClass('segmented-label-short', 'hidden');
	});

	it('renders a plain label when no short label is given', () => {
		renderControl('name');

		expect(screen.getByTestId('sort-name').querySelector('.segmented-label-full')).toBeNull();
	});
});

it('uses underline tab semantics, count badges, overflow hints and keyboard focus', () => {
	const scrollIntoView = vi.fn();
	const scrolling = vi.spyOn(horizontalScroll, 'useHorizontalScroll').mockReturnValue({
		canScrollLeft: false,
		canScrollRight: true,
		scrollByPage: vi.fn(),
		scrollIntoView,
	});
	function Tabs() {
		const [value, onChange] = useState<Mode>('name');
		return (
			<SegmentedControl
				variant="underline"
				value={value}
				onChange={onChange}
				options={OPTIONS.map((option) => ({
					...option,
					count: option.value === 'created' ? 3 : undefined,
					controls: 'content',
				}))}
				theme={mockTheme}
				ariaLabel="Views"
			/>
		);
	}
	const view = render(<Tabs />);
	try {
		const tabs = screen.getAllByRole('tab');
		for (const tab of tabs) expect(tab).toHaveStyle({ padding: '0 8px' });
		expect(screen.getByRole('tablist')).toHaveClass('overflow-x-auto');
		expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
		expect(tabs[0]).toHaveAttribute('aria-controls', 'content');
		expect(tabs[0]).not.toHaveAttribute('aria-checked');
		expect(tabs[1].querySelector('[data-tab-count]')).toHaveTextContent('3');
		expect(view.container.querySelector('[data-scroll-edge="right"]')).toHaveAttribute(
			'aria-hidden',
			'true'
		);
		expect(view.container.querySelector('[data-scroll-edge="left"]')).toBeNull();
		tabs[0].focus();
		fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
		expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
		expect(tabs[1]).toHaveFocus();
		expect(tabs[0]).toHaveAttribute('tabindex', '-1');
		expect(scrollIntoView).toHaveBeenLastCalledWith(tabs[1], 20);
		fireEvent.keyDown(tabs[1], { key: 'ArrowLeft' });
		expect(tabs[0]).toHaveFocus();
		fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
		expect(tabs[2]).toHaveFocus();
		expect(scrollIntoView).toHaveBeenLastCalledWith(tabs[2], 20);
		scrolling.mockReturnValue({
			canScrollLeft: false,
			canScrollRight: false,
			scrollByPage: vi.fn(),
			scrollIntoView,
		});
		fireEvent.click(tabs[0]);
		expect(view.container.querySelector('[data-scroll-edge]')).toBeNull();
	} finally {
		view.unmount();
		scrolling.mockRestore();
	}
});
