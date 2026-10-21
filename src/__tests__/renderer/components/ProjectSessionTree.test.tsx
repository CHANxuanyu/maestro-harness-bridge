import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ProjectSessionTree } from '../../../renderer/components/SessionList/ProjectSessionTree';
import type {
	SidebarConversation,
	SidebarProject,
} from '../../../renderer/utils/projectSessionTree';
import { mockTheme } from '../../helpers/mockTheme';

// Pin the English copy so the tests do not depend on the catalog keys landing
// in the same change.
const EN: Record<string, string> = {
	'workflows.conversations.search': 'Search conversations...',
	'workflows.conversations.new': 'New conversation',
	'workflows.conversations.newWith': 'New with {provider}',
	'workflows.conversations.newConversation': 'New conversation',
	'workflows.conversations.history': 'Browse history',
	'workflows.conversations.configure': 'Agent settings',
	'workflows.conversations.rename': 'Rename conversation',
	'workflows.conversations.close': 'Close tab',
	'workflows.conversations.closeKeepsHistory': 'The conversation stays in this list',
	'workflows.conversations.opening': 'Opening',
	'workflows.conversations.openFailed': "Couldn't open this conversation",
	'workflows.conversations.retry': 'Retry',
	'workflows.conversations.showMore': 'Show {count} more',
	'workflows.conversations.loadingHistory': 'Loading conversation history...',
	'workflows.conversations.historyLoadFailed': "Couldn't load conversation history",
	'workflows.conversations.historyUnavailableFor': "Couldn't read {providers} history here",
	'workflows.conversations.refreshHistory': 'Refresh history',
	'workflows.conversations.manageAgents': 'Manage agents',
	'workflows.conversations.allProviders': 'All',
	'workflows.conversations.providerFilter': 'Filter by provider',
	'workflows.conversations.more': 'Conversation actions',
	'workflows.conversations.projectActions': 'Project actions',
	'workflows.conversations.empty': 'No conversations yet',
	'workflows.conversations.noMatches': 'No matching conversations',
	'workflows.conversations.addAgent': 'Add provider configuration',
	'workflows.conversations.busy': 'Working',
	'workflows.conversations.unread': 'Unread',
	'workflows.conversations.error': 'Needs attention',
};

vi.mock('../../../renderer/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../renderer/i18n')>();
	const t = (key: string, params?: Record<string, unknown>) =>
		(EN[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''));
	return { ...actual, useT: () => t };
});

const CLAUDE_AGENT = {
	id: 'owner-claude',
	name: 'Claude main',
	provider: 'claude-code',
	projectPath: '/p',
};
const CODEX_AGENT = { id: 'owner-codex', name: 'Codex main', provider: 'codex', projectPath: '/p' };

function conversation(overrides: Partial<SidebarConversation> = {}): SidebarConversation {
	return {
		key: 'owner-claude:tab-1',
		kind: 'open',
		ownerId: 'owner-claude',
		tabId: 'tab-1',
		provider: 'claude-code',
		nativeSessionId: null,
		title: 'Fix bug',
		agentName: 'Claude main',
		projectPath: '/p',
		busy: false,
		unread: false,
		error: false,
		starred: false,
		createdAt: 1,
		modifiedAt: 0,
		...overrides,
	};
}

function historyRow(overrides: Partial<SidebarConversation> = {}): SidebarConversation {
	return conversation({
		key: 'history:codex:native-1',
		kind: 'history',
		ownerId: null,
		tabId: null,
		provider: 'codex',
		nativeSessionId: 'native-1',
		title: 'Old investigation',
		agentName: '',
		modifiedAt: Date.now() - 60_000,
		...overrides,
	});
}

function project(overrides: Partial<SidebarProject> = {}): SidebarProject {
	const conversations = overrides.conversations ?? [conversation()];
	return {
		key: 'project-maestro',
		groupId: 'g1',
		name: 'Maestro',
		emoji: '🎹',
		depth: 0,
		collapsed: false,
		totalCount: conversations.length,
		hiddenCount: 0,
		agents: [CLAUDE_AGENT, CODEX_AGENT],
		...overrides,
		conversations,
	};
}

const claudeFix = conversation();
const codexFix = conversation({
	key: 'owner-codex:tab-9',
	ownerId: 'owner-codex',
	tabId: 'tab-9',
	provider: 'codex',
	agentName: 'Codex main',
});

function setup(overrides: Record<string, unknown> = {}) {
	const props = {
		theme: mockTheme,
		projects: [project({ conversations: [claudeFix, codexFix] })],
		activeKey: null,
		search: '',
		onSearchChange: vi.fn(),
		onToggleProject: vi.fn(),
		onSelectConversation: vi.fn(),
		onNewConversation: vi.fn(),
		onRenameConversation: vi.fn(),
		onCloseConversation: vi.fn(),
		onShowMore: vi.fn(),
		onManageAgents: vi.fn(),
		onRetryHistory: vi.fn(),
		onProviderFilterChange: vi.fn(),
		onAddAgent: vi.fn(),
		...overrides,
	};
	const utils = render(<ProjectSessionTree {...(props as any)} />);
	const rerender = (next: Record<string, unknown>) =>
		utils.rerender(<ProjectSessionTree {...({ ...props, ...next } as any)} />);
	return { props, rerender };
}

