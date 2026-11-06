import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import {
	createTab,
	closeTab,
	setActiveTab,
	permissionModeFields,
	navigateToUnifiedTabByIndex,
	navigateToNextUnifiedTab,
	navigateToPrevUnifiedTab,
} from '../../../renderer/utils/tabHelpers';
import { setCapabilitiesCache } from '../../../renderer/hooks/agent/useAgentCapabilities';
import { AGENT_CAPABILITIES } from '../../../main/agents/capabilities';
import { newConversationPermissionFields } from '../../../renderer/utils/tabHelpers/focusFields';
import { buildAgentArgs } from '../../../main/utils/agent-args';
import { getAgentDefinition } from '../../../main/agents/definitions';
import {
	conversationPermissionSnapshot,
	resolveProjectConversationPermission,
} from '../../../renderer/utils/newConversationPermissions';
import type { AgentConfig } from '../../../main/agents';
import { resolveTabPermissionMode } from '../../../shared/agentMetadata';

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
	window.maestro.windows = {
		...window.maestro.windows,
		getConversationPermissions: vi.fn().mockResolvedValue([]),
	};
	useSettingsStore.setState({ newShell: true });
	for (const [id, capabilities] of Object.entries(AGENT_CAPABILITIES))
		setCapabilitiesCache(id, capabilities);
	useSessionStore.setState({ sessions: [], groups: [] });
});

describe('new conversation permission inheritance', () => {
	it.each(['index', 'next', 'previous'] as const)(
		'inherits the readonly conversation selected by keyboard %s navigation',
		(navigation) => {
			const readonly = createMockAITab({
				id: 'readonly',
				createdAt: 1,
				lastSelectedAt: 1,
				...permissionModeFields('readonly'),
			});
			const full = createMockAITab({
				id: 'full',
				createdAt: 2,
				lastSelectedAt: 2,
				...permissionModeFields('full'),
			});
			const session = createMockSession({
				aiTabs: [readonly, full],
				activeTabId: full.id,
				unifiedTabOrder: [
					{ type: 'ai', id: readonly.id },
					{ type: 'ai', id: full.id },
				],
			});
			const selected =
				navigation === 'index'
					? navigateToUnifiedTabByIndex(session, 0)
					: navigation === 'next'
						? navigateToNextUnifiedTab(session)
						: navigateToPrevUnifiedTab(session);
			expect(selected?.session.activeTabId).toBe(readonly.id);
			expect(createTab(selected!.session)!.tab).toMatchObject(permissionModeFields('readonly'));
		}
	);
	it.each(['full', 'standard', 'readonly'] as const)(
		'inherits the current conversation %s permission without changing its source',
		(mode) => {
			const source = createMockAITab({ id: 'source', ...permissionModeFields(mode) });
			const session = createMockSession({ aiTabs: [source], activeTabId: source.id });
			const result = createTab(session, { permissionSource: source })!;
			expect(result.tab).toMatchObject(permissionModeFields(mode));
			Object.assign(result.tab, permissionModeFields('full'));
			expect(result.session.aiTabs[0]).toEqual(source);
			expect(source).toMatchObject(permissionModeFields(mode));
		}
	);

	it('normalizes legacy readonly and conflicting legacy flags using the canonical resolver', () => {
		for (const fields of [
			{ readOnlyMode: true },
			{ permissionMode: 'standard' as const, readOnlyMode: true },
		]) {
			const source = createMockAITab(fields);
			const result = createTab(createMockSession({ aiTabs: [source] }), {
				permissionSource: source,
			})!;
			expect(result.tab).toMatchObject(permissionModeFields(resolveTabPermissionMode(source)));
		}
	});

	it('uses the latest project conversation across tools instead of the target runner active tab', () => {
		const older = createMockAITab({ createdAt: 1, permissionMode: 'full' });
		const recent = createMockAITab({ createdAt: 2, permissionMode: 'readonly' });
		const target = createMockSession({
			id: 'target',
			toolType: 'claude-code',
			cwd: '/project',
			projectRoot: '/project',
			aiTabs: [older],
		});
		const source = createMockSession({
			id: 'source',
			toolType: 'codex',
			cwd: '/project',
			projectRoot: '/project',
			aiTabs: [recent],
		});
		useSessionStore.setState({ sessions: [target, source] });
		expect(createTab(target)!.tab).toMatchObject(permissionModeFields('readonly'));
	});

	it('uses recent activity and a newly selected older conversation', () => {
		const old = createMockAITab({
			id: 'old',
			createdAt: 1,
			permissionMode: 'readonly',
			logs: [{ id: 'log', timestamp: 3, source: 'user', text: 'recent turn' }],
		});
		const newer = createMockAITab({ id: 'newer', createdAt: 2, permissionMode: 'full' });
		const session = createMockSession({ aiTabs: [old, newer], activeTabId: newer.id });
		expect(createTab(session)!.tab.permissionMode).toBe('readonly');
		const selected = setActiveTab(session, newer.id)!.session;
		expect(createTab(selected)!.tab.permissionMode).toBe('full');
	});

	it('ignores other projects, remote hosts and hidden consult tabs', () => {
		const source = createMockAITab({ id: 'source', createdAt: 1, readOnlyMode: true });
		const target = createMockSession({
			id: 'target',
			projectRoot: '/project',
			cwd: '/project',
			aiTabs: [source, createMockAITab({ createdAt: 100, hidden: true, permissionMode: 'full' })],
		});
		useSessionStore.setState({
			sessions: [
				target,
				createMockSession({
					id: 'other',
					projectRoot: '/other',
					aiTabs: [createMockAITab({ createdAt: 200 })],
				}),
				createMockSession({
					id: 'remote',
					projectRoot: '/project',
					cwd: '/project',
					sessionSshRemoteConfig: { enabled: true, remoteId: 'host' },
					aiTabs: [createMockAITab({ createdAt: 300 })],
				}),
			],
		});
		expect(createTab(target)!.tab).toMatchObject(permissionModeFields('readonly'));
	});

	it('keeps the existing default for an empty project', () => {
		expect(resolveTabPermissionMode(createTab(createMockSession({ aiTabs: [] }))!.tab)).toBe(
			'full'
		);
	});

	it('leaves classic creation and native history imports unchanged', () => {
		const session = createMockSession({ aiTabs: [createMockAITab({ readOnlyMode: true })] });
		useSettingsStore.setState({ newShell: false });
		expect(createTab(session)!.tab.permissionMode).toBeUndefined();
		useSettingsStore.setState({ newShell: true });
		expect(createTab(session, { agentSessionId: 'native' })!.tab.permissionMode).toBeUndefined();
	});
});

