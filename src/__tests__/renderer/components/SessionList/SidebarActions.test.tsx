import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SidebarActions } from '../../../../renderer/components/SessionList/SidebarActions';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { useNotificationStore } from '../../../../renderer/stores/notificationStore';
import { useModalStore } from '../../../../renderer/stores/modalStore';
import { useUIStore } from '../../../../renderer/stores/uiStore';

import { mockTheme } from '../../../helpers/mockTheme';

const defaultShortcuts = {
	toggleSidebar: { keys: ['Cmd', 'B'], label: 'Toggle Sidebar' },
	filterUnreadAgents: { keys: ['Alt', 'u'], label: 'Filter Unread Agents' },
} as any;

function createProps(overrides: Partial<Parameters<typeof SidebarActions>[0]> = {}) {
	return {
		theme: mockTheme,
		leftSidebarOpen: true,
		sidebarWidth: 320,
		hasNoSessions: false,
		shortcuts: defaultShortcuts,
		showUnreadAgentsOnly: false,
		hasUnreadAgents: false,
		addNewSession: vi.fn(),
		toggleShowUnreadAgentsOnly: vi.fn(),
		...overrides,
	};
}

// SidebarActions calls setLeftSidebarOpen via useUIStore.getState() rather than
// taking the setter as a prop, so reset the store between tests.
beforeEach(() => {
	useSettingsStore.setState({ newShell: false });
	useNotificationStore.setState({ history: [], notificationCenterOpen: false });
	useUIStore.setState({ leftSidebarOpen: true, leftSidebarHidden: false });
});

describe('SidebarActions', () => {
	it('keeps only collapse, settings and notification center in the new shell', () => {
		useSettingsStore.setState({ newShell: true });
		useNotificationStore.setState({ history: [{ id: 'notice', read: false } as any] });
		const props = createProps({ openFeedback: vi.fn(), hasUnreadAgents: true });
		render(<SidebarActions {...props} />);
		expect(screen.getAllByRole('button')).toHaveLength(3);
		expect(screen.queryByText('New Agent')).toBeNull();
		expect(screen.queryByText('Feedback')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
		expect(useModalStore.getState().modals.get('settings')?.open).toBe(true);
		const bell = screen.getByTestId('notification-center-button');
		expect(bell.querySelector('span.absolute.rounded-full')).not.toBeNull();
		fireEvent.click(bell);
		expect(useNotificationStore.getState().notificationCenterOpen).toBe(true);
		expect(props.toggleShowUnreadAgentsOnly).not.toHaveBeenCalled();
	});

	it('renders collapse button, New Agent, and Feedback when sidebar is open', () => {
		render(<SidebarActions {...createProps({ openFeedback: vi.fn() })} />);

		expect(screen.getByText('New Agent')).toBeTruthy();
		expect(screen.getByText('Feedback')).toBeTruthy();
	});

	it('hides New Agent, Feedback, and unread filter when sidebar is collapsed', () => {
		render(<SidebarActions {...createProps({ leftSidebarOpen: false })} />);

		expect(screen.queryByText('New Agent')).toBeNull();
		expect(screen.queryByText('Feedback')).toBeNull();
		expect(screen.queryByTitle(/Filter unread agents/)).toBeNull();
		expect(screen.queryByTitle(/Showing unread agents only/)).toBeNull();
	});

	it('disables Feedback button when openFeedback is undefined', () => {
		render(<SidebarActions {...createProps({ openFeedback: undefined })} />);

		expect(screen.getByText('New Agent')).toBeTruthy();
		const feedbackBtn = screen.getByText('Feedback').closest('button');
		expect(feedbackBtn?.disabled).toBe(true);
	});

	it('calls addNewSession when New Agent is clicked', () => {
		const addNewSession = vi.fn();
		render(<SidebarActions {...createProps({ addNewSession })} />);

		fireEvent.click(screen.getByText('New Agent'));
		expect(addNewSession).toHaveBeenCalledOnce();
	});

	it('calls openFeedback when Feedback is clicked', () => {
		const openFeedback = vi.fn();
		render(<SidebarActions {...createProps({ openFeedback })} />);

		fireEvent.click(screen.getByText('Feedback'));
		expect(openFeedback).toHaveBeenCalledOnce();
	});

	it('collapses the sidebar on collapse-button click', () => {
		useUIStore.setState({ leftSidebarOpen: true, leftSidebarHidden: false });
		render(<SidebarActions {...createProps({ leftSidebarOpen: true })} />);

		const collapseBtn = screen.getByTitle(/Collapse Sidebar/);
		fireEvent.click(collapseBtn);
		expect(useUIStore.getState().leftSidebarOpen).toBe(false);
	});

	it('prevents collapse when no sessions and sidebar is open', () => {
		useUIStore.setState({ leftSidebarOpen: true, leftSidebarHidden: false });
		render(<SidebarActions {...createProps({ hasNoSessions: true, leftSidebarOpen: true })} />);

		const collapseBtn = screen.getByTitle('Add an agent first to collapse sidebar');
		fireEvent.click(collapseBtn);
		// Disabled button - no state change.
		expect(useUIStore.getState().leftSidebarOpen).toBe(true);
	});

	it('expands the sidebar on expand-button click', () => {
		useUIStore.setState({ leftSidebarOpen: false, leftSidebarHidden: false });
		render(<SidebarActions {...createProps({ hasNoSessions: true, leftSidebarOpen: false })} />);

		const expandBtn = screen.getByTitle(/Expand Sidebar/);
		fireEvent.click(expandBtn);
		expect(useUIStore.getState().leftSidebarOpen).toBe(true);
	});

	it('renders unread agents filter button', () => {
		render(<SidebarActions {...createProps()} />);
		expect(screen.getByTitle(/Filter unread agents/)).toBeTruthy();
	});

	it('calls toggleShowUnreadAgentsOnly when unread filter button is clicked', () => {
		const toggleShowUnreadAgentsOnly = vi.fn();
		render(<SidebarActions {...createProps({ toggleShowUnreadAgentsOnly })} />);

		fireEvent.click(screen.getByTitle(/Filter unread agents/));
		expect(toggleShowUnreadAgentsOnly).toHaveBeenCalledOnce();
	});

	it('shows active state when showUnreadAgentsOnly is true', () => {
		render(<SidebarActions {...createProps({ showUnreadAgentsOnly: true })} />);
		expect(screen.getByTitle(/Showing unread agents only/)).toBeTruthy();
	});

	it('renders two-column grid layout', () => {
		render(<SidebarActions {...createProps({ openFeedback: vi.fn() })} />);

		const newAgentBtn = screen.getByText('New Agent');
		const grid = newAgentBtn.closest('div[style]');
		expect(grid?.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
	});

	it('prevents text wrapping in action buttons', () => {
		render(<SidebarActions {...createProps({ openFeedback: vi.fn() })} />);

		const newAgentBtn = screen.getByText('New Agent').closest('button');
		const feedbackBtn = screen.getByText('Feedback').closest('button');

		expect(newAgentBtn?.className).toContain('whitespace-nowrap');
		expect(feedbackBtn?.className).toContain('whitespace-nowrap');
		expect(newAgentBtn?.className).toContain('overflow-hidden');
		expect(feedbackBtn?.className).toContain('overflow-hidden');
	});
});
