import { describe, expect, it } from 'vitest';
import { buildProjectSessionTree } from '../../../renderer/utils/projectSessionTree';
import { sidebarSessionEquality } from '../../../renderer/stores/sessionEquality';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import type { ProjectHistoryConversation } from '../../../shared/projectHistory';

const origin = {
	kind: 'review' as const,
	sourceSessionId: 'parent-owner',
	sourceTabId: 'parent-tab',
	sourceProvider: 'claude-code',
	sourceNativeSessionId: 'parent-native',
	createdAt: 20,
};

const parent = createMockSession({
	id: 'parent-owner',
	toolType: 'claude-code',
	projectRoot: '/parent',
	aiTabs: [createMockAITab({ id: 'parent-tab', agentSessionId: 'parent-native', createdAt: 1 })],
});
const child = createMockSession({
	id: 'child-owner',
	toolType: 'codex',
	projectRoot: '/child',
	aiTabs: [
		createMockAITab({
			id: 'child-tab',
			name: 'Review parser.',
			origin,
			hidden: true,
			hasUnread: true,
		}),
	],
});
const history: ProjectHistoryConversation = {
	key: 'claude:local:account:parent-native',
	projectKey: 'path:local:/parent',
	projectPath: '/parent',
	provider: 'claude-code',
	accountDir: '/account',
	nativeSessionId: 'parent-native',
	title: 'Parent in history',
	preview: '',
	createdAt: 1,
	modifiedAt: 1,
	messageCount: 2,
	starred: false,
};

describe('new shell conversation children', () => {
	it('nests hidden consults under their source across projects without unread', () => {
		const tree = buildProjectSessionTree({ sessions: [parent, child], groups: [], newShell: true });
		expect(tree[0].conversations[0].children).toEqual([
			expect.objectContaining({ tabId: 'child-tab', provider: 'codex', unread: false }),
		]);
		expect(tree[1].conversations).toEqual([]);
	});

	it('keeps the classic tree and hidden consult behavior unchanged', () => {
		const tree = buildProjectSessionTree({ sessions: [parent, child], groups: [] });
		expect(tree[0].conversations[0].children).toBeUndefined();
		expect(tree[1].conversations).toEqual([]);
	});

	it('reattaches to the native history parent outside the first page', () => {
		const tree = buildProjectSessionTree({
			sessions: [
				{ ...parent, aiTabs: [], customEnvVars: { CLAUDE_CONFIG_DIR: '/account' } },
				child,
			],
			groups: [],
			newShell: true,
			history: [history],
			rowLimits: { 'path:local:/parent': 0 },
		});
		expect(tree[0].conversations[0]).toMatchObject({
			kind: 'history',
			nativeSessionId: 'parent-native',
			children: [expect.objectContaining({ tabId: 'child-tab' })],
		});
	});

	it('keeps native identities on another account or SSH host separate', () => {
		const tree = buildProjectSessionTree({
			sessions: [
				{ ...parent, aiTabs: [], customEnvVars: { CLAUDE_CONFIG_DIR: '/account' } },
				child,
			],
			groups: [],
			newShell: true,
			history: [
				{ ...history, accountDir: '/other' },
				{ ...history, key: 'remote', sshRemoteId: 'remote' },
			],
		});
		expect(tree[0].conversations.every((row) => !row.children?.length)).toBe(true);
		expect(tree[1].conversations[0].tabId).toBe('child-tab');
	});

	it('retains ancestors when a child matches search', () => {
		const tree = buildProjectSessionTree({
			sessions: [parent, child],
			groups: [],
			newShell: true,
			search: 'Review parser',
		});
		expect(tree).toHaveLength(1);
		expect(tree[0].conversations[0]).toMatchObject({
			tabId: 'parent-tab',
			children: [expect.objectContaining({ tabId: 'child-tab' })],
		});
	});

	it('reattaches to a reopened native parent with a new tab id', () => {
		const tree = buildProjectSessionTree({
			sessions: [{ ...parent, aiTabs: [{ ...parent.aiTabs[0], id: 'reopened' }] }, child],
			groups: [],
			newShell: true,
		});
		expect(tree[0].conversations[0]).toMatchObject({
			tabId: 'reopened',
			children: [expect.objectContaining({ tabId: 'child-tab' })],
		});
	});

	it('refreshes the sidebar when origin metadata changes', () => {
		const changed = {
			...child,
			aiTabs: [{ ...child.aiTabs[0], origin: { ...origin, sourceTabId: 'other' } }],
		};
		expect(sidebarSessionEquality([child], [changed])).toBe(false);
	});
});