describe('permission choices across tools', () => {
	it.each(['claude-code', 'codex'] as const)('preserves full and readonly for %s', (tool) => {
		for (const mode of ['full', 'readonly'] as const)
			expect(
				newConversationPermissionFields(permissionModeFields(mode), AGENT_CAPABILITIES[tool])
			).toEqual(permissionModeFields(mode));
	});
	it('keeps standard for Claude and DeepSeek but tightens it for Codex', () => {
		expect(
			newConversationPermissionFields(
				permissionModeFields('standard'),
				AGENT_CAPABILITIES['claude-code']
			)
		).toEqual(permissionModeFields('standard'));
		expect(
			newConversationPermissionFields(permissionModeFields('standard'), AGENT_CAPABILITIES.codex)
		).toEqual(permissionModeFields('readonly'));
	});
	it('refuses to widen when the target has no equally strict permission', () => {
		expect(
			newConversationPermissionFields(permissionModeFields('readonly'), {
				supportsReadOnlyMode: false,
			})
		).toBeNull();
		expect(
			newConversationPermissionFields(permissionModeFields('standard'), {
				supportsReadOnlyMode: false,
				supportsStandardPermissionMode: false,
			})
		).toBeNull();
	});
});

it('sends the inherited readonly fields as Codex sandbox arguments, and allows a deliberate later change', () => {
	const source = createMockAITab({ readOnlyMode: true });
	const result = createTab(createMockSession({ toolType: 'codex', aiTabs: [source] }), {
		permissionSource: source,
	})!;
	const agent = {
		...getAgentDefinition('codex')!,
		capabilities: AGENT_CAPABILITIES.codex,
		available: true,
	} as AgentConfig;
	const args = buildAgentArgs(agent, {
		baseArgs: [],
		prompt: 'Synthetic request',
		permissionMode: resolveTabPermissionMode(result.tab),
		readOnlyMode: result.tab.readOnlyMode,
	});
	expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
	expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
	Object.assign(result.tab, permissionModeFields('full'));
	expect(
		buildAgentArgs(agent, {
			baseArgs: [],
			prompt: 'Synthetic request',
			permissionMode: result.tab.permissionMode,
			readOnlyMode: result.tab.readOnlyMode,
		})
	).toContain('--dangerously-bypass-approvals-and-sandbox');
	expect(source.readOnlyMode).toBe(true);
});

