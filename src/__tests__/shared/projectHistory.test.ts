import { expect, it } from 'vitest';
import { projectHistoryScopeFor, type ProjectHistoryScope } from '../../shared/projectHistory';

const scopes: ProjectHistoryScope[] = [
	{ projectKey: 'parent', projectPath: '/repo', ownerIds: ['parent'] },
	{ projectKey: 'nested', projectPath: '/repo/packages', ownerIds: ['nested'] },
	{ projectKey: 'remote', projectPath: '/repo', sshRemoteId: 'host', ownerIds: ['remote'] },
];

it('uses the most specific directory boundary and isolates hosts', () => {
	expect(projectHistoryScopeFor(scopes, { projectPath: '/repo/packages/api' })?.projectKey).toBe(
		'nested'
	);
	expect(projectHistoryScopeFor(scopes, { projectPath: '/repo-other' })).toBeUndefined();
	expect(
		projectHistoryScopeFor(scopes, { projectPath: '/repo/packages/api', sshRemoteId: 'host' })
			?.projectKey
	).toBe('remote');
	expect(
		projectHistoryScopeFor(scopes, { projectPath: '/repo', sshRemoteId: 'other' })
	).toBeUndefined();
});

it('prefers an exact worktree project, otherwise uses its main repository', () => {
	const record = {
		projectPath: '/worktrees/topic',
		worktree: { path: '/worktrees/topic', commonDir: '/repo/.git' },
	};
	expect(projectHistoryScopeFor(scopes, record)?.projectKey).toBe('parent');
	expect(
		projectHistoryScopeFor(
			[...scopes, { projectKey: 'worktree', projectPath: record.projectPath, ownerIds: [] }],
			record
		)?.projectKey
	).toBe('worktree');
	expect(projectHistoryScopeFor(scopes, { ...record, sshRemoteId: 'host' })).toBeUndefined();
});

it('retains adapter-recognized project aliases and falls back to paths after regrouping', () => {
	expect(
		projectHistoryScopeFor(scopes, { projectPath: '/physical/alias/api', projectKey: 'parent' })
			?.projectKey
	).toBe('parent');
	expect(
		projectHistoryScopeFor(scopes, { projectPath: '/repo/api', projectKey: 'removed-group' })
			?.projectKey
	).toBe('parent');
	expect(
		projectHistoryScopeFor(scopes, {
			projectPath: '/elsewhere',
			projectKey: 'parent',
			sshRemoteId: 'host',
		})
	).toBeUndefined();
});

it('normalizes local Windows paths and preserves literal SSH backslashes', () => {
	const local = [{ projectKey: 'win', projectPath: 'C:\\repo\\', ownerIds: [] }];
	expect(projectHistoryScopeFor(local, { projectPath: 'c:\\repo\\api' })?.projectKey).toBe('win');
	expect(
		projectHistoryScopeFor(scopes, { projectPath: '/repo\\api', sshRemoteId: 'host' })
	).toBeUndefined();
	expect(
		projectHistoryScopeFor(
			[{ projectKey: 'remote', projectPath: '~/repo/', sshRemoteId: 'host', ownerIds: [] }],
			{ projectPath: '~/repo/api', sshRemoteId: 'host' }
		)?.projectKey
	).toBe('remote');
});
