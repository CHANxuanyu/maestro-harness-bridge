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
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { useUIStore } from '../../../../renderer/stores/uiStore';
// vi.mock calls below are hoisted above these imports.
import { ProjectSessionSidebar } from '../../../../renderer/components/SessionList/ProjectSessionSidebar';
import { createMockSession } from '../../../helpers/mockSession';
import { createMockAITab } from '../../../helpers/mockTab';
import { mockTheme } from '../../../helpers/mockTheme';
import { useConversationArchiveStore } from '../../../../renderer/stores/conversationArchiveStore';

const EN: Record<string, string> = {
	'workflows.conversations.refreshFailed': "Couldn't load newer messages; showing the saved copy",
	'workflows.conversations.openFailed': "Couldn't open this conversation",
	'workflows.conversations.retry': 'Retry',
	'workflows.conversations.worktree': 'Ran in worktree {path}',
	'workflows.conversations.worktreeGone':
		'This worktree no longer exists, so the conversation is read-only',
	'workflows.archive.archived': 'Archived {count}',
	'workflows.archive.unarchive': 'Unarchive',
};

vi.mock('../../../../renderer/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../renderer/i18n')>();
	const t = (key: string, params?: Record<string, unknown>) =>
		(EN[key] ?? key).replace(/\{(\w+)\}/g, (match, name) =>
			params && name in params ? String(params[name]) : match
		);
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
		projectPath: '/Users/u/sample-project',
		provider: 'codex',
		nativeSessionId: NATIVE,
		title: 'Example Conversation',
		nativeTitle: '查看示例项目的原生会话与工具支持',
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
				name: 'Example Conversation',
				createdAt: 1,
				logs: [{ id: 'err', timestamp: AFTERNOON, source: 'error', text: 'Busy' }],
			}),
		],
	});
}

function renderSidebar(sessions: Session[], onDeleteWorktree = vi.fn()) {
	return render(
		<ProjectSessionSidebar
			theme={mockTheme}
			onDeleteWorktree={onDeleteWorktree}
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
	useConversationArchiveStore.setState({ records: [] });
	refreshNativeConversation.mockReset();
	refreshNativeConversation.mockResolvedValue({ status: 'updated', added: 2 });
	Object.values(tabHandlers).forEach((fn) => fn.mockReset());
	setHistory([record()]);
	const sessions = [owner()];
	useSessionStore.setState({ sessions, activeSessionId: 'maestro-owner' } as never);
});

it.each([undefined, 'remote'])(
	'shows and unarchives native subdirectory history on host %s',
	async (sshRemoteId) => {
		useSettingsStore.setState({ newShell: true });
		const session = createMockSession({
			id: 'project',
			groupId: GROUP.id,
			toolType: 'codex',
			projectRoot: '/repo',
			cwd: '/repo',
			aiTabs: [],
			sessionSshRemoteConfig: sshRemoteId ? { enabled: true, remoteId: sshRemoteId } : undefined,
		});
		const archived = {
			...record({
				projectKey: '',
				projectPath: '/repo/packages/api',
				sshRemoteId,
				ownerId: undefined,
			}),
			ownerIds: ['project'],
			archivedAt: 1,
			permissionMode: 'readonly' as const,
		};
		useSessionStore.setState({ sessions: [session] });
		setHistory([]);
		useConversationArchiveStore.setState({ records: [archived] });
		const original = window.maestro.agentSessions;
		const change = vi.fn().mockResolvedValue({ success: true });
		window.maestro.agentSessions = {
			...original,
			archiveConversation: change,
			archives: vi.fn().mockResolvedValue([]),
		};
		try {
			renderSidebar([session]);
			fireEvent.click(screen.getByRole('button', { name: 'Archived 1', exact: true }));
			fireEvent.click(screen.getByRole('button', { name: 'Unarchive', exact: true }));
			expect(change).toHaveBeenCalledWith(
				expect.objectContaining({ projectPath: '/repo/packages/api', sshRemoteId }),
				'unarchive'
			);
			await act(async () => {});
		} finally {
			window.maestro.agentSessions = original;
			useSettingsStore.setState({ newShell: false });
		}
	}
);

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
			record: { projectPath: '/Users/u/sample-project', nativeSessionId: NATIVE },
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