it('keeps readonly in the automatic conversation created after closing the last tab', () => {
	const source = createMockAITab({ id: 'last', readOnlyMode: true });
	const session = createMockSession({ aiTabs: [source], activeTabId: source.id });
	const closed = closeTab(session, source.id)!;
	expect(closed.session.aiTabs[0]).toMatchObject({
		permissionMode: 'readonly',
		readOnlyMode: true,
	});
});

it('can inherit from a recently closed project conversation when only file tabs remain', () => {
	const source = createMockAITab({ readOnlyMode: true });
	const session = createMockSession({
		aiTabs: [],
		closedTabHistory: [{ tab: source, index: 0, closedAt: 1 }],
	});
	expect(createTab(session)!.tab).toMatchObject({ permissionMode: 'readonly', readOnlyMode: true });
});

describe('owner permission resolution', () => {
	it('uses live recency rather than unnecessarily retaining an old readonly restriction', async () => {
		const target = createMockSession({
			id: 'target',
			aiTabs: [createMockAITab({ permissionMode: 'readonly' })],
		});
		useSessionStore.setState({ sessions: [target] });
		vi.spyOn(window.maestro.windows, 'getConversationPermissions').mockResolvedValue([
			{
				sessionId: target.id,
				tabs: [{ id: 'latest', lastActivity: 50, permissionMode: 'full', readOnlyMode: false }],
			},
		]);
		expect(await resolveProjectConversationPermission(target)).toEqual(
			permissionModeFields('full')
		);
	});

	it.each(['reject', 'partial', 'absent'] as const)(
		'keeps the strictest known mode when an owner is %s',
		async (state) => {
			const target = createMockSession({
				id: 'target',
				aiTabs: [
					createMockAITab({ id: 'strict', permissionMode: 'standard', createdAt: 1 }),
					createMockAITab({ id: 'recent', permissionMode: 'full', createdAt: 2 }),
				],
			});
			useSessionStore.setState({ sessions: [target] });
			const read = vi.spyOn(window.maestro.windows, 'getConversationPermissions');
			if (state === 'reject') read.mockRejectedValue(new Error('owner unavailable'));
			else
				read.mockResolvedValue(
					state === 'absent'
						? [null]
						: [
								{
									sessionId: 'other',
									tabs: [
										{
											id: 'tightened',
											lastActivity: 3,
											permissionMode: 'readonly',
											readOnlyMode: true,
										},
									],
								},
								null,
							]
				);
			expect(await resolveProjectConversationPermission(target)).toEqual(
				permissionModeFields(state === 'partial' ? 'readonly' : 'standard')
			);
		}
	);

	it('queries only the same project and SSH host, without resolving remote paths locally', async () => {
		const target = createMockSession({
			id: 'remote',
			cwd: '~/project',
			projectRoot: '~/project',
			sessionSshRemoteConfig: { enabled: true, remoteId: 'host-a' },
		});
		useSessionStore.setState({
			sessions: [
				target,
				{ ...target, id: 'peer' },
				{
					...target,
					id: 'other-host',
					sessionSshRemoteConfig: { enabled: true, remoteId: 'host-b' },
				},
				{ ...target, id: 'other-project', projectRoot: '~/other', cwd: '~/other' },
				{ ...target, id: 'local', sessionSshRemoteConfig: undefined },
			],
		});
		const read = vi
			.spyOn(window.maestro.windows, 'getConversationPermissions')
			.mockResolvedValue([null, null]);
		await resolveProjectConversationPermission(target);
		expect(read).toHaveBeenCalledExactlyOnceWith(['remote', 'peer']);
	});

	it('owner snapshots include selected and retained closed tabs but omit hidden tabs and transcript text', () => {
		const selected = createMockAITab({
			id: 'selected',
			createdAt: 1,
			lastSelectedAt: 10,
			readOnlyMode: true,
		});
		const closed = createMockAITab({
			id: 'closed',
			createdAt: 2,
			logs: [{ id: 'l', timestamp: 20, source: 'user', text: 'private' }],
		});
		useSessionStore.setState({
			sessions: [
				createMockSession({
					id: 'owner',
					aiTabs: [selected, createMockAITab({ hidden: true })],
					closedTabHistory: [{ tab: closed, index: 0, closedAt: 30 }],
				}),
			],
		});
		expect(conversationPermissionSnapshot('owner')).toEqual({
			sessionId: 'owner',
			tabs: [
				{ id: 'closed', lastActivity: 20, permissionMode: 'full', readOnlyMode: false },
				{ id: 'selected', lastActivity: 10, permissionMode: 'readonly', readOnlyMode: true },
			],
		});
		expect(conversationPermissionSnapshot('missing')).toBeNull();
	});
});

