import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionListView } from '../../../../../renderer/components/AgentSessionsBrowser/components/SessionListView';
import type { AgentSession } from '../../../../../renderer/hooks/agent/useSessionViewer';
import { mockTheme } from '../../../../helpers/mockTheme';

function props(overrides: Partial<React.ComponentProps<typeof SessionListView>> = {}) {
	return {
		loading: false,
		sessions: [{ sessionId: 's1' } as AgentSession],
		filteredSessions: [],
		selectedIndex: 0,
		starredSessions: new Set<string>(),
		activeAgentSessionId: null,
		renamingSessionId: null,
		renameValue: '',
		searchMode: 'all' as const,
		search: 'needle',
		isLoadingMoreSessions: false,
		hasMoreSessions: false,
		totalSessionCount: 1,
		agentId: 'codex',
		theme: mockTheme,
		sessionsContainerRef: { current: null },
		selectedItemRef: { current: null },
		renameInputRef: { current: null },
		getSearchResultInfo: () => undefined,
		onSessionsScroll: vi.fn(),
		onViewSession: vi.fn(),
		onToggleStar: vi.fn(),
		onQuickResume: vi.fn(),
		onStartRename: vi.fn(),
		onRenameChange: vi.fn(),
		onSubmitRename: vi.fn(),
		onCancelRename: vi.fn(),
		...overrides,
	};
}

describe('SessionListView empty states', () => {
	it('says the account is unavailable rather than that nothing matched', () => {
		render(<SessionListView {...props({ accountUnavailable: true })} />);
		expect(screen.getByText("This agent's account is unavailable")).toBeInTheDocument();
		expect(screen.queryByText('No sessions match your search')).toBeNull();
	});

	it('keeps "no matching sessions" for a search that ran and found nothing', () => {
		render(<SessionListView {...props()} />);
		expect(screen.getByText('No sessions match your search')).toBeInTheDocument();
		expect(screen.queryByText("This agent's account is unavailable")).toBeNull();
	});
});
