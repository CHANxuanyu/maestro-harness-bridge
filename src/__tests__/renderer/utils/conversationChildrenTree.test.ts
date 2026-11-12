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

	it.each(['review', 'handoff', 'subtask'] as const)(
		'keeps %s native identities on another account or SSH host separate',
		(kind) => {
			const tree = buildProjectSessionTree({
				sessions: [
					{ ...parent, aiTabs: [], customEnvVars: { CLAUDE_CONFIG_DIR: '/account' } },
					{ ...child, aiTabs: [{ ...child.aiTabs[0], origin: { ...origin, kind } }] },
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
		}
	);

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

	it('hides descendants of an archived parent and restores them when unarchived', () => {
		const archived = {
			...history,
			archivedAt: 10,
			permissionMode: 'readonly' as const,
			ownerIds: [parent.id],
		};
		const sessions = [
			{ ...parent, aiTabs: [], customEnvVars: { CLAUDE_CONFIG_DIR: '/account' } },
			child,
		];
		const hidden = buildProjectSessionTree({
			sessions,
			groups: [],
			newShell: true,
			archives: [archived],
		});
		expect(hidden.flatMap((project) => project.conversations)).toEqual([]);
		const restored = buildProjectSessionTree({
			sessions,
			groups: [],
			newShell: true,
			history: [history],
		});
		expect(restored[0].conversations[0].children?.[0].tabId).toBe('child-tab');
	});

	it.each([false, true])(
		'nests handoffs, promotes them on archive, and reattaches (closed: %s)',
		(closed) => {
			const source = { ...parent, aiTabs: closed ? [] : parent.aiTabs };
			const moved = {
				...child,
				aiTabs: [{ ...child.aiTabs[0], origin: { ...origin, kind: 'handoff' as const } }],
			};
			const options = { sessions: [source, moved], groups: [], newShell: true, history: [history] };
			const visible = buildProjectSessionTree(options);
			expect(visible[0].conversations[0].children?.[0].tabId).toBe('child-tab');
			const archived = buildProjectSessionTree({
				...options,
				archives: [
					{ ...history, archivedAt: 10, ownerIds: [parent.id], permissionMode: 'readonly' },
				],
			});
			expect(archived[0].conversations).toEqual([]);
			expect(archived[1].conversations[0].tabId).toBe('child-tab');
			const restarted = buildProjectSessionTree(JSON.parse(JSON.stringify(options)));
			expect(restarted[0].conversations[0].children?.[0].tabId).toBe('child-tab');
		}
	);

	it.each(['review', 'handoff', 'subtask'] as const)(
		'allows a %s child to be archived independently',
		(kind) => {
			const nativeChild = {
				...child,
				aiTabs: [
					{ ...child.aiTabs[0], agentSessionId: 'child-native', origin: { ...origin, kind } },
				],
			};
			const archive = {
				...history,
				key: 'child-archive',
				provider: 'codex' as const,
				projectKey: 'path:local:/child',
				projectPath: '/child',
				nativeSessionId: 'child-native',
				archivedAt: 10,
				permissionMode: 'readonly' as const,
				ownerIds: [child.id],
			};
			const tree = buildProjectSessionTree({
				sessions: [parent, nativeChild],
				groups: [],
				newShell: true,
				archives: [archive],
			});
			expect(tree[0].conversations[0].tabId).toBe('parent-tab');
			expect(tree[0].conversations[0].children ?? []).toEqual([]);
			expect(tree[1].conversations).toEqual([]);
		}
	);

	it('indexes 5000 history identities once instead of scanning them for each of 1000 children', () => {
		const reads = (count: number) => {
			let identityReads = 0;
			const records = Array.from({ length: 5000 }, (_, i) => ({
				...history,
				key: 'history-' + i,
				get nativeSessionId() {
					identityReads++;
					return i === 0 ? 'parent-native' : 'native-' + i;
				},
			}));
			const children = {
				...child,
				aiTabs: Array.from({ length: count }, (_, i) => ({ ...child.aiTabs[0], id: 'child-' + i })),
			};
			const tree = buildProjectSessionTree({
				sessions: [{ ...parent, aiTabs: [] }, children],
				groups: [],
				newShell: true,
				history: records,
			});
			expect(
				tree[0].conversations.find((row) => row.nativeSessionId === 'parent-native')?.children
			).toHaveLength(count);
			return identityReads;
		};
		const small = reads(250);
		const large = reads(1000);
		expect(large).toBeLessThan(30000);
		expect(large).toBeLessThan(small * 1.6);
	});

	it('refreshes the sidebar when origin metadata changes', () => {
		const changed = {
			...child,
			aiTabs: [{ ...child.aiTabs[0], origin: { ...origin, sourceTabId: 'other' } }],
		};
		expect(sidebarSessionEquality([child], [changed])).toBe(false);
	});
});
