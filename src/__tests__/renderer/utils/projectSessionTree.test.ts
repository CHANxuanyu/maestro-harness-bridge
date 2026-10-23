import { describe, expect, it } from 'vitest';
import {
	buildProjectHistoryScopes,
	buildProjectSessionTree,
	providersInHistory,
	PROJECT_HISTORY_PAGE_SIZE,
} from '../../../renderer/utils/projectSessionTree';
import type { ProjectHistoryConversation } from '../../../shared/projectHistory';
import { sidebarSessionEquality } from '../../../renderer/stores/sessionEquality';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import type { Group } from '../../../renderer/types';

const project: Group = { id: 'project', name: 'Maestro', emoji: '📁', collapsed: false };

describe('project conversation navigation', () => {
	it('puts conversations from different harnesses directly in the existing project', () => {
		const codex = createMockSession({
			id: 'codex-owner',
			name: 'Backend configuration',
			toolType: 'codex',
			groupId: project.id,
			aiTabs: [createMockAITab({ id: 'same-tab-id', name: 'Fix bug', createdAt: 1 })],
		});
		const claude = createMockSession({
			id: 'claude-owner',
			name: 'Frontend configuration',
			toolType: 'claude-code',
			groupId: project.id,
			aiTabs: [createMockAITab({ id: 'same-tab-id', name: 'Fix bug', createdAt: 2 })],
		});
		const projects = buildProjectSessionTree({ sessions: [codex, claude], groups: [project] });
		expect(projects).toHaveLength(1);
		expect(projects[0].name).toBe('Maestro');
		expect(projects[0].conversations.map((row) => [row.key, row.provider])).toEqual([
			['claude-owner:same-tab-id', 'claude-code'],
			['codex-owner:same-tab-id', 'codex'],
		]);
		expect(codex.aiTabs[0].id).toBe('same-tab-id');
	});

	it('keeps hidden consults out while exposing an error on only the affected conversation', () => {
		const error = {
			type: 'session_busy' as const,
			message: 'busy',
			recoverable: true,
			agentId: 'codex',
		};
		const session = createMockSession({
			groupId: project.id,
			aiTabs: [
				createMockAITab({ id: 'hidden', hidden: true }),
				createMockAITab({ id: 'failed', agentError: error }),
				createMockAITab({ id: 'healthy' }),
			],
		});
		const rows = buildProjectSessionTree({ sessions: [session], groups: [project] })[0]
			.conversations;
		expect(rows.map((row) => row.tabId)).not.toContain('hidden');
		expect(rows.find((row) => row.tabId === 'failed')?.error).toBe(true);
		expect(rows.find((row) => row.tabId === 'healthy')?.error).toBe(false);
	});

	it('keeps nested projects collapsed until a search reveals their matching conversations', () => {
		const groups = [
			{ ...project, collapsed: true },
			{ ...project, id: 'child', name: 'Child', parentGroupId: project.id },
		];
		const sessions = [
			createMockSession({
				groupId: 'child',
				toolType: 'claude-code',
				aiTabs: [createMockAITab({ name: 'Needle' })],
			}),
		];
		expect(
			buildProjectSessionTree({ sessions, groups, groupsPlusEnabled: true }).map(
				(item) => item.groupId
			)
		).toEqual(['project']);
		const found = buildProjectSessionTree({
			sessions,
			groups,
			groupsPlusEnabled: true,
			search: 'claude',
		});
		expect(found.map((item) => item.groupId)).toEqual(['project', 'child']);
		expect(found[1].conversations[0].title).toBe('Needle');
		expect(groups[0].collapsed).toBe(true);
	});

	it('groups unassigned configurations by project path, keeping remote hosts separate', () => {
		const sessions = [
			createMockSession({ id: 'local-a', toolType: 'codex', projectRoot: '/projects/app' }),
			createMockSession({ id: 'local-b', toolType: 'claude-code', projectRoot: '/projects/app' }),
			createMockSession({
				id: 'remote',
				projectRoot: '/projects/app',
				sessionSshRemoteConfig: { enabled: true, remoteId: 'host-a' },
			}),
		];
		const projects = buildProjectSessionTree({
			sessions,
			groups: [],
			collapsedProjects: ['path:local:/projects/app'],
		});
		expect(projects).toHaveLength(2);
		expect(projects[0].agents.map((agent) => agent.id)).toEqual(['local-a', 'local-b']);
		expect(projects[0].collapsed).toBe(true);
		expect(projects[1].agents[0].id).toBe('remote');
	});

	it('inherits the worktree parent project and filters unread at conversation level', () => {
		const parent = createMockSession({ id: 'parent', groupId: project.id });
		const child = createMockSession({
			id: 'worktree',
			parentSessionId: parent.id,
			aiTabs: [createMockAITab({ id: 'read' }), createMockAITab({ id: 'unread', hasUnread: true })],
		});
		const rows = buildProjectSessionTree({
			sessions: [parent, child],
			groups: [project],
			unreadOnly: true,
		})[0].conversations;
		expect(rows.map((row) => row.tabId)).toEqual(['unread']);
		expect(rows[0].ownerId).toBe('worktree');
	});

	describe('native history', () => {
		const NATIVE = '0b7a1c2e-1111-4222-8333-944455556666';
		function record(
			overrides: Partial<ProjectHistoryConversation> = {}
		): ProjectHistoryConversation {
			return {
				key: `codex:local:/acct:${overrides.nativeSessionId ?? NATIVE}`,
				projectKey: `group:${project.id}`,
				projectPath: '/projects/app',
				provider: 'codex',
				nativeSessionId: NATIVE,
				title: 'Refactor parser',
				preview: 'Please refactor the parser',
				createdAt: 10,
				modifiedAt: 100,
				messageCount: 4,
				starred: false,
				...overrides,
			};
		}

		it('lists history with no runner directly under the project, with no configuration level', () => {
			const projects = buildProjectSessionTree({
				sessions: [],
				groups: [project],
				history: [record()],
			});
			const rows = projects[0].conversations;
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				kind: 'history',
				ownerId: null,
				tabId: null,
				provider: 'codex',
				title: 'Refactor parser',
			});
			expect(projects[0].totalCount).toBe(1);
		});

		it('merges an open tab with its native record into one row, and the record returns when the tab closes', () => {
			const owner = createMockSession({
				id: 'codex-owner',
				toolType: 'codex',
				groupId: project.id,
				projectRoot: '/projects/app',
				aiTabs: [createMockAITab({ id: 'tab', name: null, agentSessionId: NATIVE, createdAt: 5 })],
			});
			const open = buildProjectSessionTree({
				sessions: [owner],
				groups: [project],
				history: [record()],
			})[0].conversations;
			expect(open).toHaveLength(1);
			expect(open[0]).toMatchObject({ kind: 'open', tabId: 'tab', title: 'Refactor parser' });
			expect(open[0].modifiedAt).toBe(100);

			const closed = buildProjectSessionTree({
				sessions: [{ ...owner, aiTabs: [] }],
				groups: [project],
				history: [record({ ownerId: 'codex-owner' })],
			})[0].conversations;
			expect(closed.map((row) => row.kind)).toEqual(['history']);
			expect(closed[0].ownerId).toBe('codex-owner');
		});

		it('shows one row when two runners hold the same native conversation, and never a hidden consult', () => {
			const tab = (id: string, extra = {}) =>
				createMockAITab({ id, agentSessionId: NATIVE, createdAt: 1, ...extra });
			const a = createMockSession({
				id: 'a',
				toolType: 'codex',
				groupId: project.id,
				aiTabs: [tab('t1')],
			});
			const b = createMockSession({
				id: 'b',
				toolType: 'codex',
				groupId: project.id,
				aiTabs: [tab('t2'), createMockAITab({ id: 'consult', hidden: true, agentSessionId: 'x' })],
			});
			const rows = buildProjectSessionTree({
				sessions: [a, b],
				groups: [project],
				history: [record(), record({ modifiedAt: 50 })],
			})[0].conversations;
			expect(rows.map((row) => row.key)).toEqual(['a:t1']);
		});

		it('keeps a user-named tab title but finds the row by the provider native title', () => {
			const owner = createMockSession({
				id: 'maestro-owner',
				toolType: 'codex',
				groupId: project.id,
				projectRoot: '/projects/bridge',
				aiTabs: [
					createMockAITab({
						id: 'legacy',
						name: 'Example Conversation',
						agentSessionId: NATIVE,
						createdAt: 5,
					}),
				],
			});
			const native = {
				...record({ ownerId: 'maestro-owner', projectPath: '/projects/secretary' }),
				title: 'Example Conversation',
				nativeTitle: '查看示例项目的原生会话与工具支持',
			};
			const search = (query: string) =>
				buildProjectSessionTree({
					sessions: [owner],
					groups: [project],
					history: [native],
					search: query,
				})[0]?.conversations ?? [];

			const [row] = search('示例项目的原生会话');
			expect(row).toMatchObject({
				kind: 'open',
				tabId: 'legacy',
				// The name the user (or an older import) gave the tab is not overwritten.
				title: 'Example Conversation',
				nativeTitle: '查看示例项目的原生会话与工具支持',
			});
			// Still one row for one conversation, and the tab name keeps matching too.
			expect(search('Example Conversation').map((r) => r.key)).toEqual(['maestro-owner:legacy']);
			expect(search('no such title')).toEqual([]);
		});

		it('adds no alias when the native title is what the row already shows, or only an id', () => {
			const withNative = (base: ProjectHistoryConversation, nativeTitle: string) => ({
				...base,
				nativeTitle,
			});
			const rows = buildProjectSessionTree({
				sessions: [],
				groups: [project],
				history: [
					withNative(record({ key: 'same' }), 'Refactor parser'),
					withNative(record({ key: 'id-only', nativeSessionId: 'other' }), 'other'),
				],
			})[0].conversations;
			expect(rows.every((row) => row.nativeTitle === undefined)).toBe(true);
		});

		it('keeps the same native id in two account pools as two conversations', () => {
			const rows = buildProjectSessionTree({
				sessions: [],
				groups: [project],
				history: [
					record({ key: 'pool-a', accountEnvVar: 'CODEX_HOME', accountDir: '/home/u/.codex' }),
					record({ key: 'pool-b', accountEnvVar: 'CODEX_HOME', accountDir: '/work/codex' }),
				],
			})[0].conversations;
			expect(rows.map((row) => row.key)).toEqual(['history:pool-a', 'history:pool-b']);
		});

		it('merges a default-account runner (no env vars) into the record main says it owns', () => {
			const runner = createMockSession({
				id: 'default-runner',
				toolType: 'codex',
				groupId: project.id,
				customEnvVars: undefined,
				aiTabs: [createMockAITab({ id: 'tab', agentSessionId: NATIVE, createdAt: 1 })],
			});
			const rows = buildProjectSessionTree({
				sessions: [runner],
				groups: [project],
				history: [
					record({
						key: 'default-pool',
						ownerId: 'default-runner',
						accountEnvVar: 'CODEX_HOME',
						accountDir: '/home/u/.codex',
					}),
					record({ key: 'work-pool', accountEnvVar: 'CODEX_HOME', accountDir: '/work/codex' }),
				],
			})[0].conversations;
			expect(rows.map((row) => [row.kind, row.key])).toEqual([
				['open', 'default-runner:tab'],
				['history', 'history:work-pool'],
			]);
			expect(rows[0].history?.key).toBe('default-pool');
		});

		it('merges by explicit account, and refuses to guess when the pool is ambiguous', () => {
			const tab = createMockAITab({ id: 'tab', agentSessionId: NATIVE, createdAt: 1 });
			const pools = [
				record({ key: 'default-pool', accountEnvVar: 'CODEX_HOME', accountDir: '/home/u/.codex' }),
				record({ key: 'work-pool', accountEnvVar: 'CODEX_HOME', accountDir: '/work/codex/' }),
			];
			const explicit = createMockSession({
				id: 'work-runner',
				toolType: 'codex',
				groupId: project.id,
				customEnvVars: { CODEX_HOME: '/work/codex' },
				aiTabs: [tab],
			});
			const merged = buildProjectSessionTree({
				sessions: [explicit],
				groups: [project],
				history: pools,
			})[0].conversations;
			expect(merged.find((row) => row.kind === 'open')?.history?.key).toBe('work-pool');
			expect(merged).toHaveLength(2);

			const unknown = createMockSession({
				id: 'unknown-runner',
				toolType: 'codex',
				groupId: project.id,
				aiTabs: [tab],
			});
			const ambiguous = buildProjectSessionTree({
				sessions: [unknown],
				groups: [project],
				history: pools,
			})[0].conversations;
			// The open tab plus both pools: no record was silently merged into the tab.
			expect(ambiguous).toHaveLength(3);
			expect(ambiguous.find((row) => row.kind === 'open')?.history).toBeUndefined();
		});

		it('keeps the same native id on another host or provider as a different conversation', () => {
			const rows = buildProjectSessionTree({
				sessions: [],
				groups: [project],
				history: [
					record({ key: 'local' }),
					record({ key: 'remote', sshRemoteId: 'host-a' }),
					record({ key: 'claude', provider: 'claude-code' }),
				],
			})[0].conversations;
			expect(rows).toHaveLength(3);
		});

		it('never shows a bare id when a first message exists', () => {
			const rows = buildProjectSessionTree({
				sessions: [],
				groups: [project],
				history: [record({ title: NATIVE, preview: 'Fix the login bug\nmore text' })],
			})[0].conversations;
			expect(rows[0].title).toBe('Fix the login bug');
		});

		it('pages history per project while keeping every open tab, and search reaches past the page', () => {
			const history = Array.from({ length: 40 }, (_, i) =>
				record({
					key: `k${i}`,
					nativeSessionId: `native-${i}`,
					title: i === 39 ? 'Needle conversation' : `Conversation ${i}`,
					modifiedAt: 1000 - i,
				})
			);
			const owner = createMockSession({
				id: 'owner',
				toolType: 'claude-code',
				groupId: project.id,
				aiTabs: [createMockAITab({ id: 'old-open', name: 'Old tab', createdAt: 1 })],
			});
			const first = buildProjectSessionTree({ sessions: [owner], groups: [project], history })[0];
			expect(first.totalCount).toBe(41);
			expect(first.conversations).toHaveLength(PROJECT_HISTORY_PAGE_SIZE + 1);
			expect(first.conversations.some((row) => row.tabId === 'old-open')).toBe(true);
			expect(first.hiddenCount).toBe(41 - PROJECT_HISTORY_PAGE_SIZE - 1);

			const more = buildProjectSessionTree({
				sessions: [owner],
				groups: [project],
				history,
				rowLimits: { [`group:${project.id}`]: 30 },
			})[0];
			expect(more.conversations).toHaveLength(31);

			const found = buildProjectSessionTree({
				sessions: [owner],
				groups: [{ ...project, collapsed: true }],
				history,
				search: 'needle',
			})[0];
			expect(found.conversations.map((row) => row.title)).toEqual(['Needle conversation']);
		});

		it('filters by provider without leaving empty projects behind', () => {
			const other: Group = { id: 'other', name: 'Other', collapsed: false };
			const projects = buildProjectSessionTree({
				sessions: [],
				groups: [project, other],
				history: [
					record({ key: '1' }),
					record({ key: '2', provider: 'claude-code', projectKey: 'group:other' }),
				],
				providerFilter: 'claude-code',
			});
			expect(projects.map((item) => item.key)).toEqual(['group:other']);
			expect(providersInHistory([], [record(), record({ provider: 'claude-code' })])).toEqual([
				'claude-code',
				'codex',
			]);
		});

		it('scopes every path of a manual group, per host, with sorted owner hints', () => {
			const sessions = [
				createMockSession({ id: 'z', groupId: project.id, projectRoot: '/a', toolType: 'codex' }),
				createMockSession({
					id: 'y',
					groupId: project.id,
					projectRoot: '/a',
					toolType: 'claude-code',
				}),
				createMockSession({ id: 'x', groupId: project.id, projectRoot: '/b' }),
				createMockSession({
					id: 'r',
					projectRoot: '/a',
					sessionSshRemoteConfig: { enabled: true, remoteId: 'host-a' },
				}),
				createMockSession({ id: 't', toolType: 'terminal', projectRoot: '/c' }),
			];
			expect(buildProjectHistoryScopes(sessions, [project])).toEqual([
				{ projectKey: 'group:project', projectPath: '/a', ownerIds: ['y', 'z'] },
				{ projectKey: 'group:project', projectPath: '/b', ownerIds: ['x'] },
				{ projectKey: 'path:host-a:/a', projectPath: '/a', sshRemoteId: 'host-a', ownerIds: ['r'] },
			]);
		});
	});

	it('updates the sidebar when hidden, error or project identity changes, without subscribing to logs', () => {
		const before = createMockSession({ aiTabs: [createMockAITab({ createdAt: 1 })] });
		expect(
			sidebarSessionEquality(
				[before],
				[{ ...before, aiTabs: [{ ...before.aiTabs[0], hidden: true }] }]
			)
		).toBe(false);
		expect(
			sidebarSessionEquality(
				[before],
				[
					{
						...before,
						aiTabs: [
							{
								...before.aiTabs[0],
								agentError: {
									type: 'session_busy',
									message: 'busy',
									recoverable: true,
									agentId: 'codex',
								},
							},
						],
					},
				]
			)
		).toBe(false);
		expect(sidebarSessionEquality([before], [{ ...before, projectRoot: '/another/project' }])).toBe(
			false
		);
		expect(
			sidebarSessionEquality(
				[before],
				[
					{
						...before,
						aiTabs: [
							{
								...before.aiTabs[0],
								logs: [{ id: 'log', timestamp: 1, source: 'stdout', text: 'streaming' }],
							},
						],
					},
				]
			)
		).toBe(true);
	});
});
