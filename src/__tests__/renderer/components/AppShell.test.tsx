import React, { createRef } from 'react';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell, type AppShellProps } from '../../../renderer/components/AppShell';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { createMockSession } from '../../helpers/mockSession';
import { mockTheme } from '../../helpers/mockTheme';
import { THEMES } from '../../../shared/themes';
import { contrastRatio } from '../../../shared/colorContrast';

vi.mock('../../../renderer/components/Toast', () => ({ ToastContainer: () => null }));
vi.mock('../../../renderer/components/CenterFlash', () => ({ CenterFlash: () => null }));
vi.mock('../../../renderer/components/ImageContextMenuHost', () => ({
	ImageContextMenuHost: () => null,
}));
vi.mock('../../../renderer/components/ZoomViewer', () => ({ ZoomViewerHost: () => null }));
vi.mock('../../../renderer/components/MediaPlayback', () => ({ MediaPlaybackHost: () => null }));
vi.mock('../../../renderer/components/ThoughtStreamPanel', () => ({
	ThoughtStreamPanel: () => null,
}));
vi.mock('../../../renderer/components/ContextTimelinePanel', () => ({
	ContextTimelinePanel: () => null,
}));
vi.mock('../../../renderer/components/PermissionPrompt', () => ({ PermissionPrompt: () => null }));
vi.mock('../../../renderer/components/AgentsLoadingView', () => ({
	AgentsLoadingView: () => null,
}));
vi.mock('../../../renderer/components/EmptyStateView', () => ({
	EmptyStateView: () => <div data-testid="classic-start" />,
}));
vi.mock('../../../renderer/components/ProjectStartView', () => ({
	ProjectStartView: () => <div data-testid="new-start" />,
}));

beforeEach(() => {
	useSettingsStore.setState({ newShell: false });
	useSessionStore.setState({
		sessions: [createMockSession({ id: 's', name: 'Conversation title', groupId: 'g' })],
		activeSessionId: 's',
		sessionsReadOk: true,
	});
});

describe('AppShell title strip', () => {
	it('scopes upright opaque placeholders to the new shell and excludes controls from header dragging', () => {
		const css = readFileSync('src/renderer/index.css', 'utf8');
		expect(css).toMatch(
			/html\[data-new-shell='true'\] input::placeholder,\s*html\[data-new-shell='true'\] textarea::placeholder\s*\{\s*font-style: normal !important;\s*opacity: 1 !important;/
		);
		expect(css).toMatch(/\[data-shell-header\]\s*\{\s*-webkit-app-region: drag;/);
		expect(css).toMatch(
			/\[data-shell-header\] button,[\s\S]*?\[data-shell-header\] \[role='tab'\],[\s\S]*?-webkit-app-region: no-drag;/
		);
	});
	it.each([false, true])('merges chrome only in the new shell, new shell %s', (newShell) => {
		useSettingsStore.setState({ newShell });
		const props = {
			theme: mockTheme,
			keyboardShellOffset: 0,
			isMobileLandscape: false,
			useNativeTitleBar: false,
			isMdDownViewport: false,
			concertoEnabled: false,
			activeGroupChatId: null,
			groupChats: [],
			groups: [{ id: 'g', name: 'project', emoji: '' }],
			modals: null,
			standaloneModals: null,
			logViewerOpen: false,
			logViewer: null,
			groupChatView: null,
			hasSessions: false,
			sessionsLoaded: false,
			emptyStateProps: {},
			sessionListProps: {},
			mainPanelRef: createRef(),
			mainPanelProps: {},
			rightPanelRef: createRef(),
			rightPanelProps: {},
			isNarrowViewport: false,
			leftSidebarOpen: true,
			rightPanelOpen: false,
			onCloseDrawers: vi.fn(),
			drawerCloseSwipeHandlers: {},
			edgeSwipeHandlers: {},
			onToastSessionClick: vi.fn(),
		} as AppShellProps;
		const { container, rerender } = render(<AppShell {...props} />);
		expect(!!screen.queryByText('project · Conversation title')).toBe(!newShell);
		const strip = container.querySelector('.fixed.top-0.left-0.right-0.h-10')!;
		expect(!!strip).toBe(!newShell);
		expect(container.firstElementChild).toHaveClass(newShell ? 'pt-0' : 'pt-10');
		for (const theme of Object.values(THEMES)) {
			rerender(<AppShell {...props} theme={theme} />);
			expect(document.documentElement.dataset.newShell).toBe(String(newShell));
			if (newShell) {
				const color = document.documentElement.style.getPropertyValue('--new-shell-placeholder');
				for (const background of [
					theme.colors.bgMain,
					theme.colors.bgSidebar,
					theme.colors.bgActivity,
				]) {
					expect(contrastRatio(color, background), theme.name).toBeGreaterThanOrEqual(4.5);
				}
			}
		}
		rerender(<AppShell {...props} sessionsLoaded={true} />);
		expect(!!screen.queryByTestId('new-start')).toBe(newShell);
		expect(!!screen.queryByTestId('classic-start')).toBe(!newShell);
		expect(!!screen.queryByRole('button', { name: 'Open project…' })).toBe(newShell);
	});
});