describe('ProjectSessionSidebar hands the caret to the composer', () => {
	// The Left Bar's own container sets activeFocus back to 'sidebar' on every
	// click that bubbles up to it, so a row cannot rely on setting 'main' itself:
	// it asks the main panel to focus the conversation's composer instead.
	function renderInsideLeftBar() {
		return render(
			<div onClick={() => useUIStore.getState().setActiveFocus('sidebar')}>
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
			</div>
		);
	}

	beforeEach(() => {
		useUIStore.getState().clearFocusRequest();
	});

	it('asks for the selected conversation to take focus', () => {
		const { container } = renderInsideLeftBar();
		fireEvent.click(rowButton(container));
		expect(useUIStore.getState().focusRequest).toEqual({ tab: { type: 'ai', id: 'tab-native' } });
	});

	it('asks for a new conversation to take focus', () => {
		tabHandlers.handleNewAgentSession.mockImplementation(() => {
			const [session] = useSessionStore.getState().sessions;
			useSessionStore.setState({
				sessions: [
					{
						...session,
						aiTabs: [...session.aiTabs, createMockAITab({ id: 'tab-new' })],
						activeTabId: 'tab-new',
					},
				],
			} as never);
		});
		renderInsideLeftBar();
		fireEvent.click(screen.getByRole('button', { name: /^workflows\.conversations\.new: / }));
		expect(tabHandlers.handleNewAgentSession).toHaveBeenCalledTimes(1);
		expect(useUIStore.getState().focusRequest).toEqual({ tab: { type: 'ai', id: 'tab-new' } });
	});

	it('starts a conversation with the open agent from the button at the top', () => {
		tabHandlers.handleNewAgentSession.mockClear();
		renderInsideLeftBar();
		fireEvent.click(screen.getByTestId('sidebar-new-conversation'));
		expect(tabHandlers.handleNewAgentSession).toHaveBeenCalledTimes(1);
	});

	it('hides the top button when no agent is open', () => {
		useSessionStore.setState({ activeSessionId: 'gone' } as never);
		renderInsideLeftBar();
		expect(screen.queryByTestId('sidebar-new-conversation')).not.toBeInTheDocument();
	});
});

it('shows the recorded worktree identity beside a conversation title', () => {
	setHistory([record({ worktree: { path: '/synthetic/worktrees/x', branch: 'fixture-x' } })]);
	renderSidebar(useSessionStore.getState().sessions);
	expect(screen.getByText('fixture-x').closest('[data-worktree]')?.getAttribute('title')).toBe(
		'Ran in worktree /synthetic/worktrees/x\nfixture-x'
	);
});

it('labels a worktree by its folder and says when that folder is gone', () => {
	setHistory([
		record({
			worktree: {
				path: '/synthetic/repo/.claude/worktrees/handoff-x',
				name: 'handoff-x',
				branch: 'claude/handoff-x',
				missing: true,
			},
		}),
	]);
	renderSidebar(useSessionStore.getState().sessions);
	expect(screen.queryByText('claude/handoff-x')).not.toBeInTheDocument();
	expect(screen.getByText('handoff-x').closest('[data-worktree]')?.getAttribute('title')).toBe(
		[
			'Ran in worktree /synthetic/repo/.claude/worktrees/handoff-x',
			'claude/handoff-x',
			'This worktree no longer exists, so the conversation is read-only',
		].join('\n')
	);
});

describe('daily conversation actions', () => {
	it('opens the existing cleanup flow for the right-clicked worktree only', () => {
		useSettingsStore.setState({ newShell: true });
		const main = owner();
		const child = createMockSession({
			id: 'child',
			parentSessionId: main.id,
			worktreeBranch: 'feature',
			aiTabs: [createMockAITab({ id: 'child-tab', name: 'Worktree conversation' })],
		});
		useSessionStore.setState({ sessions: [main, child], activeSessionId: main.id });
		const cleanup = vi.fn();
		const { container } = renderSidebar([main, child], cleanup);
		fireEvent.contextMenu(
			container.querySelector('[data-conversation-key="child:child-tab"] button[data-tree-nav]')!
		);
		fireEvent.click(screen.getByRole('menuitem', { name: 'workflows.git.removeWorktree' }));
		expect(cleanup).toHaveBeenCalledExactlyOnceWith(child);
		expect(useSessionStore.getState().activeSessionId).toBe(main.id);
		fireEvent.contextMenu(rowButton(container));
		expect(
			screen.queryByRole('menuitem', { name: 'workflows.git.removeWorktree' })
		).not.toBeInTheDocument();
	});
});

it('pins and unpins a background conversation without changing focus', () => {
	useSettingsStore.setState({ newShell: true });
	const main = owner();
	const other = createMockSession({
		id: 'other',
		aiTabs: [createMockAITab({ id: 'other-tab', name: 'Other conversation' })],
	});
	useSessionStore.setState({ sessions: [main, other], activeSessionId: main.id });
	const { container, rerender } = renderSidebar([main, other]);
	fireEvent.contextMenu(
		container.querySelector('[data-conversation-key="other:other-tab"] button[data-tree-nav]')!
	);
	fireEvent.click(screen.getByRole('menuitem', { name: 'workflows.conversations.pin' }));
	expect(
		useSessionStore.getState().sessions.find((s) => s.id === other.id)!.aiTabs[0].starred
	).toBe(true);
	expect(useSessionStore.getState().activeSessionId).toBe(main.id);
	rerender(
		<ProjectSessionSidebar
			theme={mockTheme}
			sessions={useSessionStore.getState().sessions}
			groups={[GROUP]}
			groupsPlusEnabled={false}
			unreadOnly={false}
			onToggleGroup={vi.fn()}
			onAddAgent={vi.fn()}
		/>
	);
	fireEvent.contextMenu(
		container.querySelector('[data-conversation-key="other:other-tab"] button[data-tree-nav]')!
	);
	fireEvent.click(screen.getByRole('menuitem', { name: 'workflows.conversations.unpin' }));
	expect(
		useSessionStore.getState().sessions.find((s) => s.id === other.id)!.aiTabs[0].starred
	).toBe(false);
	expect(useSessionStore.getState().activeSessionId).toBe(main.id);
});
