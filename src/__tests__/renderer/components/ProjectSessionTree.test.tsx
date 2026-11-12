import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { ProjectSessionTree } from '../../../renderer/components/SessionList/ProjectSessionTree';
import type {
	SidebarConversation,
	SidebarProject,
} from '../../../renderer/utils/projectSessionTree';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useModalStore } from '../../../renderer/stores/modalStore';
import { contrastRatio } from '../../../shared/colorContrast';
import { mockTheme } from '../../helpers/mockTheme';

// Pin the English copy so the tests do not depend on the catalog keys landing
// in the same change.
const EN: Record<string, string> = {
	'workflows.projectSettings.title': 'Project settings',
	'workflows.projectSettings.newConversation': 'New with project defaults',
	'workflows.split.openRight': 'Open on the right',
	'workflows.conversations.closeConversation': 'Close conversation',
	'workflows.conversations.addAccount': 'Add account or configuration',
	'workflows.conversations.handoff': 'Hand off…',
	'workflows.conversations.search': 'Search conversations...',
	'workflows.conversations.contentSearchPlaceholder': 'Search conversations...',
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
	'workflows.conversations.expandChildren': 'Show subtasks: {title}',
	'workflows.conversations.collapseChildren': 'Hide subtasks: {title}',
};

vi.mock('../../../renderer/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../renderer/i18n')>();
	const t = (key: string, params?: Record<string, unknown>) =>
		(
			EN[key] ??
			(key.startsWith('workflows.newShellCopy.')
				? actual.getTranslator('en')(key as keyof typeof actual.CATALOGS.en)
				: key)
		).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''));
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
	function ControlledTree({ value }: { value: typeof props }) {
		const [choices, setChoices] = React.useState<Record<string, boolean>>({});
		const apply = (row: SidebarConversation): SidebarConversation =>
			!row.children && choices[row.key] === undefined
				? row
				: {
						...row,
						expanded: choices[row.key] ?? row.expanded,
						children: row.children?.map(apply),
					};
		return (
			<ProjectSessionTree
				{...(value as any)}
				projects={(value.projects as SidebarProject[]).map((p) => ({
					...p,
					conversations: p.conversations.map(apply),
				}))}
				onSetChildrenExpanded={(row, expanded) =>
					setChoices((previous) => ({ ...previous, [row.key]: expanded }))
				}
			/>
		);
	}
	const utils = render(<ControlledTree value={props} />);
	const rerender = (next: Record<string, unknown>) =>
		utils.rerender(<ControlledTree value={{ ...props, ...next } as any} />);
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

it.each([false, true])(
	'distinguishes busy shape and omits project emoji only in new shell %s',
	(newShell) => {
		useSettingsStore.setState({ newShell });
		setup({ projects: [project({ conversations: [conversation({ busy: true })] })] });
		expect(!!screen.queryByText('🎹')).toBe(!newShell);
		const mark = screen.getByTitle('Working');
		expect(!!mark.querySelector('.animate-spin')).toBe(newShell);
		expect(!!mark.querySelector('.animate-pulse')).toBe(!newShell);
	}
);