describe('archived conversation permissions', () => {
	it('excludes archived tabs from recency and uses the strictest archive when nothing else remains', async () => {
		const archivedStrict = createMockAITab({
			id: 'strict',
			createdAt: 10,
			permissionMode: 'readonly',
			archived: true,
		});
		const archivedFull = createMockAITab({
			id: 'full',
			createdAt: 20,
			permissionMode: 'full',
			archived: true,
		});
		const normal = createMockAITab({ id: 'normal', createdAt: 1, permissionMode: 'standard' });
		const session = createMockSession({ aiTabs: [normal, archivedStrict, archivedFull] });
		useSessionStore.setState({ sessions: [session] });
		expect(createTab(session)!.tab.permissionMode).toBe('standard');
		session.aiTabs = [archivedStrict, archivedFull];
		expect(createTab(session)!.tab.permissionMode).toBe('readonly');
		vi.spyOn(window.maestro.windows, 'getConversationPermissions').mockImplementation(async () => [
			conversationPermissionSnapshot(session.id),
		]);
		expect(await resolveProjectConversationPermission(session)).toEqual(
			permissionModeFields('readonly')
		);
	});
});

it('retains archive permissions after restart even when only a different provider is configured', async () => {
	const { useConversationArchiveStore } =
		await import('../../../renderer/stores/conversationArchiveStore');
	const target = createMockSession({
		id: 'new-tool',
		toolType: 'codex',
		projectRoot: '/project',
		cwd: '/project',
		aiTabs: [],
	});
	useSessionStore.setState({ sessions: [target] });
	useConversationArchiveStore.setState({
		records: [
			{
				key: 'saved',
				provider: 'claude-code',
				projectPath: '/project',
				nativeSessionId: 'saved',
				ownerIds: [],
				permissionMode: 'readonly',
				archivedAt: 1,
			},
		] as never,
	});
	try {
		expect(createTab(target)!.tab.permissionMode).toBe('readonly');
	} finally {
		useConversationArchiveStore.setState({ records: [] });
	}
});

it('keeps worktree archive restrictions in the parent project', async () => {
	const { useConversationArchiveStore } =
		await import('../../../renderer/stores/conversationArchiveStore');
	const target = createMockSession({
		id: 'main',
		toolType: 'codex',
		projectRoot: '/project',
		cwd: '/project',
		aiTabs: [],
	});
	useSessionStore.setState({ sessions: [target] });
	useConversationArchiveStore.setState({
		records: [
			{
				key: 'worktree',
				provider: 'codex',
				projectPath: '/worktree',
				worktree: { path: '/worktree', commonDir: '/project/.git' },
				nativeSessionId: 'native',
				ownerIds: ['main'],
				permissionMode: 'readonly',
				archivedAt: 1,
			},
		] as never,
	});
	try {
		expect(createTab(target)!.tab.permissionMode).toBe('readonly');
	} finally {
		useConversationArchiveStore.setState({ records: [] });
	}
});
