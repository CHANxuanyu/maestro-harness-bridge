import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TurnActivityFold } from '../../../../renderer/components/TerminalOutput/components/TurnActivityFold';
import { TurnDeliveryBar } from '../../../../renderer/components/TerminalOutput/components/TurnDeliveryBar';
import { ToolActivityLine } from '../../../../renderer/components/TerminalOutput/components/ToolBadge';
import { TasksPanel } from '../../../../renderer/components/TasksPanel';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { resetStores, createMockSession, createMockAITab } from '../../../helpers';
import { mockTheme } from '../../../helpers/mockTheme';
import type { TurnActivity } from '../../../../renderer/components/TerminalOutput/utils/foldTurnActivity';
import { readableTextOn } from '../../../../shared/colorContrast';

const activity: TurnActivity = {
	entries: [
		{
			id: 'tool',
			source: 'tool',
			text: 'Bash',
			timestamp: 1,
			metadata: { toolState: { status: 'failed', input: { command: 'npm test' }, exitCode: 1 } },
		},
	],
	durationMs: 35000,
	status: 'completed',
};
const props = {
	hostId: 'activity:u',
	index: 1,
	activity,
	open: false,
	onToggle: vi.fn(),
	theme: mockTheme,
	secondaryTextColor: mockTheme.colors.textDim,
	newShell: true,
};

beforeEach(() => {
	resetStores(useSettingsStore, useSessionStore);
	useSettingsStore.setState({ newShell: true, uiLanguage: 'en' });
	vi.clearAllMocks();
});

