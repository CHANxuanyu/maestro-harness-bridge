/**
 * The Left Bar's project tree catching an open native conversation up with its
 * transcript: on selecting the row, and when a history scan (window focus,
 * poll) reports that the conversation on screen moved on elsewhere.
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectHistoryConversation } from '../../../../shared/projectHistory';
import type { Group, Session } from '../../../../renderer/types';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
// vi.mock calls below are hoisted above these imports.
import { ProjectSessionSidebar } from '../../../../renderer/components/SessionList/ProjectSessionSidebar';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';
import { mockTheme } from '../../../helpers/mockTheme';

const EN: Record<string, string> = {
	'workflows.conversations.refreshFailed': "Couldn't load newer messages; showing the saved copy",
	'workflows.conversations.openFailed': "Couldn't open this conversation",
	'workflows.conversations.retry': 'Retry',
};

vi.mock('../../../../renderer/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../renderer/i18n')>();
	const t = (key: string) => EN[key] ?? key;
	return { ...actual, useT: () => t };
});

const mocks = vi.hoisted(() => ({
	tabHandlers: {
		handleTabSelect: vi.fn(),
		handleNewAgentSession: vi.fn(),
		handleTabClose: vi.fn(),
		handleRequestTabRename: vi.fn(),
	},
	refresh: vi.fn(),
	history: { conversations: [] as unknown[] },
}));
const tabHandlers = mocks.tabHandlers;
const refreshNativeConversation = mocks.refresh;

vi.mock('../../../../renderer/hooks/tabs/internal/useAITabHandlers', () => ({
	useAITabHandlers: () => mocks.tabHandlers,
}));

vi.mock('../../../../renderer/hooks/session/useProjectHistory', () => ({
	useProjectHistory: () => ({
		status: 'ready',
		refreshing: false,
		conversations: mocks.history.conversations,
		errors: [],
		failure: null,
		refresh: () => {},
	}),
}));

vi.mock('../../../../renderer/services/refreshNativeConversation', async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import('../../../../renderer/services/refreshNativeConversation')
		>();
	return {
		...actual,
		refreshNativeConversation: (...args: unknown[]) => mocks.refresh(...args),
	};
});

function setHistory(conversations: ProjectHistoryConversation[]): void {
	mocks.history.conversations = conversations;
}

const NATIVE = '00000000-0000-7000-a000-000000000001';
const AFTERNOON = Date.parse('2026-10-16T14:00:00Z');
const TONIGHT = Date.parse('2026-10-16T15:58:30Z');
const GROUP: Group = { id: 'maestro', name: 'MAESTRO', emoji: '', collapsed: false };

function record(overrides: Partial<ProjectHistoryConversation> = {}): ProjectHistoryConversation {
	return {
		key: `codex:local:/acct:${NATIVE}`,
		projectKey: 'group:maestro',
		projectPath: '/Users/u/secretary-harness-dev',
		provider: 'codex',
		nativeSessionId: NATIVE,
		title: 'Maestro Chinese Localization',
		nativeTitle: '查找 OpenCode 的订阅与 Harness 支持',
		preview: '',
		createdAt: 1,
		modifiedAt: AFTERNOON,
		messageCount: 4,
		starred: false,
		ownerId: 'maestro-owner',
		...overrides,
	};
}

function owner(): Session {
	return createMockSession({
		id: 'maestro-owner',
		toolType: 'codex',
		groupId: GROUP.id,
		projectRoot: '/Users/u/maestro-harness-bridge',
		activeTabId: 'tab-native',
		aiTabs: [
			createMockAITab({
				id: 'tab-native',
				agentSessionId: NATIVE,
				name: 'Maestro Chinese Localization',
				createdAt: 1,
				logs: [{ id: 'err', timestamp: AFTERNOON, source: 'error', text: 'Busy' }],
			}),
		],
	});
}

function renderSidebar(sessions: Session[]) {
	return render(
		<ProjectSessionSidebar
			theme={mockTheme}
			sessions={sessions}
			groups={[GROUP]}
			groupsPlusEnabled={false}
			unreadOnly={false}
			onToggleGroup={vi.fn()}
			onAddAgent={vi.fn()}
			onResumeSession={vi.fn()}
		/>
	);
}

function rowButton(container: HTMLElement): HTMLElement {
	return container.querySelector(
		'[data-conversation-key="maestro-owner:tab-native"] button[data-tree-nav]'
	) as HTMLElement;
}

beforeEach(() => {
	refreshNativeConversation.mockReset();
	refreshNativeConversation.mockResolvedValue({ status: 'updated', added: 2 });
	Object.values(tabHandlers).forEach((fn) => fn.mockReset());
	setHistory([record()]);
	const sessions = [owner()];
	useSessionStore.setState({ sessions, activeSessionId: 'maestro-owner' } as never);
});

describe('ProjectSessionSidebar native refresh', () => {
	it('selecting an open native conversation re-reads it with its own record, in place', async () => {
		const { container } = renderSidebar(useSessionStore.getState().sessions);
		expect(refreshNativeConversation).not.toHaveBeenCalled();

		fireEvent.click(rowButton(container));

		expect(tabHandlers.handleTabSelect).toHaveBeenCalledWith('tab-native');
		expect(refreshNativeConversation).toHaveBeenCalledTimes(1);
		expect(refreshNativeConversation.mock.calls[0][0]).toMatchObject({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
			record: { projectPath: '/Users/u/secretary-harness-dev', nativeSessionId: NATIVE },
		});
	});

	it('shows a failed catch-up with a retry that clears once it succeeds', async () => {
		refreshNativeConversation.mockResolvedValueOnce({ status: 'failed', error: 'EACCES' });
		const { container } = renderSidebar(useSessionStore.getState().sessions);

		fireEvent.click(rowButton(container));
		expect(
			await screen.findByText("Couldn't load newer messages; showing the saved copy")
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
		await waitFor(() =>
			expect(
				screen.queryByText("Couldn't load newer messages; showing the saved copy")
			).not.toBeInTheDocument()
		);
		expect(refreshNativeConversation).toHaveBeenCalledTimes(2);
	});

	it('catches the ACTIVE tab up once when a scan reports newer native activity, without moving focus', async () => {
		setHistory([record({ modifiedAt: TONIGHT })]);
		const { rerender } = renderSidebar(useSessionStore.getState().sessions);

		await waitFor(() => expect(refreshNativeConversation).toHaveBeenCalledTimes(1));
		expect(refreshNativeConversation.mock.calls[0][0]).toMatchObject({
			sessionId: 'maestro-owner',
			tabId: 'tab-native',
		});

		// The same metadata again (another scan) does not read again.
		setHistory([record({ modifiedAt: TONIGHT })]);
		await act(async () => {
			rerender(
				<ProjectSessionSidebar
					theme={mockTheme}
					sessions={useSessionStore.getState().sessions}
					groups={[GROUP]}
					groupsPlusEnabled={false}
					unreadOnly={false}
					onToggleGroup={vi.fn()}
					onAddAgent={vi.fn()}
					onResumeSession={vi.fn()}
				/>
			);
		});
		expect(refreshNativeConversation).toHaveBeenCalledTimes(1);
		expect(useSessionStore.getState().activeSessionId).toBe('maestro-owner');
		expect(tabHandlers.handleTabSelect).not.toHaveBeenCalled();
	});

	it('does not catch up a conversation that is not on screen', async () => {
		setHistory([record({ modifiedAt: TONIGHT })]);
		useSessionStore.setState({ activeSessionId: 'someone-else' } as never);
		renderSidebar(useSessionStore.getState().sessions);
		await act(async () => {});
		expect(refreshNativeConversation).not.toHaveBeenCalled();
	});
});
