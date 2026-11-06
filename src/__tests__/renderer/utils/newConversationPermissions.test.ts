import { beforeEach, describe, expect, it } from 'vitest';
import { createMockSession } from '../../helpers/mockSession';
import { createMockAITab } from '../../helpers/mockTab';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import { createTab, setActiveTab, permissionModeFields } from '../../../renderer/utils/tabHelpers';
import { resolveTabPermissionMode } from '../../../shared/agentMetadata';

beforeEach(() => {
	useSettingsStore.setState({ newShell: true });
	useSessionStore.setState({ sessions: [], groups: [] });
});

describe('new conversation permission inheritance', () => {
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