function projectHeader(name = 'Maestro') {
	// The header's name is "<project> <count>"; its action buttons are named
	// "<action>: <project>", so the anchored prefix picks the disclosure only.
	return screen.getByRole('button', { name: new RegExp(`^${name}`) });
}

function rowsOf(header: HTMLElement) {
	const list = document.getElementById(header.getAttribute('aria-controls')!);
	return list ? within(list).queryAllByRole('listitem') : [];
}

describe('ProjectSessionTree', () => {
	it('lists conversations directly under the project, with no agent level in between', () => {
		setup();
		const header = projectHeader();
		expect(header).toHaveAttribute('aria-expanded', 'true');

		// Both conversations are rows of the project's own list.
		expect(rowsOf(header)).toHaveLength(2);
		// Agent configuration names are not rendered as headings or rows.
		expect(screen.queryByText('Claude main')).toBeNull();
		expect(screen.queryByText('Codex main')).toBeNull();
		// The provider is a labelled badge on each row.
		expect(screen.getByRole('img', { name: 'Claude Code' })).toHaveAttribute(
			'title',
			'Claude Code · Claude main'
		);
		expect(screen.getByRole('img', { name: 'Codex' })).toBeInTheDocument();
	});

	it('toggles a project through the callback and hides its rows once collapsed', () => {
		const { props, rerender } = setup();
		fireEvent.click(projectHeader());
		expect(props.onToggleProject).toHaveBeenCalledWith(props.projects[0]);

		rerender({ projects: [project({ collapsed: true, conversations: [claudeFix, codexFix] })] });
		expect(projectHeader()).toHaveAttribute('aria-expanded', 'false');
		expect(screen.queryByRole('button', { name: /^Claude Code Fix bug/ })).toBeNull();
	});

	it('selects the exact row when two conversations share a name across providers', () => {
		const { props } = setup();
		fireEvent.click(screen.getByRole('button', { name: /^Codex Fix bug/ }));
		expect(props.onSelectConversation).toHaveBeenCalledTimes(1);
		expect(props.onSelectConversation.mock.calls[0][0]).toBe(codexFix);

		fireEvent.click(screen.getByRole('button', { name: /^Claude Code Fix bug/ }));
		expect(props.onSelectConversation.mock.calls[1][0]).toBe(claudeFix);
	});

	it('starts a new conversation with the configuration picked from the plus menu', () => {
		const { props } = setup();
		fireEvent.click(screen.getByRole('button', { name: 'New conversation: Maestro' }));

		const menu = screen.getByRole('menu');
		fireEvent.click(within(menu).getByRole('menuitem', { name: /New with Codex/ }));
		expect(props.onNewConversation).toHaveBeenCalledWith('owner-codex');
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('skips the picker when the project has a single configuration', () => {
		const { props } = setup({ projects: [project({ agents: [CODEX_AGENT] })] });
		fireEvent.click(screen.getByRole('button', { name: 'New conversation: Maestro' }));
		expect(screen.queryByRole('menu')).toBeNull();
		expect(props.onNewConversation).toHaveBeenCalledWith('owner-codex');
	});

	it('reveals rows of a collapsed project while a search is active', () => {
		setup({
			search: 'fix',
			projects: [project({ collapsed: true, conversations: [claudeFix] })],
		});
		expect(projectHeader()).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByRole('button', { name: /^Claude Code Fix bug/ })).toBeInTheDocument();
	});

	it('reports no matches when a search leaves nothing', () => {
		setup({ search: 'zzz', projects: [project({ conversations: [] })] });
		expect(screen.getByText('No matching conversations')).toBeInTheDocument();
	});

	it('exposes the active row and its status to assistive technology', () => {
		const errored = conversation({ key: 'e', tabId: 'e', title: 'Deploy', error: true });
		const unread = conversation({ key: 'u', tabId: 'u', title: 'Review', unread: true });
		const busy = conversation({ key: 'b', tabId: 'b', title: 'Refactor', busy: true });
		setup({
			activeKey: 'u',
			projects: [project({ conversations: [errored, unread, busy] })],
		});

		const reviewRow = screen.getByRole('button', { name: /^Claude Code Review/ });
		expect(reviewRow).toHaveAttribute('aria-current', 'page');
		expect(reviewRow).toHaveAccessibleName(/Unread/);
		expect(screen.getByRole('button', { name: /^Claude Code Deploy/ })).toHaveAccessibleName(
			/Needs attention/
		);
		expect(screen.getByRole('button', { name: /^Claude Code Deploy/ })).not.toHaveAttribute(
			'aria-current'
		);
		expect(screen.getByRole('button', { name: /^Claude Code Refactor/ })).toHaveAccessibleName(
			/Working/
		);
	});

	it('labels an untitled conversation as a new conversation', () => {
		setup({ projects: [project({ conversations: [conversation({ title: '' })] })] });
		expect(
			screen.getByRole('button', { name: /^Claude Code New conversation$/ })
		).toBeInTheDocument();
	});

	it('renames the exact conversation from its row menu and closes on Escape', () => {
		const { props } = setup();
		const codexRow = screen
			.getByRole('button', { name: /^Codex Fix bug/ })
			.closest('li') as HTMLElement;
		const trigger = within(codexRow).getByRole('button', { name: 'Conversation actions: Fix bug' });

		fireEvent.click(trigger);
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(trigger);

		fireEvent.click(trigger);
		fireEvent.click(screen.getByRole('menuitem', { name: 'Rename conversation' }));
		expect(props.onRenameConversation.mock.calls[0][0]).toBe(codexFix);
	});

	it('names the row action "Close tab" and offers no configuration or history browser', () => {
		const { props } = setup();
		const codexRow = screen
			.getByRole('button', { name: /^Codex Fix bug/ })
			.closest('li') as HTMLElement;
		fireEvent.click(within(codexRow).getByRole('button', { name: /Conversation actions/ }));
		const menu = screen.getByRole('menu');
		expect(within(menu).queryByText('Agent settings')).toBeNull();
		expect(within(menu).queryByText('Browse history')).toBeNull();
		fireEvent.click(within(menu).getByRole('menuitem', { name: /Close tab/ }));
		expect(props.onCloseConversation.mock.calls[0][0]).toBe(codexFix);
	});

	it('opens a native history row with one click and gives it no tab actions', () => {
		const row = historyRow();
		const { props } = setup({ projects: [project({ conversations: [claudeFix, row] })] });
		const button = screen.getByRole('button', { name: /^Codex Old investigation/ });
		const item = button.closest('li') as HTMLElement;
		expect(item).toHaveAttribute('data-conversation-kind', 'history');
		expect(within(item).queryByRole('button', { name: /Conversation actions/ })).toBeNull();
		// Recency is shown, subtly, as a <time>.
		expect(item.querySelector('time')).not.toBeNull();

		fireEvent.click(button);
		expect(props.onSelectConversation).toHaveBeenCalledWith(row);
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('marks an opening row busy and offers an inline retry after a failure', () => {
		const row = historyRow();
		const { props, rerender } = setup({
			projects: [project({ conversations: [row] })],
			pendingKeys: { [row.key]: true },
		});
		expect(
			screen.getByRole('button', { name: /^Codex Old investigation Opening/ })
		).toHaveAttribute('aria-busy', 'true');

		rerender({ pendingKeys: {}, failedKeys: { [row.key]: true } });
		expect(screen.getByRole('alert')).toHaveTextContent("Couldn't open this conversation");
		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(props.onSelectConversation).toHaveBeenCalledWith(row);
	});

	it('counts conversations, not configurations, and pages the rest behind Show more', () => {
		const { props } = setup({
			projects: [
				project({ conversations: [claudeFix, codexFix], totalCount: 40, hiddenCount: 38 }),
			],
		});
		expect(projectHeader()).toHaveAccessibleName(/Maestro\s*40$/);
		fireEvent.click(screen.getByRole('button', { name: 'Show 38 more' }));
		expect(props.onShowMore).toHaveBeenCalledWith(props.projects[0]);
	});

	it('keeps the project menu short: refresh, manage agents, add a provider', () => {
		const { props } = setup();
		fireEvent.click(screen.getByRole('button', { name: 'Project actions: Maestro' }));
		const items = within(screen.getByRole('menu'))
			.getAllByRole('menuitem')
			.map((item) => item.textContent);
		expect(items).toEqual(['Refresh history', 'Manage agents', 'Add provider configuration']);
		fireEvent.click(screen.getByRole('menuitem', { name: 'Manage agents' }));
		expect(props.onManageAgents).toHaveBeenCalled();
	});

	it('filters by provider only when several providers have conversations', () => {
		const { props, rerender } = setup({ providers: ['claude-code'] });
		expect(screen.queryByRole('radiogroup', { name: 'Filter by provider' })).toBeNull();

		rerender({ providers: ['claude-code', 'codex'] });
		const filter = screen.getByRole('radiogroup', { name: 'Filter by provider' });
		fireEvent.click(within(filter).getByRole('radio', { name: 'Codex' }));
		expect(props.onProviderFilterChange).toHaveBeenCalledWith('codex');
	});

	it('explains loading, a failed scan, and a provider that could not be read', () => {
		const { props, rerender } = setup({
			historyStatus: 'loading',
			projects: [project({ conversations: [] })],
		});
		expect(screen.getAllByText('Loading conversation history...').length).toBeGreaterThan(0);
		expect(screen.queryByText('No conversations yet')).toBeNull();

		rerender({
			historyStatus: 'ready',
			historyFailure: 'boom',
			historyErrors: {
				'project-maestro': [
					{ projectKey: 'project-maestro', provider: 'codex', message: 'EACCES' },
				],
			},
		});
		expect(screen.getByText("Couldn't load conversation history")).toBeInTheDocument();
		expect(screen.getByText("Couldn't read Codex history here")).toBeInTheDocument();
		fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
		expect(props.onRetryHistory).toHaveBeenCalled();
	});
});