describe('ProjectSessionTree', () => {
	it('keeps completed subtasks collapsed and opens them through the same row callback', () => {
		useSettingsStore.setState({ newShell: true });
		const child = { ...codexFix, title: 'Review the tests' };
		const parent = conversation({ children: [child] });
		const { props } = setup({ projects: [project({ conversations: [parent] })] });
		expect(screen.queryByRole('button', { name: 'Codex Review the tests' })).toBeNull();
		const disclosure = screen.getByRole('button', { name: 'Show subtasks: Fix bug' });
		expect(disclosure).toHaveAttribute('aria-expanded', 'false');
		fireEvent.click(disclosure);
		const childButton = screen.getByRole('button', { name: 'Codex Review the tests' });
		expect(childButton).toHaveStyle({ paddingLeft: '32px' });
		expect(within(childButton).getByRole('img', { name: 'Codex' })).toBeInTheDocument();
		fireEvent.click(childButton);
		expect(props.onSelectConversation).toHaveBeenCalledWith(child);
		fireEvent.click(screen.getByRole('button', { name: 'Hide subtasks: Fix bug' }));
		expect(screen.queryByRole('button', { name: 'Codex Review the tests' })).toBeNull();
	});

	it('automatically reveals running subtasks and their state without unread marks', () => {
		useSettingsStore.setState({ newShell: true });
		const child = { ...codexFix, title: 'Review the tests', busy: false };
		const tree = (busy: boolean) => [
			project({ conversations: [conversation({ children: [{ ...child, busy }] })] }),
		];
		const { rerender } = setup({ projects: tree(false) });
		expect(screen.queryByRole('button', { name: /Codex Review the tests/ })).toBeNull();
		rerender({ projects: tree(true) });
		const childButton = screen.getByRole('button', { name: 'Codex Review the tests Working' });
		expect(within(childButton).getByTitle('Working')).toBeInTheDocument();
		expect(screen.queryByTitle('Unread')).toBeNull();
		expect(screen.getByRole('button', { name: 'Hide subtasks: Fix bug' })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		rerender({ projects: tree(false) });
		expect(screen.getByRole('button', { name: /Codex Review the tests/ })).toBeInTheDocument();
	});

	it('keeps a selected completed descendant visible and resolves its own menu actions', () => {
		useSettingsStore.setState({ newShell: true });
		const child = { ...codexFix, title: 'Review the tests' };
		const { props } = setup({
			projects: [project({ conversations: [conversation({ children: [child] })] })],
			activeKey: child.key,
		});
		expect(screen.getByRole('button', { name: 'Codex Review the tests' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		fireEvent.click(screen.getByRole('button', { name: 'Conversation actions: Review the tests' }));
		fireEvent.click(screen.getByRole('menuitem', { name: 'Rename conversation' }));
		expect(props.onRenameConversation).toHaveBeenCalledWith(child);
	});

	it('keeps the explicit collapsed choice when another run starts', () => {
		useSettingsStore.setState({ newShell: true });
		const tree = (busy: boolean) => [
			project({ conversations: [conversation({ children: [{ ...codexFix, busy }] })] }),
		];
		const { rerender } = setup({ projects: tree(true) });
		fireEvent.click(screen.getByRole('button', { name: 'Hide subtasks: Fix bug' }));
		expect(screen.queryByRole('button', { name: 'Codex Fix bug Working' })).toBeNull();
		rerender({ projects: tree(false) });
		rerender({ projects: tree(true) });
		expect(screen.queryByRole('button', { name: 'Codex Fix bug Working' })).toBeNull();
	});

	it('reveals nested descendants during search and when a grandchild is working', () => {
		useSettingsStore.setState({ newShell: true });
		const grandchild = conversation({ key: 'deep:tab-3', title: 'Check edge cases', busy: true });
		const parent = conversation({ children: [{ ...codexFix, children: [grandchild] }] });
		const { rerender } = setup({ projects: [project({ conversations: [parent] })] });
		expect(
			screen.getByRole('button', { name: 'Claude Code Check edge cases Working' })
		).toHaveStyle({
			paddingLeft: '44px',
		});
		rerender({
			search: 'edge',
			projects: [
				project({
					conversations: [conversation({ children: [{ ...grandchild, busy: false }] })],
				}),
			],
		});
		expect(
			screen.getByRole('button', { name: 'Claude Code Check edge cases' })
		).toBeInTheDocument();
	});

	it('does not expose children or their disclosure in the old shell', () => {
		useSettingsStore.setState({ newShell: false });
		setup({ projects: [project({ conversations: [conversation({ children: [codexFix] })] })] });
		expect(screen.queryByRole('button', { name: /subtasks:/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Codex Fix bug' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Claude Code Fix bug' })).toBeInTheDocument();
	});

	it('offers project default creation through the same project action', async () => {
		useSettingsStore.setState({ newShell: true });
		const { props } = setup();
		fireEvent.click(screen.getByRole('button', { name: 'New conversation: Maestro' }));
		fireEvent.click(await screen.findByRole('menuitem', { name: 'New with project defaults' }));
		expect(props.onNewConversation).toHaveBeenCalledWith(CLAUDE_AGENT.id);
	});
	it.each([false, true])(
		'opens project settings from the project context menu only in new shell %s',
		(newShell) => {
			useSettingsStore.setState({ newShell });
			const onProjectSettings = vi.fn();
			setup({ onProjectSettings });
			fireEvent.contextMenu(projectHeader(), { clientX: 40, clientY: 80 });
			if (newShell) {
				fireEvent.click(screen.getByRole('menuitem', { name: 'Project settings' }));
				expect(onProjectSettings).toHaveBeenCalledWith(
					expect.objectContaining({ key: 'project-maestro' })
				);
			} else {
				expect(
					screen.queryByRole('menuitem', { name: 'Project settings' })
				).not.toBeInTheDocument();
			}
		}
	);
	it.each([false, true])(
		'offers opening a conversation on the right only in new shell %s',
		(newShell) => {
			useSettingsStore.setState({ newShell });
			setup();
			fireEvent.contextMenu(screen.getByRole('button', { name: /^Codex Fix bug/ }));
			expect(!!screen.queryByRole('menuitem', { name: 'Open on the right' })).toBe(newShell);
		}
	);

	it.each([false, true])(
		'uses available local tools from the shared plus path, new shell %s',
		async (newShell) => {
			useSettingsStore.setState({ newShell });
			vi.mocked(window.maestro.context.conversation).mockResolvedValue({
				success: true,
				targets: [{ provider: 'claude-code' }, { provider: 'codex' }],
			} as never);
			const { props } = setup({ projects: [project({ agents: [CLAUDE_AGENT] })] });
			const button = screen.getByRole('button', { name: 'New conversation: Maestro' });
			if (newShell) expect(button).toHaveAttribute('aria-haspopup', 'menu');
			fireEvent.click(button);
			if (newShell) {
				fireEvent.click(
					await screen.findByRole('menuitem', { name: 'New conversation with Codex' })
				);
				await waitFor(() =>
					expect(window.maestro.context.conversation).toHaveBeenCalledWith({
						action: 'new-conversation',
						sourceAgentId: CLAUDE_AGENT.id,
						targetProvider: 'codex',
						replaceTabId: undefined,
					})
				);
				expect(props.onNewConversation).not.toHaveBeenCalled();
			} else expect(props.onNewConversation).toHaveBeenCalledWith(CLAUDE_AGENT.id);
		}
	);

	beforeEach(() => useSettingsStore.setState({ newShell: false }));

	it.each([false, true])(
		'gates provider filters and project configuration entries, new shell %s',
		(newShell) => {
			useSettingsStore.setState({ newShell });
			setup({ providers: ['claude-code', 'codex'] });
			expect(!!screen.queryByTestId('conversation-provider-filter')).toBe(!newShell);
			fireEvent.click(screen.getByRole('button', { name: 'New conversation: Maestro' }));
			expect(!!screen.queryByText('Add provider configuration')).toBe(!newShell);
			fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
			fireEvent.click(screen.getByRole('button', { name: 'Project actions: Maestro' }));
			expect(!!screen.queryByText('Manage agents')).toBe(!newShell);
			expect(
				screen.getByText(newShell ? 'Add account or configuration' : 'Add provider configuration')
			).toBeInTheDocument();
		}
	);

	it.each([false, true])(
		'names and hands off the exact conversation from either row menu, new shell %s',
		(newShell) => {
			useSettingsStore.setState({ newShell });
			setup();
			for (const open of [
				() => fireEvent.contextMenu(screen.getByRole('button', { name: /^Codex Fix bug/ })),
				() =>
					fireEvent.click(
						screen.getAllByRole('button', { name: 'Conversation actions: Fix bug' })[1]
					),
			]) {
				open();
				expect(screen.getByText(newShell ? 'Close conversation' : 'Close tab')).toBeInTheDocument();
				expect(!!screen.queryByText('Hand off…')).toBe(newShell);
				if (newShell) {
					fireEvent.click(screen.getByText('Hand off…'));
					expect(useModalStore.getState().modals.get('aiHandoff')).toMatchObject({
						open: true,
						data: { sessionId: 'owner-codex', tabId: 'tab-9' },
					});
				} else fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
			}
		}
	);

	it.each(['#181818', '#fafafa'])(
		'gives the new search placeholder AA contrast on %s',
		(background) => {
			useSettingsStore.setState({ newShell: true });
			setup({
				theme: {
					...mockTheme,
					colors: { ...mockTheme.colors, bgActivity: background, textDim: '#888888' },
				},
			});
			const input = screen.getByPlaceholderText('Search conversations...');
			const foreground = input.style.getPropertyValue('--placeholder-color');
			expect(foreground).not.toBe('');
			expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
			expect(input).toHaveClass('placeholder:opacity-100');
		}
	);

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

it('offers archive and native delete on Codex history only in the new shell', () => {
	useSettingsStore.setState({ newShell: true });
	const archive = vi.fn();
	const remove = vi.fn();
	setup({
		projects: [project({ conversations: [historyRow()] })],
		onArchiveConversation: archive,
		onDeleteConversation: remove,
	});
	fireEvent.contextMenu(screen.getByText('Old investigation').closest('button')!);
	fireEvent.click(screen.getByText('workflows.archive.archive'));
	expect(archive).toHaveBeenCalledWith(expect.objectContaining({ nativeSessionId: 'native-1' }));
	fireEvent.contextMenu(screen.getByText('Old investigation').closest('button')!);
	expect(screen.getByText('workflows.archive.delete')).toBeTruthy();
});

it('never offers native deletion for Claude, and hides archive actions in the classic shell', () => {
	useSettingsStore.setState({ newShell: true });
	const row = conversation({ nativeSessionId: 'claude-native' });
	const { rerender } = setup({
		projects: [project({ conversations: [row] })],
		onArchiveConversation: vi.fn(),
		onDeleteConversation: vi.fn(),
	});
	fireEvent.contextMenu(screen.getByText('Fix bug').closest('button')!);
	expect(screen.queryByText('workflows.archive.delete')).toBeNull();
	expect(screen.getByText('workflows.archive.archive')).toBeTruthy();
	fireEvent.keyDown(document, { key: 'Escape' });
	useSettingsStore.setState({ newShell: false });
	rerender({ projects: [project({ conversations: [row] })] });
	fireEvent.contextMenu(screen.getByText('Fix bug').closest('button')!);
	expect(screen.queryByText('workflows.archive.archive')).toBeNull();
});
it('expands archived conversations at the bottom of their project and unarchives through the shared operation', async () => {
	useSettingsStore.setState({ newShell: true });
	window.maestro.agentSessions.archiveConversation = vi.fn().mockResolvedValue({ success: true });
	setup({
		projects: [
			project({
				archivedConversations: [
					{
						key: 'archive',
						title: 'Archived item',
						provider: 'codex',
						nativeSessionId: 'native',
						projectPath: '/p',
						accountDir: '/synthetic-account',
						ownerIds: [],
					},
				] as never,
			}),
		],
	});
	expect(screen.queryByText('Archived item')).toBeNull();
	fireEvent.click(screen.getByText('workflows.archive.archived'));
	expect(screen.getByText('Archived item')).toBeTruthy();
	fireEvent.click(screen.getByText('workflows.archive.unarchive'));
	await waitFor(() =>
		expect(window.maestro.agentSessions.archiveConversation).toHaveBeenCalledWith(
			expect.objectContaining({ nativeSessionId: 'native', accountDir: '/synthetic-account' }),
			'unarchive'
		)
	);
});

it('shows a separate content group with highlighted snippet and keyboard opening in the new shell', () => {
	useSettingsStore.setState({ newShell: true });
	const hit = {
		conversation: { key: 'body-hit', title: 'Body result', projectPath: '/project' },
		matchPreview: 'before needle after',
		message: { role: 'assistant', text: 'needle' },
	};
	const open = vi.fn();
	setup({
		search: 'needle',
		projects: [],
		contentSearch: { hits: [hit], truncated: true },
		onSelectContent: open,
	});
	expect(screen.getByText('workflows.conversations.contentResults')).toBeTruthy();
	expect(screen.getByText('workflows.conversations.moreContentResults')).toBeTruthy();
	const row = screen.getByRole('button', { name: /Body result/ });
	expect(row.textContent).toContain('/project');
	expect(row.querySelector('mark')?.textContent).toBe('needle');
	fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown' });
	expect(document.activeElement).toBe(row);
	fireEvent.click(row);
	expect(open).toHaveBeenCalledWith(hit);
});
