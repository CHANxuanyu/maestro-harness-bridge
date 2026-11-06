import React, { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell, type AppShellProps } from '../../../renderer/components/AppShell';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { createMockSession } from '../../helpers/mockSession';
import { mockTheme } from '../../helpers/mockTheme';

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

beforeEach(() => {
	useSettingsStore.setState({ newShell: false });
	useSessionStore.setState({
		sessions: [createMockSession({ id: 's', name: 'Conversation title', groupId: 'g' })],
		activeSessionId: 's',
		sessionsReadOk: true,
	});
});

describe('AppShell title strip', () => {
	it.each([false, true])(
		'keeps the drag geometry and gates title text, new shell %s',
		(newShell) => {
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
			const { container } = render(<AppShell {...props} />);
			expect(!!screen.queryByText('project · Conversation title')).toBe(!newShell);
			const strip = container.querySelector('.fixed.top-0.left-0.right-0.h-10')!;
			expect(strip).toBeInTheDocument();
			expect(container.firstElementChild).toHaveClass('pt-10');
			if (newShell) expect(strip.textContent).toBe('');
		}
	);
});