describe('activity and delivery', () => {
	it('keeps a fixed bar, supplies an action fallback, and has exactly one animation', () => {
		const { container, rerender } = render(
			<TurnActivityFold {...props} activity={{ ...activity, running: true, status: 'running' }} />
		);
		expect(screen.getByTestId('turn-activity-bar')).toHaveStyle({ height: '64px' });
		expect(screen.getByTestId('activity-note')).toHaveTextContent('Working on your request');
		expect(screen.queryByTestId('activity-plan')).toBeNull();
		expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1);
		rerender(
			<TurnActivityFold
				{...props}
				activity={{
					...activity,
					running: true,
					entries: [
						...activity.entries,
						{
							id: 'note',
							source: 'stdout',
							purpose: 'commentary',
							text: 'Checking the result',
							timestamp: 2,
						},
					],
				}}
			/>
		);
		expect(screen.getByTestId('turn-activity-bar')).toHaveStyle({ height: '64px' });
		expect(screen.getByTestId('activity-note')).toHaveTextContent('Checking the result');
		fireEvent.click(screen.getByTestId('activity-toggle'));
		expect(props.onToggle).toHaveBeenCalledWith('turn:activity:u');
	});

	it('renders recovered failures neutrally and terminal errors with a reason', () => {
		const { rerender } = render(
			<TurnActivityFold {...props} open>
				<ToolActivityLine
					log={activity.entries[0]}
					theme={mockTheme}
					secondaryTextColor={mockTheme.colors.textDim}
				/>
			</TurnActivityFold>
		);
		expect(screen.getByTestId('activity-collapsed')).toHaveTextContent('Worked for 35s · 1 step');
		expect(screen.getByText('exit code 1')).toHaveStyle({
			color: readableTextOn(mockTheme.colors.textDim, [mockTheme.colors.bgMain]),
		});
		rerender(
			<TurnActivityFold
				{...props}
				activity={{ ...activity, status: 'error', reason: 'Connection lost' }}
			/>
		);
		expect(screen.getByText('Connection lost')).toHaveStyle({
			color: readableTextOn(mockTheme.colors.error, [mockTheme.colors.bgMain]),
		});
	});
	it.each([
		{ language: 'en', expected: 'Failed: Connection lost' },
		{ language: 'zh-CN', expected: '失败：Connection lost' },
	] as const)('describes a failure before any step in $language', ({ language, expected }) => {
		useSettingsStore.setState({ uiLanguage: language });
		render(
			<TurnActivityFold
				{...props}
				activity={{ ...activity, entries: [], status: 'error', reason: 'Connection lost' }}
			/>
		);
		const row = screen.getByTestId('activity-collapsed');
		expect(row.textContent).toBe(expected);
		expect(row).toHaveClass('max-w-full');
		expect(row.querySelector('[data-tool-status="error"]')).toHaveClass('truncate');
		expect(row.querySelector('[data-tool-status="error"]')).toHaveTextContent(expected);
		expect(screen.getByText(expected)).toHaveStyle({
			color: readableTextOn(mockTheme.colors.error, [mockTheme.colors.bgMain]),
		});
	});

	it('collapses expanded live detail at completion and renders real plan progress only', () => {
		const planEntry = {
			id: 'plan',
			source: 'tool' as const,
			text: 'update_plan',
			timestamp: 2,
			metadata: {
				toolState: {
					input: {
						plan: [
							{ step: 'Inspect', status: 'completed' },
							{ step: 'Verify', status: 'pending' },
						],
					},
				},
			},
		};
		const { rerender } = render(
			<TurnActivityFold
				{...props}
				open
				activity={{
					...activity,
					entries: [...activity.entries, planEntry],
					running: true,
					status: 'running',
				}}
			/>
		);
		expect(screen.getByTestId('activity-plan')).toHaveTextContent('1/2 tasks');
		rerender(<TurnActivityFold {...props} open />);
		expect(props.onToggle).toHaveBeenCalledWith('turn:activity:u');
		expect(screen.queryByTestId('turn-activity-bar')).toBeNull();
	});

	it.each(['canceled', 'unknown'] as const)('keeps %s completion neutral', (status) => {
		const { container } = render(
			<TurnActivityFold {...props} activity={{ ...activity, status }} />
		);
		expect(screen.getByTestId('activity-collapsed')).toHaveTextContent(
			status === 'canceled' ? 'Stopped' : 'Result unknown'
		);
		expect(container.querySelector('[data-tool-status="error"]')).toBeNull();
	});

	it('replaces the running bar with the existing approval host and preserves classic presentation', () => {
		const { rerender } = render(
			<TurnActivityFold
				{...props}
				activity={{ ...activity, running: true }}
				awaitingApproval
				approvalHostId="approval"
			/>
		);
		expect(screen.queryByTestId('turn-activity-bar')).toBeNull();
		expect(document.getElementById('approval')).toBeTruthy();
		rerender(
			<TurnActivityFold {...props} newShell={false} activity={{ ...activity, status: 'error' }} />
		);
		expect(screen.getByText('1 failed step')).toBeInTheDocument();
		expect(screen.queryByTestId('activity-collapsed')).toBeNull();
	});

	it('opens Changes filtered to this turn and omits checks when no check list exists', () => {
		useSessionStore.setState({
			sessions: [
				createMockSession({ id: 's', activeTabId: 't', aiTabs: [createMockAITab({ id: 't' })] }),
			],
		});
		render(
			<TurnDeliveryBar
				sessionId="s"
				tabId="t"
				turnId="u"
				textColor={mockTheme.colors.textDim}
				plan={null}
				delivery={{ files: 2, additions: 9, deletions: 1, paths: ['a', 'b'] }}
			/>
		);
		fireEvent.click(screen.getByRole('button', { name: 'Changed 2 files · +9 -1' }));
		expect(useSessionStore.getState().sessions[0].aiTabs[0].newShellPanel).toMatchObject({
			tab: 'changes',
			changesView: 'turn',
			changesTurnId: 'u',
			open: true,
		});
		expect(screen.queryByTestId('delivery-plan')).toBeNull();
		expect(screen.getByTestId('turn-delivery').textContent).toBe('Changed 2 files · +9 -1');
	});

	it('names a single changed file in the singular', () => {
		render(
			<TurnDeliveryBar
				sessionId="s"
				tabId="t"
				turnId="u"
				textColor={mockTheme.colors.textDim}
				plan={null}
				delivery={{ files: 1, additions: 1, deletions: 1, paths: ['greet.cjs'] }}
			/>
		);
		expect(screen.getByTestId('turn-delivery').textContent).toBe('Changed 1 file · +1 -1');
	});

	it.each([0, null])(
		'hides a zero-file delivery without checks even with line counts %s',
		(count) => {
			render(
				<TurnDeliveryBar
					sessionId="s"
					tabId="t"
					turnId="u"
					textColor={mockTheme.colors.textDim}
					plan={null}
					delivery={{ files: 0, additions: count, deletions: count, paths: [] }}
				/>
			);
			// Nothing to report draws no row at all, so the transcript does not grow.
			expect(screen.queryByTestId('turn-delivery')).toBeNull();
		}
	);

	it('keeps plan and check results without a zero-file chip or absent-file placeholder', () => {
		const deliveryProps = {
			sessionId: 's',
			tabId: 't',
			turnId: 'u',
			textColor: mockTheme.colors.textDim,
		};
		const { rerender } = render(<TurnDeliveryBar {...deliveryProps} plan={null} />);
		expect(screen.queryByTestId('turn-delivery')).toBeNull();
		rerender(
			<TurnDeliveryBar
				{...deliveryProps}
				delivery={{ files: 0, additions: 0, deletions: 0, paths: [] }}
				plan={{
					tasks: [{ content: 'Inspect files', status: 'completed' }],
					completed: 1,
					inProgress: null,
				}}
			/>
		);
		expect(screen.getByTestId('turn-delivery')).toHaveTextContent('1/1 tasks');
		expect(screen.queryByRole('button', { name: /Changed/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /checks|passed|Assistant claims/ })).toBeNull();
		rerender(
			<TurnDeliveryBar {...deliveryProps} plan={null} checkResult={<span>Check evidence</span>} />
		);
		expect(screen.getByTestId('turn-delivery')).toHaveTextContent('Check evidence');
		expect(screen.queryByRole('button')).toBeNull();
	});

	it('keeps known changed files with unavailable line counts honest', () => {
		render(
			<TurnDeliveryBar
				sessionId="s"
				tabId="t"
				turnId="u"
				textColor={mockTheme.colors.textDim}
				plan={null}
				delivery={{ files: 2, additions: null, deletions: null, paths: ['a', 'b'] }}
			/>
		);
		const files = screen.getByRole('button', { name: /Changed 2 files/ });
		expect(files).toHaveTextContent('Changed 2 files');
		expect(files).toHaveTextContent('Line counts unavailable');
		expect(files).not.toHaveTextContent('+0 -0');
	});

	it('explains a Claude 5 conversation without a task tool and preserves actual plans', () => {
		const { rerender } = render(
			<TasksPanel logs={[]} theme={mockTheme} provider="claude-code" model="claude-sonnet-5-5" />
		);
		expect(screen.getByTestId('tasks-empty')).toHaveTextContent(
			'This conversation has no task list.'
		);
		expect(screen.getByTestId('tasks-empty')).toHaveTextContent(
			'Claude 5-series models do not provide a task-list tool.'
		);
		expect(screen.queryByTestId('tasks-progress')).toBeNull();
		rerender(
			<TasksPanel
				logs={[
					{
						id: 'p',
						source: 'tool',
						text: 'update_plan',
						timestamp: 1,
						metadata: { toolState: { input: { plan: [{ step: 'Check', status: 'completed' }] } } },
					},
				]}
				theme={mockTheme}
				provider="codex"
			/>
		);
		expect(screen.getByTestId('tasks-progress')).toHaveTextContent('1 / 1 completed');
	});
});
