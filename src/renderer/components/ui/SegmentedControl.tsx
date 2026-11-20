/**
 * SegmentedControl - a horizontal row of mutually exclusive options rendered as
 * one joined pill bar (the "Sort by: [Name][Created][Queries]" control).
 *
 * Distinct from `RadioGroup`, which renders the same semantics as stacked list
 * rows for settings panes. This is the compact toolbar form: it belongs above a
 * grid or chart where the options are short words and vertical space is scarce.
 *
 * Usage:
 * ```tsx
 * <SegmentedControl
 *   value={sortMode}
 *   onChange={setSortMode}
 *   options={[{ value: 'name', label: 'Name' }, { value: 'queries', label: 'Queries' }]}
 *   theme={theme}
 *   ariaLabel="Sort agents"
 *   testId="agent-overview-sort"
 * />
 * ```
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Theme } from '../../types';
import { readableTextOn } from '../../../shared/colorContrast';
import { useHorizontalScroll } from '../../hooks/ui/useHorizontalScroll';
import { useElementWidth } from '../../hooks/ui/useElementWidth';
import { useFocusAfterRender } from '../../hooks/utils/useFocusAfterRender';

const TAB_EDGE_PADDING = 20;

export interface SegmentedOption<T extends string> {
	value: T;
	label: string;
	/**
	 * Abbreviated label for a cramped bar. Both forms render: the short one is
	 * `hidden` by default, and the host's container query swaps them by targeting
	 * `.segmented-label-full` / `.segmented-label-short`. The control does not
	 * decide when space is short, because only the host knows what else shares
	 * its row.
	 */
	shortLabel?: string;
	/** Tooltip text. Useful when the label is abbreviated to fit the bar. */
	title?: string;
	/** Small trailing count for an underline tab. */
	count?: number;
	id?: string;
	controls?: string;
}

export interface SegmentedControlProps<T extends string> {
	value: T;
	onChange: (value: T) => void;
	options: ReadonlyArray<SegmentedOption<T>>;
	theme: Theme;
	/** Accessible label for the group. */
	ariaLabel: string;
	/** Test id for the container. Each segment gets `${testId}-${option.value}`. */
	testId?: string;
	/** Underline tabs use tab semantics; the default joined segments remain a radio group. */
	variant?: 'segments' | 'underline';
}

export function SegmentedControl<T extends string>({
	value,
	onChange,
	options,
	theme,
	ariaLabel,
	testId,
	variant = 'segments',
}: SegmentedControlProps<T>) {
	const tabs = variant === 'underline';
	const stripRef = useRef<HTMLDivElement>(null);
	const selectedRef = useRef<HTMLButtonElement>(null);
	const focusSelection = useRef(false);
	const labelsKey = options
		.map((option) => `${option.value}:${option.label}:${option.count}`)
		.join('|');
	const { canScrollLeft, canScrollRight, scrollIntoView } = useHorizontalScroll(
		stripRef,
		labelsKey
	);
	// Re-reveal the selected tab after a resize or language/count change, too.
	const stripWidth = useElementWidth(stripRef, tabs);
	useFocusAfterRender(selectedRef, tabs && focusSelection.current);
	useEffect(() => {
		focusSelection.current = false;
		if (tabs) scrollIntoView(selectedRef.current, TAB_EDGE_PADDING);
	}, [tabs, value, labelsKey, stripWidth, scrollIntoView]);
	// Arrow keys move between segments, matching how a native radio group
	// behaves - the bar is one tab stop, not one per option.
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
			const index = options.findIndex((o) => o.value === value);
			if (index === -1) return;
			e.preventDefault();
			const delta = e.key === 'ArrowRight' ? 1 : -1;
			const next = options[(index + delta + options.length) % options.length];
			focusSelection.current = tabs;
			onChange(next.value);
		},
		[options, value, onChange, tabs]
	);

	const control = (
		<div
			ref={tabs ? stripRef : undefined}
			// Scrolls sideways when the row cannot hold every segment, rather
			// than clipping. `overflow-hidden` is what rounds the corners, and it
			// used to mean a bar wider than its row simply lost its last options:
			// invisible AND unclickable, with no scrollbar to hint they were
			// there. On a phone the five-way sort bar lost two of them.
			// `overflow-y-hidden` is required beside it - `overflow-x: auto`
			// alone computes `overflow-y` to `auto` and adds a vertical bar.
			className={
				tabs
					? 'flex min-w-0 max-w-full overflow-x-auto overflow-y-hidden no-scrollbar'
					: 'flex min-w-0 max-w-full rounded border overflow-x-auto overflow-y-hidden no-scrollbar'
			}
			style={{
				borderColor: theme.colors.border,
				...(tabs ? { height: 48, padding: '0 8px', gap: 2 } : {}),
			}}
			role={tabs ? 'tablist' : 'radiogroup'}
			aria-label={ariaLabel}
			data-testid={testId}
			onKeyDown={handleKeyDown}
		>
			{options.map((opt, i) => {
				const isActive = value === opt.value;
				return (
					<button
						ref={isActive ? selectedRef : undefined}
						key={opt.value}
						id={opt.id}
						type="button"
						onClick={() => onChange(opt.value)}
						className={
							tabs
								? 'shrink-0 font-medium border-b-2 whitespace-nowrap'
								: 'shrink-0 px-2 py-1 text-xs transition-colors whitespace-nowrap'
						}
						style={
							tabs
								? {
										color: readableTextOn(isActive ? theme.colors.textMain : theme.colors.textDim, [
											theme.colors.bgSidebar,
										]),
										borderBottomColor: isActive ? theme.colors.accent : 'transparent',
										fontSize: 13,
										padding: '0 8px',
									}
								: {
										backgroundColor: isActive ? `${theme.colors.accent}20` : 'transparent',
										color: isActive ? theme.colors.accent : theme.colors.textDim,
										borderLeft: i === 0 ? undefined : `1px solid ${theme.colors.border}`,
									}
						}
						role={tabs ? 'tab' : 'radio'}
						aria-selected={tabs ? isActive : undefined}
						aria-controls={tabs ? opt.controls : undefined}
						aria-checked={tabs ? undefined : isActive}
						aria-pressed={tabs ? undefined : isActive}
						title={opt.title}
						tabIndex={isActive ? 0 : -1}
						data-testid={testId ? `${testId}-${opt.value}` : undefined}
					>
						{opt.shortLabel ? (
							<>
								<span className="segmented-label-full">{opt.label}</span>
								<span className="segmented-label-short hidden">{opt.shortLabel}</span>
							</>
						) : (
							opt.label
						)}
						{tabs && opt.count !== undefined && opt.count > 0 && (
							<span
								className="ml-1 text-xs-plus"
								style={{ color: readableTextOn(theme.colors.textDim, [theme.colors.bgSidebar]) }}
								data-tab-count
							>
								{opt.count}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
	if (!tabs) return control;
	return (
		<div
			className="relative min-w-0 shrink-0 border-b"
			style={{ borderColor: theme.colors.border, background: theme.colors.bgSidebar }}
		>
			{control}
			{(['left', 'right'] as const).map((side) =>
				(canScrollLeft && side === 'left') || (canScrollRight && side === 'right') ? (
					<span
						key={side}
						aria-hidden
						data-scroll-edge={side}
						className="pointer-events-none absolute inset-y-0"
						style={{
							[side]: 0,
							width: TAB_EDGE_PADDING,
							background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, ${theme.colors.bgSidebar}, transparent)`,
						}}
					/>
				) : null
			)}
		</div>
	);
}

export default SegmentedControl;
